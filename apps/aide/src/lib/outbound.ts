import 'server-only';
import {db} from '@/lib/db';
import {vapi,type Business} from '@/lib/vapi';

export async function startOutbound(business:Business, customer:{name:string;phone:string}, order:{id:string;total:number}, eventId:string|null) {
  const numberId=business.vapi_phone_number_id||process.env.VAPI_PHONE_NUMBER_ID;
  if(!business.vapi_assistant_id||!numberId) throw new Error('Vapi assistant or phone number is not configured');
  if(!/^\+[1-9]\d{7,14}$/.test(customer.phone)) throw new Error('Customer phone must be E.164');
  const firstMessage=`Hello ${customer.name}, this is Aide from ${business.name}. Your order ${order.id} for ${order.total} naira is placed. How would you rate your experience from one to five?`;
  const result=await vapi<{id:string}>('/call','POST',{
    phoneNumberId:numberId,assistantId:business.vapi_assistant_id,customer:{number:customer.phone,name:customer.name},
    assistantOverrides:{firstMessage},metadata:{businessId:business.id,eventId,orderId:order.id}
  });
  const linked=(await db<{id:string}[]>('customers',{query:`business_id=eq.${business.id}&phone=eq.${encodeURIComponent(customer.phone)}&select=id`}))[0];
  const rows=await db<{id:string}[]>('calls',{method:'POST',query:'on_conflict=vapi_call_id',prefer:'resolution=merge-duplicates,return=representation',body:{business_id:business.id,customer_id:linked?.id||null,vapi_call_id:result.id,
    direction:'outbound',channel:'phone',status:'queued',trigger_event_id:eventId}});
  if(eventId) await db('events',{method:'PATCH',query:`id=eq.${eventId}`,body:{call_id:rows[0].id,dispatched_at:new Date().toISOString()}});
  return {vapi_call_id:result.id,call_id:rows[0].id};
}
