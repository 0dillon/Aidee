import { NextRequest, NextResponse } from 'next/server';

export async function POST(request:NextRequest) {
  const {email,password} = await request.json();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anon) return NextResponse.json({error:'Supabase Auth is not configured'},{status:503});
  const response = await fetch(`${base}/auth/v1/token?grant_type=password`,{
    method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({email,password}),cache:'no-store'
  });
  const payload = await response.json();
  if (!response.ok) return NextResponse.json({error:'Invalid email or password'},{status:401});
  const result = NextResponse.json({ok:true});
  result.cookies.set('aide_session',payload.access_token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:payload.expires_in});
  return result;
}
