import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {executeTool,logToolCall} from '@/lib/tools';
import type {Business} from '@/lib/vapi';

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
    try {result=await executeTool(name,args,business,{providerColumn:'vapi_call_id',providerId:call?.id||null});} catch(cause) {error=cause instanceof Error?cause.message:'I could not complete that action';}
    await logToolCall(rows[0]?.id||null,name,args,result,error,started);
    results.push(error?{toolCallId:item.id,error}:{toolCallId:item.id,result:JSON.stringify(result)});
  }
  return NextResponse.json({results});
}
