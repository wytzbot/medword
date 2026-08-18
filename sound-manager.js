// MedWord Sound Manager
// Soft synthesized piano ambience + success chime + completion voice.
// No copyrighted audio files are used.
let ctx=null, enabled=true, unlocked=false;
let ambientTimer=null, ambientNodes=[];
let successfulWordVolume=.07, pianoVolume=.06, voiceVolume=.8;
let melodyIndex=-1, lastPhraseIndex=-1;

const phrases=['Good!','Perfect!','Genius!','You killed it!','Excellent!','Brilliant!','Amazing!'];
const melodies=[
 [[261.63,.34],[329.63,.34],[392,.42],[329.63,.34],[293.66,.42]],
 [[220,.34],[261.63,.34],[329.63,.42],[293.66,.34],[261.63,.42]],
 [[196,.34],[246.94,.34],[293.66,.42],[246.94,.34],[220,.42]],
 [[293.66,.34],[349.23,.34],[440,.42],[349.23,.34],[329.63,.42]],
 [[174.61,.34],[220,.34],[261.63,.42],[220,.34],[196,.42]]
];

function load(){
 try{
  enabled=localStorage.sound!=='off';
  successfulWordVolume=clamp(localStorage.successful_word_volume,.07);
  pianoVolume=clamp(localStorage.piano_ambient_volume,.06);
  voiceVolume=clamp(localStorage.level_voice_volume,.8);
 }catch{}
}
function clamp(v,f){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):f}
function save(k,v){try{localStorage.setItem(k,String(v))}catch{}}
function audio(){
 if(!ctx){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;ctx=new AC()}
 if(ctx.state==='suspended')ctx.resume().catch(()=>{});
 return ctx;
}
function unlock(){if(!enabled)return;unlocked=true;audio()}
function chooseMelody(){
 if(melodyIndex>=0)return melodyIndex;
 try{
  const last=Number(sessionStorage.getItem('medword_piano_melody'));
  let n=Number.isInteger(last)?(last+1)%melodies.length:Math.floor(Math.random()*melodies.length);
  melodyIndex=n;sessionStorage.setItem('medword_piano_melody',String(n));return n;
 }catch{melodyIndex=Math.floor(Math.random()*melodies.length);return melodyIndex}
}
function note(freq,start,duration,vol){
 const c=audio();if(!c||!enabled||pianoVolume<=0)return;
 const o=c.createOscillator(),g=c.createGain(),f=c.createBiquadFilter();
 o.type='sine';o.frequency.value=freq;f.type='lowpass';f.frequency.value=2200;f.Q.value=.5;
 o.connect(f);f.connect(g);g.connect(c.destination);
 const peak=Math.max(.0001,vol*pianoVolume);
 g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(peak,start+.02);g.gain.exponentialRampToValueAtTime(.0001,start+duration);
 o.start(start);o.stop(start+duration+.05);ambientNodes.push(o);
}
function startAmbient(){
 if(!enabled||!unlocked||pianoVolume<=0||document.visibilityState!=='visible'||ambientTimer)return;
 const c=audio();if(!c)return;
 const melody=melodies[chooseMelody()],now=c.currentTime;
 melody.forEach((n,i)=>note(n[0],now+i*.7,n[1],.65));
 ambientTimer=setTimeout(()=>{ambientTimer=null;if(enabled&&unlocked&&document.visibilityState==='visible')startAmbient()},3800);
}
function stopAmbient(){
 if(ambientTimer){clearTimeout(ambientTimer);ambientTimer=null}
 ambientNodes.forEach(o=>{try{o.stop()}catch{}});ambientNodes=[];
}
function chime(){
 if(!enabled||successfulWordVolume<=0)return;
 const c=audio();if(!c)return;
 try{
  const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(740,c.currentTime);o.frequency.exponentialRampToValueAtTime(988,c.currentTime+.07);o.connect(g);g.connect(c.destination);
  const t=c.currentTime;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(successfulWordVolume,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+.16);o.start(t);o.stop(t+.2);
 }catch{}
}
function speak(){
 if(!enabled||voiceVolume<=0||!('speechSynthesis'in window)||typeof SpeechSynthesisUtterance==='undefined')return;
 try{
  const synth=window.speechSynthesis;synth.cancel();
  let i;do{i=Math.floor(Math.random()*phrases.length)}while(phrases.length>1&&i===lastPhraseIndex);lastPhraseIndex=i;
  const u=new SpeechSynthesisUtterance(phrases[i]);u.volume=voiceVolume;u.rate=1.05;u.pitch=1;
  const voices=synth.getVoices();const v=voices.find(x=>/^en(-|_)/i.test(x.lang))||voices.find(x=>/en/i.test(x.lang));if(v)u.voice=v;
  synth.speak(u);
 }catch{}
}
function stopAll(){stopAmbient();try{window.speechSynthesis?.cancel()}catch{}}
['pointerdown','touchend','mousedown','keydown'].forEach(e=>document.addEventListener(e,()=>{if(!unlocked)unlock()},{passive:true}));
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAll()});window.addEventListener('pagehide',stopAll);
export const sound={
 get enabled(){return enabled},
 init(){load();try{window.speechSynthesis?.getVoices()}catch{}},
 setEnabled(v){enabled=!!v;save('sound',enabled?'on':'off');if(!enabled)stopAll();else{unlock();startAmbient()}},
 start(){unlock();startAmbient()},
 stop(){stopAll()},
 hint(){chime()},
 found(){chime()},
 complete(){chime();speak()},
 voice(){speak()},
 setSuccessfulWordVolume(v){successfulWordVolume=clamp(v,0);save('successful_word_volume',successfulWordVolume)},
 setPianoVolume(v){pianoVolume=clamp(v,0);save('piano_ambient_volume',pianoVolume);if(pianoVolume<=0)stopAmbient();else if(enabled&&unlocked)startAmbient()},
 setVoiceVolume(v){voiceVolume=clamp(v,0);save('level_voice_volume',voiceVolume)},
 getVolumes(){return{successfulWord:successfulWordVolume,piano:pianoVolume,voice:voiceVolume}}
};
