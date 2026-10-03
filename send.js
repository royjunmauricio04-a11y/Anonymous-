/* send.html: the personal-link page. Visitors do not need an account:
   the page quietly gives them an anonymous session so the database can accept the message. */
(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var REMOTE = !!(C.SUPABASE_URL && C.SUPABASE_KEY);
  var $ = function (i) { return document.getElementById(i); };
  var AUTH = 'anon-auth', SENT = 'anon-sent';
  var pick = null, last = [], tmr;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lget(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function lset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function show(id) { ['sLoad', 'sForm', 'sDone', 'sMiss', 'sMaint'].forEach(function (x) { $(x).hidden = x !== id; }); window.scrollTo(0, 0); }
  function miss(t) { $('sMissTxt').textContent = t; show('sMiss'); }

  /* who is the link for? works with send.html?to=name (and the older #to=name) */
  var to = new URLSearchParams(location.search).get('to') || (location.hash.match(/to=([^&]+)/) || [])[1] || '';
  try { to = decodeURIComponent(to); } catch (e) {}
  to = to.trim();

  /* ---- session (shared with the main app) ---- */
  function sget() { return lget(AUTH, null); }
  function store(d) {
    var o = sget() || {};
    lset(AUTH, { access_token: d.access_token, refresh_token: d.refresh_token, user: d.user || o.user, exp: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
  }
  function fresh() {
    var s = sget();
    if (!s || !s.refresh_token || (s.exp && s.exp - 60 > Date.now() / 1000)) return Promise.resolve();
    return fetch(C.SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(store).catch(function () { try { localStorage.removeItem(AUTH); } catch (e) {} });
  }
  function api(path, opt) {
    opt = opt || {};
    return fresh().then(function () {
      var hd = { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' }, s = sget();
      if (s && s.access_token) hd.Authorization = 'Bearer ' + s.access_token;
      else if (/^eyJ/.test(C.SUPABASE_KEY)) hd.Authorization = 'Bearer ' + C.SUPABASE_KEY;
      opt.headers = Object.assign(hd, opt.headers);
      return fetch(C.SUPABASE_URL + '/rest/v1/' + path, opt).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw { status: r.status, text: t }; });
        return r.json().catch(function () { return null; });
      });
    });
  }
  function rpc(n, a) { return api('rpc/' + n, { method: 'POST', body: JSON.stringify(a) }); }
  function ensureSession() {
    var s = sget(); if (s && s.access_token) return Promise.resolve();
    return fetch(C.SUPABASE_URL + '/auth/v1/signup', { method: 'POST', headers: { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.access_token) throw { off: true, status: r.status }; store(d); }); });
  }
  function why(e) {
    var m = ''; try { m = JSON.parse(e.text).message || ''; } catch (x) {}
    if (e && e.off) return e.status === 429 ? 'Too many tries from this network. Please wait a few minutes.' : 'Sending is not switched on yet. The site owner must turn on Anonymous sign-ins in Supabase.';
    if (m === 'rate_limited') return 'You are sending too fast. Please try again in a while.';
    if (m === 'recipient_not_found') return 'That link is not connected to anyone.';
    if (!e || !e.status) return 'Could not reach the database. Check your connection.';
    return 'Could not send right now (error ' + e.status + ').';
  }

  /* ---- iTunes song search ---- */
  function itunes(term, limit) {
    var url = 'https://itunes.apple.com/search?media=music&entity=song&limit=' + limit + '&term=' + encodeURIComponent(term);
    return fetch(url).then(function (r) { return r.json(); }).catch(function () {
      return new Promise(function (res, rej) {
        var cb = 'it' + Date.now() + Math.floor(Math.random() * 1e4), el = document.createElement('script');
        function clean() { delete window[cb]; el.remove(); }
        var t = setTimeout(function () { clean(); rej(); }, 6000);
        window[cb] = function (d) { clearTimeout(t); clean(); res(d); };
        el.onerror = function () { clearTimeout(t); clean(); rej(); };
        el.src = url + '&callback=' + cb; document.head.appendChild(el);
      });
    });
  }
  function art(c) { return /^https:\/\//.test(c || '') ? '<img class="art" alt="" src="' + esc(c) + '">' : '<span class="art" style="background:#999"></span>'; }
  $('sq').oninput = function () {
    var raw = $('sq').value.trim(); clearTimeout(tmr);
    if (!raw) { $('sres').hidden = true; return; }
    $('sres').innerHTML = '<button data-free="1">' + art('') + '<span><b>Use "' + esc(raw) + '"</b><span>Add it as typed (Title - Artist)</span></span></button>'; $('sres').hidden = false;
    tmr = setTimeout(function () {
      itunes(raw, 10).then(function (d) {
        if ($('sq').value.trim() !== raw) return;
        last = (d.results || []).map(function (x) { return { t: x.trackName, a: x.artistName, c: x.artworkUrl100, p: x.previewUrl || '' }; });
        $('sres').innerHTML = last.map(function (s, i) { return '<button data-i="' + i + '">' + art(s.c) + '<span><b>' + esc(s.t) + '</b><span>' + esc(s.a) + '</span></span></button>'; }).join('') + $('sres').innerHTML;
      }).catch(function () {});
    }, 350);
  };
  $('sres').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.free) { var t = $('sq').value.trim().split(' - '); pick = [t[0], t[1] || 'Unknown artist', '', '']; }
    else { var o = last[+b.dataset.i]; pick = [o.t, o.a, o.c, o.p]; }
    $('sres').hidden = true; $('sq').value = ''; $('sq').hidden = true;
    $('spicked').innerHTML = '<div class="pick">' + art(pick[2]) + '<span><b>' + esc(pick[0]) + '</b><span>' + esc(pick[1]) + '</span></span><button aria-label="Remove song" id="sx">×</button></div>';
    $('sx').onclick = function () { pick = null; $('spicked').innerHTML = ''; $('sq').hidden = false; };
  };

  /* ---- send ---- */
  $('sSend').onclick = function () {
    var tx = $('sText').value.trim(), m = $('sMsg');
    if (!pick && $('sq').value.trim()) { var t = $('sq').value.trim().split(' - '); pick = [t[0], t[1] || 'Unknown artist', '', '']; }
    var bad = !tx ? 'Write a message first.' : !pick ? 'Pick a song to send with it.' : '';
    if (bad) { m.className = 'msg err'; m.textContent = bad; return; }
    $('sSend').disabled = true; m.className = 'msg'; m.textContent = 'Sending...';
    ensureSession().then(function () {
      return rpc('send_message', { p_type: 'direct', p_to_name: to, p_to_key: to.toLowerCase(), p_body: tx, p_song: pick[0], p_artist: pick[1], p_art: pick[2] || null, p_preview: pick[3] || null });
    }).then(function () {
      var sent = lget(SENT, []); sent.unshift({ id: 'l' + Date.now(), to: to, key: to.toLowerCase(), type: 'direct', text: tx, song: pick[0], artist: pick[1], color: pick[2], prev: pick[3], t: Date.now() }); lset(SENT, sent.slice(0, 100));
      show('sDone');
    }).catch(function (e) { m.className = 'msg err'; m.textContent = why(e); })
      .then(function () { $('sSend').disabled = false; });
  };
  $('sAgain').onclick = function () {
    $('sText').value = ''; pick = null; $('spicked').innerHTML = ''; $('sq').hidden = false; $('sMsg').textContent = ''; show('sForm');
  };

  /* ---- start ---- */
  if (!/^[A-Za-z0-9._]{3,20}$/.test(to)) { miss('This link is missing a name. Ask your friend to send it again.'); return; }
  if (!REMOTE) { miss('This page needs the online database. Add your Supabase keys in config.js.'); return; }
  api('settings?select=key,value').catch(function () { return []; }).then(function (rows) {
    var st = {}; rows.forEach(function (x) { st[x.key] = x.value; });
    if (st.maintenance === 'true') { $('sMaintTxt').textContent = st.maintenance_note || 'We will be right back.'; show('sMaint'); return; }
    return rpc('username_exists', { p_username: to }).then(function (ok) {
      if (ok !== true) { miss('This link is not connected to anyone yet. Check the spelling, or ask your friend to open Anonymous first.'); return; }
      $('sAv').textContent = to.charAt(0).toUpperCase(); $('sName').textContent = '@' + to;
      $('sNote').textContent = 'Anonymous. @' + to + ' will never see who sent this.';
      show('sForm');
    });
  }).catch(function (e) { miss(why(e)); });
})();
