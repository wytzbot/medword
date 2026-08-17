export async function adTransition(){
 return new Promise(resolve=>{
  const s=document.createElement('div');s.className='sheet';s.innerHTML=`<div class="modal"><h3>Continue playing</h3><p class="muted">Free players may see a short advertisement between levels.</p><div class="adbox" id="adsterra-slot"><span>Loading ad…</span></div><p class="muted">If the advertisement cannot load, you can still continue.</p><button class="btn ghost" id="cancelAd" type="button">Cancel & continue</button><button class="btn pro" id="getPro" type="button">Remove ads with Pro</button></div>`;document.body.appendChild(s);
  const slot=s.querySelector('#adsterra-slot');let resolved=false;
  const timer=setTimeout(()=>finish(true),10000);
  const finish=v=>{if(resolved)return;resolved=true;clearTimeout(timer);s.remove();resolve(v)};
  try{
   window.atOptions={key:'6f28172393ec5261180c7d2e1f39d525',format:'iframe',height:600,width:160,params:{}};
   const script=document.createElement('script');script.src='https://potterynaggingformerly.com/6f28172393ec5261180c7d2e1f39d525/invoke.js';script.async=true;
   script.onload=()=>slot.querySelector('span')?.remove();script.onerror=()=>{slot.innerHTML='<span>Ad unavailable — continue below.</span>'};slot.appendChild(script);
  }catch{slot.innerHTML='<span>Ad unavailable — continue below.</span>'}
  s.querySelector('#cancelAd').onclick=()=>finish(true);
  s.querySelector('#getPro').onclick=()=>finish('upgrade');
 });
}
