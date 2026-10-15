import {NextRequest} from 'next/server';
import {guard} from '@/lib/guard';
export const runtime='nodejs';

const SAHARA_TTS_URL='https://infer.voice.intron.io/tts/v1/generate';
const MAX_TEXT=300;
const CACHE_LIMIT=300;
const GENERATE_TIMEOUT_MS=40000;
const DOWNLOAD_TIMEOUT_MS=30000;
const cache=new Map<string,Buffer>();

async function synthesize(key:string,text:string,gender:string,accent:string):Promise<Buffer> {
  const generated=await fetch(SAHARA_TTS_URL,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({text,voice_language:'en',voice_accent:accent,voice_gender:gender,output_audio_format:'wav'}),signal:AbortSignal.timeout(GENERATE_TIMEOUT_MS),cache:'no-store'});
  if(!generated.ok) throw new Error(`Sahara TTS ${generated.status}`);
  const payload=await generated.json();
  const url=new URL(payload.data?.audio_path);
  if(!['http:','https:'].includes(url.protocol)||!url.hostname.endsWith('.amazonaws.com')) throw new Error('Unexpected audio host');
  url.protocol='https:';
  const download=await fetch(url,{signal:AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),cache:'no-store'});
  if(!download.ok) throw new Error('Audio download failed');
  return Buffer.from(await download.arrayBuffer());
}

async function withRetry<T>(run:()=>Promise<T>):Promise<T> {
  try { return await run(); } catch(error) { console.warn('Voice TTS retrying',error instanceof Error?error.message:error); return run(); }
}

export async function POST(request:NextRequest) {
  const blocked=guard(request,120);
  if(blocked) return blocked;
  const key=process.env.SAHARA_API_KEY;
  if(!key) return Response.json({error:'Voice is not configured'},{status:503});
  try {
    const {text:raw}=await request.json();
    const text=String(raw||'').trim().slice(0,MAX_TEXT);
    if(!text) return Response.json({error:'Nothing to say'},{status:400});
    const gender=process.env.SAHARA_TTS_GENDER||'male';
    const accent=process.env.SAHARA_TTS_ACCENT||'yoruba';
    const cacheKey=`${gender}|${accent}|${text}`;
    let audio=cache.get(cacheKey);
    if(!audio) {
      audio=await withRetry(()=>synthesize(key,text,gender,accent));
      if(cache.size>=CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(cacheKey,audio);
    }
    return new Response(new Uint8Array(audio),{headers:{'Content-Type':'audio/wav','Cache-Control':'no-store'}});
  } catch(error) {
    console.error('Voice TTS failed',error);
    return Response.json({error:'Speech is temporarily unavailable'},{status:502});
  }
}
