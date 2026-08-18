import {Game} from './game/puzzle-engine.js';
import {store} from './data/local-cache.js';
import {sound} from './audio/sound-manager.js';
import {showToast, celebrate, sheet} from './ui/ui.js';
import {requestWords, explainTerm} from './ai/word-service.js';
import {adTransition} from './ads/adsterra.js';
import {startPro, checkPro, verifyPaymentReturn, peekCachedPro} from './payments/flutterwave.js';

const cats=[['Anatomy','🫀'],['Nursing','🩺'],['Medical Laboratory Science','🧪'],['Medicine','💊'],['Physiology','🧠'],['Biology','🧬'],['Pharmacology','💉'],['Pathology','🔬'],['Microbiology','🦠'],['Biochemistry','⚗️'],['Histology','🔬'],['Immunology','🛡️']];
const app=document.querySelector('#app');
let game=null, navigationToken=0, pro=false, paymentChecking=false;

function particles(){return `<div class="bg">${Array.from({length:16},(_,i)=>`<i class="particle" style="left:${(i*17)%100}%;animation-delay:-${i%9}s;animation-duration:${9+i%7}s"></i>`).join('')}</div>`}
function shell(content,active='home'){app.innerHTML=`<div class="app">${particles()}<main class="screen">${content}</main>${nav(active)}</div>`;bindNav()}
function pushRoute(routeName){try{history.pushState({route:routeName},'',location.pathname+'#'+routeName)}catch{}}
function goBack(){if(history.state?.route&&history.length>1)history.back();else home()}
function nav(active){return `<nav class="bottom">${[['home','⌂','Home'],['play','▶','Play'],['progress','◔','Progress'],['badges','🏆','Badges'],['settings','⚙','Settings']].map(x=>`<button class="nav ${active===x[0]?'active':''}" data-nav="${x[0]}" type="button"><span>${x[1]}</span>${x[2]}</button>`).join('')}</nav>`}
function bindNav(){document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{pushRoute(b.dataset.nav);route(b.dataset.nav)})}
function home(){
 const p=store.profile;
 shell(`<div class="top"><div class="brand">Med<span>Word</span></div><button class="iconbtn" id="theme" type="button">☾</button></div>
 <section class="hero"><h1>Find the terms.<br>Master your field.</h1><p>Fast medical word search for students and lifelong learners.</p><button class="btn light" id="quick" type="button">Continue playing</button></section>
 <div class="section stats"><div class="stat"><b>${p.level||1}</b><span class="muted">Level</span></div><div class="stat"><b>${p.xp||0}</b><span class="muted">XP</span></div><div class="stat"><b>🔥 ${p.streak||0}</b><span class="muted">Streak</span></div></div>
 <div class="section"><div class="sectionhead"><h2>Medical fields</h2><span class="muted">Unlimited levels</span></div><div class="gridcats">${cats.map(([n,i])=>`<button class="cat" data-cat="${escapeHtml(n)}" type="button"><span class="ico">${i}</span><strong>${escapeHtml(n)}</strong><small>${store.progress[n]||0} levels</small></button>`).join('')}</div></div>`);
 document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>play(b.dataset.cat));
 document.querySelector('#quick').onclick=()=>play(p.category||'Anatomy');
 document.querySelector('#theme').onclick=toggleTheme;
}
function toggleTheme(){const dark=!document.body.classList.contains('dark');document.body.classList.toggle('dark',dark);try{localStorage.theme=dark?'dark':'light'}catch{}}
function play(category){pushRoute('play');const level=(store.progress[category]||0)+1;startGame(category,level)}
async function startGame(category,level){
 const token=++navigationToken;
 app.innerHTML=`<div class="app">${particles()}<main class="screen"><div class="top"><button class="back" id="back" type="button">‹</button><div class="gameinfo"><strong>${escapeHtml(category)}</strong><span class="muted">Level ${level}</span></div><span class="pill" id="count">0/0</span></div><div class="progress"><i id="bar" style="width:0%"></i></div><section class="game"><div class="boardwrap"><div id="board" class="board"></div></div><div class="words" id="words"></div><div class="gameactions"><button class="btn ghost" id="hint" type="button">💡 Hint <span id="hints"></span></button><button class="btn" id="skip" type="button">Next</button></div></section></main></div>`;
 document.querySelector('#back').onclick=()=>goBack();
 let words;
 try{words=await requestWords(category,level)}catch(e){if(token===navigationToken)showToast('Could not load this level. Please try again.');return}
 if(token!==navigationToken)return;
 try{game=new Game(words,level,{pro});renderGame(category,level)}catch(e){console.error(e);if(token===navigationToken)showToast('This puzzle could not be created. Try the next level.')}
}
function renderGame(category,level){
 const board=document.querySelector('#board');
 if(!board||!game)return;
 game.render(board);
 const wordsEl=document.querySelector('#words');
 wordsEl.innerHTML=game.words.map(w=>`<button class="word" type="button" data-word="${escapeHtml(w.word)}">${escapeHtml(w.word)}</button>`).join('');
 const update=()=>{
  if(!game)return;
  const found=game.found.size,total=game.words.length;
  const count=document.querySelector('#count'),bar=document.querySelector('#bar'),hintEl=document.querySelector('#hints');
  if(!count||!bar||!hintEl)return;
  count.textContent=`${found}/${total}`;
  bar.style.width=`${total?found/total*100:0}%`;
  wordsEl.querySelectorAll('.word').forEach(x=>{
   const done=game.found.has(game.norm(x.dataset.word));
   x.classList.toggle('done',done);
   x.onclick=()=>done?showExplanation(x.dataset.word):showToast('Find this term in the grid first.');
  });
  hintEl.textContent=game.remainingHints===Infinity?'∞':game.remainingHints;
  if(found===total&&!game.finished)finish(category,level);
 };
 game.onUpdate=update; game.onFound=()=>sound.found();
 document.querySelector('#hint').onclick=()=>{
  const w=game.hint();
  if(w){sound.hint();showToast(`Hint: ${w}`);update()}else showToast(game.remainingHints===0?'No hints left':'No hints available');
 };
 document.querySelector('#skip').onclick=()=>finish(category,level,true);
 update();
}
async function showExplanation(word){
 if(!pro){showToast('Medical explanations are a Pro feature.');return}
 const result=await explainTerm(word);
 if(!result){showToast('Explanation is temporarily unavailable.');return}
 await sheet(`<h2>${escapeHtml(word)}</h2><p class="muted">${escapeHtml(result.explanation||result.definition||'No explanation returned.')}</p>`);
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function finish(category,level,skip=false){
 if(!game||game.finished)return;
 game.finished=true;
 if(skip){startGame(category,level+1);return}
 store.complete(category,level);
 sound.complete();
 await celebrate(level,store.totalLevels);
 await refreshPro(true);
 if(!pro){
  const action=await adTransition();
  if(action==='upgrade'){
   await upgrade();
   if(game!==null)startGame(category,level+1);
   return;
  }
 }
 if(game===null)return;
 startGame(category,level+1);
}
function progress(){
 const p=store.profile;
 const badgeProgress=(p.totalLevels%10)/10*100,levelsUntilBadge=10-(p.totalLevels%10);
 shell(`<div class="top"><div class="brand">Progress</div></div><div class="card"><h2>${p.totalLevels} levels completed</h2><p class="muted">Keep your streak alive and explore every field.</p><div class="progress"><i style="width:${badgeProgress}%"></i></div><small class="muted">${levelsUntilBadge} levels until the next badge</small></div><div class="list">${cats.map(([n,i])=>`<div class="card row"><span>${i} <b>${escapeHtml(n)}</b></span><span class="pill">${store.progress[n]||0}</span></div>`).join('')}</div>`,'progress');
}
function badges(){
 const total=store.totalLevels,list=[];
 for(let n=10;n<=Math.max(10,total+10);n+=10)list.push(`<div class="card row"><span style="font-size:1.7rem">${n<=total?'🏆':'🔒'}</span><span><b>${n<=total?'Unlocked':'Locked'} — Level ${n}</b><small class="muted" style="display:block">${n<=total?'Medical milestone':'Complete '+n+' levels'}</small></span></div>`);
 shell(`<div class="top"><div class="brand">Badges</div></div>${list.join('')}`,'badges');
}
function settings(){
 shell(`<div class="top"><div class="brand">Settings</div></div><div class="card proline"><div class="row"><div><b>👑 MedWord Pro</b><div class="muted">${pro?'Active — unlimited hints, explanations & no ads':'Unlimited hints, explanations & no ads'}</div></div><button class="btn pro" id="pro" type="button">${pro?'Pro Active':'Upgrade'}</button></div>
 <div class="price"><span>Monthly price</span><b>₦1,000 / $1</b></div>
 <div class="premium-email"><input class="email" id="premiumEmail" type="email" maxlength="254" placeholder="Add your premium email" autocomplete="email" value="${escapeHtml(readLS('medwordEmail')||'')}"><button class="btn" id="verifyEmail" type="button">Verify</button></div>
 <div class="verify-status muted" id="verifyStatus"></div></div>
 <div class="card"><div class="setting"><span>Appearance</span><select class="select" id="appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
 <div class="setting"><span>Font size</span><select class="select" id="font"><option value="normal">Normal</option><option value="large">Large</option><option value="xlarge">Extra large</option></select></div>
 <div class="setting"><span>Sound effects</span><input id="sound" type="checkbox"></div></div>
 <div class="card legal"><h3>Trust & information</h3><div class="list">${[['privacy','Privacy Policy'],['terms','Terms of Service'],['medical-disclaimer','Medical Disclaimer'],['advertising','Advertising Policy'],['subscription','Subscription & Refunds'],['contact','Contact']].map(([f,l])=>`<button class="btn ghost legal-link" data-page="${f}" type="button">${l}</button>`).join('')}</div></div>`,'settings');
 const a=document.querySelector('#appearance');a.value=readLS('theme')||'system';applyAppearance(a.value);a.onchange=()=>{writeLS('theme',a.value);applyAppearance(a.value)};
 const f=document.querySelector('#font');f.value=readLS('font')||'normal';f.onchange=()=>{document.documentElement.classList.remove('large','xlarge');if(f.value!=='normal')document.documentElement.classList.add(f.value);writeLS('font',f.value)};
 const snd=document.querySelector('#sound');snd.checked=sound.enabled;snd.onchange=()=>sound.setEnabled(snd.checked);
 document.querySelectorAll('.legal-link').forEach(b=>b.onclick=()=>{location.href=`legal/${b.dataset.page}.html`});
 document.querySelector('#pro').onclick=()=>pro?showToast('Your Pro plan is active.'):upgrade();
 const emailInput=document.querySelector('#premiumEmail'),verifyBtn=document.querySelector('#verifyEmail'),status=document.querySelector('#verifyStatus');
 const savedEmail=readLS('medwordEmail');if(savedEmail)status.textContent='Premium email saved. Verify to refresh your Pro status.';
 emailInput.oninput=()=>{if(!emailInput.value.trim()){writeLS('medwordEmail','');pro=false;game?.setPro?.(false);status.textContent='Email removed — Free account.';}};
 verifyBtn.onclick=async()=>{const email=emailInput.value.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){status.textContent='Enter a valid email.';return}writeLS('medwordEmail',email);verifyBtn.disabled=true;status.textContent='Verifying premium status…';const ok=await checkPro({force:true});pro=ok;game?.setPro?.(pro);verifyBtn.disabled=false;status.textContent=ok?'✓ Pro verified — your account is now Pro.':'Free account — this email has no active Pro entitlement.';};

}
function applyAppearance(v){document.body.classList.toggle('dark',v==='dark'||(v==='system'&&window.matchMedia?.('(prefers-color-scheme:dark)').matches))}
async function upgrade(){
 const email=await sheet(`<h2>👑 Unlock Pro</h2><p class="muted">Unlimited hints, full medical explanations and no ads.</p><input class="email" id="email" type="email" maxlength="254" placeholder="your@email.com" autocomplete="email"><button class="btn pro" id="pay" type="button">Continue to payment</button>`);
 if(email){writeLS('medwordEmail',email);const ok=await startPro(email);if(!ok)showToast('Payment could not be started. Please try again.')}
}
async function refreshPro(force=false){pro=await checkPro({force});game?.setPro?.(pro);return pro}
function route(r){if(r==='play')startGame(store.profile.category||'Anatomy',(store.progress[store.profile.category||'Anatomy']||0)+1);else ({home,progress,badges,settings}[r]||home)()}
async function handlePaymentReturn(){
 const params=new URLSearchParams(location.search);
 if(!params.has('tx_ref')&&!params.has('transaction_id'))return;
 if(paymentChecking)return;
 paymentChecking=true;
 showToast('Verifying your payment…');
 const result=await verifyPaymentReturn();
 paymentChecking=false;
 if(result?.pro){pro=true;showToast('Pro activated — welcome!');history.replaceState({},'',location.pathname);settings()}
 else showToast('Payment is still being verified. Please check again shortly.');
}
function readLS(k){try{return localStorage.getItem(k)}catch{return null}}
function writeLS(k,v){try{localStorage.setItem(k,v)}catch{}}
window.addEventListener('error',e=>console.error('MedWord runtime error:',e.error||e.message));
window.addEventListener('unhandledrejection',e=>console.error('MedWord promise error:',e.reason));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshPro(true).catch(()=>{})});
applyAppearance(readLS('theme')||'system');
const font=readLS('font');if(font&&font!=='normal')document.documentElement.classList.add(font);
sound.init(); document.addEventListener('pointerdown',()=>sound.start(),{once:true});
pro=peekCachedPro();
try{history.replaceState({route:'home'},'',location.pathname+'#home');history.pushState({route:'home'},'',location.pathname+'#home')}catch{}
window.addEventListener('popstate',()=>{navigationToken++;game=null;const r=location.hash.replace('#','');if(r==='play')route('play');else if(r){route(r)}else{try{history.pushState({route:'home'},'',location.pathname+'#home')}catch{}home()}});
route('home');
refreshPro().catch(()=>{});
handlePaymentReturn();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
