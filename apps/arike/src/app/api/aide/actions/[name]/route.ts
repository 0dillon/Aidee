import { NextRequest, NextResponse } from 'next/server';
import {verifyAideKey} from '@/lib/data';
import {runAction} from '@/lib/actions';

export async function POST(request:NextRequest, context:{params:Promise<{name:string}>}) {
  if (!verifyAideKey(request.headers.get('X-Aide-Key'))) return NextResponse.json({error:'Unauthorized'},{status:401});
  try {
    const {name} = await context.params;
    const result = await runAction(name, await request.json());
    return NextResponse.json(result.body,{status:result.status});
  } catch (error) { return NextResponse.json({error:error instanceof Error ? error.message : 'Action failed'},{status:400}); }
}
