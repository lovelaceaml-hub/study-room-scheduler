/* LV Zion Study Rooms service worker.
   Network-first with cache fallback so the six designs and the lobby TV still
   open offline. The Admin page at /admin/ is deliberately never precached and
   never served from the cache: it is protected, it is useless without the
   network, and handing that URL a member page would only confuse. */
const CACHE = 'srs-v17-six-designs';
const ASSETS = [
  './', './index.html', './manifest.json', './icon.svg',
  './design-choice.js', './design-choice.css', './firebase-config.js',
  './tokens.css', './tv.html', './tv.css', './tv.js', './tv-special-schedule-entry.js',
  './experiences/shared/live.js', './experiences/shared/model.js',
  './experiences/solace/', './experiences/solace/solace.js', './experiences/solace/solace.css',
  './experiences/velum/', './experiences/velum/velum.js', './experiences/velum/velum.css',
  './experiences/cove/', './experiences/cove/app.js',
  './experiences/petal/', './experiences/petal/app.js',
  './experiences/atlas/', './experiences/atlas/atlas.js', './experiences/atlas/atlas.css',
  './experiences/lattice/', './experiences/lattice/lattice.js', './experiences/lattice/lattice.css'
];

const isAdmin = url => url.pathname === '/admin' || url.pathname.startsWith('/admin/');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
// Every earlier cache goes, so the retired member shell cannot survive here.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (isAdmin(url)) {
    e.respondWith(fetch(e.request).catch(() => new Response(
      '<!doctype html><meta charset="utf-8"><title>Admin needs a connection</title><p>Admin needs a connection. Reconnect and reload this page.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)
        .then(hit => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
