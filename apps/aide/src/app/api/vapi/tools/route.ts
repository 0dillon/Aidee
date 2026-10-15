import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {decrypt} from '@/lib/security';
import {lookupPostcode} from '@/lib/postcode';
import type {Action,Business} from '@/lib/vapi';

async function execute(name:string,args:Record<string,any>,business:Business,callId:string|null) {
  if(name==='lookup_postcode') return lookupPostcode(String(args.postcode||''));
  if(name==='schedule_followup') {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(args.due_date)||!args.reason) throw new Error('Please give a reason and calendar date');
    const call=callId?(await db<{id:string;customer_id:string|null}[]>('calls',{query:`vapi_call_id=eq.${encodeURIComponent(callId)}&select=id,customer_id`}))[0]:null;
    const rows=await db<{id:string}[]>('followups',{method:'POST',body:{business_id:business.id,call_id:call?.id||null,customer_id:call?.customer_id||null,reason:args.reason,due_date:args.due_date}});
    return {followup_id:rows[0].id};
  }
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

export async function POST(request:NextRequest) {
  const secret=process.env.VAPI_WEBHOOK_SECRET;
  if(!secret||request.headers.get('x-vapi-secret')!==secret) return NextResponse.json({error:'Unauthorized'},{status:401});
  const payload=await request.json();
  const call=payload.message?.call;
  const assistantId=call?.assistantId||call?.assistant?.id;
  const business=(await db<Business[]>('businesses',{query:`vapi_assistant_id=eq.${encodeURIComponent(String(assistantId||''))}&select=*`}))[0];
  if(!business) return NextResponse.json({error:'Unknown assistant'},{status:404});
  const list=payload.message?.toolCallList;
  if(!Array.isArray(list)) return NextResponse.json({results:[]});
  const rows=call?.id?await db<{id:string}[]>('calls',{method:'POST',query:'on_conflict=vapi_call_id',prefer:'resolution=merge-duplicates,return=representation',body:{business_id:business.id,vapi_call_id:call.id,direction:call.type==='outboundPhoneCall'?'outbound':'inbound',channel:call.type==='webCall'?'web':'phone',status:'in_progress',started_at:new Date().toISOString()}}):[];
  const results=[];
  for(const item of list) {
    const started=Date.now();const name=String(item.function?.name||'');const args=item.function?.arguments||{};
    let result:unknown;let error:string|undefined;
    try {result=await execute(name,args,business,call?.id||null);} catch(cause) {error=cause instanceof Error?cause.message:'I could not complete that action';}
    await db('tool_calls',{method:'POST',body:{call_id:rows[0]?.id||null,tool_name:name,args,result:error?{error}:result,status:error?'error':'ok',latency_ms:Date.now()-started}});
    results.push(error?{toolCallId:item.id,error}:{toolCallId:item.id,result:JSON.stringify(result)});
  }
  return NextResponse.json({results});
}
