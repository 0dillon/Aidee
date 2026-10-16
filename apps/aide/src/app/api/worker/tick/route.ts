import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {startOutbound} from '@/lib/outbound';
import {syncBimpeCalls} from '@/lib/bimpe-calls';
import type {Business} from '@/lib/vapi';

export async function POST(request:NextRequest) {
  if(!process.env.TRIGGER_WORKER_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.TRIGGER_WORKER_SECRET}`) return NextResponse.json({error:'Unauthorized'},{status:401});
  const now=new Date().toISOString();
  const events=await db<{id:string;business_id:string;payload:any}[]>('events',{query:`signature_valid=eq.true&dispatched_at=is.null&next_attempt_at=lte.${encodeURIComponent(now)}&order=next_attempt_at.asc&limit=10&select=*`});
  const outcomes=[];
  for(const event of events) {
    try {
      const business=(await db<Business[]>('businesses',{query:`id=eq.${event.business_id}&select=*`}))[0];
      if(!business) throw new Error('Business missing');
      const result=await startOutbound(business,event.payload.customer,event.payload.order,event.id);
      outcomes.push({event_id:event.id,...result});
    } catch(error) {outcomes.push({event_id:event.id,error:error instanceof Error?error.message:'Failed'});}
  }
  const calls=await syncBimpeCalls().catch(error=>({error:error instanceof Error?error.message:'Call sync failed'}));
  return NextResponse.json({processed:outcomes,calls});
}
