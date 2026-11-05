/* Service worker: deixa o app abrir sem internet.
   Os dados em si ficam no IndexedDB (db.js). Aqui só guardamos os arquivos do app.
   Ao publicar uma versão nova, mude VERSION para forçar a atualização. */
const VERSION = 'almox-v1';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'db.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => { })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // nunca interceptar o Supabase (dados, login, fotos privadas)
  if (url.hostname.endsWith('supabase.co')) return;
  // fontes do Google e bibliotecas do CDN: usa o cache e atualiza em segundo plano
  const staticExt = url.hostname.includes('fonts.g') || url.hostname.includes('jsdelivr');
  if (staticExt) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // arquivos do app: tenta a rede primeiro (pega versão nova) e cai no cache se estiver offline
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)) }
    return r;
  }).catch(() => caches.match(req).then(h => h || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
