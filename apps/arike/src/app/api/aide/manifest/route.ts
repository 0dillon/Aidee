import { NextResponse } from 'next/server';

const object = (properties: Record<string,unknown>, required: string[]) => ({type:'object',properties,required});
const string = {type:'string'};
const knowledge = `Arike Pre-order makes clothing in small batches. A customer account is needed so we can contact you about sizing, order status and delivery. Payment is pay on delivery only; never request card or bank details. Pre-order delivery estimates depend on the product and begin when the order is placed. We accept returns for faulty items within 7 days of delivery; contact the team before returning an item. Current promotion: 10% off a second item ordered this month, confirmed by the team at delivery. Do not promise a discount on a single item.`;
const actions = [
  {name:'create_account',description:'Create or update a customer account after confirming name and phone.',method:'POST',path:'/api/aide/actions/create_account',params_schema:object({full_name:string,phone:string},['full_name','phone'])},
  {name:'search_products',description:'Find clothing and current sizes, prices and materials.',method:'POST',path:'/api/aide/actions/search_products',params_schema:object({query:string,size:string,max_price:{type:'number'}},['query'])},
  {name:'get_product',description:'Get exact product description, care and delivery days.',method:'POST',path:'/api/aide/actions/get_product',params_schema:object({product_id:string},['product_id'])},
  {name:'get_delivery_estimate',description:'Get the pre-order delivery estimate for a product.',method:'POST',path:'/api/aide/actions/get_delivery_estimate',params_schema:object({product_id:string,postcode:string},['product_id'])},
  {name:'create_order',description:'Place a pay-on-delivery order after customer confirms all details.',method:'POST',path:'/api/aide/actions/create_order',params_schema:object({customer_id:string,items:{type:'array',items:object({product_id:string,size:string,qty:{type:'integer'}},['product_id','size','qty'])},postcode:string,address_text:string,payment_method:string,address_needs_review:{type:'boolean'}},['customer_id','items','address_text','payment_method'])},
  {name:'get_order',description:'Get the current status and estimate of an order.',method:'POST',path:'/api/aide/actions/get_order',params_schema:object({order_id:string},['order_id'])}
];

export async function GET() {
  return NextResponse.json({business:{name:'Arike Pre-order',site_url:process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'},knowledge,actions});
}
