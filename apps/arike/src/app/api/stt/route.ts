import {NextRequest} from 'next/server';
import {guard} from '@/lib/guard';
export const runtime='nodejs';

const MAX_BYTES=1_000_000;
const SAHARA_STT_URL='https://infer.voice.intron.io/file/v1/upload/sync';
const GROQ_STT_URL='https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL='whisper-large-v3';
const GROQ_VOCAB='Arike, Aide, Ada Shirt, Amara Set, Zuri Dress, naira, pre-order, Lagos, Abuja, Ikeja.';
const STT_TIMEOUT_MS=20000;

function extensionFor(mime:string){return mime.includes('mp4')?'mp4':mime.includes('wav')?'wav':'webm';}

async function viaGroq(key:string,audio:Buffer,mime:string):Promise<string> {
  const form=new FormData();
  form.append('file',new Blob([new Uint8Array(audio)],{type:mime}),`utterance.${extensionFor(mime)}`);
  form.append('model',GROQ_MODEL);form.append('language','en');form.append('temperature','0');form.append('prompt',GROQ_VOCAB);form.append('response_format','json');
  const response=await fetch(GROQ_STT_URL,{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(STT_TIMEOUT_MS),cache:'no-store'});
  if(!response.ok) throw new Error(`Groq STT ${response.status}`);
  return String((await response.json()).text||'').trim();
}

async function viaSahara(key:string,audio:Buffer,mime:string,language='en'):Promise<string> {
  const name=`utterance.${extensionFor(mime)}`;
  const form=new FormData();
  form.append('audio_file_name',name);
  form.append('audio_file_blob',new Blob([new Uint8Array(audio)],{type:mime}),name);
  form.append('use_language_asr_input',language);
  form.append('use_disable_llm_corrections','TRUE');
  const response=await fetch(SAHARA_STT_URL,{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(STT_TIMEOUT_MS),cache:'no-store'});
  if(!response.ok) throw new Error(`Sahara STT ${response.status}`);
  return String((await response.json()).data?.audio_transcript||'').trim();
}

const COMPARE_LANGUAGES=['en','yo','ig','ha','pcm'];

async function timed(label:string,run:()=>Promise<string>) {
  const start=Date.now();
  try { return {label,ms:Date.now()-start,text:await run()}; }
  catch(error) { return {label,ms:Date.now()-start,text:`ERROR ${error instanceof Error?error.message:'failed'}`}; }
}

/** Diagnostic only: runs every recognizer on the same audio so accent fit can be judged on real speech. */
async function compare(groqKey:string|undefined,saharaKey:string|undefined,audio:Buffer,mime:string) {
  const jobs=[
    ...(groqKey?[timed('groq-whisper',()=>viaGroq(groqKey,audio,mime))]:[]),
    ...(saharaKey?COMPARE_LANGUAGES.map(language=>timed(`sahara-${language}`,()=>viaSahara(saharaKey,audio,mime,language))):[])
  ];
  const results=await Promise.all(jobs);
  console.log('STT_COMPARE',audio.length,'bytes',JSON.stringify(results));
}

export async function POST(request:NextRequest) {
  const blocked=guard(request,60);
  if(blocked) return blocked;
  const groqKey=process.env.GROQ_API_KEY;const saharaKey=process.env.SAHARA_API_KEY;
  if(!groqKey&&!saharaKey) return Response.json({error:'Speech recognition is not configured'},{status:503});
  const mime=(request.headers.get('content-type')||'audio/webm').split(';')[0];
  const audio=Buffer.from(await request.arrayBuffer());
  if(!audio.length||audio.length>MAX_BYTES) return Response.json({error:'Invalid audio'},{status:400});
  if(process.env.STT_COMPARE==='1') await compare(groqKey,saharaKey,audio,mime);
  try {
    const text=groqKey?await viaGroq(groqKey,audio,mime):await viaSahara(saharaKey as string,audio,mime);
    if(!text) return Response.json({error:'I did not catch that. Please say it again.'},{status:422});
    return Response.json({text,provider:groqKey?'groq':'sahara'});
  } catch(error) {
    console.error('Speech recognition failed',error);
    return Response.json({error:'Speech recognition is temporarily unavailable. You can type instead.'},{status:502});
  }
}
