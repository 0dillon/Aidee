import {NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {syncBimpe} from '@/lib/bimpe';
import {syncVapi,type Action,type Business} from '@/lib/vapi';

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireUser(); const {id}=await params;
    const business=(await db<Business[]>('businesses',{query:`id=eq.${encodeURIComponent(id)}&select=*`}))[0];
    if (!business) return NextResponse.json({error:'Business not found'},{status:404});
    const actions=await db<Action[]>('actions',{query:`business_id=eq.${encodeURIComponent(id)}&select=*`});
    if(process.env.BIMPE_API_KEY) {
      const bimpeResult=await syncBimpe(business,actions);
      await db('businesses',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}`,body:{status:'connected'}});
      return NextResponse.json(bimpeResult);
    }
    const result=await syncVapi(business,actions);
    await db('businesses',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}`,body:{vapi_assistant_id:result.assistant_id,vapi_structured_output_id:result.structured_output_id,status:'connected'}});
    return NextResponse.json(result);
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Sync failed'},{status:400});}
}
