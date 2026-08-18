// MedWord audio manager: soft synthesized piano ambience, success chimes and voice.
// All audio is generated locally; no copyrighted audio files are used.
let ctx=null;
let enabled=true;
let ambientNodes=[];
let ambientMaster=null;
let unlocked=false;
let melodyIndex=0;
let voiceTimer=null;

const volumes={found:.45,ambient:.18,voice:.75};
const KEY='medwordSoundSettings';

function loadSettings(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY)||'{}');
    if(typeof s.enabled==='boolean') enabled=s.enabled;
    ['found','ambient','voice'].forEach(k=>{
      const n=Number(s[k]);
      if(Number.isFinite(n)) volumes[k]=Math.max(0,Math.min(1,n));
    });
    melodyIndex=Number(localStorage.getItem('medwordMelodyIndex')||0)%5;
  }catch{}
}
function saveSettings(){try{localStorage.setItem(KEY,JSON.stringify({enabled,...volumes}))}catch{}}
function audio(){
  if(!ctx){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;ctx=new AC()}
  if(ctx.state==='suspended'){try{ctx.resume()}catch{}}
  return ctx;
}
function makeImpulse(c,seconds=1.8,decay=2.6){
  const rate=c.sampleRate,len=Math.floor(rate*seconds),buf=c.createBuffer(2,len,rate);
  for(let ch=0;ch<2;ch++){const data=buf.getChannelData(ch);for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay)}
  return buf;
}
function chime(freqs,{dur=.14,gap=.07,gain=.06}={}){
  if(!enabled||volumes.found<=0)return;
  const c=audio();if(!c)return;
  try{freqs.forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=f;o.connect(g);g.connect(c.destination);const t=c.currentTime+i*gap,peak=gain*volumes.found;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+.012);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.start(t);o.stop(t+dur+.03)})}catch{}
}

// Five short, gentle piano-like phrases. A different one is selected per new visit.
const melodies=[
 [261.63,329.63,392,523.25,392,329.63],
 [293.66,349.23,440,587.33,440,349.23],
 [246.94,329.63,369.99,493.88,369.99,329.63],
 [220,277.18,329.63,440,329.63,277.18],
 [261.63,311.13,392,466.16,392,311.13]
];

function pianoNote(c,f,t,d=.75,gain=.18){
  const o=c.createOscillator(),g=c.createGain(),filter=c.createBiquadFilter();
  o.type='triangle';o.frequency.setValueAtTime(f,t);
  filter.type='lowpass';filter.frequency.value=2300;filter.Q.value=.4;
  o.connect(filter);filter.connect(g);g.connect(ambientMaster);
  const peak=gain*volumes.ambient;
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),t+.025);g.gain.exponentialRampToValueAtTime(.0001,t+d);
  o.start(t);o.stop(t+d+.05);ambientNodes.push(o);
}
function playMelody(c){
  const notes=melodies[melodyIndex];const start=c.currentTime+.15;
  notes.forEach((f,i)=>pianoNote(c,f,start+i*.55,.72,.22));
  // Repeat the selected phrase quietly while the app remains visible.
  const repeat=()=>{if(!ambientMaster||document.hidden||!enabled||volumes.ambient<=0)return;const now=c.currentTime+1.2;notes.forEach((f,i)=>pianoNote(c,f,now+i*.55,.72,.22));ambientNodes.push({timer:setTimeout(repeat,notes.length*550+850)});};
  ambientNodes.push({timer:setTimeout(repeat,notes.length*550+850)});
}
function startAmbient(){
  if(!enabled||volumes.ambient<=0||ambientMaster||document.hidden)return;
  const c=audio();if(!c)return;
  try{ambientMaster=c.createGain();ambientMaster.gain.setValueAtTime(0,c.currentTime);ambientMaster.gain.linearRampToValueAtTime(.95,c.currentTime+1.2);ambientMaster.connect(c.destination);playMelody(c)}catch{}
}
function stopAmbient(){
  if(!ambientMaster)return;
  const master=ambientMaster;ambientMaster=null;
  try{const now=ctx.currentTime;master.gain.cancelScheduledValues(now);master.gain.setValueAtTime(Math.max(0,master.gain.value),now);master.gain.linearRampToValueAtTime(0,now+.18)}catch{}
  const nodes=ambientNodes;ambientNodes=[];
  nodes.forEach(n=>{if(n?.timer)clearTimeout(n.timer);else try{n.stop()}catch{}});
  setTimeout(()=>{try{master.disconnect()}catch{}},250);
}
function unlock(){if(unlocked)return;unlocked=true;audio();if(enabled&&!document.hidden)startAmbient()}
function speak(text){
  if(!enabled||volumes.voice<=0||document.hidden||!('speechSynthesis' in window))return;
  try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.rate=.92;u.pitch=1.02;u.volume=volumes.voice;window.speechSynthesis.speak(u)}catch{}
}
['pointerdown','touchend','mousedown','keydown'].forEach(evt=>{try{document.addEventListener(evt,unlock,{once:true,passive:true})}catch{}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopAmbient();try{window.speechSynthesis?.cancel()}catch{}}else if(enabled){unlocked=false}});

export const sound={
 get enabled(){return enabled},
 get volumes(){return {...volumes}},
 init(){loadSettings()},
 setEnabled(v){enabled=!!v;saveSettings();if(enabled){unlocked=false}else{stopAmbient();try{window.speechSynthesis?.cancel()}catch{}}},
 setVolume(type,value){if(!(type in volumes))return;volumes[type]=Math.max(0,Math.min(1,Number(value)||0));saveSettings();if(type==='ambient'){stopAmbient();if(enabled&&!document.hidden&&volumes.ambient>0)startAmbient()}},
 start(){unlock();startAmbient()},
 stop(){stopAmbient();try{window.speechSynthesis?.cancel()}catch{}},
 hint(){chime([659.25,880],{dur:.14,gap:.09,gain:.055})},
 found(){chime([740,987.77],{dur:.12,gap:.06,gain:.065})},
 complete(){chime([523.25,659.25,783.99,1046.5],{dur:.18,gap:.09,gain:.055});const words=['Good!','Perfect!','Genius!','You killed it!','Excellent!','Brilliant!','Amazing!'];speak(words[Math.floor(Math.random()*words.length)])}
};
