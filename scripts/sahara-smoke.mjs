const key=process.env.SAHARA_API_KEY;
if(!key) throw new Error('SAHARA_API_KEY is required');
const started=Date.now();
const response=await fetch('https://infer.voice.intron.io/tts/v1/generate',{
  method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
  body:JSON.stringify({text:'Hello, welcome to Arike. How may I help you today?',voice_language:'en',voice_accent:process.env.SAHARA_TTS_ACCENT||'yoruba',voice_gender:process.env.SAHARA_TTS_GENDER||'female',output_audio_format:'wav'}),
  signal:AbortSignal.timeout(35000)
});
const payload=await response.json();
console.log(JSON.stringify({http_status:response.status,provider_status:payload.status,audio_ready:!!payload.data?.audio_path,elapsed_ms:Date.now()-started,message:response.ok?undefined:payload.message}));
if(!response.ok||!payload.data?.audio_path) process.exitCode=1;
