import 'server-only';
import {db} from '@/lib/db';
import {vapi,type Business} from '@/lib/vapi';
import {bimpeAgentId,makeBimpeCall} from '@/lib/bimpe';

type Customer = {name:string;phone:string};
type Order = {id:string;total:number};

export async function startOutbound(business:Business, customer:Customer, order:Order, eventId:string|null) {
  if(!/^\+[1-9]\d{7,14}$/.test(customer.phone)) throw new Error('Customer phone must be E.164');
  const useBimpe=Boolean(process.env.BIMPE_API_KEY);
  const providerCallId=useBimpe?await makeBimpeCall(bimpeAgentId(),customer.phone):await startVapi(business,customer,order,eventId);
  const trigger=(await db<{script:string}[]>('triggers',{query:`business_id=eq.${business.id}&event_type=eq.order.placed&select=script`}))[0];
  const linked=(await db<{id:string}[]>('customers',{query:`business_id=eq.${business.id}&phone=eq.${encodeURIComponent(customer.phone)}&select=id`}))[0];
  const conflict=useBimpe?'bimpe_call_id':'vapi_call_id';
  const rows=await db<{id:string}[]>('calls',{method:'POST',query:`on_conflict=${conflict}`,prefer:'resolution=merge-duplicates,return=representation',body:{
    business_id:business.id,customer_id:linked?.id||null,[conflict]:providerCallId,direction:'outbound',channel:'phone',status:'queued',trigger_event_id:eventId,
    context:{direction:'outbound',customer_name:customer.name,order_id:order.id,order_total_naira:order.total,script:trigger?.script||''}}});
  if(eventId) await db('events',{method:'PATCH',query:`id=eq.${eventId}`,body:{call_id:rows[0].id,dispatched_at:new Date().toISOString()}});
  return {provider_call_id:providerCallId,call_id:rows[0].id};
}

async function startVapi(business:Business, customer:Customer, order:Order, eventId:string|null) {
  const numberId=business.vapi_phone_number_id||process.env.VAPI_PHONE_NUMBER_ID;
  if(!business.vapi_assistant_id||!numberId) throw new Error('Vapi assistant or phone number is not configured');
  const firstMessage=`Hello ${customer.name}, this is Aide from ${business.name}. Your order ${order.id} for ${order.total} naira is placed. How would you rate your experience from one to five?`;
  const result=await vapi<{id:string}>('/call','POST',{
    phoneNumberId:numberId,assistantId:business.vapi_assistant_id,customer:{number:customer.phone,name:customer.name},
    assistantOverrides:{firstMessage},metadata:{businessId:business.id,eventId,orderId:order.id}
  });
  return result.id;
}
