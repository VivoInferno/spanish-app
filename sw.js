// Update-friendly offline strategy for iOS Home Screen apps:
//  - app shell (html/js/css/json): network-first (revalidated, bypassing the HTTP cache), cache fallback when offline/slow
//  - icons: cache-first
//  - new versions activate immediately (skipWaiting + clients.claim); the page reloads once on controllerchange
const CACHE = 'espanol-v8';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'srs.js', 'check.js', 'fx.js', 'daily.js', 'listen.js', 'speech.js', 'voice.js', 'content.json', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const NET_TIMEOUT = 3500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => Promise.all(ASSETS.map(a =>
    // cache: 'reload' skips the browser HTTP cache (GitHub Pages sends max-age=600), so a new CACHE never holds old files
    fetch(new Request(a, { cache: 'reload' })).then(res => { if (!res.ok) throw new Error(a + ' ' + res.status); return cache.put(a === './' ? './' : a, res); })
  ))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'version' && e.source) e.source.postMessage({ version: CACHE }); });

function cacheKey(req) {
  if (req.mode === 'navigate') return './';
  const u = new URL(req.url); u.search = ''; return u.href;
}
async function networkFirst(req) {
  const cache = await caches.open(CACHE), key = cacheKey(req);
  const net = fetch(req.mode === 'navigate' ? new Request('./', { cache: 'no-cache' }) : new Request(req.url, { cache: 'no-cache' }))
    .then(res => { if (res && res.ok) cache.put(key, res.clone()); return res; });
  const timeout = new Promise(r => setTimeout(r, NET_TIMEOUT, null));
  try {
    const res = await Promise.race([net, timeout]);
    if (res && res.ok) return res;
  } catch (err) { /* offline */ }
  const cached = await cache.match(key, { ignoreSearch: true });
  if (cached) return cached;
  try { return await net; } catch (err) { return new Response('Offline', { status: 503 }); }
}
async function cacheFirst(req) {
  const cache = await caches.open(CACHE), cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res;
}
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  e.respondWith(/\/icons\//.test(url.pathname) ? cacheFirst(req) : networkFirst(req));
});
