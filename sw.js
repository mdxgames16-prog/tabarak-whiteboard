const V='tabarak-v3';
const FILES=['./','index.html','style.css','app.js','board.js','drive.js','manifest.webmanifest','img/logo.png','img/icon-192.png','img/icon-512.png','lib/pdf.min.js','lib/pdf.worker.min.js','lib/Amiri.ttf','lib/AmiriQuran.ttf','data/quran-data.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
