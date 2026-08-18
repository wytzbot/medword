export async function adTransition(){
 return new Promise(resolve=>{
  const s=document.createElement('div');s.className='sheet';s.innerHTML=`<div class="modal"><h3>Continue playing</h3><p class="muted">Free players may see a short advertisement between levels.</p><div class="adbox" id="adsterra-slot"><span>Loading ad…</span></div><p class="muted">Please wait <strong id="adCountdown">10</strong>s before continuing.</p><button class="btn ghost adwait" id="cancelAd" type="button" disabled>Cancel & continue</button><button class="btn pro" id="getPro" type="button">Remove ads with Pro</button></div></div>`;document.body.appendChild(s);
  const slot=s.querySelector('#adsterra-slot'),btn=s.querySelector('#cancelAd'),count=s.querySelector('#adCountdown');let resolved=false,seconds=10;
  const finish=v=>{if(resolved)return;resolved=true;clearInterval(tick);s.remove();resolve(v)};
  const tick=setInterval(()=>{seconds--;count.textContent=String(Math.max(0,seconds));if(seconds<=0){clearInterval(tick);btn.disabled=false;btn.classList.remove('adwait')}},1000);
  try{
   window.atOptions={key:'6f28172393ec5261180c7d2e1f39d525',format:'iframe',height:250,width:300,params:{}};
   const script=document.createElement('script');script.src='https://potterynaggingformerly.com/6f28172393ec5261180c7d2e1f39d525/invoke.js';script.async=true;
   script.onload=()=>slot.querySelector('span')?.remove();script.onerror=()=>{slot.innerHTML='<span>Ad unavailable — continue below.</span>'};slot.appendChild(script);
  }catch{slot.innerHTML='<span>Ad unavailable — continue below.</span>'}
  btn.onclick=()=>finish(true);s.querySelector('#getPro').onclick=()=>finish('upgrade');
 });
}
