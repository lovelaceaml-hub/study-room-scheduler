// Service worker: the network first, with a cached copy for when the
// connection drops, so the app and the lobby TV still open offline. Admin is
// never cached; it needs a live connection anyway.

const CACHE = 'srs-v19-fix-pass';
const FILES = [
  '/', '/index.html', '/manifest.json', '/icon.svg', '/icon-192.png', '/apple-touch-icon.png',
  '/shared/base.css', '/shared/format.js', '/shared/availability.js', '/shared/firebase.js', '/shared/dom.js', '/shared/demo.js',
  '/app/app.css', '/app/main.js', '/app/store.js', '/app/demo-backend.js', '/app/sheet.js', '/app/booking.js',
  '/app/details.js', '/app/mine.js', '/app/text.js', '/app/icons.js', '/app/announce.js',
  '/tv.html', '/tv/tv.js', '/tv/status.js', '/tv/tv.css'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

// Older caches (including the six-design app) are removed.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/admin')) return;
  event.respondWith(fetch(event.request)
    .then(response => {
      if (response.ok) {
        // Kept alive until the copy is stored, so the next offline visit finds it.
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
      }
      return response;
    })
    .catch(() => caches.match(event.request, { ignoreSearch: event.request.mode === 'navigate' })));
});
