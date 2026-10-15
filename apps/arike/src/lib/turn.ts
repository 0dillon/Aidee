type TurnOptions={minSpeechMs?:number;endSilenceMs?:number;maxSpeechMs?:number;minThreshold?:number;floorRatio?:number;playingBoost?:number};
export type TurnEvent='speech_start'|'barge_in'|'end'|null;

export function createTurnDetector({minSpeechMs=150,endSilenceMs=500,maxSpeechMs=18_000,minThreshold=0.006,floorRatio=2.5,playingBoost=2.5}:TurnOptions={}){
  let floor=0.002,loudSince=0,speechStarted=0,lastLoud=0,waitForQuiet=false;
  function update(rms:number,now:number,isPlaying=false):TurnEvent{
    const threshold=Math.max(minThreshold,floor*floorRatio)*(isPlaying?playingBoost:1);
    if(rms<=threshold){
      loudSince=0;waitForQuiet=false;
      if(!speechStarted)floor=floor*0.95+rms*0.05;
    }else if(!waitForQuiet){
      loudSince||=now;lastLoud=now;
      if(!speechStarted&&now-loudSince>=minSpeechMs){speechStarted=loudSince;return isPlaying?'barge_in':'speech_start';}
    }
    if(speechStarted&&(now-lastLoud>endSilenceMs||now-speechStarted>maxSpeechMs)){
      waitForQuiet=now-lastLoud<=endSilenceMs;
      speechStarted=0;loudSince=0;
      return 'end';
    }
    return null;
  }
  return {update,get inSpeech(){return speechStarted!==0;}};
}
