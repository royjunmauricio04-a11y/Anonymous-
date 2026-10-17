/* install.html: lets people install Anonymous (PWA button, APK link, or iPhone steps). */
(function () {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var installed = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true ||
    (document.referrer || '').indexOf('android-app://') === 0;
  var deferred = null, toastT;

  function toast(t) {
    var el = $('toast'); el.textContent = t; el.className = 'toast'; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 3500);
  }

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });

  /* show the right cards for this phone */
  if (installed) { $('done').hidden = false; $('android').hidden = true; $('apk').hidden = true; $('ios').hidden = true; }
  else if (isIOS) { $('android').hidden = true; $('apk').hidden = true; }
  else if (isAndroid) { $('ios').hidden = true; }

  /* the big Install button (browser install) */
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; $('pwaHint').hidden = true; });
  $('pwaBtn').onclick = function () {
    if (!deferred) { $('pwaHint').hidden = false; return; }
    deferred.prompt();
    deferred.userChoice.then(function (c) {
      deferred = null;
      if (c && c.outcome === 'accepted') toast('Installing... look for Anonymous on your home screen.');
    }).catch(function () {});
  };
  window.addEventListener('appinstalled', function () {
    deferred = null; $('done').hidden = false; $('android').hidden = true; $('apk').hidden = true; toast('Installed!');
  });

  /* APK link (your Linkvertise link lives in apk-link.js) */
  var link = (window.APK_URL || '').trim();
  if (/^https:\/\//i.test(link)) { $('apkBtn').href = link; $('apkBtn').hidden = false; $('apkSoon').hidden = true; }
})();
