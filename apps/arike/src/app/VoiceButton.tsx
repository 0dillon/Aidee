'use client';
import {useEffect,useRef,useState} from 'react';
import Vapi from '@vapi-ai/web';

type Phase='idle'|'connecting'|'listening'|'thinking'|'speaking'|'ended';
type Line={role:'Aide'|'You'|'Action';text:string};
const actionNames:Record<string,string>={create_account:'Creating your account',search_products:'Checking the collection',get_product:'Reading product details',get_delivery_estimate:'Checking delivery',lookup_postcode:'Verifying your postcode',create_order:'Placing your order',get_order:'Checking your order',schedule_followup:'Setting your reminder'};
const labels:Record<Phase,string>={idle:'Ready when you are',connecting:'Connecting your conversation',listening:'Listening to you',thinking:'Finding the right answer',speaking:'Aide is speaking',ended:'Conversation ended'};

export default function VoiceButton(){
  const [open,setOpen]=useState(false);
  const [phase,setPhase]=useState<Phase>('idle');
  const [error,setError]=useState('');
  const [lines,setLines]=useState<Line[]>([]);
  const [level,setLevel]=useState(0);
  const [draft,setDraft]=useState('');
  const instance=useRef<Vapi|null>(null);
  const running=useRef(false);
  const scrollRef=useRef<HTMLDivElement|null>(null);
  const panelRef=useRef<HTMLElement|null>(null);
  const openerRef=useRef<HTMLButtonElement|null>(null);
  const startRef=useRef<HTMLButtonElement|null>(null);
  const closeRef=useRef<HTMLButtonElement|null>(null);
  const openedOnce=useRef(false);
  useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:'smooth'});},[lines]);
  useEffect(()=>()=>{instance.current?.stop();},[]);
  useEffect(()=>{if(open){openedOnce.current=true;startRef.current?.focus();}else if(openedOnce.current)openerRef.current?.focus();},[open]);
  useEffect(()=>{if(open&&phase==='connecting')closeRef.current?.focus();},[open,phase]);
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
  async function start(){
    setOpen(true);setError('');setLines([]);setPhase('connecting');
    const publicKey=process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
    const assistantId=process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
    if(!publicKey||!assistantId){setPhase('idle');setError('Voice calling is being connected. The Arike collection is ready to explore below.');return;}
    try{
      const call=new Vapi(publicKey);instance.current=call;
      call.on('call-start',()=>{running.current=true;setPhase('listening');});
      call.on('speech-start',()=>setPhase('speaking'));
      call.on('speech-end',()=>setPhase('listening'));
      call.on('local-volume-level',volume=>setLevel(Math.min(1,Math.max(0,volume))));
      call.on('message',(message:any)=>{
        if(message?.type==='transcript'&&message?.transcriptType==='final'&&message?.transcript){add(message.role==='assistant'?'Aide':'You',message.transcript);if(message.role==='user')setPhase('thinking');}
        if(message?.type==='tool-calls')for(const tool of message.toolCallList||[]){const name=tool.function?.name;if(name)add('Action',actionNames[name]||name.replaceAll('_',' '));}
        if(message?.type==='tool.completed')setPhase('thinking');
      });
      call.on('call-end',()=>{running.current=false;setPhase('ended');setLevel(0);});
      call.on('error',()=>{running.current=false;setError('The conversation disconnected. Please try again.');setPhase('ended');});
      await call.start(assistantId);
    }catch(cause){running.current=false;setPhase('idle');setError(cause instanceof Error?cause.message:'The call could not start');}
  }
  async function end(){await instance.current?.stop();running.current=false;setPhase('ended');setLevel(0);}
  function close(){if(running.current)void end();setOpen(false);}
  function sendText(event:React.FormEvent){event.preventDefault();const text=draft.trim();if(!text||!running.current)return;instance.current?.send({type:'add-message',message:{role:'user',content:text},triggerResponseEnabled:true});add('You',text);setDraft('');setPhase('thinking');}
  return <div className="voice-wrap">
    <button ref={openerRef} id="aide-voice" className="voice-button" onClick={()=>setOpen(true)} aria-label="Talk to Aide. Opens voice assistant. Shortcut Alt+A" aria-haspopup="dialog" aria-expanded={open}><span className="voice-button-mark" aria-hidden="true"><span/><span/><span/><span/></span><span>Talk to Aide</span><span className="voice-button-arrow" aria-hidden="true">↗</span></button>
    {open&&<div className="aide-backdrop" onClick={close}><section ref={panelRef} className="aide-panel" role="dialog" aria-modal="true" aria-label="Talk to Aide" onClick={event=>event.stopPropagation()}>
      <div className="aide-panel-top"><div className="aide-ident"><span className="aide-ident-mark">✳</span><span><strong>Aide</strong><small>ARIKE&apos;S VOICE ASSISTANT</small></span></div><button ref={closeRef} className="aide-close" onClick={close} aria-label="Close voice assistant">×</button></div>
      <div className="aide-stage"><div className={`aide-orbit ${phase}`} style={{'--voice-level':level} as React.CSSProperties} aria-hidden="true"><div className="aide-orbit-ring ring-one"/><div className="aide-orbit-ring ring-two"/><div className="aide-orbit-core"><span>✳</span></div></div><span className="aide-phase-kicker">{phase==='idle'?'A NEW WAY TO SHOP':'LIVE CONVERSATION'}</span><h2>{phase==='idle'?'A conversation starts here.':labels[phase]}</h2><p>{phase==='idle'?'Ask about fabrics, sizes, delivery or place an order, all by voice.':phase==='connecting'?'Preparing your microphone and connecting to Arike.':phase==='ended'?'Come back whenever you need a hand.':'Speak naturally. Aide can check products and help with your order.'}</p><p className="aide-sr-status" role="status" aria-live="polite">{labels[phase]}</p>{(phase==='listening'||phase==='speaking')&&<div className="aide-wave" aria-hidden="true">{Array.from({length:19},(_,i)=><i key={i} style={{'--bar':i} as React.CSSProperties}/>)}</div>}</div>
      {lines.length>0&&<div className="aide-conversation" ref={scrollRef} aria-live="polite">{lines.map((line,index)=><div key={index} className={`aide-line ${line.role.toLowerCase()}`}><span>{line.role}</span><p>{line.text}</p></div>)}</div>}
      {error&&<p className="aide-error" role="alert">{error}</p>}
      <div className="aide-panel-bottom"><span className="aide-privacy">✧ &nbsp; Microphone starts only when you choose Start talking. Aide uses Arike&apos;s product and policy information.</span>{running.current&&<form className="aide-text-fallback" onSubmit={sendText}><label htmlFor="aide-text">Prefer typing?</label><div><input id="aide-text" value={draft} onChange={event=>setDraft(event.target.value)} placeholder="Type a message to Aide"/><button type="submit" disabled={!draft.trim()}>Send</button></div></form>}{phase==='idle'||phase==='ended'?<button ref={startRef} className="aide-start" onClick={start}>{phase==='ended'?'Start another conversation':'Start talking'} <span>→</span></button>:<button className="aide-end" onClick={end} disabled={phase==='connecting'}>End conversation <span>■</span></button>}</div>
    </section></div>}
  </div>;
}
