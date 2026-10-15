import {NextRequest} from 'next/server';
import {wavToPcm} from '@/lib/wav';
export const runtime='nodejs';
const SPEECH_CACHE_LIMIT=200;
const speechCache=new Map<string,Buffer>();

export async function POST(request:NextRequest) {
  if(!process.env.VAPI_WEBHOOK_SECRET||request.headers.get('x-vapi-secret')!==process.env.VAPI_WEBHOOK_SECRET) return Response.json({error:'Unauthorized'},{status:401});
  const key=process.env.SAHARA_API_KEY;
  if(!key) return Response.json({error:'Sahara is not configured'},{status:503});
  try {
    const {message}=await request.json();
    const text=String(message?.text||'').trim();const sampleRate=Number(message?.sampleRate);
    if(message?.type!=='voice-request'||!text||text.length>4000||![8000,16000,22050,24000,44100].includes(sampleRate)) return Response.json({error:'Invalid voice request'},{status:400});
    const gender=process.env.SAHARA_TTS_GENDER||'male';
    const cacheKey=`${sampleRate}|${gender}|${text}`;
    const hit=speechCache.get(cacheKey);
    if(hit) return new Response(new Uint8Array(hit),{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
    const generated=await fetch('https://infer.voice.intron.io/tts/v1/generate',{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({text,voice_language:'en',voice_accent:process.env.SAHARA_TTS_ACCENT||'yoruba',voice_gender:gender,output_audio_format:'wav'}),
      signal:AbortSignal.timeout(35000),cache:'no-store'
    });
    if(!generated.ok) throw new Error(`Sahara generation failed (${generated.status})`);
    const payload=await generated.json();
    const audioUrl=new URL(payload.data?.audio_path);
    if(!['http:','https:'].includes(audioUrl.protocol)||!audioUrl.hostname.endsWith('.amazonaws.com')) throw new Error('Unexpected Sahara audio URL');
    audioUrl.protocol='https:';
    const audio=await fetch(audioUrl,{signal:AbortSignal.timeout(10000),cache:'no-store'});
    if(!audio.ok) throw new Error('Sahara audio download failed');
    const pcm=wavToPcm(Buffer.from(await audio.arrayBuffer()),sampleRate);
    if(speechCache.size>=SPEECH_CACHE_LIMIT)speechCache.delete(speechCache.keys().next().value as string);
    speechCache.set(cacheKey,pcm);
    return new Response(new Uint8Array(pcm),{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
  } catch(error) {console.error('Sahara TTS failed',error);return Response.json({error:'Speech is temporarily unavailable'},{status:502});}
}
