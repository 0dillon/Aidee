import {NextRequest} from 'next/server';
import {guard} from '@/lib/guard';
import {endCall,isCallId} from '@/lib/calls';
export const runtime='nodejs';

export async function POST(request:NextRequest) {
  const blocked=guard(request,20);
  if(blocked) return blocked;
  try {
    const body=await request.json();
    if(!isCallId(body.call_id)) return Response.json({error:'Invalid call'},{status:400});
    const result=await endCall(body.call_id,String(body.transcript??''));
    return Response.json(result,{status:result.ok?200:404});
  } catch(error) {
    console.error('Call end failed',error);
    return Response.json({error:'Could not save the call'},{status:502});
  }
}
