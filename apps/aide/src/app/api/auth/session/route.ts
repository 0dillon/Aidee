import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
export async function GET() {
  try {await requireUser();return NextResponse.json({access_token:(await cookies()).get('aide_session')?.value});}
  catch {return NextResponse.json({error:'Unauthorized'},{status:401});}
}
