/* send.html: the personal-link page. Visitors do not need an account:
   the page quietly gives them an anonymous session so the database can accept the message. */
(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var REMOTE = !!(C.SUPABASE_URL && C.SUPABASE_KEY);
  var $ = function (i) { return document.getElementById(i); };
  var AUTH = 'anon-auth', SENT = 'anon-sent';
  var pick = null, last = [], tmr, au = new Audio(), playing = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lget(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function lset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function show(id) {
    ['sLoad', 'sForm', 'sDone', 'sMiss', 'sMaint'].forEach(function (x) { $(x).hidden = x !== id; });
    document.body.className = 'lp';   /* every state (form, sent, not found, maintenance) lives on the brand colour */
    window.scrollTo(0, 0);
  }
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
  var freshP = null;
  function fresh() {
    var s = sget();
    if (!s || !s.refresh_token || (s.exp && s.exp - 60 > Date.now() / 1000)) return Promise.resolve();
    if (freshP) return freshP;
    freshP = fetch(C.SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) })
      .then(function (r) { return r.ok ? r.json() : Promise.reject({ status: r.status }); }).then(store)
      .catch(function (e) { if (e && (e.status === 400 || e.status === 401 || e.status === 403)) { try { localStorage.removeItem(AUTH); } catch (x) {} } })   /* a weak signal never signs you out */
      .then(function () { freshP = null; });
    return freshP;
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
    if (m === 'blocked_content') return 'That message has a word that is not allowed here. Please change it and try again.';
    if (e && (e.status === 300)) return 'Sending is being fixed on our side. Please try again later.';
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
  function art(c) {
    return /^https:\/\//.test(c || '')
      ? '<img class="art" alt="" src="' + esc(c) + '">'
      : '<span class="art art-ph" aria-hidden="true"></span>';
  }
  var REC = [
    ["Tingin", "Cup of Joe, Janine"], ["Sana", "I Belong to the Zoo"], ["Multo", "Cup of Joe"],
    ["Babylon", "Taylor Swift"], ["Die With A Smile", "Lady Gaga, Bruno Mars"], ["Pagsamo", "Arthur Nery"],
    ["Heather", "Conan Gray"], ["Perfect", "Ed Sheeran"], ["Iris", "Goo Goo Dolls"]
  ];
  var recMeta = {}; /* "title|artist" -> { c, p } cached from iTunes */
  function recKey(t, a) { return (t + '|' + a).toLowerCase(); }
  function enrichRecs() {
    /* quietly fill cover + preview for visible recommendations */
    REC.forEach(function (s, i) {
      var k = recKey(s[0], s[1]);
      if (recMeta[k]) {
        if (last[i]) { last[i].c = recMeta[k].c; last[i].p = recMeta[k].p; }
        return;
      }
      itunes(s[0] + ' ' + s[1], 1).then(function (d) {
        var r = d.results && d.results[0];
        if (!r) return;
        recMeta[k] = { c: r.artworkUrl100 || '', p: r.previewUrl || '' };
        if (last[i] && last[i].t === s[0]) {
          last[i].c = recMeta[k].c;
          last[i].p = recMeta[k].p;
        }
        /* refresh list art if still open */
        if (!$('sres').hidden && last[i]) {
          var btn = $('sres').querySelector('button[data-i="' + i + '"]');
          if (btn && recMeta[k].c) {
            var img = btn.querySelector('.art');
            if (img && img.tagName !== 'IMG') {
              var n = document.createElement('img');
              n.className = 'art'; n.alt = ''; n.src = recMeta[k].c;
              img.replaceWith(n);
            }
          }
        }
      }).catch(function () {});
    });
  }
  function showRecs() {
    last = REC.map(function (s) {
      var m = recMeta[recKey(s[0], s[1])] || {};
      return { t: s[0], a: s[1], c: m.c || '', p: m.p || '' };
    });
    $('sres').innerHTML = '<div class="res-head">Recommended for you</div>' +
      last.map(function (s, i) {
        return '<button type="button" data-i="' + i + '">' + art(s.c) +
          '<span><b>' + esc(s.t) + '</b><span>' + esc(s.a) + '</span></span></button>';
      }).join('');
    $('sres').hidden = false;
    enrichRecs();
  }
  $('sq').onfocus = function () { if (!$('sq').value.trim() && !pick) showRecs(); };
  $('sq').oninput = function () {
    var raw = $('sq').value.trim(); clearTimeout(tmr);
    if (!raw) { showRecs(); return; }
    $('sres').innerHTML = '<button type="button" data-free="1">' + art('') +
      '<span><b>Use "' + esc(raw) + '"</b><span>Add as typed (Title - Artist)</span></span></button>';
    $('sres').hidden = false;
    tmr = setTimeout(function () {
      itunes(raw, 10).then(function (d) {
        if ($('sq').value.trim() !== raw) return;
        last = (d.results || []).map(function (x) {
          return { t: x.trackName, a: x.artistName, c: x.artworkUrl100, p: x.previewUrl || '' };
        });
        $('sres').innerHTML = last.map(function (s, i) {
          return '<button type="button" data-i="' + i + '">' + art(s.c) +
            '<span><b>' + esc(s.t) + '</b><span>' + esc(s.a) + '</span></span></button>';
        }).join('') +
          '<button type="button" data-free="1">' + art('') +
          '<span><b>Use "' + esc(raw) + '"</b><span>Add as typed (Title - Artist)</span></span></button>';
      }).catch(function () {});
    }, 350);
  };
  function stopAudio() {
    au.pause(); playing = null;
    var b = document.getElementById('spl');
    if (b) b.innerHTML = '&#9654;';
  }
  au.onended = stopAudio;
  function fillPickMeta(done) {
    if (pick[2] && pick[3]) { if (done) done(); return; }
    var k = recKey(pick[0], pick[1]);
    if (recMeta[k]) {
      if (!pick[2]) pick[2] = recMeta[k].c;
      if (!pick[3]) pick[3] = recMeta[k].p;
      if (done) done();
      return;
    }
    itunes(pick[0] + ' ' + pick[1], 1).then(function (d) {
      var r = d.results && d.results[0];
      if (r) {
        if (!pick[2]) pick[2] = r.artworkUrl100 || '';
        if (!pick[3]) pick[3] = r.previewUrl || '';
        recMeta[k] = { c: pick[2], p: pick[3] };
      }
    }).catch(function () {}).then(function () { if (done) done(); });
  }
  function renderPick() {
    if (!pick) { $('spicked').innerHTML = ''; $('sq').hidden = false; return; }
    /* always show circular play — fetch preview if missing */
    $('spicked').innerHTML =
      '<div class="lp-pick">' +
        art(pick[2]) +
        '<div class="pt"><b>' + esc(pick[0]) + '</b><span>' + esc(pick[1]) + '</span></div>' +
        '<button type="button" id="spl" class="lp-play" aria-label="Play 30 second preview">&#9654;</button>' +
        '<button type="button" class="x" id="sx" aria-label="Remove song">×</button>' +
      '</div>';
    $('sx').onclick = function () { stopAudio(); pick = null; renderPick(); };
    $('spl').onclick = function () {
      if (playing) { stopAudio(); return; }
      function go(u) {
        if (!u) return;
        au.src = u; playing = true;
        var b = $('spl'); if (b) b.innerHTML = '&#10073;&#10073;';
        au.play().catch(function () { stopAudio(); });
      }
      if (pick[3] && /^https:\/\//.test(pick[3])) { go(pick[3]); return; }
      var btn = $('spl'); if (btn) btn.disabled = true;
      fillPickMeta(function () {
        if (btn) btn.disabled = false;
        /* update cover in place without resetting play state */
        if (pick && pick[2] && /^https:\/\//.test(pick[2])) {
          var ph = $('spicked').querySelector('.art');
          if (ph && ph.tagName !== 'IMG') {
            var n = document.createElement('img');
            n.className = 'art'; n.alt = ''; n.src = pick[2];
            ph.replaceWith(n);
          }
        }
        go(pick[3] || '');
      });
    };
    /* if cover missing, fetch and swap art in place */
    if (!pick[2] || !/^https:\/\//.test(pick[2])) {
      fillPickMeta(function () {
        if (!pick || !pick[2]) return;
        var ph = $('spicked').querySelector('.art');
        if (ph && ph.tagName !== 'IMG') {
          var n = document.createElement('img');
          n.className = 'art'; n.alt = ''; n.src = pick[2];
          ph.replaceWith(n);
        }
      });
    }
  }
  $('sres').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.free) {
      var t = $('sq').value.trim().split(' - ');
      pick = [t[0], t[1] || 'Unknown artist', '', ''];
    } else {
      var o = last[+b.dataset.i];
      pick = [o.t, o.a, o.c || '', o.p || ''];
    }
    $('sres').hidden = true; $('sq').value = ''; $('sq').hidden = true;
    renderPick();
  };

  var ownerCard = null;

  /* ---- message box: ideas + counter ---- */
  function grow() { var t = $('sText'); t.style.height = 'auto'; t.style.height = Math.min(300, Math.max(150, t.scrollHeight)) + 'px'; }
  function count() { $('sCount').textContent = $('sText').value.length + ' / 1000'; grow(); }
  $('sText').oninput = count;
  $('sPrompts').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var v = $('sText').value.trim(); $('sText').value = (v ? v + ' ' : '') + b.textContent + '. '; count(); $('sText').focus();
  };

  /* ---- send ---- */
  $('sSend').onclick = function () {
    var tx = $('sText').value.trim(), m = $('sMsg');
    if (!pick && $('sq').value.trim()) { var t = $('sq').value.trim().split(' - '); pick = [t[0], t[1] || 'Unknown artist', '', '']; renderPick(); }
    var bad = !tx ? 'Write a message first.' : !pick ? 'Pick a song to send with it.' : '';
    if (bad) { m.className = 'msg err'; m.textContent = bad; return; }
    stopAudio(); $('sSend').disabled = true; m.className = 'msg'; m.textContent = 'Sending...';
    ensureSession().then(function () {
      return rpc('send_message', { p_type: 'direct', p_to_name: to, p_to_key: to.toLowerCase(), p_body: tx, p_song: pick[0], p_artist: pick[1], p_art: pick[2] || null, p_preview: pick[3] || null, p_parent_id: null });
    }).then(function () {
      var sent = lget(SENT, []); sent.unshift({ id: 'l' + Date.now(), to: to, key: to.toLowerCase(), type: 'direct', text: tx, song: pick[0], artist: pick[1], color: pick[2], prev: pick[3], t: Date.now() }); lset(SENT, sent.slice(0, 100));
      $('sDoneArt').innerHTML = /^https:\/\//.test(pick[2] || '') ? '<img alt="" src="' + esc(pick[2].replace('100x100', 300 + 'x' + 300)) + '">' : '';
      $('sDoneArt').hidden = !$('sDoneArt').innerHTML;
      $('sDoneTxt').textContent = pick[0] + ' is on its way to @' + to + '. They will never know it was you.';
      show('sDone');
    }).catch(function (e) { m.className = 'msg err'; m.textContent = why(e); })
      .then(function () { $('sSend').disabled = false; });
  };
  $('sAgain').onclick = function () {
    $('sText').value = ''; count(); $('sText').style.height = ''; pick = null; renderPick(); $('sMsg').textContent = ''; show('sForm');
  };

  /* ---- start ---- */
  if (!/^[A-Za-z0-9._]{3,20}$/.test(to)) { miss('This link is missing a name. Ask your friend to send it again.'); return; }
  if (!REMOTE) { miss('This page needs the online database. Add your Supabase keys in config.js.'); return; }
  /* count link view once per username per day on this device */
  try {
    var vk = 'anon-viewed-' + to.toLowerCase();
    var day = new Date().toISOString().slice(0, 10);
    if (lget(vk, '') !== day) {
      lset(vk, day);
      rpc('record_link_view', { p_username: to }).catch(function () {});
    }
  } catch (e) {}

  api('settings?select=key,value').catch(function () { return []; }).then(function (rows) {
    var st = {}; rows.forEach(function (x) { st[x.key] = x.value; });
    if (st.maintenance === 'true') { $('sMaintTxt').textContent = st.maintenance_note || 'We will be right back.'; show('sMaint'); return; }
    return rpc('username_exists', { p_username: to }).then(function (ok) {
      if (ok !== true) { miss('This link is not connected to anyone yet. Check the spelling, or ask your friend to open Anonymous first.'); return; }
      document.title = 'Send @' + to + ' an anonymous song';
      $('sAv').textContent = to.charAt(0).toUpperCase(); $('sName').textContent = '@' + to;
      $('sNote').textContent = 'Anonymous. @' + to + ' will never see who sent this.';
      show('sForm');
      /* owner's photo + card design (public, optional: the page still works without it) */
      return rpc('public_profile', { p_username: to }).then(function (p) {
        if (!p || !p.username) return;
        ownerCard = p.card || null;
        if (p.avatar && /^data:image\/(jpeg|png|webp);base64,/.test(p.avatar)) {
          $('sAv').textContent = ''; $('sAv').style.background = 'url(' + p.avatar + ') center/cover';
        }
        if (ownerCard && window.CardStyle) {
          var hero = document.querySelector('.lp-hero');
          if (CardStyle.apply(hero, ownerCard, 10)) hero.classList.add('lp-styled');
        }
      }).catch(function () {});
    });
  }).catch(function (e) { miss(why(e)); });
})();
