export class Game{
 constructor(words,level,{pro=false}={}){
  const cleaned=(Array.isArray(words)?words:[]).map(x=>({...x,word:Game.normStatic(x?.word)})).filter(x=>x.word.length>=2&&x.word.length<=18);
  const seen=new Set();this.words=cleaned.filter(x=>{if(seen.has(x.word))return false;seen.add(x.word);return true}).slice(0,10);
  if(this.words.length<4)throw new Error('Not enough valid unique terms');
  this.level=level;this.found=new Set;this.onUpdate=()=>{};const longest=Math.max(...this.words.map(x=>x.word.length));this.size=Math.min(18,Math.max(7,7+Math.floor((level-1)/15),longest));
  this.placements=new Map;this.finished=false;this.pro=pro;this.hintUsed=0;this.hintLimit=pro?Infinity:3;this.build();
 }
 static normStatic(s){return String(s??'').toUpperCase().replace(/[^A-Z]/g,'')}
 norm(s){return Game.normStatic(s)}
 build(){
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
  const sorted=[...this.words].sort((a,b)=>b.word.length-a.word.length);
  for(let gridTry=0;gridTry<10;gridTry++){
   this.grid=Array.from({length:this.size},()=>Array(this.size).fill(''));this.placements.clear();let all=true;
   for(const obj of sorted){
    const candidates=[];
    for(let r=0;r<this.size;r++)for(let c=0;c<this.size;c++)for(const d of dirs){const er=r+d[1]*(obj.word.length-1),ec=c+d[0]*(obj.word.length-1);if(er>=0&&er<this.size&&ec>=0&&ec<this.size)candidates.push({r,c,er,ec,d})}
    if(!candidates.length){all=false;break}
    for(let i=candidates.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]]}
    let placed=false;
    for(const q of candidates){const {r,c,er,ec,d}=q;let ok=true;for(let i=0;i<obj.word.length;i++){const ch=this.grid[r+d[1]*i][c+d[0]*i];if(ch&&ch!==obj.word[i]){ok=false;break}}if(ok){for(let i=0;i<obj.word.length;i++)this.grid[r+d[1]*i][c+d[0]*i]=obj.word[i];this.placements.set(obj.word,{r,c,er,ec});placed=true;break}}
    if(!placed){all=false;break}
   }
   if(all){const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ';for(let r=0;r<this.size;r++)for(let c=0;c<this.size;c++)if(!this.grid[r][c])this.grid[r][c]=letters[Math.floor(Math.random()*26)];this.words=sorted;return}
   if(this.size<18)this.size++;
  }
  throw new Error('Unable to build puzzle');
 }
 setPro(value){this.pro=!!value;this.hintLimit=this.pro?Infinity:3} get remainingHints(){return this.hintLimit===Infinity?Infinity:Math.max(0,this.hintLimit-this.hintUsed)}
 render(el){el.style.gridTemplateColumns=`repeat(${this.size},1fr)`;el.innerHTML='';this.el=el;this.cells=[];for(let r=0;r<this.size;r++)for(let c=0;c<this.size;c++){const x=document.createElement('div');x.className='cell';x.textContent=this.grid[r][c];x.dataset.r=r;x.dataset.c=c;el.appendChild(x);this.cells.push(x)}this.bind()}
 bind(){let start=null,last=null;const move=e=>{if(!start)return;const p=this.pos(e);if(!p)return;last=p;this.clearSel();if(!this.validLine(start,p))return;const dr=Math.sign(p.r-start.r),dc=Math.sign(p.c-start.c);let r=start.r,c=start.c;for(let i=0;i<=Math.max(Math.abs(p.r-start.r),Math.abs(p.c-start.c));i++){this.cell(r,c)?.classList.add('sel');r+=dr;c+=dc}};const up=e=>{if(!start)return;const p=last||this.pos(e);if(p&&this.validLine(start,p))this.check(start,p);start=last=null;this.clearSel();try{this.el.releasePointerCapture?.(e.pointerId)}catch{}};this.el.onpointerdown=e=>{e.preventDefault();start=this.pos(e);last=start;try{this.el.setPointerCapture?.(e.pointerId)}catch{}};this.el.onpointermove=e=>{e.preventDefault();move(e)};this.el.onpointerup=e=>{e.preventDefault();up(e)};this.el.onpointercancel=up}
 validLine(a,b){const dr=Math.abs(b.r-a.r),dc=Math.abs(b.c-a.c);return a&&b&&(dr===0||dc===0||dr===dc)}
 pos(e){const rect=this.el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;if(x<0||y<0||x>=rect.width||y>=rect.height)return null;return{c:Math.min(this.size-1,Math.floor(x/(rect.width/this.size))),r:Math.min(this.size-1,Math.floor(y/(rect.height/this.size)))}}
 cell(r,c){return this.el&&r>=0&&c>=0&&r<this.size&&c<this.size?this.el.children[r*this.size+c]:null}
 clearSel(){this.el?.querySelectorAll('.sel').forEach(x=>x.classList.remove('sel'))}
 check(a,b){if(!this.validLine(a,b))return;const dr=Math.sign(b.r-a.r),dc=Math.sign(b.c-a.c),n=Math.max(Math.abs(b.r-a.r),Math.abs(b.c-a.c))+1;let w='';for(let i=0;i<n;i++)w+=this.grid[a.r+dr*i][a.c+dc*i];const rev=w.split('').reverse().join(''),target=this.words.find(x=>{const q=x.word;return q===w||q===rev});if(target&&!this.found.has(target.word)){this.found.add(target.word);const p=this.placements.get(target.word);if(p){let r=p.r,c=p.c;const dR=Math.sign(p.er-p.r),dC=Math.sign(p.ec-p.c);for(let i=0;i<target.word.length;i++){this.cell(r,c)?.classList.add('found');r+=dR;c+=dC}}this.onUpdate()}}
 hint(){if(this.remainingHints===0)return null;const left=this.words.find(x=>!this.found.has(x.word));if(!left)return null;this.hintUsed++;const p=this.placements.get(left.word);if(p){const cell=this.cell(p.r,p.c);cell?.classList.add('hint');setTimeout(()=>cell?.classList.remove('hint'),2600)}return left.word}
}
