import {NextRequest,NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {encrypt} from '@/lib/security';
import type {Business} from '@/lib/vapi';

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireUser(); const {id}=await params; const input=await request.json();
    const allowed:Record<string,unknown>={};
    if(input.name!==undefined){const name=String(input.name).trim();if(!name||name.length>100)throw new Error('Business name must be 1 to 100 characters');allowed.name=name;}
    if(input.site_url!==undefined){const site=new URL(String(input.site_url));if(!['https:','http:'].includes(site.protocol))throw new Error('Website URL must use HTTP or HTTPS');allowed.site_url=site.toString().replace(/\/$/,'');}
    if(input.api_base_url!==undefined){const api=new URL(String(input.api_base_url));if(!['https:','http:'].includes(api.protocol))throw new Error('API URL must use HTTP or HTTPS');if(process.env.NODE_ENV==='production'&&api.protocol!=='https:')throw new Error('Use a public HTTPS API URL in production');allowed.api_base_url=api.origin;}
    if(typeof input.shared_secret==='string'&&input.shared_secret.trim())allowed.shared_secret_encrypted=encrypt(input.shared_secret.trim());
    for (const name of ['knowledge','status']) if (input[name]!==undefined) allowed[name]=input[name];
    if (!Object.keys(allowed).length) throw new Error('No supported fields');
    const rows=await db<Business[]>('businesses',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}`,body:allowed});
    if (!rows[0]) return NextResponse.json({error:'Business not found'},{status:404});
    return NextResponse.json({...rows[0],shared_secret_encrypted:undefined});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Update failed'},{status:400});}
}
