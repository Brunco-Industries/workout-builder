/* sw.js — offline cache for Stephen's workout builder.
   Cache-first for the app's own files, refreshed in the background when there is signal.
   CACHE must change with Engine.APP_VERSION (tests.html checks they match) so a new version replaces the old one.
   At install, each file is fetched with a version stamp in the query string, so a CDN cannot hand back the previous
   version's bytes (GitHub Pages caches files for ten minutes); it is stored under its plain URL. */
const CACHE = 'workout-builder-0.4.0';
const VERSION = CACHE.replace('workout-builder-', '');
const REQUIRED = ['./', './index.html', './engine.js', './library.js'];                       // without these there is no app offline
const OPTIONAL = ['./manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png']; // nice to have; a blocked icon must not stop the install

const fresh = url => fetch(url + '?v=' + VERSION, { cache: 'no-store' }).then(res => {
  if (!res.ok) throw new Error(url + ' ' + res.status);
  return res;
});
const putFresh = (cache, url) => fresh(url).then(res => cache.put(new Request(url), res));

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(REQUIRED.map(u => putFresh(cache, u)))
        .then(() => Promise.allSettled(OPTIONAL.map(u => putFresh(cache, u).catch(() => null))))
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
