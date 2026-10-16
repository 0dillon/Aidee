import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {db} from '@/lib/db';
import {executeTool,findCall,logToolCall} from '@/lib/tools';
import type {Business} from '@/lib/vapi';

function authorised(request:NextRequest) {
  const secret=process.env.BIMPE_TOOL_SECRET;
  if(!secret) return false;
  const given=Buffer.from(request.headers.get('authorization')||'');
  const expected=Buffer.from(`Bearer ${secret}`);
  return given.length===expected.length&&timingSafeEqual(given,expected);
}

export async function POST(request:NextRequest,{params}:{params:Promise<{name:string}>}) {
  if(!authorised(request)) return NextResponse.json({error:'Unauthorized'},{status:401});
  const {name}=await params;
  const businessId=request.nextUrl.searchParams.get('business')||'';
  const business=(await db<Business[]>('businesses',{query:`id=eq.${encodeURIComponent(businessId)}&select=*`}))[0];
  if(!business) return NextResponse.json({error:'Unknown business'},{status:404});
  const args=await request.json().catch(()=>({}));
  const started=Date.now();
  const ref={providerColumn:'bimpe_call_id' as const,providerId:null};
  let result:unknown;let error:string|undefined;
  try {result=await executeTool(name,args&&typeof args==='object'?args:{},business,ref);}
  catch(cause) {error=cause instanceof Error?cause.message:'I could not complete that action';}
  const call=await findCall(business,ref).catch(()=>null);
  await logToolCall(call?.id||null,name,args,result,error,started);
  return NextResponse.json(error?{error}:result as object);
}
