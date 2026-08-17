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
function choose(a,level){
 const pool=cleanTerms(a,'');
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
 const n=Math.min(10,Math.max(6,6+Math.floor(Number(level)||1)/15|0));
 return pool.slice(0,n);
}
export async function requestWords(category,level){
 const cached=cleanTerms(store.getTerms(category),category);
 if(cached.length>=6)return choose(cached,level);
 try{
  const controller=typeof AbortController==='function'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),10000):null;
  const r=await fetch('/api/generate-words',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:String(category),level:Math.max(1,Number(level)||1),count:60}),...(controller?{signal:controller.signal}:{})});
  if(timer)clearTimeout(timer);
  if(r.ok){
   const data=await r.json();
   const terms=cleanTerms(data?.words,category);
   if(terms.length>=6){store.setTerms(category,terms);return choose(terms,level)}
  }
 }catch{}
 const arr=fallback[category]||[];
 return choose(arr.map(word=>({word,definition:'Medical learning term.',category})),level);
}
export async function explainTerm(word){
 const safe=String(word??'').replace(/[^A-Za-z -]/g,'').trim().slice(0,80);
 if(!safe)return null;
 try{
  const r=await fetch('/api/explain-term',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word:safe})});
  if(r.ok)return await r.json();
 }catch{}
 return null;
}
