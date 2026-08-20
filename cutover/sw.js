/* LV Zion Study Rooms — RETIREMENT service worker (built in Section 8,
   deployed only at the Section 9 cutover).

   Served at the same URL (/sw.js) as the live app's service worker, so every
   cached old client picks it up on its next visit or its browser's daily
   update check. The old worker's cache version ladder ('srs-v1' …
   'srs-v13-mobile-home-grid-density') retires here: this worker deletes EVERY
   cache, unregisters itself, and reloads open pages so they land on the
   retirement shell and its redirect to https://lvzion.vercel.app/rooms.

   It intentionally has NO fetch handler and precaches nothing: after this
   worker runs, the origin behaves like a plain website again, and the freeze
   (app/writeFreeze + Firestore rules) is what guarantees even a
   still-cached page cannot write. */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(clients.map(client => client.navigate(client.url).catch(() => {})));
    await self.registration.unregister();
  })());
});
