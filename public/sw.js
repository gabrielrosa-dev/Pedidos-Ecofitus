'use strict';
const cacheName = 'ecofitus-offline-v1';
const offlineUrl = new URL('./offline.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.add(offlineUrl)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('ecofitus-offline-') && key !== cacheName).map((key) => caches.delete(key))
  )));
});
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(offlineUrl);
    return cached || Response.error();
  }));
});
