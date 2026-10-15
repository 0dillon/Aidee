import { NextResponse } from 'next/server';
import { actions, knowledge } from '@/lib/manifest';

export async function GET() {
  return NextResponse.json({business:{name:'Arike Pre-order',site_url:process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'},knowledge,actions});
}
