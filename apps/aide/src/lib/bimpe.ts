import 'server-only';
import type {Action,Business} from '@/lib/vapi';

const BASE = 'https://api.bimpe.ai/api/v1/console';

export type BimpeCall = {id:string;status:string;direction:string;destination:string;source:string|null;duration_seconds:number|null;
  error_reason:string|null;end_reason:string|null;ringing_at:string|null;ended_at:string|null;started_at?:string|null;answered_at?:string|null;
  created_on?:string;conversation_logs?:{role:string;message?:string|null;created_at:string}[]};

export function bimpeAgentId() {
  const id = process.env.BIMPE_AGENT_ID;
  if (!id) throw new Error('BIMPE_AGENT_ID is not configured');
  return id;
}

export async function bimpe<T>(path:string, method:'GET'|'POST'|'PATCH'|'DELETE', body?:unknown):Promise<T> {
  const key = process.env.BIMPE_API_KEY;
  if (!key) throw new Error('BIMPE_API_KEY is not configured');
  const response = await fetch(`${BASE}${path}`,{
    method, headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:body === undefined ? undefined : JSON.stringify(body), cache:'no-store', signal:AbortSignal.timeout(20000)
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Bimpe ${method} ${path}: ${response.status} ${json?.message||json?.detail||text}`);
  return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}

export async function makeBimpeCall(agentId:string, destination:string) {
  const result = await bimpe<{status:string;call_id?:string;detail?:string}>(`/agents/${agentId}/calls`,'POST',{destination,is_test_call:false});
  if (result.status !== 'initiated' || !result.call_id) throw new Error(`Bimpe call ${result.status}${result.detail?`: ${result.detail}`:''}`);
  return result.call_id;
}

export const getBimpeCall = (agentId:string, callId:string) => bimpe<BimpeCall>(`/agents/${agentId}/calls/${callId}`,'GET');
export const listBimpeCalls = (agentId:string) => bimpe<BimpeCall[]>(`/agents/${agentId}/calls?limit=25&sort=-created_on`,'GET');

type Param = {name:string;type:string;description:string;required?:boolean};
function toParams(schema:Record<string,any>):Param[] {
  const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
  return Object.entries<any>(schema?.properties||{}).map(([name,def])=>({
    name, type:Array.isArray(def?.type)?def.type.find((t:string)=>t!=='null')||'string':def?.type||'string',
    description:def?.description||name, required:required.has(name)
  }));
}

const NATIVE_TOOLS = [
  {name:'lookup_postcode',description:'Resolve a spoken Nigerian NIPOST postcode into an address. Call before create_order.',params_schema:{type:'object',properties:{postcode:{type:'string'}},required:['postcode']}},
  {name:'schedule_followup',description:'Record a reminder the customer agreed to. due_date is YYYY-MM-DD.',params_schema:{type:'object',properties:{reason:{type:'string'},due_date:{type:'string'}},required:['reason','due_date']}},
  {name:'get_call_context',description:'Call FIRST on an outbound call. Returns the customer name, order and script to follow.',params_schema:{type:'object',properties:{}}},
  {name:'record_call_outcome',description:'Call once before hanging up to save the call results.',params_schema:{type:'object',properties:{
    intent:{type:'string'},outcome:{type:'string',description:'completed, abandoned or escalated'},account_created:{type:'boolean'},order_id:{type:'string'},
    rating:{type:'integer',description:'1 to 5'},promo_interest:{type:'string',description:'none, low, medium or high'},reminder_date:{type:'string'},
    sentiment:{type:'string',description:'negative, neutral or positive'},questions_asked:{type:'array'},unanswered_questions:{type:'array'}},required:['intent','outcome','sentiment']}}
];

export async function syncBimpe(business:Business, actions:Action[]) {
  const agentId = bimpeAgentId();
  const publicUrl = process.env.AIDE_PUBLIC_URL?.replace(/\/$/,'');
  const secret = process.env.BIMPE_TOOL_SECRET;
  if (!publicUrl?.startsWith('https://')) throw new Error('AIDE_PUBLIC_URL must be a public HTTPS URL for Bimpe');
  if (!secret) throw new Error('BIMPE_TOOL_SECRET is not configured');

  const existing = await bimpe<{id:string;config:{name:string}}[]>(`/agents/${agentId}/integrations/custom_api`,'GET');
  let integration = existing.find(i=>i.config?.name===`Aide ${business.name}`);
  if (integration) await bimpe(`/agents/${agentId}/integrations/custom_api/${integration.id}`,'DELETE');
  integration = await bimpe<{id:string;config:{name:string}}>(`/agents/${agentId}/integrations/custom_api/configure`,'POST',{
    name:`Aide ${business.name}`, description:`Actions for ${business.name} served through Aide`, base_url:publicUrl, auth_type:'bearer', auth_config:{token:secret}
  });

  const tools = [...actions.filter(a=>a.enabled),...NATIVE_TOOLS];
  for (const tool of tools) {
    await bimpe(`/agents/${agentId}/integrations/custom_api/${integration.id}/tools`,'POST',{
      name:tool.name, description:tool.description, http_method:'POST',
      url_template:`${publicUrl}/api/bimpe/tools/${tool.name}?business=${business.id}`,
      body_params:toParams(tool.params_schema), timeout:8000
    });
  }

  const kb = await bimpe<{id:string;name:string}[]>(`/agents/${agentId}/knowledge_bases`,'GET').catch(()=>[]);
  const name = `${business.name} policies`;
  const current = kb.find(k=>k.name===name);
  if (current) await bimpe(`/agents/${agentId}/knowledge_bases/${current.id}`,'PATCH',{content:business.knowledge});
  else await bimpe(`/agents/${agentId}/knowledge_bases`,'POST',{type:'text',name,content:business.knowledge});
  return {agent_id:agentId,integration_id:integration.id,tool_count:tools.length};
}
