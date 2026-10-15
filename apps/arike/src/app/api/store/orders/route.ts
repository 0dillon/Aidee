import {NextRequest,NextResponse} from 'next/server';
import {createAccount,createOrder} from '@/lib/data';
export async function POST(request:NextRequest) {
  try {const input=await request.json(); const account=await createAccount(input.full_name,input.phone);
    const order=await createOrder({customer_id:account.customer_id,items:input.items,postcode:input.postcode,
      address_text:input.address_text,payment_method:'pay_on_delivery',address_needs_review:!!input.address_needs_review});
    return NextResponse.json(order,{status:201});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Order failed'},{status:400});}
}
