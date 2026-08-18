const C='medword-shell-v5';
const ASSETS=['/','/index.html','/styles.css','/app.js','/game/puzzle-engine.js','/data/local-cache.js','/ai/word-service.js','/audio/sound-manager.js','/ui/ui.js','/ads/adsterra.js','/payments/flutterwave.js','/manifest.json','/icon.svg','/icon-192.png','/icon-512.png','/icon-192-maskable.png','/icon-512-maskable.png','/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(async c=>{for(const u of ASSETS){try{await c.add(u)}catch{}}}));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('medword-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);if(url.origin!==location.origin)return;
 // Network-first for application files prevents stale JS/CSS after deploy; cache remains an offline fallback.
 const isAppFile=/\.(js|css|html)$/.test(url.pathname)||url.pathname.endsWith('/');
 if(isAppFile)e.respondWith(fetch(e.request).then(r=>{if(r.ok){const q=r.clone();caches.open(C).then(c=>c.put(e.request,q)).catch(()=>{})}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))));
 else e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(x=>{if(x.ok){const q=x.clone();caches.open(C).then(c=>c.put(e.request,q)).catch(()=>{})}return x})));
});
