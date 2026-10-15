'use client';
import {useEffect,useRef,useState} from 'react';
import {createTurnDetector} from '../lib/turn';

type Phase='idle'|'connecting'|'listening'|'thinking'|'speaking'|'chatting'|'ended';
type Line={role:'Aide'|'You'|'Action';text:string};
type Message={role:'user'|'assistant'|'tool';content:string|null;tool_calls?:unknown[];tool_call_id?:string};
type MicState={stream:MediaStream;ctx:AudioContext;analyser:AnalyserNode;turn:ReturnType<typeof createTurnDetector>;recorder:MediaRecorder|null;heard:boolean;startedAt:number};
type CallContext={name:string;phone:string;order_id:string;items:string;total:string;estimated_delivery:string};
type CallMode='inbound'|'callback';
type Speech={text:string;blob:Promise<Blob|null>};
type ChatEvent={type:'say';text:string}|{type:'action';name:string}|{type:'done';messages:Message[]}|{type:'error';message:string};

const GREETING='Hi, I’m Aide for Arike. Allow microphone access if your browser asks. After my welcome, tell me what you need. Tap once to pause me, twice to hear me again, or three times to mute me. You can also type at any time.';
const CALLBACK_DELAY_MS=15000;
const IDLE_RECORDING_MS=10000;
const SILENCE_REMINDER_MS=12000;
const ECHO_OVERLAP=0.75;
const ECHO_TAIL_MS=1800;
const MIN_OVERLAP_WORDS=4;
const MISSED_PHRASE='Sorry, I did not catch that. Please say it again.';
const TROUBLE_PHRASE='I am having trouble hearing you. Please try again, or type your message.';
const NOISE_PHRASES=/^(thank you.?|thanks.?|thank you for watching.?|you.?|bye.?|okay.?|yeah.?|um.?|uh.?|hmm.?)$/i;
const IDLE_LIMIT_MS=120000;
const SESSION_LIMIT_MS=600000;
const actionNames:Record<string,string>={create_account:'Creating your account',search_products:'Checking the collection',get_product:'Reading product details',get_delivery_estimate:'Checking delivery',create_order:'Placing your order',get_order:'Checking your order'};
const callbackOpening=(context:CallContext)=>`Hello ${context.name.split(' ')[0]}, this is Aide calling from Arike about your order ${context.order_id}. Is now a good time to talk?`;
const labels:Record<Phase,string>={idle:'Ready when you are',connecting:'Getting ready',listening:'Listening to you',thinking:'Finding the right answer',speaking:'Aide is speaking',chatting:'Here to help',ended:'Conversation ended'};

export default function VoiceButton({pageContext}:{pageContext:string}){
  const [open,setOpen]=useState(false);
  const [phase,setPhase]=useState<Phase>('idle');
  const [error,setError]=useState('');
  const [lines,setLines]=useState<Line[]>([]);
  const [draft,setDraft]=useState('');
  const [muted,setMuted]=useState(false);
  const [welcome,setWelcome]=useState(true);
  const [lastReply,setLastReply]=useState('');
  const [micNote,setMicNote]=useState('');
  const running=useRef(false);
  const textOnly=useRef(false);
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
  const silenceReminder=useRef<ReturnType<typeof setTimeout>|null>(null);
  const silenceReminded=useRef(false);
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
      if(!running.current||textOnly.current||!(event.target instanceof Element)||event.target.closest('.aide-panel button, .aide-panel input'))return;
      tapCount.current++;
      if(tapTimer.current)clearTimeout(tapTimer.current);
      if(tapCount.current===1&&speaking.current)quiet();
      if(tapCount.current>=3){tapCount.current=0;toggleMute();return;}
      tapTimer.current=setTimeout(()=>{if(tapCount.current===2)replay();tapCount.current=0;},420);
    }
    window.addEventListener('pointerdown',tap);return()=>window.removeEventListener('pointerdown',tap);
  },[]);
  useEffect(()=>{if(open){openedOnce.current=true;closeRef.current?.focus({preventScroll:true});}else if(openedOnce.current)openerRef.current?.focus();},[open]);
  useEffect(()=>{if(open&&phase==='connecting')closeRef.current?.focus();},[open,phase]);
  useEffect(()=>{try{if(sessionStorage.getItem('aide-welcome-dismissed')==='1')setWelcome(false);}catch{}},[]);
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
      armRecorder();micTimer.current=setInterval(tickMic,50);setMicNote('Microphone is on. I am listening.');
      if(silenceReminder.current)clearTimeout(silenceReminder.current);
      silenceReminder.current=setTimeout(()=>{
        if(!running.current||!mic.current||mic.current.heard||silenceReminded.current)return;
        silenceReminded.current=true;
        const message='I have not heard you yet. You can speak now, or type a message below.';
        setMicNote(message);speak(message);
      },SILENCE_REMINDER_MS);
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
    const aideTalking=speaking.current||now-spokeAt.current<ECHO_TAIL_MS;
    if((event==='speech_start'||event==='barge_in')&&!aideTalking){state.heard=true;if(silenceReminder.current)clearTimeout(silenceReminder.current);setMicNote('I can hear you.');}
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
      if(NOISE_PHRASES.test(text.trim())){setMicNote('Ignored background noise.');return;}
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
    if(textOnly.current){setPhase('chatting');return;}
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
    if(textOnly.current)return;
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
    if(event.type==='say'){spoken.push(event.text);turnSpoken.current+=` ${event.text}`;appendAide(event.text);if(!textOnly.current)speak(event.text);}
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
      const response=await fetch('/api/voice/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history.current,call_id:callId.current,mode:callMode.current,context:callContext.current,page_context:pageContext}),signal:controller.signal});
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
    textOnly.current=false;
    const opening=mode==='callback'&&context?callbackOpening(context):GREETING;
    openingRef.current=opening;callMode.current=mode;callContext.current=mode==='callback'?context??null:null;
    setOpen(true);setError('');setLines([]);setMicNote('Opening your microphone. I will tell you when it is ready.');silenceReminded.current=false;setPhase('connecting');
    running.current=true;history.current=[{role:'assistant',content:opening}];lastReplyRef.current=opening;setLastReply(opening);aideLineOpen.current=false;
    add('Aide',opening);aideLineOpen.current=true;
    recordCallStart(mode,mode==='callback'?context??null:null);
    void listen();activity();
    maxTimer.current=setTimeout(()=>{setError('This conversation reached the ten-minute session limit. Start another whenever you are ready.');void end();},SESSION_LIMIT_MS);
    speak(opening);
  }
  function startText(prompt?:string){
    if(running.current)return;
    textOnly.current=true;running.current=true;callMode.current='inbound';callContext.current=null;
    setOpen(true);setWelcome(false);setError('');setLines([]);setPhase(prompt?'thinking':'chatting');
    callId.current=null;callStarted.current=Promise.resolve(null);history.current=[];lastReplyRef.current='';setLastReply('');aideLineOpen.current=false;
    activity();
    maxTimer.current=setTimeout(()=>{setError('This conversation reached the ten-minute session limit. Start another whenever you are ready.');void end();},SESSION_LIMIT_MS);
    if(prompt)void send(prompt);
  }
  function openPanel(){setWelcome(false);setOpen(true);}
  function stopEverything(){
    running.current=false;generation.current++;queue.current=[];
    audio.current?.pause();audio.current=null;abort.current?.abort();abort.current=null;
    playing.current=false;turnActive.current=false;speaking.current=false;
    stopListening();if(silenceReminder.current)clearTimeout(silenceReminder.current);silenceReminder.current=null;
    clearTimers();
  }
  async function end(){
    const transcript=transcriptText();
    stopEverything();setPhase('ended');
    const id=callId.current??await callStarted.current;callId.current=null;
    if(id)void fetch('/api/voice/call/end',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({call_id:id,transcript})}).catch(()=>undefined);
  }
  function close(){setOpen(false);}
  function sendText(event:React.FormEvent){event.preventDefault();const text=draft.trim();if(!text)return;setDraft('');if(!running.current){startText(text);return;}void send(text);}

  return <div className="voice-wrap">
    {!open&&welcome&&<aside className="aide-invite" aria-label="Aide page guide"><button className="aide-invite-close" onClick={()=>{setWelcome(false);try{sessionStorage.setItem('aide-welcome-dismissed','1');}catch{}}} aria-label="Dismiss Aide welcome">×</button><div className="aide-invite-head"><span className="aide-invite-mark" aria-hidden="true"><WaveGlyph/></span><div><span className="aide-invite-status"><i/> HERE TO HELP</span><h2>What can I help you with?</h2></div></div><p>I can explore the collection, compare sizes, check delivery, or guide you through a pay-on-delivery order.</p><div className="aide-invite-actions"><button className="aide-invite-primary" onClick={openPanel}>Explore this page <span aria-hidden="true">→</span></button><button className="aide-invite-voice" onClick={()=>start()}>Talk now <span aria-hidden="true">◖</span></button></div></aside>}
    <button ref={openerRef} id="aide-voice" className={`voice-button ${live?'on-call':''}`} onClick={open?close:openPanel} aria-label={live?'Aide is helping you. Open voice assistant':'Talk to Aide. Open the voice and page guide'} aria-haspopup="dialog" aria-expanded={open}><span className="voice-button-mark" aria-hidden="true"><WaveGlyph/></span><span className="voice-button-label">{phase==='listening'?'Listening':live?'Aide is here':'Talk to Aide'}</span><span className="voice-button-arrow" aria-hidden="true">{open?'×':'↗'}</span></button>
    {open&&<div className="aide-backdrop"><section ref={panelRef} className={`aide-panel${lines.length>0?' has-lines':''}`} role="dialog" aria-label="Aide page guide" onClick={event=>event.stopPropagation()}>
      <div className="aide-panel-top"><div className="aide-ident"><span className="aide-ident-mark" aria-hidden="true"><WaveGlyph/></span><span><strong>Aide</strong><small>YOUR ARIKE SHOPPING GUIDE</small></span></div><button ref={closeRef} className="aide-close" onClick={close} aria-label={live?'Minimize Aide; conversation stays active':'Close Aide'}>×</button></div>
      <div className="aide-stage"><div className={`aide-orbit ${phase}`} style={{'--voice-level':phase==='speaking'?0.7:0.25} as React.CSSProperties} aria-hidden="true"><div className="aide-orbit-ring ring-one"/><div className="aide-orbit-ring ring-two"/><div className="aide-orbit-core"><WaveGlyph/></div></div><span className="aide-phase-kicker">{phase==='idle'?'YOUR GUIDE IS HERE':phase==='listening'?'MICROPHONE ON':'AIDE SUPPORT'}</span><h2>{phase==='idle'?'Hi, I’m Aide.':phase==='chatting'?'I’m here with you.':labels[phase]}</h2><p>{phase==='idle'?'Tell me what you need. I can explain this page, help you choose, or walk you through an order.':phase==='connecting'?'Getting the microphone ready. Your browser may ask for permission.':phase==='ended'?'You can come back whenever you need help.':phase==='listening'?'Go ahead. Use Quiet to pause me, Repeat to hear me again, or Mute to stay silent.':'I’ll help one step at a time. You can speak or type.'}</p><p className="aide-sr-status" role="status" aria-live="polite">{labels[phase]}</p>{(phase==='listening'||phase==='speaking')&&<div className="aide-wave" aria-hidden="true">{Array.from({length:19},(_,i)=><i key={i} style={{'--bar':i} as React.CSSProperties}/>)}</div>}</div>
      {phase==='idle'&&<div className="aide-quick-help" aria-label="Ways Aide can help"><span>WHAT WOULD YOU LIKE TO DO?</span><button onClick={()=>startText('Please describe this page and help me explore the collection.')}>Explore this page <b>→</b></button><button onClick={()=>startText('Help me choose an item that suits me.')}>Help me choose <b>→</b></button><button onClick={()=>startText('Help me understand sizing and delivery.')}>Sizing and delivery <b>→</b></button></div>}
      {lines.length>0&&<div className="aide-conversation" ref={scrollRef} aria-live="polite">{lines.map((line,index)=><div key={index} className={`aide-line ${line.role.toLowerCase()}`}><span>{line.role}</span><p>{line.text}</p></div>)}</div>}
      {live&&micNote&&!textOnly.current&&<p className="aide-heard" role="status" aria-live="polite" aria-atomic="true">{micNote}</p>}
      {error&&<p className="aide-error" role="alert">{error}</p>}
      <div className="aide-panel-bottom"><span className="aide-privacy">{textOnly.current?'You can type here without turning on your microphone.':'Your microphone turns on only when you choose Talk now. No voice is sent before then.'}</span>{live&&!textOnly.current&&<div className="aide-controls"><button onClick={quiet} aria-label="Quiet Aide's voice now">Quiet</button><button onClick={replay} disabled={!lastReply} aria-label="Repeat Aide's last reply">Repeat</button><button onClick={toggleMute} aria-pressed={muted} aria-label={muted?'Unmute Aide':'Mute Aide'}>{muted?'Unmute':'Mute'}</button></div>}{(live||phase==='idle')&&<form className="aide-text-fallback" onSubmit={sendText}><label htmlFor="aide-text">Or type what you need</label><div><input id="aide-text" value={draft} onChange={event=>setDraft(event.target.value)} placeholder="Ask Aide a question"/><button type="submit" disabled={!draft.trim()}>Send</button></div></form>}{!live?<button ref={startRef} className="aide-start" onClick={()=>start()} aria-label="Start talking to Aide. Microphone permission may be requested."><span className="aide-start-icon" aria-hidden="true">◖</span>Talk with Aide <span aria-hidden="true">→</span></button>:<button className="aide-end" onClick={end}>End conversation <span>■</span></button>}</div>
    </section></div>}
  </div>;
}
function WaveGlyph(){return <span className="aide-glyph"><i/><i/><i/><i/><i/></span>;}
