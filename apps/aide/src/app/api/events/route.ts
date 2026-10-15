import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {decrypt,validSignature} from '@/lib/security';
import type {Business} from '@/lib/vapi';

export async function POST(request:NextRequest) {
  const raw=await request.text(); let payload:Record<string,any>;
  try {payload=JSON.parse(raw);} catch {return NextResponse.json({error:'Invalid JSON'},{status:400});}
  const business=(await db<Business[]>('businesses',{query:`id=eq.${encodeURIComponent(String(payload.business_id||''))}&select=*`}))[0];
  if (!business) return NextResponse.json({error:'Unknown business'},{status:404});
  const valid=validSignature(raw,decrypt(business.shared_secret_encrypted),request.headers.get('X-Aide-Signature'));
  if (!valid) {
    await db('events',{method:'POST',body:{business_id:business.id,type:String(payload.type||'unknown'),payload,signature_valid:false}});
    return NextResponse.json({error:'Invalid signature'},{status:401});
  }
  if (payload.type!=='order.placed'||!payload.customer?.phone||!payload.order?.id) return NextResponse.json({error:'Invalid event'},{status:400});
  const customers=await db<{id:string}[]>('customers',{method:'POST',query:'on_conflict=business_id,phone',prefer:'resolution=merge-duplicates,return=representation',
    body:{business_id:business.id,external_id:payload.customer.external_id,name:payload.customer.name,phone:payload.customer.phone}});
  const trigger=(await db<{id:string;delay_seconds:number}[]>('triggers',{query:`business_id=eq.${business.id}&event_type=eq.order.placed&enabled=eq.true&select=*`}))[0];
  const due=trigger ? new Date(Date.now()+trigger.delay_seconds*1000).toISOString():null;
  const events=await db<{id:string}[]>('events',{method:'POST',body:{business_id:business.id,type:payload.type,payload,signature_valid:true,next_attempt_at:due}});
  await db('businesses',{method:'PATCH',query:`id=eq.${business.id}`,body:{last_event_at:new Date().toISOString()}});
  return NextResponse.json({event_id:events[0].id,customer_id:customers[0].id,scheduled_for:due},{status:202});
}
