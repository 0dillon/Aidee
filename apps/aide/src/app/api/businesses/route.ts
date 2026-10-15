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
    const base = new URL(input.api_base_url);
    if (!['http:','https:'].includes(base.protocol)) throw new Error('Invalid API URL');
    const rows = await db<Business[]>('businesses',{method:'POST',body:{name:input.name,site_url:input.site_url,
      api_base_url:base.origin,shared_secret_encrypted:encrypt(input.shared_secret),knowledge:input.knowledge||'',
      vapi_phone_number_id:process.env.VAPI_PHONE_NUMBER_ID||null}});
    return NextResponse.json(publicBusiness(rows[0]),{status:201});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Request failed'},{status:400});}
}
