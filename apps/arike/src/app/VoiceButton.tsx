'use client';
import {useEffect,useRef,useState} from 'react';
import {createTurnDetector} from '../lib/turn';

type Phase='idle'|'connecting'|'listening'|'thinking'|'speaking'|'ended';
type Line={role:'Aide'|'You'|'Action';text:string};
type Message={role:'user'|'assistant'|'tool';content:string|null;tool_calls?:unknown[];tool_call_id?:string};
type MicState={stream:MediaStream;ctx:AudioContext;analyser:AnalyserNode;turn:ReturnType<typeof createTurnDetector>;recorder:MediaRecorder|null;heard:boolean;startedAt:number};
type CallContext={name:string;phone:string;order_id:string;items:string;total:string;estimated_delivery:string};
type CallMode='inbound'|'callback';
type Speech={text:string;blob:Promise<Blob|null>};
type ChatEvent={type:'say';text:string}|{type:'action';name:string}|{type:'done';messages:Message[]}|{type:'error';message:string};

const GREETING='Hello, this is Aide for Arike. How can I help you today?';
const CALLBACK_DELAY_MS=15000;
const IDLE_RECORDING_MS=10000;
const ECHO_OVERLAP=0.75;
const ECHO_TAIL_MS=1800;
const MIN_OVERLAP_WORDS=4;
const MISSED_PHRASE='Sorry, I did not catch that. Please say it again.';
const TROUBLE_PHRASE='I am having trouble hearing you. Please try again, or type your message.';
const IDLE_LIMIT_MS=120000;
const SESSION_LIMIT_MS=600000;
const actionNames:Record<string,string>={create_account:'Creating your account',search_products:'Checking the collection',get_product:'Reading product details',get_delivery_estimate:'Checking delivery',create_order:'Placing your order',get_order:'Checking your order'};
const callbackOpening=(context:CallContext)=>`Hello ${context.name.split(' ')[0]}, this is Aide calling from Arike about your order ${context.order_id}. Is now a good time to talk?`;
const labels:Record<Phase,string>={idle:'Ready when you are',connecting:'Getting ready',listening:'Listening to you',thinking:'Finding the right answer',speaking:'Aide is speaking',ended:'Conversation ended'};

export default function VoiceButton(){
  const [open,setOpen]=useState(false);
  const [phase,setPhase]=useState<Phase>('idle');
  const [error,setError]=useState('');
  const [lines,setLines]=useState<Line[]>([]);
  const [draft,setDraft]=useState('');
  const [muted,setMuted]=useState(false);
  const [lastReply,setLastReply]=useState('');
  const [micNote,setMicNote]=useState('');
  const running=useRef(false);
  const history=useRef<Message[]>([]);
  const queue=useRef<Speech[]>([]);
  const generation=useRef(0);
  const playing=useRef(false);
  const turnActive=useRef(false);
  const speaking=useRef(false);
  const aideLineOpen=useRef(false);
  const audio=useRef<HTMLAudioElement|null>(null);
  const abort=useRef<AbortController|null>(null);
  const mic=useRef<MicState|null>(null);
  const micTimer=useRef<ReturnType<typeof setInterval>|null>(null);
  const turnSpoken=useRef('');
  const callId=useRef<string|null>(null);
  const callStarted=useRef<Promise<string|null>>(Promise.resolve(null));
  const callMode=useRef<CallMode>('inbound');
  const callContext=useRef<CallContext|null>(null);
  const openingRef=useRef(GREETING);
  const callbackTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const spokeAt=useRef(0);
  const mutedRef=useRef(false);
  const lastReplyRef=useRef('');
  const tapCount=useRef(0);
  const tapTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const idleTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const maxTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const scrollRef=useRef<HTMLDivElement|null>(null);
  const panelRef=useRef<HTMLElement|null>(null);
  const openerRef=useRef<HTMLButtonElement|null>(null);
  const startRef=useRef<HTMLButtonElement|null>(null);
  const closeRef=useRef<HTMLButtonElement|null>(null);
  const openedOnce=useRef(false);
  const live=phase!=='idle'&&phase!=='ended';

  useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:'smooth'});},[lines]);
  useEffect(()=>()=>{stopEverything();if(tapTimer.current)clearTimeout(tapTimer.current);},[]);
  useEffect(()=>{
    function tap(event:PointerEvent){
      if(!running.current||!(event.target instanceof Element)||event.target.closest('.aide-panel button, .aide-panel input'))return;
      tapCount.current++;
      if(tapTimer.current)clearTimeout(tapTimer.current);
      if(tapCount.current===1&&speaking.current)quiet();
      if(tapCount.current>=3){tapCount.current=0;toggleMute();return;}
      tapTimer.current=setTimeout(()=>{if(tapCount.current===2)replay();tapCount.current=0;},420);
    }
    window.addEventListener('pointerdown',tap);return()=>window.removeEventListener('pointerdown',tap);
  },[]);
  useEffect(()=>{if(open){openedOnce.current=true;startRef.current?.focus();}else if(openedOnce.current)openerRef.current?.focus();},[open]);
  useEffect(()=>{if(open&&phase==='connecting')closeRef.current?.focus();},[open,phase]);
  useEffect(()=>{if(open&&phase==='idle')void fetchSpeech(GREETING);},[open,phase]);
  useEffect(()=>{
    function onCallback(event:Event){
      const context=(event as CustomEvent<CallContext>).detail;
      if(!context?.name||!context?.phone)return;
      void fetchSpeech(callbackOpening(context));
      if(callbackTimer.current)clearTimeout(callbackTimer.current);
      callbackTimer.current=setTimeout(()=>{if(!running.current)start('callback',context);},CALLBACK_DELAY_MS);
    }
    function onLeave(){
      const id=callId.current;if(!running.current||!id)return;
      navigator.sendBeacon('/api/voice/call/end',new Blob([JSON.stringify({call_id:id,transcript:transcriptText()})],{type:'application/json'}));
    }
    window.addEventListener('aide-callback',onCallback);window.addEventListener('pagehide',onLeave);
    return()=>{window.removeEventListener('aide-callback',onCallback);window.removeEventListener('pagehide',onLeave);if(callbackTimer.current)clearTimeout(callbackTimer.current);};
  },[]);
  useEffect(()=>{
    function key(event:KeyboardEvent){
      if(event.altKey&&event.key.toLowerCase()==='a'){event.preventDefault();setOpen(true);}
      if(event.key==='Escape'&&open){event.preventDefault();close();}
      if(event.key==='Tab'&&open){
        const controls=Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href]')||[]);
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[open]);

  function add(role:Line['role'],text:string){setLines(previous=>[...previous,{role,text}].slice(-16));}
  function appendAide(text:string){
    if(!aideLineOpen.current){aideLineOpen.current=true;add('Aide',text);return;}
    setLines(previous=>{const last=previous.at(-1);return last?.role==='Aide'?[...previous.slice(0,-1),{role:'Aide',text:`${last.text} ${text}`}]:[...previous,{role:'Aide',text}];});
  }
  function clearTimers(){if(idleTimer.current)clearTimeout(idleTimer.current);if(maxTimer.current)clearTimeout(maxTimer.current);idleTimer.current=null;maxTimer.current=null;}
  function activity(){if(idleTimer.current)clearTimeout(idleTimer.current);idleTimer.current=setTimeout(()=>{setError('This conversation ended after two minutes without speech. Start again whenever you are ready.');void end();},IDLE_LIMIT_MS);}

  function words(text:string){return text.toLowerCase().replace(/[^a-z0-9s]/g,' ').split(/s+/).filter(Boolean);}
  function isEcho(text:string){
    if(!speaking.current&&Date.now()-spokeAt.current>ECHO_TAIL_MS)return false;
    const heard=words(text);if(!heard.length)return true;
    const saidWords=words(`${openingRef.current} ${lastReplyRef.current} ${turnSpoken.current}`);
    if(` ${saidWords.join(' ')} `.includes(` ${heard.join(' ')} `))return true;
    const said=new Set(saidWords);
    return heard.length>=MIN_OVERLAP_WORDS&&heard.filter(word=>said.has(word)).length/heard.length>=ECHO_OVERLAP;
  }
  function stopListening(){
    if(micTimer.current)clearInterval(micTimer.current);micTimer.current=null;
    const state=mic.current;mic.current=null;if(!state)return;
    if(state.recorder?.state==='recording'){state.recorder.onstop=null;state.recorder.stop();}
    state.stream.getTracks().forEach(track=>track.stop());void state.ctx.close();
  }
  async function listen(){
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(!running.current){stream.getTracks().forEach(track=>track.stop());return;}
      const ctx=new AudioContext();await ctx.resume();
      const analyser=ctx.createAnalyser();analyser.fftSize=1024;ctx.createMediaStreamSource(stream).connect(analyser);
      mic.current={stream,ctx,analyser,turn:createTurnDetector(),recorder:null,heard:false,startedAt:0};
      armRecorder();micTimer.current=setInterval(tickMic,50);setMicNote('Mic is on. Say something.');
    }catch{setError('Allow microphone access for this site, or type your message instead.');speak('I cannot reach your microphone. Please allow microphone access in your browser, or type your message.');}
  }
  function armRecorder(){
    const state=mic.current;if(!state||!running.current)return;
    const mime=['audio/webm;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
    const recorder=new MediaRecorder(state.stream,mime?{mimeType:mime}:{});
    const chunks:Blob[]=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onstop=()=>{const heard=state.heard;state.heard=false;if(mic.current===state)armRecorder();if(heard)void transcribe(new Blob(chunks,{type:recorder.mimeType}));};
    state.recorder=recorder;state.heard=false;state.startedAt=Date.now();recorder.start(100);
  }
  function tickMic(){
    const state=mic.current;if(!state)return;
    const samples=new Float32Array(state.analyser.fftSize);state.analyser.getFloatTimeDomainData(samples);
    const rms=Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length);
    const now=Date.now();
    const event=state.turn.update(rms,now,speaking.current);
    if(event==='speech_start'||event==='barge_in'){state.heard=true;setMicNote('Hearing you...');}
    const recording=state.recorder?.state==='recording';
    if(event==='end'&&recording)state.recorder?.stop();
    else if(recording&&!state.turn.inSpeech&&!state.heard&&now-state.startedAt>IDLE_RECORDING_MS)state.recorder?.stop();
  }
  async function transcribe(blob:Blob){
    setMicNote('Understanding you...');
    try{
      const response=await fetch('/api/stt',{method:'POST',headers:{'Content-Type':blob.type||'audio/webm'},body:blob});
      const result=await response.json();
      if(response.status===422){setMicNote('Could not make out words. Please say it again.');sayMissed(MISSED_PHRASE);return;}
      if(!response.ok||!result.text)throw new Error(result.error||'I did not catch that. Please say it again.');
      const text=String(result.text);
      if(isEcho(text)){setMicNote(`Ignored (Aide's own voice): ${text}`);return;}
      setMicNote(`Heard: ${text}`);
      if(speaking.current||turnActive.current)quiet();
      void send(text);
    }catch(cause){setError(cause instanceof Error?cause.message:'I did not catch that. Please say it again.');sayMissed(TROUBLE_PHRASE);}
  }
  function sayMissed(phrase:string){
    if(!running.current||playing.current||turnActive.current)return;
    speak(phrase);
  }


  async function fetchSpeech(text:string):Promise<Blob|null>{
    try{
      const response=await fetch('/api/voice/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      return response.ok?await response.blob():null;
    }catch{return null;}
  }
  function playBlob(blob:Blob,gen:number){
    return new Promise<void>(resolve=>{
      const url=URL.createObjectURL(blob);const element=new Audio(url);
      element.muted=mutedRef.current;audio.current=element;
      const finish=()=>{URL.revokeObjectURL(url);if(audio.current===element)audio.current=null;resolve();};
      element.addEventListener('ended',finish,{once:true});element.addEventListener('error',finish,{once:true});element.addEventListener('pause',()=>{if(gen!==generation.current)finish();},{once:true});
      element.play().catch(finish);
    });
  }
  function settle(){
    if(!running.current)return;
    if(playing.current){setPhase('speaking');return;}
    if(turnActive.current){setPhase('thinking');return;}
    speaking.current=false;setPhase('listening');
  }
  async function playLoop(){
    playing.current=true;speaking.current=true;setPhase('speaking');
    const gen=generation.current;
    while(queue.current.length&&gen===generation.current){
      const item=queue.current.shift() as Speech;
      const blob=await item.blob;
      if(gen!==generation.current)break;
      if(!blob){setError('Aide could not speak just now. The reply is shown as text.');continue;}
      await playBlob(blob,gen);
      spokeAt.current=Date.now();
    }
    if(gen!==generation.current)return;
    playing.current=false;settle();
  }
  function speak(text:string){
    queue.current.push({text,blob:fetchSpeech(text)});
    if(!playing.current)void playLoop();
  }
  function quiet(){
    generation.current++;queue.current=[];
    audio.current?.pause();audio.current=null;
    abort.current?.abort();abort.current=null;
    playing.current=false;turnActive.current=false;speaking.current=false;
    settle();
  }
  function toggleMute(){const next=!mutedRef.current;mutedRef.current=next;setMuted(next);if(audio.current)audio.current.muted=next;}
  function replay(){const text=lastReplyRef.current;if(!text||!running.current)return;quiet();speak(text);}

  function handleEvent(event:ChatEvent,spoken:string[]){
    if(event.type==='say'){spoken.push(event.text);turnSpoken.current+=` ${event.text}`;appendAide(event.text);speak(event.text);}
    else if(event.type==='action')add('Action',actionNames[event.name]||event.name.replaceAll('_',' '));
    else if(event.type==='done')history.current=[...history.current,...event.messages];
    else if(event.type==='error')setError(event.message);
  }
  async function send(text:string){
    if(!running.current)return;
    quiet();
    const controller=new AbortController();abort.current=controller;turnActive.current=true;aideLineOpen.current=false;
    turnSpoken.current='';setError('');add('You',text);activity();setPhase('thinking');
    history.current=[...history.current,{role:'user',content:text}];
    const spoken:string[]=[];
    try{
      const response=await fetch('/api/voice/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history.current,call_id:callId.current,mode:callMode.current,context:callContext.current}),signal:controller.signal});
      if(!response.ok||!response.body)throw new Error('Aide could not answer just now. Please try again.');
      const reader=response.body.getReader();const decoder=new TextDecoder();let pending='';
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        pending+=decoder.decode(value,{stream:true});
        const parts=pending.split('\n');pending=parts.pop()||'';
        for(const part of parts)if(part.trim())handleEvent(JSON.parse(part) as ChatEvent,spoken);
      }
      const reply=spoken.join(' ');if(reply){lastReplyRef.current=reply;setLastReply(reply);}
    }catch(cause){
      if(controller.signal.aborted)return;
      setError(cause instanceof Error?cause.message:'Aide could not answer just now. Please try again.');
    }finally{
      if(abort.current===controller){abort.current=null;turnActive.current=false;settle();}
    }
  }

  function transcriptText(){
    return history.current.filter(message=>(message.role==='user'||message.role==='assistant')&&message.content)
      .map(message=>`${message.role==='user'?'Customer':'Aide'}: ${message.content}`).join('\n');
  }
  function recordCallStart(mode:CallMode,context:CallContext|null){
    callId.current=null;
    callStarted.current=fetch('/api/voice/call/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,context})})
      .then(response=>response.ok?response.json():null).then(result=>{callId.current=result?.call_id??null;return callId.current;}).catch(()=>null);
  }
  function start(mode:CallMode='inbound',context?:CallContext){
    if(running.current)return;
    const opening=mode==='callback'&&context?callbackOpening(context):GREETING;
    openingRef.current=opening;callMode.current=mode;callContext.current=mode==='callback'?context??null:null;
    setOpen(true);setError('');setLines([]);setPhase('connecting');
    running.current=true;history.current=[{role:'assistant',content:opening}];lastReplyRef.current=opening;setLastReply(opening);aideLineOpen.current=false;
    add('Aide',opening);aideLineOpen.current=true;
    recordCallStart(mode,mode==='callback'?context??null:null);
    void listen();activity();
    maxTimer.current=setTimeout(()=>{setError('This conversation reached the ten-minute session limit. Start another whenever you are ready.');void end();},SESSION_LIMIT_MS);
    speak(opening);
  }
  function stopEverything(){
    running.current=false;generation.current++;queue.current=[];
    audio.current?.pause();audio.current=null;abort.current?.abort();abort.current=null;
    playing.current=false;turnActive.current=false;speaking.current=false;
    stopListening();
    clearTimers();
  }
  async function end(){
    const transcript=transcriptText();
    stopEverything();setPhase('ended');
    const id=callId.current??await callStarted.current;callId.current=null;
    if(id)void fetch('/api/voice/call/end',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({call_id:id,transcript})}).catch(()=>undefined);
  }
  function close(){setOpen(false);}
  function sendText(event:React.FormEvent){event.preventDefault();const text=draft.trim();if(!text||!running.current)return;setDraft('');void send(text);}

  return <div className="voice-wrap">
    <button ref={openerRef} id="aide-voice" className={`voice-button ${live?'on-call':''}`} onClick={()=>setOpen(true)} aria-label={live?'Aide conversation is active. Open companion. Shortcut Alt+A':'Talk to Aide. Opens voice assistant. Shortcut Alt+A'} aria-haspopup="dialog" aria-expanded={open}><span className="voice-button-mark" aria-hidden="true"><span/><span/><span/><span/></span><span>{live?'Aide is here':'Talk to Aide'}</span><span className="voice-button-arrow" aria-hidden="true">↗</span></button>
    {open&&<div className="aide-backdrop"><section ref={panelRef} className={`aide-panel${lines.length>0?' has-lines':''}`} role="dialog" aria-label="Talk to Aide" onClick={event=>event.stopPropagation()}>
      <div className="aide-panel-top"><div className="aide-ident"><span className="aide-ident-mark" aria-hidden="true"><WaveGlyph/></span><span><strong>Aide</strong><small>ARIKE&apos;S VOICE ASSISTANT</small></span></div><button ref={closeRef} className="aide-close" onClick={close} aria-label={live?'Minimize voice assistant; conversation stays active':'Close voice assistant'}>×</button></div>
      <div className="aide-stage"><div className={`aide-orbit ${phase}`} style={{'--voice-level':phase==='speaking'?0.7:0.25} as React.CSSProperties} aria-hidden="true"><div className="aide-orbit-ring ring-one"/><div className="aide-orbit-ring ring-two"/><div className="aide-orbit-core"><WaveGlyph/></div></div><span className="aide-phase-kicker">{phase==='idle'?'A NEW WAY TO SHOP':'LIVE CONVERSATION'}</span><h2>{phase==='idle'?'A conversation starts here.':labels[phase]}</h2><p>{phase==='idle'?'Ask about fabrics, sizes, delivery or place an order, all by voice.':phase==='connecting'?'Preparing your microphone.':phase==='ended'?'Come back whenever you need a hand.':'Speak naturally. Aide can check products and help with your order.'}</p><p className="aide-sr-status" role="status" aria-live="polite">{labels[phase]}</p>{(phase==='listening'||phase==='speaking')&&<div className="aide-wave" aria-hidden="true">{Array.from({length:19},(_,i)=><i key={i} style={{'--bar':i} as React.CSSProperties}/>)}</div>}</div>
      {lines.length>0&&<div className="aide-conversation" ref={scrollRef} aria-live="polite">{lines.map((line,index)=><div key={index} className={`aide-line ${line.role.toLowerCase()}`}><span>{line.role}</span><p>{line.text}</p></div>)}</div>}
      {live&&micNote&&<p className="aide-heard" aria-hidden="true">{micNote}</p>}
      {error&&<p className="aide-error" role="alert">{error}</p>}
      <div className="aide-panel-bottom"><span className="aide-privacy">✧ &nbsp; Microphone starts only when you choose Start talking. Aide uses Arike&apos;s product and policy information.</span>{live&&<div className="aide-controls"><button onClick={quiet} aria-label="Quiet Aide's voice now">Quiet</button><button onClick={replay} disabled={!lastReply} aria-label="Repeat Aide's last reply">Repeat</button><button onClick={toggleMute} aria-pressed={muted} aria-label={muted?'Unmute Aide':'Mute Aide'}>{muted?'Unmute':'Mute'}</button></div>}{live&&<form className="aide-text-fallback" onSubmit={sendText}><label htmlFor="aide-text">Prefer typing?</label><div><input id="aide-text" value={draft} onChange={event=>setDraft(event.target.value)} placeholder="Type a message to Aide"/><button type="submit" disabled={!draft.trim()}>Send</button></div></form>}{!live?<button ref={startRef} className="aide-start" onClick={()=>start()} aria-label={phase==='ended'?'Start another voice conversation with Aide':'Start voice conversation with Aide. Microphone permission may be requested.'}>{phase==='ended'?'Start another conversation':'Start talking'} <span>→</span></button>:<button className="aide-end" onClick={end}>End conversation <span>■</span></button>}</div>
    </section></div>}
  </div>;
}
function WaveGlyph(){return <span className="aide-glyph"><i/><i/><i/><i/><i/></span>;}
