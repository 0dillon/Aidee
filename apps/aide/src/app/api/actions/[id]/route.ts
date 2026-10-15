import {NextRequest,NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {await requireUser();const {id}=await params;const {enabled}=await request.json();
    if(typeof enabled!=='boolean') throw new Error('enabled must be boolean');
    const rows=await db('actions',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}`,body:{enabled}});
    return NextResponse.json(rows);
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Update failed'},{status:400});}
}
