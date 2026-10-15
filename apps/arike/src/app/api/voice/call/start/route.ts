import {NextRequest} from 'next/server';
import {guard} from '@/lib/guard';
import {cleanText,startCall,type Party} from '@/lib/calls';
export const runtime='nodejs';

const E164=/^\+[1-9]\d{7,14}$/;

export async function POST(request:NextRequest) {
  const blocked=guard(request,20);
  if(blocked) return blocked;
  try {
    const body=await request.json();
    const callback=body.mode==='callback';
    let customer:Party|undefined;
    if(callback) {
      const name=cleanText(body.context?.name,80);const phone=cleanText(body.context?.phone,20);
      if(name.length<2||!E164.test(phone)) return Response.json({error:'A customer name and phone are needed for a callback'},{status:400});
      customer={name,phone};
    }
    const callId=await startCall({direction:callback?'outbound':'inbound',customer});
    return Response.json({call_id:callId});
  } catch(error) {
    console.error('Call start failed',error);
    return Response.json({error:'Could not record the call'},{status:502});
  }
}
