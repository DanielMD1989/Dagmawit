// DAGMAWIT service worker — auto-updating
// Strategy: network-first for app files (always get latest when online),
// fall back to cache only when offline. Bump VERSION to force refresh.
const VERSION = 'dagmawit-v4';
const ASSETS = [
  './','./index.html','./styles.css','./app.js','./config.js',
  './manifest.json','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./logo-white.png'
];

self.addEventListener('install', e => {
  // activate the new worker immediately, don't wait
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).catch(()=>{}));
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
  // never touch Supabase API — always live network
  if (url.hostname.includes('supabase')) return;
  if (e.request.method !== 'GET') return;

  // NETWORK-FIRST: try to fetch the freshest file; update cache; fall back to cache offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
  );
});

// allow the page to tell a waiting worker to take over
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
