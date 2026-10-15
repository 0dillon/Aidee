import 'server-only';
import {query} from '@/lib/data';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const MAX_TRANSCRIPT_CHARS=12000;
const EXTRACT_TIMEOUT_MS=20000;

export type Party={name:string;phone:string;external_id?:string};
type CallRow={id:string;status:string;started_at:string|null;customer_id:string|null};

export const isCallId=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
export const cleanText=(value:unknown,max:number)=>String(value??'').replace(/[\r\n]+/g,' ').trim().slice(0,max);

function businessId():string {
  const id=process.env.AIDE_BUSINESS_ID;
  if(!id) throw new Error('AIDE_BUSINESS_ID is not configured');
  return id;
}

export async function upsertCustomer(party:Party):Promise<string> {
  const rows=await query<{id:string}[]>('customers',{method:'POST',query:'on_conflict=business_id,phone',prefer:'resolution=merge-duplicates,return=representation',
    body:{business_id:businessId(),name:party.name,phone:party.phone,...(party.external_id?{external_id:party.external_id}:{})}});
  return rows[0].id;
}

export async function startCall(input:{direction:'inbound'|'outbound';customer?:Party}):Promise<string> {
  const customerId=input.customer?await upsertCustomer(input.customer):null;
  const rows=await query<{id:string}[]>('calls',{method:'POST',body:{business_id:businessId(),customer_id:customerId,direction:input.direction,channel:'web',status:'in-progress',started_at:new Date().toISOString()}});
  return rows[0].id;
}

async function loadCall(callId:string):Promise<CallRow|null> {
  const rows=await query<CallRow[]>('calls',{query:`id=eq.${callId}&business_id=eq.${businessId()}&select=id,status,started_at,customer_id`});
  return rows[0]??null;
}

export async function linkCustomer(callId:string,party:Party):Promise<void> {
  const customerId=await upsertCustomer(party);
  await query('calls',{method:'PATCH',query:`id=eq.${callId}`,body:{customer_id:customerId},prefer:'return=minimal'}).catch(()=>undefined);
}

export async function logToolCall(callId:string,name:string,args:unknown,result:unknown,status:'ok'|'error',latencyMs:number):Promise<void> {
  await query('tool_calls',{method:'POST',prefer:'return=minimal',body:{call_id:callId,tool_name:name,args,result,status,latency_ms:latencyMs}}).catch(error=>console.error('Tool call log failed',error));
}

export async function scheduleFollowup(callId:string,args:{reason?:unknown;due_date?:unknown}):Promise<{followup_id?:string;error?:string}> {
  const reason=cleanText(args.reason,200);const due=cleanText(args.due_date,10);
  if(!reason||!ISO_DATE.test(due)) return {error:'A reason and a date in year-month-day form are needed'};
  if(due<new Date().toISOString().slice(0,10)) return {error:'The reminder date must not be in the past'};
  const call=await loadCall(callId);
  if(!call) return {error:'Call not found'};
  const rows=await query<{id:string}[]>('followups',{method:'POST',body:{business_id:businessId(),customer_id:call.customer_id,call_id:callId,reason,due_date:due}});
  return {followup_id:rows[0].id};
}

const EXTRACTION_PROMPT=`Extract call insights from this customer-support call transcript. Reply with one JSON object only, using exactly these keys: intent (short string), outcome ("completed"|"abandoned"|"escalated"), account_created (boolean), order_id (string or null), rating (integer 1 to 5 or null), promo_interest ("none"|"low"|"medium"|"high"), reminder_date (YYYY-MM-DD or null), sentiment ("negative"|"neutral"|"positive"), questions_asked (array of strings), unanswered_questions (array of strings the assistant could not answer), summary (at most two sentences). Use only what the transcript states; never invent a rating or date.`;

async function extractInsights(transcript:string):Promise<{summary:string;structured:Record<string,unknown>}> {
  const key=process.env.VOICE_LLM_API_KEY;
  if(!key||!transcript.trim()) return {summary:'Call ended.',structured:{}};
  const base=(process.env.VOICE_LLM_BASE_URL||'https://api.deepseek.com').replace(/\/$/,'');
  try {
    const response=await fetch(`${base}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:process.env.VOICE_LLM_MODEL||'deepseek-chat',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:EXTRACTION_PROMPT},{role:'user',content:transcript.slice(0,MAX_TRANSCRIPT_CHARS)}]}),
      signal:AbortSignal.timeout(EXTRACT_TIMEOUT_MS),cache:'no-store'});
    if(!response.ok) throw new Error(`Extraction ${response.status}`);
    const parsed=JSON.parse((await response.json()).choices?.[0]?.message?.content??'{}');
    const {summary,...structured}=parsed;
    return {summary:cleanText(summary,500)||'Call ended.',structured};
  } catch(error) {
    console.error('Call insight extraction failed',error);
    return {summary:'Call ended. Insights could not be extracted.',structured:{}};
  }
}

export async function endCall(callId:string,transcript:string):Promise<{ok:boolean}> {
  const call=await loadCall(callId);
  if(!call||call.status==='ended') return {ok:!!call};
  const endedAt=new Date();
  const started=call.started_at?new Date(call.started_at):endedAt;
  const trimmed=transcript.slice(0,MAX_TRANSCRIPT_CHARS);
  const {summary,structured}=await extractInsights(trimmed);
  await query('calls',{method:'PATCH',query:`id=eq.${callId}`,prefer:'return=minimal',
    body:{status:'ended',ended_at:endedAt.toISOString(),duration_s:Math.max(0,Math.round((endedAt.getTime()-started.getTime())/1000)),transcript:trimmed,summary,structured_data:structured}});
  return {ok:true};
}
