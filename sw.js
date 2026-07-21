/* Majestic resident PWA — service worker.
   App shell cached for instant/offline loads. Navigations are
   network-first (so updates arrive) with cache fallback (so it opens
   offline); other same-origin assets are cache-first. Backend calls
   (script.google.com) are never cached here. Bump VERSION on deploy. */

'use strict';

const VERSION = 'v11';
const CACHE = 'majestic-shell-' + VERSION;

const SHELL = [
  './index.html',
  './style.css?v=11',
  './app.js?v=11',
  './pages.js?v=11',
  './reports.js?v=11',
  './content.js?v=11',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // backend etc: network

  if (e.request.mode === 'navigate') {
    // network-first so new versions land; cached shell when offline
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return r;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((hit) => hit ||
      fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      }))
  );
});
