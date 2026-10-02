(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var REMOTE = !!(C.SUPABASE_URL && C.SUPABASE_KEY);
  var $ = function (i) { return document.getElementById(i); };
  var LS = 'anon-msgs', US = 'anon-user', SENT = 'anon-sent';
  var SECS = ['gate', 'home', 'submit', 'browse', 'mybox', 'history', 'support', 'detail'];
  var cache = {}, cur = 'submit', pick = null, last = [], tmr, seen = {}, feedReady = false;
  var CAT = [["Tingin", "Cup of Joe, Janine", "#3F6B55"], ["Sana", "I Belong to the Zoo", "#2C3E75"], ["Lucky", "Jason Mraz, Colbie Caillat", "#9C8F7A"], ["stranger", "Olivia Rodrigo", "#5B3A8C"], ["Binibini", "Zack Tabudlo", "#D4547A"], ["Perfect", "Ed Sheeran", "#D9A441"]];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function norm(s) { return String(s).trim().toLowerCase(); }
  function lget(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function lset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- data layer (Supabase REST, or local demo mode) ---------- */
  function api(path, opt) {
    opt = opt || {};
    opt.headers = Object.assign({ apikey: C.SUPABASE_KEY, Authorization: 'Bearer ' + C.SUPABASE_KEY, 'Content-Type': 'application/json' }, opt.headers);
    return fetch(C.SUPABASE_URL + '/rest/v1/' + path, opt).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw { status: r.status, text: t }; });
      return r.json().catch(function () { return null; });
    });
  }
  function fromRow(r) {
    return { id: r.id, to: r.to_name, key: r.to_key, text: r.body, song: r.song, artist: r.artist, color: r.art || '', prev: r.preview || '', t: Date.parse(r.created_at) || 0 };
  }
  function fetchMsgs(key) {
    if (!REMOTE) {
      return Promise.resolve(lget(LS, []).filter(function (m) { return !key || m.key === key; }));
    }
    var q = 'messages?select=*&order=created_at.desc&limit=' + (key ? 100 : 50);
    if (key) q += '&to_key=eq.' + encodeURIComponent(key);
    return api(q).then(function (rows) { return rows.map(fromRow); });
  }
  function saveMsg(m) {
    if (!REMOTE) { var a = lget(LS, []); a.unshift(m); lset(LS, a); return Promise.resolve(); }
    return api('messages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ to_name: m.to, to_key: m.key, body: m.text, song: m.song, artist: m.artist, art: m.color, preview: m.prev }) });
  }
  function userExists(key) {
    if (!REMOTE) return Promise.resolve(true);
    return api('users?select=username&username_key=eq.' + encodeURIComponent(key) + '&limit=1').then(function (r) { return r.length > 0; });
  }
  function claim(u) {
    u = u.trim();
    if (!/^[A-Za-z0-9._]{3,20}$/.test(u)) return Promise.reject({ msg: 'Use 3 to 20 letters, numbers, dot or underscore.' });
    var done = function () { lset(US, u); };
    if (!REMOTE) { done(); return Promise.resolve(); }
    return api('users', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ username: u, username_key: norm(u) }) })
      .then(done, function (e) { throw { msg: e.status === 409 ? 'That username is taken. Try another.' : e.status ? 'Could not claim it (error ' + e.status + '). Check the keys in config.js and that schema.sql was run.' : 'Could not reach the database. Check your connection.' }; });
  }

  /* ---------- tabs ---------- */
  function showGate() {
    SECS.forEach(function (x) { $(x).hidden = x !== 'gate'; });
    $('tabs').hidden = true; window.scrollTo(0, 0);
  }
  function tab(t) {
    if (!lget(US, '') && t !== 'gate') { showGate(); return; }
    if (typeof au !== 'undefined') { au.pause(); rst(); }
    cur = t;
    SECS.forEach(function (x) { $(x).hidden = x !== t; });
    $('tabs').hidden = false;
    [].forEach.call($('tabs').children, function (b) { b.setAttribute('aria-selected', b.dataset.t === t); });
    if (t === 'home') loadHome();
    if (t === 'history') showHistory();
    if (t === 'browse') loadFeed();
    if (t === 'mybox') inbox();
  }
  $('tabs').onclick = function (e) { var b = e.target.closest('button'); if (b) tab(b.dataset.t); };

  /* ---------- song search ---------- */
  /* iTunes search: normal request first, JSONP as a backup if the browser blocks it */
  function itunes(term, limit) {
    var url = 'https://itunes.apple.com/search?media=music&entity=song&limit=' + limit + '&term=' + encodeURIComponent(term);
    return fetch(url).then(function (r) { return r.json(); }).catch(function () {
      return new Promise(function (res, rej) {
        var cb = 'it' + Date.now() + Math.floor(Math.random() * 1e4), el = document.createElement('script');
        function clean() { delete window[cb]; el.remove(); }
        var to = setTimeout(function () { clean(); rej(); }, 6000);
        window[cb] = function (d) { clearTimeout(to); clean(); res(d); };
        el.onerror = function () { clearTimeout(to); clean(); rej(); };
        el.src = url + '&callback=' + cb; document.head.appendChild(el);
      });
    });
  }

  function art(c) {
    return /^https:\/\//.test(c || '') ? '<img class="art" alt="" src="' + esc(c) + '">' : '<span class="art" style="background:' + esc(/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#999') + '"></span>';
  }
  function draw(items, raw) {
    last = items;
    $('res').innerHTML = items.map(function (s, i) {
      return '<button data-i="' + i + '">' + art(s.c) + '<span><b>' + esc(s.t) + '</b><span>' + esc(s.a) + '</span></span></button>';
    }).join('') + '<button data-free="1">' + art('#999') + '<span><b>Use "' + esc(raw) + '"</b><span>Not listed? Add it as typed</span></span></button>';
    $('res').hidden = false;
  }
  $('q').oninput = function () {
    var raw = $('q').value.trim(), v = norm(raw);
    clearTimeout(tmr);
    if (!v) { $('res').hidden = true; return; }
    draw(CAT.filter(function (s) { return norm(s[0] + ' ' + s[1]).indexOf(v) > -1; }).map(function (s) { return { t: s[0], a: s[1], c: s[2] }; }), raw);
    tmr = setTimeout(function () {
      itunes(raw, 12)
        .then(function (d) {
          if (norm($('q').value) !== v) return;
          var rs = (d.results || []).map(function (x) { return { t: x.trackName, a: x.artistName, c: x.artworkUrl100, p: x.previewUrl || '' }; });
          if (rs.length) draw(rs, raw);
        }).catch(function () {});
    }, 350);
  };
  $('res').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.free) { var t = $('q').value.trim().split(' - '); pick = [t[0], t[1] || 'Unknown artist', '#999', '']; }
    else { var o = last[+b.dataset.i]; pick = [o.t, o.a, o.c, o.p || '']; }
    $('res').hidden = true; $('q').value = ''; $('q').hidden = true;
    $('picked').innerHTML = '<div class="pick">' + art(pick[2]) + '<span><b>' + esc(pick[0]) + '</b><span>' + esc(pick[1]) + '</span></span><button aria-label="Remove song" id="x">×</button></div>';
    $('x').onclick = function () { pick = null; $('picked').innerHTML = ''; $('q').hidden = false; };
  };

  /* ---------- send ---------- */
  $('send').onclick = function () {
    var to = $('to').value.trim(), tx = $('text').value.trim(), m = $('msg');
    if (!pick && $('q').value.trim()) { var t = $('q').value.trim().split(' - '); pick = [t[0], t[1] || 'Unknown artist', '#999', '']; }
    var miss = !to ? 'Add a recipient.' : !tx ? 'Write a message.' : !pick ? 'Pick a song from the list, or type one and press Send.' : '';
    if (miss) { m.className = 'msg err'; m.textContent = miss; return; }
    var o = { id: 'l' + Date.now(), to: to, key: norm(to), text: tx, song: pick[0], artist: pick[1], color: pick[2], prev: pick[3] || '', t: Date.now() };
    $('send').disabled = true;
    userExists(o.key).then(function (found) {
      if (!found) throw { msg: 'Nobody has the username "' + to + '" yet. Ask them to join first.' };
      return saveMsg(o);
    }).then(function () {
      var sent = lget(SENT, []); sent.unshift(o); lset(SENT, sent.slice(0, 100));
      m.className = 'msg'; m.textContent = 'Sent. It is now in the Inbox for ' + to + '.';
      $('to').value = ''; $('text').value = ''; pick = null; $('picked').innerHTML = ''; $('q').hidden = false;
    }).catch(function (e) {
      m.className = 'msg err'; m.textContent = (e && e.msg) || 'Could not send. Check your connection and send again.';
    }).then(function () { $('send').disabled = false; });
  };

  /* ---------- cards, feed, inbox search ---------- */
  function pbtn(m, cls) {
    return '<button class="play' + cls + '" aria-label="Play preview" data-src="' + esc(/^https:\/\//.test(m.prev) ? m.prev : '') + '" data-q="' + esc(m.song + ' ' + m.artist) + '">' + (cls ? '&#9654;' : '&#9654; Play') + '</button>';
  }
  function cardH(m, isNew) {
    return '<div class="card' + (isNew ? ' new' : '') + '" data-id="' + esc(m.id) + '" role="button" tabindex="0" aria-label="Open message to ' + esc(m.to) + '"><i class="tape"></i>' +
      '<div class="top"><span class="to">To: ' + esc(m.to) + '</span> <span class="stamp">' + (m.ex ? 'Sample' : 'From: ???') + '</span><p class="hand clip">' + esc(m.text) + '</p></div>' +
      '<div class="song">' + art(m.color) + '<span><b>' + esc(m.song) + '</b><span>' + esc(m.artist) + '</span></span>' + pbtn(m, '') + '</div></div>';
  }
  function show(el, a, empty, animate) {
    a.forEach(function (m) { cache[m.id] = m; });
    el.innerHTML = a.length ? a.map(function (m) {
      return cardH(m, false);
    }).join('') : '<div class="empty">' + empty + '</div>';
  }
  var feedTop = null;
  function loadFeed() {
    fetchMsgs('').then(function (a) {
      var top = a[0] && a[0].id;
      if (feedReady && top === feedTop) return;
      feedTop = top; feedReady = true;
      show($('feed'), a, 'No messages yet. Send the first one.', false);
    }).catch(function () { $('feed').innerHTML = '<div class="empty">Could not load messages. Try again in a moment.</div>'; });
  }
  setInterval(function () { if (cur === 'browse' && !document.hidden) loadFeed(); }, 20000);


  function search(own) {
    var q = norm($('sq').value);
    if (!q) { $('mine').innerHTML = '<div class="empty">Type a name first.</div>'; return; }
    $('mine').innerHTML = '<div class="empty">Searching...</div>';
    fetchMsgs(q).then(function (a) { show($('mine'), a, own === true ? 'No messages yet. When someone sends you a song, it shows up here.' : 'No messages for "' + esc(q) + '".', false); })
      .catch(function () { $('mine').innerHTML = '<div class="empty">Could not search. Try again.</div>'; });
  }
  $('sgo').onclick = function () { search(); };
  $('sq').onkeydown = function (e) { if (e.key === 'Enter') search(); };
  $('mymsgs').onclick = function () { $('sq').value = lget(US, ''); search(true); };

  /* ---------- username (no password) ---------- */
  function inbox() {
    var u = lget(US, ''), base = (C.SITE_URL || location.href).split('#')[0];
    $('who').hidden = !u; $('mymsgs').hidden = !u;
    if (!u) return;
    var l = base.replace(/\/?$/, '/') + '#to=' + encodeURIComponent(u);
    var local = !C.SITE_URL && !/^https:/.test(location.protocol);
    $('linkNote').hidden = !local;
    if (local) $('linkNote').textContent = 'This link only works on this device. After you host the app, set SITE_URL in config.js.';
    $('whoName').textContent = '@' + u; $('link').value = l;
    $('share').innerHTML = '<a target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(l) + '">Facebook</a><button id="nat">Share to IG, Messenger, more</button>';
    $('nat').onclick = function () {
      if (navigator.share) navigator.share({ title: 'Send me a song', text: 'Send me a song anonymously', url: l }).catch(function () {});
      else $('copy').click();
    };
  }
  $('claimBtn').onclick = function () {
    $('claimBtn').disabled = true;
    claim($('un').value).then(function () { $('cmsg').textContent = ''; tab(location.hash.indexOf('to=') > -1 ? 'submit' : 'home'); })
      .catch(function (e) { $('cmsg').className = 'msg err'; $('cmsg').textContent = e.msg || 'Something went wrong.'; })
      .then(function () { $('claimBtn').disabled = false; });
  };
  $('un').onkeydown = function (e) { if (e.key === 'Enter') $('claimBtn').click(); };
  $('swap').onclick = function () { lset(US, ''); $('un').value = ''; showGate(); };
  $('un').onkeydown = function (e) { if (e.key === 'Enter') $('claimBtn').click(); };
  $('copy').onclick = function () {
    var b = $('copy');
    try { navigator.clipboard.writeText($('link').value).then(function () { b.textContent = 'Copied'; }); }
    catch (e) { $('link').select(); b.textContent = 'Select, copy'; }
    setTimeout(function () { b.textContent = 'Copy'; }, 1500);
  };

  /* ---------- detail view ---------- */
  function openD(id) {
    var m = cache[id]; if (!m) return;
    var hex = /^#[0-9a-f]{3,8}$/i.test(m.color), https = /^https:\/\//.test(m.color), col = hex ? m.color : '#27424F';
    var big = https ? '<img class="bigart" alt="" src="' + esc(m.color.replace('100x100', '600x600')) + '">' : '<span class="bigart" style="background:' + col + '"></span>';
    $('detail').innerHTML = '<button class="back" id="back">&larr; Back</button><h2 class="hi">Hello, ' + esc(m.to) + '</h2>' +
      '<p class="sub" style="text-align:center">Someone sent you a song. They want you to hear this one.</p>' +
      '<div class="dcard">' + big +
      '<div class="dinfo"><b>' + esc(m.song) + '</b><span>' + esc(m.artist) + '</span><em class="pv">30s preview</em></div>' + pbtn(m, ' circle') + '</div>' +
      '<p id="pnote" class="sub" style="text-align:center;min-height:1.2em"></p>' +
      '<p class="sub" style="text-align:center;margin-top:22px">Also, here is a message from the sender:</p><p class="hand">' + esc(m.text) + '</p>';
    SECS.forEach(function (x) { $(x).hidden = true; });
    $('tabs').hidden = true; $('detail').hidden = false; window.scrollTo(0, 0);
    $('back').onclick = function () { au.pause(); rst(); var t = cur; tab(t); };
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('.play,a')) return;
    var c = e.target.closest('.card[data-id]'); if (c) openD(c.dataset.id);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var c = e.target.closest && e.target.closest('.card[data-id]'); if (c) openD(c.dataset.id);
  });

  /* ---------- player (30s iTunes preview) ---------- */
  var au = new Audio(), pb = null;
  function rst() { if (pb) { pb.innerHTML = pb.classList.contains('circle') ? '&#9654;' : '&#9654; Play'; pb = null; } }
  au.onended = rst;
  function getSrc(b) {
    if (b.dataset.src) return Promise.resolve(b.dataset.src);
    return itunes(b.dataset.q, 1)
      .then(function (d) { var u = d.results && d.results[0] && d.results[0].previewUrl; if (!u) throw 0; b.dataset.src = u; return u; });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.play'); if (!b) return;
    var c = b.classList.contains('circle');
    if (b.dataset.fail) { window.open('https://open.spotify.com/search/' + encodeURIComponent(b.dataset.q), '_blank', 'noopener'); return; }
    if (pb === b) { au.pause(); rst(); return; }
    rst(); pb = b; b.textContent = c ? '...' : 'Loading...';
    getSrc(b).then(function (u) { au.src = u; return au.play(); })
      .then(function () { b.innerHTML = c ? '&#10073;&#10073;' : '&#10073;&#10073; Pause'; })
      .catch(function () {
        b.dataset.fail = '1'; b.innerHTML = c ? '&#8599;' : 'Open in Spotify'; pb = null;
        if (c && $('pnote')) $('pnote').textContent = 'No preview found. Tap the arrow to open in Spotify.';
      });
  });

  /* ---------- home: hero + drifting rows of notes ---------- */
  var EX = [["lyra", "you still live in my playlists, pasensya na", "Heather", "Conan Gray"], ["kinan", "i hope your day is as soft as this song", "Sana", "I Belong to the Zoo"], ["jensen", "kadang i wish i said it sooner, pero eto na", "Tingin", "Cup of Joe, Janine"], ["mil", "you were my safe place, even when we drifted", "Lucky", "Jason Mraz, Colbie Caillat"], ["rey", "no goodbyes, tapi salamat pa rin", "Perfect", "Ed Sheeran"], ["ana", "this one is for the quiet days with you", "Binibini", "Zack Tabudlo"]];
  function exMsg(i) { return { id: 'ex' + i, to: EX[i][0], key: EX[i][0], text: EX[i][1], song: EX[i][2], artist: EX[i][3], color: '#2C3E75', prev: '', ex: true, t: 0 }; }
  function mqRow(list, rev) {
    var h = list.map(function (m) { return cardH(m, false); }).join('');
    return '<div class="mq"><div class="track' + (rev ? ' rev' : '') + '" style="animation-duration:' + (list.length * 8) + 's">' + h + h + '</div></div>';
  }
  function loadHome() {
    fetchMsgs('').catch(function () { return []; }).then(function (a) {
      var all = a.slice(0, 30);
      for (var i = 0; all.length < 6 && i < EX.length; i++) all.push(exMsg(i));
      all.forEach(function (m) { cache[m.id] = m; });
      var rows = [[], [], []];
      all.forEach(function (m, i) { rows[i % 3].push(m); });
      rows = rows.map(function (r) { while (r.length < 4) r = r.concat(r); return r; });
      $('mqs').innerHTML = mqRow(rows[0], false) + mqRow(rows[1], true) + mqRow(rows[2], false);
    });
  }
  function showHistory() { show($('hlist'), lget(SENT, []), 'Nothing sent from this device yet.', false); }
  document.addEventListener('click', function (e) { var g = e.target.closest('[data-go]'); if (g) tab(g.dataset.go); });
  $('homeLink').onclick = function () { tab('home'); };
  $('homeLink').onkeydown = function (e) { if (e.key === 'Enter') tab('home'); };

  /* ---------- boot ---------- */
  var h = location.hash.match(/to=([^&]+)/);
  if (h) { try { $('to').value = decodeURIComponent(h[1]); $('warn').textContent = 'You are sending to ' + $('to').value + '. They will not see your name.'; } catch (e) {} }
  $('fine').textContent = REMOTE ? '' : 'Demo mode: messages are saved on this device only. Add your Supabase keys in config.js.';
  if (C.SUPPORT_EMAIL) { ['fb', 'fb2'].forEach(function (id) { $(id).href = 'mailto:' + C.SUPPORT_EMAIL + '?subject=Anonymous%20feedback'; $(id).hidden = false; }); $('fb2').style.display = 'block'; }
  if (h && !lget(US, '')) { try { $('gateSub').textContent = 'You are about to send a song to ' + decodeURIComponent(h[1]) + '. Pick a username to continue.'; } catch (e) {} }
  tab(h ? 'submit' : 'home');
})();
