// Lightweight synthesized audio — no sample files to keep the PWA fully
// offline-capable. The ambient bed layers a few detuned, filtered voices
// (a warm sawtooth/triangle pad with slow vibrato) through a short synthetic
// reverb so it reads as a soft string pad rather than a bare test-tone drone.
//
// Mobile browsers only allow an AudioContext to start/resume inside a
// handler for a "real" user gesture, and not every browser agrees on which
// event types count — this file attaches its own unlock listeners for
// several gesture types so audio reliably turns on regardless of how the
// rest of the app is wired up.
let ctx;
let enabled=true;
let ambientNodes=[];
let ambientMaster=null;
let unlocked=false;

function audio(){
 if(!ctx){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC)return null;
  ctx=new AC();
 }
 if(ctx.state==='suspended'){try{ctx.resume()}catch{}}
 return ctx;
}

function makeImpulse(c,seconds=2.4,decay=2.8){
 const rate=c.sampleRate,len=Math.floor(rate*seconds),buf=c.createBuffer(2,len,rate);
 for(let ch=0;ch<2;ch++){const data=buf.getChannelData(ch);for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay)}
 return buf;
}

// A short sequence of soft triangle-wave tones — used for hint/found/complete
// so effects read as small musical chimes instead of flat beeps.
function chime(freqs,{dur=.16,gap=.09,gain=.07,type='triangle'}={}){
 if(!enabled)return;
 const c=audio();
 if(!c)return;
 try{
  freqs.forEach((f,i)=>{
   const o=c.createOscillator(),g=c.createGain();
   o.type=type;o.frequency.value=f;o.connect(g);g.connect(c.destination);
   const t0=c.currentTime+i*gap;
   g.gain.setValueAtTime(0,t0);
   g.gain.linearRampToValueAtTime(gain,t0+.015);
   g.gain.exponentialRampToValueAtTime(.001,t0+dur);
   o.start(t0);o.stop(t0+dur+.03);
  });
 }catch{}
}

function startAmbient(){
 if(!enabled||ambientNodes.length)return;
 const c=audio();
 if(!c)return;
 try{
  ambientMaster=c.createGain();
  ambientMaster.gain.value=0;
  ambientMaster.connect(c.destination);
  ambientMaster.gain.linearRampToValueAtTime(.07,c.currentTime+1.6); // quick string-like swell in

  const filter=c.createBiquadFilter();
  filter.type='lowpass';filter.frequency.value=1050;filter.Q.value=.5;
  filter.connect(ambientMaster);

  // Reverb is a nice-to-have — if it fails on a given device, the pad
  // voices below should still play, so this is isolated in its own try.
  try{
   const convolver=c.createConvolver();
   convolver.buffer=makeImpulse(c);
   const wet=c.createGain();wet.gain.value=.32;
   filter.connect(convolver);convolver.connect(wet);wet.connect(ambientMaster);
  }catch{}

  // Warm pad chord (C3-E3-G3-C4) — alternating waveforms + slight per-voice
  // detune stand in for a small string section without needing samples.
  const notes=[130.81,164.81,196.0,261.63];
  notes.forEach((f,i)=>{
   const o=c.createOscillator();
   o.type=i%2?'triangle':'sawtooth';
   o.frequency.value=f;
   o.detune.value=(i-1.5)*6;
   const og=c.createGain();og.gain.value=.5;
   o.connect(og);og.connect(filter);o.start();
   ambientNodes.push(o);

   // Gentle vibrato per voice for a bowed-string character.
   const lfo=c.createOscillator();lfo.type='sine';lfo.frequency.value=.12+i*.03;
   const lfoGain=c.createGain();lfoGain.gain.value=3+i;
   lfo.connect(lfoGain);lfoGain.connect(o.detune);lfo.start();
   ambientNodes.push(lfo);
  });

  // Slow filter sweep so the pad breathes instead of sitting static.
  const fLfo=c.createOscillator();fLfo.type='sine';fLfo.frequency.value=.045;
  const fLfoGain=c.createGain();fLfoGain.gain.value=200;
  fLfo.connect(fLfoGain);fLfoGain.connect(filter.frequency);fLfo.start();
  ambientNodes.push(fLfo);
 }catch{}
}

function stopAmbient(){
 if(!ambientNodes.length){ambientMaster=null;return}
 const nodes=ambientNodes;ambientNodes=[];
 const master=ambientMaster;ambientMaster=null;
 try{
  if(master&&ctx){
   const now=ctx.currentTime;
   master.gain.cancelScheduledValues(now);
   master.gain.setValueAtTime(master.gain.value,now);
   master.gain.linearRampToValueAtTime(0,now+.45);
  }
 }catch{}
 setTimeout(()=>nodes.forEach(o=>{try{o.stop()}catch{}}),500);
}

function unlock(){
 if(unlocked)return;
 unlocked=true;
 audio();
 if(enabled)startAmbient();
}
// Different browsers/platforms recognise different events as a "real" user
// gesture for unlocking audio (iOS Safari in particular can be picky), so
// listen broadly rather than relying on a single event type.
['pointerdown','touchend','mousedown','keydown'].forEach(evt=>{
 try{document.addEventListener(evt,unlock,{once:true,passive:true})}catch{}
});

export const sound={
 get enabled(){return enabled},
 init(){try{enabled=localStorage.sound!=='off'}catch{enabled=true}},
 setEnabled(v){
  enabled=!!v;
  try{localStorage.sound=enabled?'on':'off'}catch{}
  if(enabled){unlock();startAmbient()}else stopAmbient();
 },
 start(){unlock();startAmbient()},
 stop(){stopAmbient()},
 hint(){chime([659.25,880],{dur:.14,gap:.09,gain:.07})},
 found(){chime([740,987.77],{dur:.12,gap:.06,gain:.075})},
 complete(){chime([523.25,659.25,783.99,1046.5],{dur:.22,gap:.12,gain:.08})}
};
