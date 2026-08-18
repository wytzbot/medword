const KEY='medword-state-v2';
const DEFAULT={profile:{level:1,xp:0,streak:0,totalLevels:0,category:'Anatomy',lastCompletedDate:null},progress:{},terms:{},recent:{}};
let state;
function load(){
 try{
  let raw=JSON.parse(localStorage.getItem(KEY)||'null');
  if(!raw){
   try{const legacy=JSON.parse(localStorage.getItem('medword-state-v1')||'null');if(legacy&&typeof legacy==='object')raw=legacy}catch{}
  }
  state=raw&&typeof raw==='object'?{...DEFAULT,...raw,profile:{...DEFAULT.profile,...raw.profile},progress:raw.progress||{},terms:raw.terms||{},recent:raw.recent||{}}:structuredClone(DEFAULT);
 }catch{state=structuredClone(DEFAULT)}
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){console.warn('MedWord storage unavailable',e)}}
function dateKey(d=new Date()){const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)}
function previousDate(key){const d=new Date(`${key}T00:00:00`);d.setDate(d.getDate()-1);return dateKey(d)}
load();
export const store={
 get profile(){return state.profile},
 get progress(){return state.progress},
 get totalLevels(){return state.profile.totalLevels||0},
 complete(cat,level){
  state.progress[cat]=(state.progress[cat]||0)+1;
  state.profile.totalLevels=(state.profile.totalLevels||0)+1;
  state.profile.level=state.profile.totalLevels+1;
  state.profile.category=cat;
  state.profile.xp=(state.profile.xp||0)+250;
  const today=dateKey(),last=state.profile.lastCompletedDate;
  if(last===today){}else if(last===previousDate(today))state.profile.streak=(state.profile.streak||0)+1;else state.profile.streak=1;
  state.profile.lastCompletedDate=today;save();
 },
 getTerms(cat){return Array.isArray(state.terms[cat])?state.terms[cat]:[]},
 setTerms(cat,terms){state.terms[cat]=Array.isArray(terms)?terms.slice(0,200):[];save()}, getRecent(cat){return Array.isArray(state.recent[cat])?state.recent[cat]:[]}, setRecent(cat,words){state.recent[cat]=Array.isArray(words)?words.slice(-12):[];save()}
};
