import 'server-only';
import {db} from '@/lib/db';
import {decrypt} from '@/lib/security';
import {lookupPostcode} from '@/lib/postcode';
import type {Action,Business} from '@/lib/vapi';

type CallRef = {providerColumn:'vapi_call_id'|'bimpe_call_id'; providerId:string|null};
type CallRow = {id:string;customer_id:string|null;context:Record<string,unknown>;structured_data:Record<string,unknown>};

const ACTIVE = '(queued,ringing,answered,in_progress)';
const ACTIVE_WINDOW_MS = 30*60*1000;

export async function findCall(business:Business, ref:CallRef):Promise<CallRow|null> {
  const select='id,customer_id,context,structured_data';
  if (ref.providerId) {
    const hit=(await db<CallRow[]>('calls',{query:`${ref.providerColumn}=eq.${encodeURIComponent(ref.providerId)}&select=${select}`}))[0];
    if (hit) return hit;
  }
  const since=new Date(Date.now()-ACTIVE_WINDOW_MS).toISOString();
  return (await db<CallRow[]>('calls',{query:`business_id=eq.${business.id}&status=in.${ACTIVE}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1&select=${select}`}))[0]||null;
}

async function callAction(name:string,args:Record<string,any>,business:Business) {
  const action=(await db<Action[]>('actions',{query:`business_id=eq.${business.id}&name=eq.${encodeURIComponent(name)}&enabled=eq.true&select=*`}))[0];
  if(!action) throw new Error('That action is unavailable');
  const url=new URL(action.path,business.api_base_url);
  if(url.origin!==new URL(business.api_base_url).origin) throw new Error('Action URL is invalid');
  const response=await fetch(url,{method:action.method,headers:{'Content-Type':'application/json','X-Aide-Key':decrypt(business.shared_secret_encrypted)},
    body:action.method==='GET'?undefined:JSON.stringify(args),signal:AbortSignal.timeout(8000),cache:'no-store'});
  const value=await response.json();
  if(!response.ok) throw new Error(typeof value.error==='string'?value.error:'The business action failed');
  return value;
}

const PROMO=['none','low','medium','high'];
const SENTIMENT=['negative','neutral','positive'];
const OUTCOME=['completed','abandoned','escalated'];

function cleanOutcome(args:Record<string,any>) {
  const list=(v:unknown)=>Array.isArray(v)?v.map(String).slice(0,20):[];
  const rating=Number(args.rating);
  return {
    intent:String(args.intent||'').slice(0,200),
    outcome:OUTCOME.includes(args.outcome)?args.outcome:'completed',
    account_created:args.account_created===true,
    order_id:args.order_id?String(args.order_id):null,
    rating:Number.isInteger(rating)&&rating>=1&&rating<=5?rating:null,
    promo_interest:PROMO.includes(args.promo_interest)?args.promo_interest:'none',
    reminder_date:/^\d{4}-\d{2}-\d{2}$/.test(String(args.reminder_date||''))?args.reminder_date:null,
    sentiment:SENTIMENT.includes(args.sentiment)?args.sentiment:'neutral',
    questions_asked:list(args.questions_asked),unanswered_questions:list(args.unanswered_questions)
  };
}

export async function executeTool(name:string,args:Record<string,any>,business:Business,ref:CallRef) {
  if(name==='lookup_postcode') return lookupPostcode(String(args.postcode||''));
  if(name==='schedule_followup') {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(args.due_date)||!args.reason) throw new Error('Please give a reason and calendar date');
    const call=await findCall(business,ref);
    const rows=await db<{id:string}[]>('followups',{method:'POST',body:{business_id:business.id,call_id:call?.id||null,customer_id:call?.customer_id||null,reason:args.reason,due_date:args.due_date}});
    return {followup_id:rows[0].id};
  }
  if(name==='get_call_context') {
    const call=await findCall(business,ref);
    return call&&Object.keys(call.context||{}).length?call.context:{direction:'inbound',note:'No outbound context. This is an inbound call.'};
  }
  if(name==='record_call_outcome') {
    const call=await findCall(business,ref);
    if(!call) throw new Error('No active call to record against');
    const merged={...call.structured_data,...cleanOutcome(args)};
    await db('calls',{method:'PATCH',query:`id=eq.${call.id}`,body:{structured_data:merged}});
    return {saved:true};
  }
  return callAction(name,args,business);
}

export async function logToolCall(callId:string|null,name:string,args:unknown,result:unknown,error:string|undefined,started:number) {
  await db('tool_calls',{method:'POST',body:{call_id:callId,tool_name:name,args,result:error?{error}:result,status:error?'error':'ok',latency_ms:Date.now()-started}});
}
