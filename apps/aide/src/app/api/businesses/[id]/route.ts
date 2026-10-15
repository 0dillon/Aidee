import {NextRequest,NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import type {Business} from '@/lib/vapi';

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireUser(); const {id}=await params; const input=await request.json();
    const allowed:Record<string,unknown>={};
    for (const name of ['knowledge','status','site_url']) if (input[name]!==undefined) allowed[name]=input[name];
    if (!Object.keys(allowed).length) throw new Error('No supported fields');
    const rows=await db<Business[]>('businesses',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}`,body:allowed});
    if (!rows[0]) return NextResponse.json({error:'Business not found'},{status:404});
    return NextResponse.json({...rows[0],shared_secret_encrypted:undefined});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Update failed'},{status:400});}
}
