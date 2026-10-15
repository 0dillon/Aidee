// Seed visible, explicitly labelled demo history. Run with:
// node --env-file=apps/aide/.env.local scripts/seed-demo.mjs
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Supabase URL and service role key are required');
const headers = { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' };
async function rest(table, query='', options={}) {
  const response = await fetch(`${base}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    ...options, headers:{...headers,Prefer:'return=representation',...options.headers}
  });
  if (!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
  return response.json();
}
const [business] = await rest('businesses','select=id&order=created_at.desc&limit=1');
if (!business) throw new Error('Connect Arike from the Aide dashboard first');
const existing = await rest('calls',`business_id=eq.${business.id}&vapi_call_id=like.demo-seed-*&select=id&limit=1`);
if (existing.length) { console.log('Demo history already seeded'); process.exit(0); }
const names = ['Ada Okafor','Tomi Balogun','Zainab Musa','Chidi Eze','Mariam Bello','Kemi Adeyemi','Ifeanyi Obi','Bisi Lawal','Emeka Nwosu','Hauwa Ibrahim'];
const customers = [];
for (let i=0;i<names.length;i++) {
  const phone = `+2348000001${String(i).padStart(3,'0')}`;
  const [customer] = await rest('customers',`on_conflict=business_id,phone`,{
    method:'POST', headers:{Prefer:'resolution=merge-duplicates,return=representation'},
    body:JSON.stringify({business_id:business.id,external_id:`demo-seed-${i+1}`,name:names[i],phone})
  });
  customers.push(customer);
}
const questions = [
  'Why do I need an account?','What material is the Ada Shirt?','Which sizes are in stock?',
  'How long does delivery take?','Can I pay on delivery?','What is your returns policy?',
  'Does the Amara Set come in medium?','Can I order a second item?'
];
const gaps = ['Is the Ada Shirt waterproof?','Can you ship outside Nigeria?','Can I alter the sleeve length?'];
const now = Date.now();
const calls = Array.from({length:30},(_,i)=>{
  const outbound = i%3===2;
  const started = new Date(now-(30-i)*18*60*60*1000);
  const duration = 54+(i*17)%121;
  const customer = customers[i%customers.length];
  const rating = outbound ? 3+Math.floor(i/3)%3 : null;
  const question = questions[i%questions.length];
  const unanswered = i%7===0 ? [gaps[i%gaps.length]] : [];
  return {
    business_id:business.id,customer_id:customer.id,vapi_call_id:`demo-seed-${String(i+1).padStart(3,'0')}`,
    direction:outbound?'outbound':'inbound',channel:i%4===0?'web':'phone',status:'completed',
    started_at:started.toISOString(),ended_at:new Date(started.getTime()+duration*1000).toISOString(),duration_s:duration,
    transcript:`DEMO HISTORY — synthetic call, not a recording.\nCustomer: ${question}\nAide: ${unanswered.length ? "I don't know yet; I'll flag that for the team." : 'I can answer that from Arike’s published product and policy information.'}`,
    summary:`DEMO HISTORY — ${outbound?'Order callback and rating':'Product or policy question'} for ${customer.name}.`,
    structured_data:{intent:outbound?'order_feedback':'product_question',outcome:'completed',account_created:i<10,
      order_id:i%4===0?`DEMO-ORDER-${String(i+1).padStart(3,'0')}`:null,rating,
      promo_interest:outbound?['low','medium','high'][i%3]:'none',reminder_date:outbound&&i%2===0?new Date(now+7*86400000).toISOString().slice(0,10):null,
      sentiment:i%6===0?'neutral':'positive',questions_asked:[question],unanswered_questions:unanswered}
  };
});
await rest('calls','',{method:'POST',body:JSON.stringify(calls)});
console.log(`Seeded ${customers.length} demo customers and ${calls.length} synthetic calls`);
