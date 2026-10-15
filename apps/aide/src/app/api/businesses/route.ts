import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { encrypt } from '@/lib/security';
import type {Business} from '@/lib/vapi';

const publicBusiness = (row:Business) => ({...row,shared_secret_encrypted:undefined});
export async function GET() {
  try { await requireUser(); return NextResponse.json((await db<Business[]>('businesses',{query:'select=*&order=created_at.desc'})).map(publicBusiness)); }
  catch (error) { return NextResponse.json({error:error instanceof Error?error.message:'Request failed'},{status:401}); }
}
export async function POST(request:NextRequest) {
  try {
    await requireUser(); const input = await request.json();
    for (const field of ['name','site_url','api_base_url','shared_secret']) if (!input[field]) throw new Error(`${field} is required`);
    const name=String(input.name).trim();if(!name||name.length>100)throw new Error('Business name must be 1 to 100 characters');
    const site=new URL(String(input.site_url));const base = new URL(String(input.api_base_url));
    if (!['http:','https:'].includes(site.protocol)||!['http:','https:'].includes(base.protocol)) throw new Error('Use a valid website and API URL');
    if(process.env.NODE_ENV==='production'&&(site.protocol!=='https:'||base.protocol!=='https:'))throw new Error('Use public HTTPS URLs in production');
    const sharedSecret=String(input.shared_secret).trim();if(sharedSecret.length<16)throw new Error('Shared secret must be at least 16 characters');
    const rows = await db<Business[]>('businesses',{method:'POST',body:{name,site_url:site.toString().replace(/\/$/,''),
      api_base_url:base.origin,shared_secret_encrypted:encrypt(sharedSecret),knowledge:input.knowledge||'',
      vapi_phone_number_id:process.env.VAPI_PHONE_NUMBER_ID||null}});
    return NextResponse.json(publicBusiness(rows[0]),{status:201});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Request failed'},{status:400});}
}
