// DAGMAWIT service worker.
// Network first: when online, always fetch the newest files and keep a copy;
// when offline, serve the last copy. Built code files have new names on every
// build, so they are cached the first time they load rather than listed here.
const VERSION = 'dagmawit-v15';
const CORE = ['./', './index.html', './config.js', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './logo-white.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co') || url.protocol === 'ws:' || url.protocol === 'wss:') return;   // live data: never cached
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then(c => c || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
