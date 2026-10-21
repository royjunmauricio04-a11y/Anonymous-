/* Anonymous: service worker (v2)
   - network first, so new deploys show up right away
   - keeps a copy of every page/script/style it loads, so the app still opens with a weak or no signal
   - handles taps on notifications (opens the app) */
var CACHE = 'anon-shell-v14';
var SHELL = [
  './',
  './index.html',
  './send.html',
  './style.css',
  './app.js',
  './send.js',
  './config.js',
  './card-style.js',
  './install.html',
  './install.js',
  './site.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './favicon.svg'
];
var CACHEABLE = /\.(?:html|js|css|png|svg|ico|webmanifest)$/i;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* add one by one: a single missing file must not stop the rest from being cached */
      return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
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
  /* never touch API / auth / other sites */
  if (url.origin !== self.location.origin) return;
  if (/\/rest\/v1\/|\/auth\/v1\/|\/functions\/v1\/|supabase/i.test(url.pathname)) return;
  /* the Digital Asset Links file must always come fresh from the server */
  if (url.pathname.indexOf('/.well-known/') === 0) return;

  e.respondWith(
    fetch(req).then(function (res) {
      var isPage = req.mode === 'navigate' && /\.html$|\/$/.test(url.pathname);
      if (res && res.ok && (isPage || CACHEABLE.test(url.pathname))) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;
        /* offline page load of a link like send.html?to=name */
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
