import {NextRequest} from 'next/server';
import {actions,knowledge} from '@/lib/manifest';
import {runAction} from '@/lib/actions';
import {createChunker} from '@/lib/chunker';
import {guard} from '@/lib/guard';
import {cleanText,isCallId,linkCustomer,logToolCall,scheduleFollowup} from '@/lib/calls';
export const runtime='nodejs';

const MAX_ROUNDS=5;
const MAX_HISTORY=30;
const MAX_MESSAGE_CHARS=1200;
const TOOL_RESULT_CHARS=4000;

type ToolCall={id:string;name:string;arguments:string};
type Message={role:'user'|'assistant'|'tool';content:string|null;tool_calls?:unknown[];tool_call_id?:string};
type CallContext={name:string;order_id:string;items:string;total:string;estimated_delivery:string};

const followupTool={name:'schedule_followup',description:'Save a reminder the customer agreed to. Only call after they agree and confirm the date.',params_schema:{type:'object',properties:{reason:{type:'string'},due_date:{type:'string',description:'Date as YYYY-MM-DD'}},required:['reason','due_date']}};
const tools=[...actions,followupTool].map(action=>({type:'function',function:{name:action.name,description:action.description,parameters:action.params_schema}}));

const STYLE=`Everything you write is spoken aloud to a customer who may be blind: use plain words only, no lists, markdown, symbols or emojis. Say prices as "naira". Reply in one or two short sentences and ask one question at a time.`;
const ACCENT_NOTE=`The customer's words come from speech recognition of Nigerian-accented English and are often slightly wrong. The only products are The Ada Shirt, The Amara Set and The Zuri Dress. Match misheard words to these by sound: Ada may arrive as "other", "older", "adder" or "these"; Amara as "a mara" or "amora"; Zuri as "zoo ree" or "zury". When the request is unclear, do not guess a product: briefly offer the three products and ask which one. Never repeat the garbled words back to the customer.`;
const RULES=`Rules: use only business knowledge and tool results for facts. If a fact is missing say "I don't know". Confirm before any action that changes data. Read back names, sizes, prices and addresses. Never ask for card or bank details. To create an account collect and confirm the full name and phone number first, then call create_account. For product questions use search_products and get_product. For checkout collect product, size and quantity. Postcode lookup is not available yet, so collect the delivery address in words, read it back, get a clear yes, then call create_order with payment_method pay_on_delivery and address_needs_review true. Read back the order number and delivery estimate.`;

function inboundPrompt():string {
  return `You are Aide, the voice assistant for Arike Pre-order. ${STYLE}\nBusiness knowledge:\n${knowledge}\n${ACCENT_NOTE}\n${RULES}`;
}

function callbackPrompt(context:CallContext):string {
  const today=new Date().toISOString().slice(0,10);
  return `You are Aide, the voice assistant for Arike Pre-order, and you have just phoned ${context.name} about their order. ${STYLE} Today is ${today}.
Order ${context.order_id}: ${context.items}, total ${context.total} naira on delivery, estimated delivery ${context.estimated_delivery}. You have already greeted them and asked if now is a good time.
Business knowledge:\n${knowledge}\n${ACCENT_NOTE}
Follow this script one step at a time, waiting for each answer: 1) if it is a good time, confirm the order in one short line and ask if the details are right; 2) ask them to rate their ordering experience from 1 to 5; 3) announce only the promotion in the business knowledge; 4) ask how interested they are: not, a little, quite or very; 5) offer a reminder, and if they agree ask for the date, confirm it back, then call schedule_followup with the reason and the date as YYYY-MM-DD; 6) thank them and say goodbye. If it is not a good time, apologise, offer to call another time, and end politely. Answer any product question with the tools, then return to the script. Never ask for card or bank details.`;
}

function buildSystem(mode:unknown,raw:any):string {
  if(mode!=='callback') return inboundPrompt();
  return callbackPrompt({
    name:cleanText(raw?.name,60),order_id:cleanText(raw?.order_id,30),items:cleanText(raw?.items,200),
    total:cleanText(raw?.total,20),estimated_delivery:cleanText(raw?.estimated_delivery,20)
  });
}

function cleanHistory(raw:unknown):Message[] {
  if(!Array.isArray(raw)) return [];
  const allowed=new Set(['user','assistant','tool']);
  return raw.filter((m:any)=>m&&allowed.has(m.role)).slice(-MAX_HISTORY).map((m:any)=>({
    role:m.role,content:m.content===null?null:String(m.content??'').slice(0,MAX_MESSAGE_CHARS),
    ...(m.tool_calls?{tool_calls:m.tool_calls}:{}),...(m.tool_call_id?{tool_call_id:String(m.tool_call_id)}:{})
  }));
}

async function streamCompletion(system:string,messages:Message[],onText:(text:string)=>void):Promise<{text:string;toolCalls:ToolCall[]}> {
  const key=process.env.VOICE_LLM_API_KEY;
  if(!key) throw new Error('The voice assistant is not configured');
  const base=(process.env.VOICE_LLM_BASE_URL||'https://api.deepseek.com').replace(/\/$/,'');
  const model=process.env.VOICE_LLM_MODEL||'deepseek-chat';
  const response=await fetch(`${base}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({model,stream:true,temperature:0.3,max_tokens:350,tools,...(model.startsWith('openai/gpt-oss')?{reasoning_effort:'low'}:{}),messages:[{role:'system',content:system},...messages]}),
    signal:AbortSignal.timeout(30000),cache:'no-store'});
  if(!response.ok||!response.body) throw new Error(`The language model is unavailable (${response.status})`);
  const reader=response.body.getReader();const decoder=new TextDecoder();
  let pending='';let text='';const calls:ToolCall[]=[];
  for(;;) {
    const {done,value}=await reader.read();
    if(done) break;
    pending+=decoder.decode(value,{stream:true});
    const lines=pending.split('\n');pending=lines.pop()||'';
    for(const line of lines) {
      if(!line.startsWith('data:')) continue;
      const data=line.slice(5).trim();
      if(!data||data==='[DONE]') continue;
      const delta=JSON.parse(data).choices?.[0]?.delta;
      if(delta?.content){text+=delta.content;onText(delta.content);}
      for(const part of delta?.tool_calls||[]) {
        const slot=calls[part.index??0]??(calls[part.index??0]={id:'',name:'',arguments:''});
        if(part.id) slot.id=part.id;
        if(part.function?.name) slot.name+=part.function.name;
        if(part.function?.arguments) slot.arguments+=part.function.arguments;
      }
    }
  }
  return {text,toolCalls:calls.filter(Boolean)};
}

async function runTool(callId:string|null,name:string,args:Record<string,unknown>):Promise<unknown> {
  const started=Date.now();
  let body:unknown;let ok=true;
  if(name==='schedule_followup') {
    body=callId?await scheduleFollowup(callId,args):{error:'Reminders are only available during a call'};
    ok=!(body as {error?:string}).error;
  } else {
    const outcome=await runAction(name,args);
    body=outcome.body;ok=outcome.status<400;
    if(ok&&name==='create_account'&&callId) {
      const account=body as {customer_id?:string};
      await linkCustomer(callId,{name:cleanText(args.full_name,80),phone:cleanText(args.phone,20),external_id:account.customer_id}).catch(error=>console.error('Customer link failed',error));
    }
  }
  if(callId) void logToolCall(callId,name,args,body,ok?'ok':'error',Date.now()-started);
  return body;
}

export async function POST(request:NextRequest) {
  const blocked=guard(request,40);
  if(blocked) return blocked;
  let history:Message[];let system:string;let callId:string|null=null;
  try {
    const body=await request.json();
    history=cleanHistory(body.messages);
    system=buildSystem(body.mode,body.context);
    callId=isCallId(body.call_id)?body.call_id:null;
  } catch { return Response.json({error:'Invalid request'},{status:400}); }
  if(history.at(-1)?.role!=='user') return Response.json({error:'Say something first'},{status:400});

  const encoder=new TextEncoder();
  const stream=new ReadableStream({async start(controller) {
    const send=(event:Record<string,unknown>)=>{try{controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));}catch{}};
    const added:Message[]=[];
    try {
      for(let round=0;round<MAX_ROUNDS;round++) {
        const chunker=createChunker();
        const result=await streamCompletion(system,[...history,...added],piece=>chunker.push(piece).forEach(text=>send({type:'say',text})));
        chunker.flush().forEach(text=>send({type:'say',text}));
        if(!result.toolCalls.length) { added.push({role:'assistant',content:result.text}); break; }
        added.push({role:'assistant',content:result.text||null,tool_calls:result.toolCalls.map(call=>({id:call.id,type:'function',function:{name:call.name,arguments:call.arguments}}))});
        for(const call of result.toolCalls) {
          send({type:'action',name:call.name});
          let args:Record<string,unknown>={};
          try { args=JSON.parse(call.arguments||'{}'); } catch { /* invalid JSON from the model; the tool reports what is missing */ }
          const outcome=await runTool(callId,call.name,args);
          added.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(outcome).slice(0,TOOL_RESULT_CHARS)});
        }
      }
      send({type:'done',messages:added});
    } catch(error) {
      console.error('Voice chat failed',error);
      send({type:'error',message:'I could not answer that just now. Please try again.'});
    } finally { controller.close(); }
  }});
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'}});
}
