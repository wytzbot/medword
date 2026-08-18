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
const RECENT_KEY='medword-ai-recent-v1';
const RECENT_LIMIT=8;
function recentWords(category){
 try{
  const all=JSON.parse(localStorage.getItem(RECENT_KEY)||'{}');
  return new Set(Array.isArray(all?.[category])?all[category]:[]);
 }catch{return new Set()}
}
function rememberWords(category, words){
 try{
  const all=JSON.parse(localStorage.getItem(RECENT_KEY)||'{}');
  const old=Array.isArray(all?.[category])?all[category]:[];
  const next=[...new Set([...words.map(w=>w.word),...old])].slice(0,RECENT_LIMIT);
  all[category]=next;localStorage.setItem(RECENT_KEY,JSON.stringify(all));
 }catch{}
}
function choose(a,level,category){
 const pool=cleanTerms(a,category);
 const recent=recentWords(category);
 const fresh=pool.filter(x=>!recent.has(x.word));
 const source=fresh.length>=Math.min(4,pool.length)?fresh:pool;
 for(let i=source.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[source[i],source[j]]=[source[j],source[i]]}
 const lvl=Math.max(1,Number(level)||1);
 const n=Math.min(8,4+Math.floor((lvl-1)/12));
 const selected=source.slice(0,n);
 // Only relax the no-repeat rule when the available pool is genuinely too small.
 rememberWords(category,selected);
 return selected;
}
export async function requestWords(category,level){
 const lvl=Math.max(1,Number(level)||1);
 const cached=cleanTerms(store.getTerms(category),category);
 if(cached.length>=6)return choose(cached,lvl,category);
 try{
  const controller=typeof AbortController==='function'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),10000):null;
  const r=await fetch('/api/generate-words',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:String(category),level:lvl,count:60}),...(controller?{signal:controller.signal}:{})});
  if(timer)clearTimeout(timer);
  if(r.ok){
   const data=await r.json();
   const terms=cleanTerms(data?.words,category);
   if(terms.length>=6){store.setTerms(category,terms);return choose(terms,lvl,category)}
  }
 }catch{}
 const arr=fallback[category]||[];
 return choose(arr.map(word=>({word,definition:'Medical learning term.',category})),lvl,category);
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
