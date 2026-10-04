/* Anonymous — minimal service worker (cache shell for faster load / offline shell) */
var CACHE = 'anon-shell-v1';
var SHELL = [
  './',
  './index.html',
  './send.html',
  './style.css',
  './app.js',
  './send.js',
  './config.js',
  './site.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './favicon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).catch(function () { /* ignore individual failures */ });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  /* never cache API / auth / cross-origin APIs */
  if (url.origin !== self.location.origin) return;
  if (/\/rest\/v1\/|\/auth\/v1\/|supabase/i.test(url.pathname)) return;

  e.respondWith(
    fetch(req).then(function (res) {
      /* network first for HTML/JS so deploys show up */
      if (res && res.ok && (url.pathname.endsWith('.css') || url.pathname.endsWith('.png') ||
          url.pathname.endsWith('.svg') || url.pathname.endsWith('.webmanifest') ||
          url.pathname.endsWith('.ico'))) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        return cached || caches.match('./index.html');
      });
    })
  );
});
