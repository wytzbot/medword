const TTL=5*60*1000;
function read(key){try{return localStorage.getItem(key)}catch{return null}}
function write(key,value){try{localStorage.setItem(key,value)}catch{}}
function getCache(){try{return JSON.parse(read('medwordProCache')||'null')}catch{return null}}
function timeoutSignal(ms){if(typeof AbortController!=='function')return {};const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return {signal:controller.signal}}
export async function startPro(email){
 try{
  const r=await fetch('/api/create-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,plan:'monthly'}),...timeoutSignal(10000)});
  if(!r.ok)throw new Error('Payment creation failed');
  const d=await r.json();if(d?.checkout_url){location.href=d.checkout_url;return true}
  throw new Error('No checkout URL');
 }catch{return false}
}
export function peekCachedPro(){
 const email=read('medwordEmail');if(!email)return false;
 const cached=getCache();
 return cached?.email===email?!!cached.pro:false;
}
export async function checkPro({force=false}={}){
 const email=read('medwordEmail');if(!email)return false;
 const cached=getCache();
 if(!force&&cached?.email===email&&Date.now()-cached.checkedAt<TTL)return !!cached.pro;
 try{
  const r=await fetch('/api/check-pro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email}),...timeoutSignal(8000)});
  if(!r.ok)return !!(cached?.email===email&&cached?.pro);
  const d=await r.json(),value=d?.pro===true;
  write('medwordProCache',JSON.stringify({email,pro:value,checkedAt:Date.now()}));return value;
 }catch{return !!(cached?.email===email&&cached?.pro)}
}
export async function verifyPaymentReturn(){
 const p=new URLSearchParams(location.search),txRef=p.get('tx_ref'),transactionId=p.get('transaction_id');
 if(!txRef&&!transactionId)return null;
 const email=read('medwordEmail');if(!email)return null;
 try{
  const r=await fetch('/api/verify-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,tx_ref:txRef,transaction_id:transactionId}),...timeoutSignal(10000)});
  if(!r.ok)return null;
  const d=await r.json();
  if(d?.pro===true)write('medwordProCache',JSON.stringify({email,pro:true,checkedAt:Date.now()}));
  return d;
 }catch{return null}
}
