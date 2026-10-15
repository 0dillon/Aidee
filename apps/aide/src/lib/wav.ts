export function wavToPcm(raw:Buffer,targetRate:number):Buffer {
  if(raw.toString('ascii',0,4)!=='RIFF'||raw.toString('ascii',8,12)!=='WAVE') throw new Error('Sahara did not return WAV audio');
  let position=12;let sampleRate=0;let channels=0;let bits=0;let format=0;let data:Buffer|null=null;
  while(position+8<=raw.length){const id=raw.toString('ascii',position,position+4);const length=raw.readUInt32LE(position+4);const start=position+8;
    if(start+length>raw.length) throw new Error('Invalid WAV chunk');
    if(id==='fmt '){format=raw.readUInt16LE(start);channels=raw.readUInt16LE(start+2);sampleRate=raw.readUInt32LE(start+4);bits=raw.readUInt16LE(start+14);}
    if(id==='data')data=raw.subarray(start,start+length);
    position=start+length+(length%2);
  }
  if(format!==1||bits!==16||![1,2].includes(channels)||!data||!sampleRate) throw new Error('Unsupported Sahara WAV format');
  const frames=Math.floor(data.length/(2*channels));
  if(!frames) throw new Error('Empty Sahara audio');
  const outputFrames=Math.floor(frames*targetRate/sampleRate);
  const output=Buffer.alloc(outputFrames*2);
  for(let i=0;i<outputFrames;i++){
    const position=i*sampleRate/targetRate;const a=Math.floor(position);const b=Math.min(a+1,frames-1);const t=position-a;
    const read=(frame:number)=>channels===1?data!.readInt16LE(frame*2):Math.round((data!.readInt16LE(frame*4)+data!.readInt16LE(frame*4+2))/2);
    output.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(read(a)*(1-t)+read(b)*t))),i*2);
  }
  return output;
}
