import 'server-only';

export type Business = {id:string;name:string;site_url:string;api_base_url:string;shared_secret_encrypted:string;knowledge:string;vapi_assistant_id:string|null;vapi_phone_number_id:string|null;vapi_structured_output_id:string|null;status:string;last_event_at:string|null};
export type Action = {id:string;business_id:string;name:string;description:string;method:string;path:string;params_schema:Record<string,unknown>;enabled:boolean};

export async function vapi<T>(path:string, method:'GET'|'POST'|'PATCH', body?:unknown):Promise<T> {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error('VAPI_API_KEY is not configured');
  const response = await fetch(`https://api.vapi.ai${path}`,{
    method, headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:body === undefined ? undefined : JSON.stringify(body), cache:'no-store', signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Vapi ${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export const structuredSchema = {
  type:'object', properties:{
    intent:{type:'string'}, outcome:{type:'string',enum:['completed','abandoned','escalated']},
    account_created:{type:'boolean'}, order_id:{type:['string','null']}, rating:{type:['integer','null'],minimum:1,maximum:5},
    promo_interest:{type:'string',enum:['none','low','medium','high']}, reminder_date:{type:['string','null']},
    sentiment:{type:'string',enum:['negative','neutral','positive']},
    questions_asked:{type:'array',items:{type:'string'}}, unanswered_questions:{type:'array',items:{type:'string'}}
  }, required:['intent','outcome','account_created','promo_interest','sentiment','questions_asked','unanswered_questions']
};

export function prompt(business:Business, outbound?:string) {
  return `You are Aide, the voice assistant for ${business.name}. Keep replies short, plain and warm. Ask one question at a time.\nBusiness knowledge:\n${business.knowledge}\nRules: Use only business knowledge and tool results for facts. Say "I don't know" if facts are missing. Confirm before every action that changes data. Read back names, sizes, prices and addresses. Never ask for card or bank details. For an account collect and confirm full name and E.164 phone before create_account. For checkout collect product, size and quantity. Ask for a postcode and use lookup_postcode. Read the address in words and get a yes before create_order with pay_on_delivery. If postcode lookup fails twice, accept a spoken landmark address and set address_needs_review true. For an outbound order callback, the first message identifies the order; ask for a 1 to 5 experience rating, announce only the promotion in business knowledge, ask interest level and offer a reminder. Call schedule_followup only after the customer agrees.\n${outbound ? `Outbound order callback: ${outbound}` : ''}`;
}

export async function syncVapi(business:Business, actions:Action[]) {
  const publicUrl = process.env.AIDE_PUBLIC_URL?.replace(/\/$/,'');
  if (!publicUrl?.startsWith('https://')) throw new Error('AIDE_PUBLIC_URL must be a public HTTPS URL for Vapi');
  const provider = process.env.VAPI_VOICE_PROVIDER;
  const voiceId = process.env.VAPI_VOICE_ID;
  if (!process.env.SAHARA_API_KEY && (!provider || !voiceId)) throw new Error('Set Sahara or VAPI_VOICE_PROVIDER and VAPI_VOICE_ID');
  const native = [
    {name:'lookup_postcode',description:'Resolve a Nigerian postcode into an address.',params_schema:{type:'object',properties:{postcode:{type:'string'}},required:['postcode']}},
    {name:'schedule_followup',description:'Record an agreed reminder date and reason.',params_schema:{type:'object',properties:{reason:{type:'string'},due_date:{type:'string'}},required:['reason','due_date']}}
  ];
  const toolIds:string[] = [];
  for (const action of [...actions.filter(a=>a.enabled),...native]) {
    const tool = await vapi<{id:string}>('/tool','POST',{
      type:'function',function:{name:action.name,description:('description' in action ? action.description : ''),parameters:action.params_schema},
      server:{url:`${publicUrl}/api/vapi/tools`,secret:process.env.VAPI_WEBHOOK_SECRET}
    });
    toolIds.push(tool.id);
  }
  let outputId = business.vapi_structured_output_id;
  if (!outputId) {
    const output = await vapi<{id:string}>('/structured-output','POST',{name:`${business.name} call insights`,type:'ai',description:'Extract the required Aide call insights',schema:structuredSchema});
    outputId = output.id;
  }
  const body = {
    name:`Aide for ${business.name}`, firstMessage:`Hello, this is Aide for ${business.name}. How may I help you?`,
    model:{provider:'openai',model:'gpt-4o-mini',messages:[{role:'system',content:prompt(business)}],toolIds},
    voice:process.env.SAHARA_API_KEY ? {provider:'custom-voice',server:{url:`${publicUrl}/api/tts/sahara`,secret:process.env.VAPI_WEBHOOK_SECRET,timeoutSeconds:45}} : {provider,voiceId},
    server:{url:`${publicUrl}/api/vapi/webhook`,secret:process.env.VAPI_WEBHOOK_SECRET},
    artifactPlan:{structuredOutputIds:[outputId]}
  };
  const assistant = business.vapi_assistant_id
    ? await vapi<{id:string}>(`/assistant/${business.vapi_assistant_id}`,'PATCH',body)
    : await vapi<{id:string}>('/assistant','POST',body);
  return {assistant_id:assistant.id,structured_output_id:outputId,tool_count:toolIds.length};
}
