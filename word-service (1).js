import {store} from '../data/local-cache.js';
const fallback={
 Anatomy:['FEMUR','TIBIA','PATELLA','FIBULA','SCAPULA','HUMERUS','RADIUS','ULNA','CLAVICLE','STERNUM','PELVIS','SACRUM'],
 Nursing:['TRIAGE','VITALS','STERILE','DOSAGE','PATIENT','DRESSING','CATHETER','INJECTION','BANDAGE','ASSESSMENT','CAREPLAN','HYGIENE'],
 'Medical Laboratory Science':['SPECIMEN','HEMATOLOGY','SERUM','PLASMA','URINALYSIS','MICROSCOPE','CULTURE','CENTRIFUGE','REAGENT','STAINING','PLATELET','LEUKOCYTE'],
 Medicine:['DIAGNOSIS','THERAPY','SYMPTOM','PROGNOSIS','SURGERY','CLINIC','PATIENT','TREATMENT','DOSAGE','VACCINE','INFECTION','ANALGESIC'],
 Physiology:['HOMEOSTASIS','NEURON','SYNAPSE','CARDIAC','RESPIRATION','METABOLISM','HORMONE','REFLEX','FILTRATION','ABSORPTION','VENTILATION','CIRCULATION'],
 Biology:['CELL','DNA','GENE','PROTEIN','MITOSIS','MEIOSIS','ENZYME','TISSUE','ORGANISM','CHROMOSOME','RIBOSOME','MEMBRANE'],
 Pharmacology:['PHARMACOKINETICS','RECEPTOR','AGONIST','ANTAGONIST','DOSAGE','ADVERSE','TOXICITY','ABSORPTION','METABOLISM','ELIMINATION','DRUG','PRESCRIPTION'],
 Pathology:['BIOPSY','NECROSIS','INFLAMMATION','TUMOR','LESION','ETIOLOGY','DISEASE','MALIGNANT','BENIGN','DIAGNOSIS','FIBROSIS','EDEMA'],
 Microbiology:['BACTERIA','VIRUS','FUNGUS','PROTOZOA','CULTURE','PATHOGEN','INFECTION','ANTIBIOTIC','GRAMSTAIN','MICROBE','SPORE','PARASITE'],
 Biochemistry:['GLUCOSE','LIPID','PROTEIN','ENZYME','AMINOACID','ATP','METABOLISM','GLYCOLYSIS','UREA','CHOLESTEROL','DNA','RNA'],
 Histology:['EPITHELIUM','STROMA','NUCLEUS','CYTOPLASM','COLLAGEN','ADIPOSE','CARTILAGE','TENDON','NEURON','MUSCLE','GLAND','TISSUE'],
 Immunology:['ANTIBODY','ANTIGEN','IMMUNITY','LYMPHOCYTE','MACROPHAGE','CYTOKINE','VACCINE','COMPLEMENT','TOLERANCE','PLASMA','BLYMPHOCYTE','TLYMPHOCYTE']
};
function cleanTerms(items,category){
 const seen=new Set(),out=[];
 for(const x of Array.isArray(items)?items:[]){
  const raw=String(x?.word??'').trim(),word=raw.toUpperCase().replace(/[^A-Z]/g,'');
  if(word.length<2||word.length>18||seen.has(word))continue;
  seen.add(word);out.push({...x,word,category});
 }
 return out;
}
// A puzzle now always pulls 6-8 terms, growing toward the top of that range
// as the player levels up, so later levels take longer to scan and solve.
function wordCountForLevel(level){
 const lvl=Math.max(1,Number(level)||1);
 return Math.min(8,6+Math.floor((lvl-1)/10));
}
const RECENT_KEY='medword-ai-recent-v1';
const RECENT_LIMIT=48; // remembers far more than one puzzle's worth so the AI has to work through the whole pool before anything repeats
function recentWords(category){
 try{
  const all=JSON.parse(localStorage.getItem(RECENT_KEY)||'{}');
  return Array.isArray(all?.[category])?all[category]:[];
 }catch{return []}
}
function rememberWords(category,words){
 try{
  const all=JSON.parse(localStorage.getItem(RECENT_KEY)||'{}');
  const old=Array.isArray(all?.[category])?all[category]:[];
  const next=[...new Set([...words.map(w=>w.word),...old])].slice(0,RECENT_LIMIT);
  all[category]=next;localStorage.setItem(RECENT_KEY,JSON.stringify(all));
 }catch{}
}
function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function pick(pool,category,level){
 const n=wordCountForLevel(level);
 const recent=new Set(recentWords(category));
 const fresh=pool.filter(x=>!recent.has(x.word));
 const source=fresh.length>=Math.min(n,pool.length)?fresh:pool;
 const selected=shuffle(source).slice(0,n);
 rememberWords(category,selected);
 return selected;
}
async function fetchAiTerms(category,level,exclude){
 const controller=typeof AbortController==='function'?new AbortController():null;
 const timer=controller?setTimeout(()=>controller.abort(),10000):null;
 try{
  const r=await fetch('/api/generate-words',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:String(category),level:Math.max(1,Number(level)||1),count:60,exclude})});
  if(!r.ok)return null;
  const data=await r.json();
  const terms=cleanTerms(data?.words,category);
  return terms.length>=6?terms:null;
 }catch{return null}
 finally{if(timer)clearTimeout(timer)}
}
export async function requestWords(category,level){
 const lvl=Math.max(1,Number(level)||1);
 const n=wordCountForLevel(lvl);
 let cached=cleanTerms(store.getTerms(category),category);
 const recentList=recentWords(category);
 const recentSet=new Set(recentList);
 let fresh=cached.filter(x=>!recentSet.has(x.word));
 // The cached pool is running low on words the player hasn't just seen —
 // ask the AI for a fresh batch (told explicitly what to avoid) before
 // falling back to reusing older terms, so repeats stay rare.
 if(fresh.length<n){
  const exclude=[...new Set([...recentList,...cached.map(w=>w.word)])].slice(0,120);
  const terms=await fetchAiTerms(category,lvl,exclude);
  if(terms){
   const merged=cleanTerms([...terms,...cached],category);
   store.setTerms(category,merged);
   cached=merged;
   fresh=cached.filter(x=>!recentSet.has(x.word));
  }
 }
 if(fresh.length>=Math.min(4,n))return pick(fresh.length>=n?fresh:cached,category,lvl);
 if(cached.length>=6)return pick(cached,category,lvl);
 const arr=fallback[category]||[];
 return pick(arr.map(word=>({word,definition:'Medical learning term.',category})),category,lvl);
}

export async function explainTerm(word){
 const safe=String(word??'').replace(/[^A-Za-z -]/g,'').trim().slice(0,80);
 if(!safe)return null;
 let email='';try{email=localStorage.getItem('medwordEmail')||''}catch{}
 try{
  const r=await fetch('/api/explain-term',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word:safe,email})});
  if(r.ok)return await r.json();
 }catch{}
 return null;
}
