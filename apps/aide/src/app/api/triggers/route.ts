import {NextRequest,NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';

export async function POST(request:NextRequest) {
  try {await requireUser(); const input=await request.json();
    if(input.event_type!=='order.placed') throw new Error('Only order.placed is supported in the MVP');
    const delay=Number(input.delay_seconds??60);
    if(!Number.isInteger(delay)||delay<0||delay>3600) throw new Error('Invalid delay');
    const rows=await db('triggers',{method:'POST',query:'on_conflict=business_id,event_type',prefer:'resolution=merge-duplicates,return=representation',body:{business_id:input.business_id,event_type:'order.placed',script:input.script||'',delay_seconds:delay,enabled:input.enabled!==false}});
    return NextResponse.json(rows);
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Save failed'},{status:400});}
}
