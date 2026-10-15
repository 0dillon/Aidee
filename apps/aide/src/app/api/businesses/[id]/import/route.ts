import {NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import type {Business} from '@/lib/vapi';

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireUser(); const {id}=await params;
    const business=(await db<Business[]>('businesses',{query:`id=eq.${encodeURIComponent(id)}&select=*`}))[0];
    if (!business) return NextResponse.json({error:'Business not found'},{status:404});
    const response=await fetch(`${business.api_base_url}/api/aide/manifest`,{signal:AbortSignal.timeout(8000),cache:'no-store'});
    if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
    const manifest=await response.json();
    if (!Array.isArray(manifest.actions) || manifest.actions.length>30) throw new Error('Invalid manifest actions');
    const actions=manifest.actions.map((action:Record<string,unknown>)=>{
      if (typeof action.name!=='string'||typeof action.path!=='string'||!/^\/[a-z0-9/_-]+$/i.test(action.path)||!['GET','POST'].includes(String(action.method))) throw new Error('Invalid action in manifest');
      return {business_id:id,name:action.name,description:action.description,method:action.method,path:action.path,params_schema:action.params_schema,enabled:true};
    });
    const saved=await db('actions',{method:'POST',query:'on_conflict=business_id,name',prefer:'resolution=merge-duplicates,return=representation',body:actions});
    if (manifest.knowledge && !business.knowledge) await db('businesses',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}`,body:{knowledge:manifest.knowledge}});
    return NextResponse.json({actions:saved,knowledge:manifest.knowledge});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Import failed'},{status:400});}
}
