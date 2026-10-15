import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import type {Business} from '@/lib/vapi';

function extracted(call:any) {
  const outputs=call?.artifact?.structuredOutputs;
  if(outputs && typeof outputs==='object') {
    for(const entry of Object.values(outputs) as any[]) if(entry?.result && typeof entry.result==='object') return entry.result;
  }
  return call?.analysis?.structuredData || {};
}

export async function POST(request:NextRequest) {
  if(!process.env.VAPI_WEBHOOK_SECRET||request.headers.get('x-vapi-secret')!==process.env.VAPI_WEBHOOK_SECRET) return NextResponse.json({error:'Unauthorized'},{status:401});
  const {message}=await request.json();
  if(!message?.call?.id) return NextResponse.json({ok:true});
  const call=message.call;
  const assistantId=call.assistantId||call.assistant?.id;
  const business=(await db<Business[]>('businesses',{query:`vapi_assistant_id=eq.${encodeURIComponent(String(assistantId||''))}&select=*`}))[0];
  if(!business) return NextResponse.json({error:'Unknown assistant'},{status:404});
  const previous=(await db<{id:string;trigger_event_id:string|null;customer_id:string|null}[]>('calls',{query:`vapi_call_id=eq.${encodeURIComponent(call.id)}&select=id,trigger_event_id,customer_id`}))[0];
  const report=message.type==='end-of-call-report';
  const reason=String(message.endedReason||call.endedReason||'');
  const noAnswer=/no.answer|did.not.answer|customer-did-not-answer|voicemail/i.test(reason);
  const direction=call.type==='outboundPhoneCall'?'outbound':'inbound';
  const values:Record<string,unknown>={business_id:business.id,vapi_call_id:call.id,direction,channel:call.type==='webCall'?'web':'phone',
    status:report?(noAnswer?'no_answer':'completed'):(message.status||call.status||'in_progress')};
  if(report) Object.assign(values,{started_at:call.startedAt||null,ended_at:call.endedAt||new Date().toISOString(),
    duration_s:call.startedAt&&call.endedAt?Math.max(0,Math.round((Date.parse(call.endedAt)-Date.parse(call.startedAt))/1000)):null,
    transcript:message.artifact?.transcript||call.artifact?.transcript||call.transcript||'',
    summary:message.analysis?.summary||call.analysis?.summary||'',recording_url:message.artifact?.recordingUrl||call.artifact?.recordingUrl||call.recordingUrl||null,
    structured_data:extracted(message.artifact?message:call)});
  await db('calls',{method:'POST',query:'on_conflict=vapi_call_id',prefer:'resolution=merge-duplicates,return=representation',body:values});
  if(report && noAnswer && previous?.trigger_event_id) {
    const event=(await db<{retry_count:number}[]>('events',{query:`id=eq.${previous.trigger_event_id}&select=retry_count`}))[0];
    if(event && event.retry_count<1) await db('events',{method:'PATCH',query:`id=eq.${previous.trigger_event_id}`,body:{dispatched_at:null,retry_count:1,next_attempt_at:new Date(Date.now()+300000).toISOString()}});
  }
  return NextResponse.json({ok:true});
}
