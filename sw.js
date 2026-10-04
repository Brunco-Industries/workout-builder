/* sw.js — offline cache for Stephen's workout builder.
   Cache-first for the app's own files, refreshed in the background when there is signal.
   CACHE must change with Engine.APP_VERSION (tests.html checks they match) so a new version replaces the old one. */
const CACHE = 'workout-builder-0.3.1';
const REQUIRED = ['./', './index.html', './engine.js', './library.js'];                       // without these there is no app offline
const OPTIONAL = ['./manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png']; // nice to have; a blocked icon must not stop the install

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(REQUIRED).then(() => Promise.allSettled(OPTIONAL.map(u => cache.add(u).catch(() => null))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const refresh = fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || refresh;
    })
  );
});
