import {NextRequest,NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {startOutbound} from '@/lib/outbound';
import {normalizePhone} from '@/lib/phone';
import type {Business} from '@/lib/vapi';

export async function POST(request:NextRequest) {
  try {await requireUser();const input=await request.json();
    const business=(await db<Business[]>('businesses',{query:`id=eq.${encodeURIComponent(input.business_id)}&select=*`}))[0];
    if(!business) return NextResponse.json({error:'Business not found'},{status:404});
    return NextResponse.json(await startOutbound(business,{name:input.name||'there',phone:normalizePhone(input.phone||process.env.DEMO_PHONE||'')},{id:input.order_id||'DEMO-001',total:Number(input.total)||32000},null));
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Call failed'},{status:400});}
}
