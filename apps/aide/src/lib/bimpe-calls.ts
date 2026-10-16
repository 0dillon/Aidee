import 'server-only';
import {db} from '@/lib/db';
import {bimpeAgentId,getBimpeCall,listBimpeCalls,type BimpeCall} from '@/lib/bimpe';
import type {Business} from '@/lib/vapi';

const RETRY_DELAY_MS = 300000;
const MAX_RETRIES = 1;

type CallRow = {id:string;bimpe_call_id:string;status:string;trigger_event_id:string|null;direction:string};

function localStatus(call:BimpeCall) {
  if (call.status==='ended') return call.answered_at||(call.duration_seconds??0)>0?'completed':'no_answer';
  if (call.status==='busy'||call.status==='cancelled') return 'no_answer';
  if (call.status==='answered') return 'in_progress';
  return call.status;
}

function transcript(call:BimpeCall) {
  return (call.conversation_logs||[]).filter(m=>m.message).map(m=>`${m.role==='user'?'Customer':'Aide'}: ${m.message}`).join('\n');
}

function values(call:BimpeCall) {
  const status=localStatus(call);
  const finished=['completed','no_answer','failed'].includes(status);
  const base:Record<string,unknown>={status,started_at:call.answered_at||call.started_at||null};
  if (!finished) return base;
  return {...base,ended_at:call.ended_at||new Date().toISOString(),duration_s:call.duration_seconds??null,transcript:transcript(call),
    summary:call.end_reason||call.error_reason||''};
}

async function scheduleRetry(row:CallRow) {
  if (!row.trigger_event_id) return;
  const event=(await db<{retry_count:number}[]>('events',{query:`id=eq.${row.trigger_event_id}&select=retry_count`}))[0];
  if (!event||event.retry_count>=MAX_RETRIES) return;
  await db('events',{method:'PATCH',query:`id=eq.${row.trigger_event_id}`,body:{dispatched_at:null,retry_count:event.retry_count+1,next_attempt_at:new Date(Date.now()+RETRY_DELAY_MS).toISOString()}});
}

async function refresh(row:CallRow,agentId:string) {
  const call=await getBimpeCall(agentId,row.bimpe_call_id);
  const next=values(call);
  await db('calls',{method:'PATCH',query:`id=eq.${row.id}`,body:next});
  if (next.status==='no_answer'&&row.status!=='no_answer') await scheduleRetry(row);
  return {call_id:row.id,status:next.status};
}

async function adoptInbound(agentId:string,business:Business) {
  const recent=await listBimpeCalls(agentId);
  const inbound=recent.filter(c=>c.direction==='inbound');
  if (!inbound.length) return [];
  const known=await db<{bimpe_call_id:string}[]>('calls',{query:`bimpe_call_id=in.(${inbound.map(c=>c.id).join(',')})&select=bimpe_call_id`});
  const seen=new Set(known.map(k=>k.bimpe_call_id));
  const fresh=inbound.filter(c=>!seen.has(c.id));
  for (const call of fresh) {
    await db('calls',{method:'POST',query:'on_conflict=bimpe_call_id',prefer:'resolution=ignore-duplicates,return=minimal',
      body:{business_id:business.id,bimpe_call_id:call.id,direction:'inbound',channel:'phone',status:'in_progress',started_at:call.created_on||new Date().toISOString()}});
  }
  return fresh.map(c=>c.id);
}

export async function syncBimpeCalls() {
  if (!process.env.BIMPE_API_KEY) return {skipped:'BIMPE_API_KEY not set'};
  const agentId=bimpeAgentId();
  const business=(await db<Business[]>('businesses',{query:'order=created_at.asc&limit=1&select=*'}))[0];
  const adopted=business?await adoptInbound(agentId,business).catch(()=>[]):[];
  const open=await db<CallRow[]>('calls',{query:'bimpe_call_id=not.is.null&status=in.(queued,ringing,answered,in_progress)&select=id,bimpe_call_id,status,trigger_event_id,direction&limit=25'});
  const updated=[];
  for (const row of open) {
    try {updated.push(await refresh(row,agentId));}
    catch(error) {updated.push({call_id:row.id,error:error instanceof Error?error.message:'Refresh failed'});}
  }
  return {adopted,updated};
}
