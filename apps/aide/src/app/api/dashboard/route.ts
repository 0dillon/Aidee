import {NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import type {Action,Business} from '@/lib/vapi';

export async function GET() {
  try {
    await requireUser();
    const businesses=await db<Business[]>('businesses',{query:'select=*&order=created_at.desc'});
    const isLocal=(value:string)=>{try{return ['localhost','127.0.0.1','::1'].includes(new URL(value).hostname)}catch{return true}};
    // A local sample integration is developer rehearsal data, not an owner's connected business.
    const business=businesses.find(item=>!isLocal(item.site_url)&&!isLocal(item.api_base_url));
    if(!business) return NextResponse.json({business:null,actions:[],triggers:[],customers:[],calls:[],toolCalls:[],followups:[],metrics:null});
    const id=business.id;
    const [actions,triggers,allCustomers,allCalls,followups]=await Promise.all([
      db<Action[]>('actions',{query:`business_id=eq.${id}&select=*&order=name.asc`}),
      db('triggers',{query:`business_id=eq.${id}&select=*`}),
      db<Record<string,any>[]>('customers',{query:`business_id=eq.${id}&select=*&order=created_at.desc`}),
      db<Record<string,any>[]>('calls',{query:`business_id=eq.${id}&select=*&order=created_at.desc&limit=100`}),
      db('followups',{query:`business_id=eq.${id}&select=*&order=due_date.asc`})
    ]);
    // Synthetic setup history stays useful for internal rehearsal, but must never appear as an owner's real activity.
    const customers=allCustomers.filter(c=>!String(c.external_id||'').startsWith('demo-seed-'));
    const calls=allCalls.filter(c=>!String(c.vapi_call_id||'').startsWith('demo-seed-'));
    const ids=calls.map(c=>c.id);
    const toolCalls=ids.length?await db('tool_calls',{query:`call_id=in.(${ids.join(',')})&select=*&order=created_at.asc`}):[];
    const today=new Date().toISOString().slice(0,10);
    const recent=calls.filter(c=>String(c.started_at||c.created_at).startsWith(today));
    const ratings=calls.map(c=>Number(c.structured_data?.rating)).filter(n=>n>=1&&n<=5);
    const metrics={calls_today:recent.length,inbound:recent.filter(c=>c.direction==='inbound').length,
      outbound:recent.filter(c=>c.direction==='outbound').length,
      orders_via_aide:calls.filter(c=>!!c.structured_data?.order_id).length,
      average_rating:ratings.length?ratings.reduce((a,b)=>a+b,0)/ratings.length:null,
      promo_interest:['none','low','medium','high'].map(level=>({level,count:calls.filter(c=>c.structured_data?.promo_interest===level).length})),
      unanswered_questions:calls.flatMap(c=>c.structured_data?.unanswered_questions||[]).length};
    return NextResponse.json({business:{...business,shared_secret_encrypted:undefined},actions,triggers,customers,calls,toolCalls,followups,metrics});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Dashboard failed'},{status:401});}
}
