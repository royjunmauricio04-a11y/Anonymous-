(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var REMOTE = !!(C.SUPABASE_URL && C.SUPABASE_KEY);
  var $ = function (i) { return document.getElementById(i); };
  var LS = 'anon-msgs', US = 'anon-user', SENT = 'anon-sent';
  var SECS = ['gate', 'maint', 'home', 'submit', 'browse', 'mybox', 'history', 'support', 'detail'];
  var cache = {}, cur = 'submit', pick = null, last = [], tmr, seen = {}, feedReady = false;
  var CAT = [["Tingin", "Cup of Joe, Janine", "#3F6B55"], ["Sana", "I Belong to the Zoo", "#2C3E75"], ["Lucky", "Jason Mraz, Colbie Caillat", "#9C8F7A"], ["stranger", "Olivia Rodrigo", "#5B3A8C"], ["Binibini", "Zack Tabudlo", "#D4547A"], ["Perfect", "Ed Sheeran", "#D9A441"]];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function norm(s) { return String(s).trim().toLowerCase(); }
  function lget(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function lset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- auth + data layer ---------- */
  var AUTH = 'anon-auth', currentUser = null, profile = null;

  function dbHint(e) {
    if (!e || !e.status) return 'Could not reach the database. Check your connection.';
    var code = ''; try { code = JSON.parse(e.text).code || ''; } catch (x) {}
    var msg = ''; try { msg = JSON.parse(e.text).msg || JSON.parse(e.text).message || ''; } catch (x2) {}
    if (code === 'PGRST202') return 'Required database functions are not installed. Run the latest schema.sql in Supabase.';
    if (code === '42501' || e.status === 401 || e.status === 403) return 'Your account is not allowed to do that. Run the latest SQL migration and sign in again.';
    if (code === '23505') return 'That username or account is already in use.';
    if (msg && /username/i.test(msg)) return msg;
    if (msg && /recipient/i.test(msg)) return 'That personal link is not connected to an account.';
    if (code === 'PGRST205' || code === '42P01' || e.status === 404) return 'Tables or functions are missing. Run schema.sql in Supabase SQL Editor.';
    return 'Database error (' + e.status + ').';
  }

  function sessionGet() { try { return JSON.parse(localStorage.getItem(AUTH)) || JSON.parse(sessionStorage.getItem(AUTH)) || null; } catch (e) { return null; } }
  function sessionSet(v) { try { if (v) localStorage.setItem(AUTH, JSON.stringify(v)); else { localStorage.removeItem(AUTH); sessionStorage.removeItem(AUTH); } } catch (e) {} }
  function storeSess(d) {
    var old = sessionGet() || {};
    sessionSet({ access_token: d.access_token, refresh_token: d.refresh_token, user: d.user || old.user, exp: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
  }
  /* keep the login alive: refresh the access token shortly before it expires */
  var freshP = null;
  function fresh() {
    var s = sessionGet();
    if (!s || !s.refresh_token || (s.exp && s.exp - 60 > Date.now() / 1000)) return Promise.resolve();
    if (freshP) return freshP;
    freshP = fetch(C.SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) })
      .then(function (r) { return r.ok ? r.json() : Promise.reject({ status: r.status }); }).then(storeSess)
      .catch(function (e) { if (e && (e.status === 400 || e.status === 401 || e.status === 403)) sessionSet(null); })   /* a weak signal must never sign you out */
      .then(function () { freshP = null; });
    return freshP;
  }
  function api(path, opt) { return fresh().then(function () { return api0(path, opt); }); }
  function rpc(name, args) { return api('rpc/' + name, { method: 'POST', body: JSON.stringify(args) }); }
  function api0(path, opt) {
    opt = opt || {};
    var hd = { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' };
    var sess = sessionGet();
    if (sess && sess.access_token) hd.Authorization = 'Bearer ' + sess.access_token;
    else if (/^eyJ/.test(C.SUPABASE_KEY)) hd.Authorization = 'Bearer ' + C.SUPABASE_KEY;
    opt.headers = Object.assign(hd, opt.headers);
    return fetch(C.SUPABASE_URL + '/rest/v1/' + path, opt).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw { status: r.status, text: t }; });
      return r.json().catch(function () { return null; });
    });
  }

  function authApi(path, opt) {
    opt = opt || {};
    var hd = { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' };
    var sess = sessionGet();
    if (sess && sess.access_token) hd.Authorization = 'Bearer ' + sess.access_token;
    opt.headers = Object.assign(hd, opt.headers);
    return fetch(C.SUPABASE_URL + '/auth/v1/' + path, opt).then(function (r) {
      return r.text().then(function (t) {
        var data = {}; try { data = t ? JSON.parse(t) : {}; } catch (e) {}
        if (!r.ok) throw { status: r.status, text: t, data: data };
        return data;
      });
    });
  }

  function fromRow(r) {
    return { id: r.id, to: r.to_name, key: r.to_key, type: r.delivery_type || 'direct', text: r.body, song: r.song, artist: r.artist, color: r.art || '', prev: r.preview || '', bot: !!r.is_bot, t: Date.parse(r.created_at) || 0 };
  }
  function fetchMsgs(key) {
    key = key ? String(key).trim().toLowerCase() : '';
    if (!REMOTE) {
      return Promise.resolve(lget(LS, []).filter(function (m) { return key ? (m.type !== 'public' && String(m.key).toLowerCase() === key) : m.type === 'public'; }));
    }
    var q = 'messages?select=id,to_name,to_key,delivery_type,body,song,artist,art,preview,is_bot,created_at&order=created_at.desc&limit=' + (key ? 100 : 50);
    /* Inbox: the database only ever returns direct messages addressed to the signed-in account */
    q += key ? '&delivery_type=eq.direct' : '&delivery_type=eq.public';
    return api(q).then(function (rows) { return rows.map(fromRow); });
  }
  function saveMsg(m) {
    if (!REMOTE) { var a = lget(LS, []); a.unshift(m); lset(LS, a); return Promise.resolve(); }
    return rpc('send_message', {
      p_type: m.type,
      p_to_name: m.to,
      p_to_key: m.key,
      p_body: m.text,
      p_song: m.song,
      p_artist: m.artist,
      p_art: m.color,
      p_preview: m.prev
    });
  }

  function authSignUp(email, password) {
    return authApi('signup', { method: 'POST', body: JSON.stringify({ email: email, password: password }) });
  }
  function authSignIn(email, password) {
    return authApi('token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: email, password: password }) });
  }
  function authSignUpAnon() {
    return authApi('signup', { method: 'POST', body: JSON.stringify({ data: {} }) }).then(function (d) {
      if (!d.access_token) throw { msg: 'Username login is not switched on yet. Turn on Anonymous sign-ins in Supabase.' };
      return d;
    });
  }
  function authUser() { return authApi('user', { method: 'GET' }); }
  function authSignOut() {
    var p = sessionGet();
    sessionSet(null); currentUser = null; profile = null;
    if (p && p.access_token) return authApi('logout', { method: 'POST' }).catch(function () {});
    return Promise.resolve();
  }

  function loadProfile() {
    if (!REMOTE || !sessionGet()) return Promise.resolve(null);
    return rpc('my_profile', {}).then(function (p) {
      profile = p && p.username ? p : null;
      if (profile && profile.username) lset(US, profile.username);
      return profile;
    });
  }
  function claim(u, pin) {
    u = u.trim();
    if (!/^[A-Za-z0-9._]{3,15}$/.test(u)) return Promise.reject({ msg: 'Use 3 to 15 letters, numbers, dot or underscore. We add the number for you.' });
    if (!REMOTE) { lset(US, u); profile = { username: u }; return Promise.resolve(); }
    return rpc('claim_username', { p_username: u, p_pin: pin || null }).then(function (p) {
      profile = { username: (p && p.username) || u, has_pin: !!pin };
      lset(US, u);
    }).catch(function (e) {
      var msg = '';
      try { msg = JSON.parse(e.text).message || ''; } catch (x) {}
      if (msg === 'username_taken') msg = 'That username is taken. Pick another one, or use the Log in tab if it is yours.';
      else if (msg === 'pin_required') msg = 'Create a PIN with 4 to 20 characters.';
      else if (msg === 'already_has_username') msg = 'This device already has a username. Sign out first.';
      else if (msg === 'invalid_username') msg = 'Use 3 to 15 letters, numbers, dot or underscore. We add the number for you.';
      else if (msg === 'name_busy') msg = 'That name is very popular right now. Try a slightly different one.';
      throw { msg: msg || dbHint(e), taken: true };
    });
  }

  /* ---------- tabs ---------- */
  var maint = null;
  function showMaint() {
    SECS.forEach(function (x) { $(x).hidden = x !== 'maint'; });
    $('maintNote').textContent = maint; $('tabs').hidden = true; window.scrollTo(0, 0);
  }
  function showGate() {
    SECS.forEach(function (x) { $(x).hidden = x !== 'gate'; });
    $('tabs').hidden = true; window.scrollTo(0, 0);
  }
  function isDirectLink() { return /(?:^#|&)to=/.test(location.hash); }
  function tab(t) {
    if (maint !== null && t !== 'admin') { showMaint(); return; }
    if (!profile && ['submit', 'mybox', 'history'].indexOf(t) > -1) { showGate(); return; }
    if (typeof au !== 'undefined') { au.pause(); rst(); }
    cur = t; window.scrollTo(0, 0);
    SECS.forEach(function (x) { $(x).hidden = x !== t; });
    $('tabs').hidden = t === 'admin' || (t === 'submit' && isDirectLink());
    if (t === 'submit') $('directHead').hidden = !isDirectLink();
    [].forEach.call($('tabs').children, function (b) { b.setAttribute('aria-selected', b.dataset.t === t); });
    if (t === 'home') loadHome();
    if (t === 'history') showHistory();
    if (t === 'browse') loadFeed();
    if (t === 'mybox') inbox();
    if (t === 'support') refreshTix();
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

  var ARTC = lget('anon-art', {}), artTried = {}, artBusy = false;
  function art(c, q) {
    var u = /^https:\/\//.test(c || '') ? c : (q && ARTC[q]) || '';
    if (u) return '<img class="art" alt="" src="' + esc(u) + '">';
    return '<span class="art"' + (q ? ' data-q="' + esc(q) + '"' : '') + ' style="background:' + esc(/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#999') + '"></span>';
  }
  function swapArt(n, u) {
    var big = n.classList.contains('bigart'), i = document.createElement('img');
    i.className = big ? 'bigart' : 'art'; i.alt = ''; i.src = big ? u.replace('100x100', '600x600') : u; n.replaceWith(i);
  }
  /* sample and bot messages only have a colour: look up the real album cover from iTunes */
  function hydrateArt() {
    var nodes = [].slice.call(document.querySelectorAll('span[data-q].art, span[data-q].bigart')), qs = [];
    nodes.forEach(function (n) {
      var q = n.dataset.q;
      if (ARTC[q]) swapArt(n, ARTC[q]); else if (!artTried[q] && qs.indexOf(q) < 0) qs.push(q);
    });
    if (artBusy || !qs.length) return;
    qs = qs.slice(0, 24); artBusy = true;
    (function next() {
      var q = qs.shift(); if (!q) { artBusy = false; return; }
      artTried[q] = 1;
      itunes(q, 1).then(function (d) {
        var u = d.results && d.results[0] && d.results[0].artworkUrl100;
        if (u) { ARTC[q] = u; lset('anon-art', ARTC); }
      }).catch(function () {}).then(function () {
        [].forEach.call(document.querySelectorAll('span[data-q]'), function (n) { if (n.dataset.q === q && ARTC[q]) swapArt(n, ARTC[q]); });
        setTimeout(next, 120);
      });
    })();
  }
  function draw(items, raw) {
    last = items;
    $('res').innerHTML = items.map(function (s, i) {
      return '<button data-i="' + i + '">' + art(s.c, s.t + ' ' + s.a) + '<span><b>' + esc(s.t) + '</b><span>' + esc(s.a) + '</span></span></button>';
    }).join('') + '<button data-free="1">' + art('#999') + '<span><b>Use "' + esc(raw) + '"</b><span>Not listed? Add it as typed</span></span></button>';
    $('res').hidden = false; hydrateArt();
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
    $('picked').innerHTML = '<div class="pick">' + art(pick[2], pick[0] + ' ' + pick[1]) + '<span><b>' + esc(pick[0]) + '</b><span>' + esc(pick[1]) + '</span></span><button aria-label="Remove song" id="x">×</button></div>';
    $('x').onclick = function () { pick = null; $('picked').innerHTML = ''; $('q').hidden = false; };
  };

  /* ---------- send ---------- */
  $('backMain').onclick = function () { location.hash = ''; tab('home'); };
  $('send').onclick = function () {
    var to = $('to').value.trim(), tx = $('text').value.trim(), m = $('msg');
    var direct = !!(location.hash.match(/(?:^#|&)to=/));
    if (!profile) { showGate(); return; }
    if (!pick && $('q').value.trim()) { var t = $('q').value.trim().split(' - '); pick = [t[0], t[1] || 'Unknown artist', '#999', '']; }
    var miss = !to ? (direct ? 'The personal link is missing its recipient.' : 'Add a name or nickname for the public post.') : !tx ? 'Write a message.' : !pick ? 'Pick a song from the list, or type one and press Send.' : '';
    if (miss) { m.className = 'msg err'; m.textContent = miss; return; }
    var o = { id: 'l' + Date.now(), to: to, key: direct ? norm(to) : 'public', type: direct ? 'direct' : 'public', text: tx, song: pick[0], artist: pick[1], color: pick[2], prev: pick[3] || '', t: Date.now() };
    $('send').disabled = true;
    saveMsg(o).then(function () {
      var sent = lget(SENT, []); sent.unshift(o); lset(SENT, sent.slice(0, 100));
      m.className = 'msg';
      m.textContent = direct ? 'Sent anonymously. Only the owner of that personal link can see it in their Inbox.' : 'Posted anonymously to Browse. The named person will not receive an Inbox message.';
      $('to').value = direct ? $('to').value : ''; $('text').value = ''; pick = null; $('picked').innerHTML = ''; $('q').hidden = false;
      if (!direct) loadFeed();
    }).catch(function (e) { m.className = 'msg err'; m.textContent = (e && e.msg) || dbHint(e); })
      .then(function () { $('send').disabled = false; });
  };

  /* ---------- cards, feed, inbox search ---------- */
  function pbtn(m, cls) {
    return '<button class="play' + cls + '" aria-label="Play preview" data-src="' + esc(/^https:\/\//.test(m.prev) ? m.prev : '') + '" data-q="' + esc(m.song + ' ' + m.artist) + '">' + (cls ? '&#9654;' : '&#9654; Play') + '</button>';
  }
  function cardH(m, isNew) {
    return '<div class="card' + (isNew ? ' new' : '') + '" data-id="' + esc(m.id) + '" role="button" tabindex="0" aria-label="Open message to ' + esc(m.to) + '">' +
      '<div class="top"><span class="to">To: ' + esc(m.to) + '</span> <span class="stamp">' + (m.ex ? 'Sample' : m.bot ? 'Bot' : 'From: ???') + '</span><p class="hand clip">' + esc(m.text) + '</p></div>' +
      '<div class="song">' + art(m.color, m.song + ' ' + m.artist) + '<span><b>' + esc(m.song) + '</b><span>' + esc(m.artist) + '</span></span>' + pbtn(m, '') + '</div></div>';
  }
  function show(el, a, empty, animate) {
    a.forEach(function (m) { cache[m.id] = m; });
    el.innerHTML = a.length ? a.map(function (m) {
      return cardH(m, false);
    }).join('') : '<div class="empty">' + empty + '</div>';
    hydrateArt();
  }
  var SEEN = 'anon-seen-ids';
  function setInboxBadge(n) {
    var b = document.querySelector('#tabs [data-t=mybox]'); if (!b) return;
    var old = b.querySelector('.badge'); if (old) old.remove();
    if (n > 0) { var sp = document.createElement('span'); sp.className = 'badge'; sp.textContent = n > 9 ? '9+' : n; b.appendChild(document.createTextNode(' ')); b.appendChild(sp); }
  }
  function checkInbox(markSeen) {
    if (!REMOTE || !profile || !sessionGet()) return Promise.resolve();
    return fetchMsgs(profile.username).then(function (a) {
      var seen = lget(SEEN, []), ids = a.map(function (m) { return m.id; });
      if (markSeen) { lset(SEEN, ids.slice(0, 200)); setInboxBadge(0); return; }
      setInboxBadge(ids.filter(function (id) { return seen.indexOf(id) < 0; }).length);
    }).catch(function () {});
  }
  setInterval(function () { if (!document.hidden && cur !== 'mybox') checkInbox(false); }, 45000);
  var feedTop = null;
  function loadFeed() {
    fetchMsgs('').then(function (a) {
      var top = a[0] && a[0].id;
      if (feedReady && top === feedTop) return;
      feedTop = top; feedReady = true;
      show($('feed'), a, 'No messages yet. Send the first one.', false);
    }).catch(function (e) { $('feed').innerHTML = '<div class="empty">' + esc(dbHint(e)) + '</div>'; });
  }
  setInterval(function () { if (cur === 'browse' && !document.hidden) loadFeed(); }, 20000);


  function inbox() {
    var u = profile && profile.username;
    $('who').hidden = !u;
    if (!u) return;
    var base = C.SITE_URL ? C.SITE_URL.replace(/\/+$/, '') + '/' : location.href.split('#')[0].split('?')[0].replace(/[^\/]*$/, '');
    var l = base + 'send.html?to=' + encodeURIComponent(u);
    var local = !C.SITE_URL && !/^https:/.test(location.protocol);
    $('linkNote').hidden = !local;
    if (local) $('linkNote').textContent = 'This link only works on this device. After you host the app, set SITE_URL in config.js.';
    $('whoName').textContent = '@' + u; $('link').value = l;
    $('share').innerHTML = '<a target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(l) + '">Facebook</a><button id="nat">Share to IG, Messenger, more</button>';
    $('nat').onclick = function () {
      if (navigator.share) navigator.share({ title: 'Send me a song', text: 'Send me a song anonymously', url: l }).catch(function () {});
      else $('copy').click();
    };
    $('mine').innerHTML = '<div class="empty">Loading your private messages...</div>';
    $('pinNudge').hidden = !(profile && profile.has_pin === false);
    fetchMsgs(u).then(function (a) {
      show($('mine'), a, 'No direct messages yet. Share your personal link so someone can send you one.', false);
      lset(SEEN, a.map(function (m) { return m.id; }).slice(0, 200)); setInboxBadge(0);
    }).catch(function (e) {
      $('mine').innerHTML = '<div class="empty">' + esc(dbHint(e)) + '</div>';
    });
  }

  function finishGate(route) {
    profileSetup = false; $('cmsg').className = 'msg'; $('cmsg').textContent = '';
    $('gate').hidden = true;
    if (route === 'submit') tab('submit'); else tab('home');
    checkInbox(false);
    if (justCreated) { $('welcomeName').textContent = justCreated; $('welcome').hidden = false; justCreated = null; }
  }

  var gateMode = 'name', profileSetup = false, justCreated = null;
  function setGateMode(mode) {
    gateMode = mode;
    $('gateName').setAttribute('aria-selected', mode === 'name');
    $('gateBack').setAttribute('aria-selected', mode === 'back');
    $('gateLogin').setAttribute('aria-selected', mode === 'login');
    $('gateSub').textContent = mode === 'name' ? 'Pick a name and a PIN. We add a random number so your username is always unique.' : mode === 'back' ? 'Log in with your full username (with the number) and your PIN. Your Inbox comes with you.' : 'Sign in with the email you used before.';
    $('unLabel').textContent = mode === 'back' ? 'Your full username (with the number)' : 'Pick a name';
    $('un').maxLength = mode === 'back' ? 20 : 15;
    $('un').placeholder = mode === 'back' ? 'for example rjay_4821' : 'for example rjay (3 to 15 characters)';
    $('unHint').hidden = mode !== 'name';
    $('emailWrap').hidden = mode !== 'login';
    $('unWrap').hidden = mode === 'login';
    $('pinWrap').hidden = mode === 'login';
    $('pinLabel').textContent = mode === 'name' ? 'Create a PIN (4 to 20 characters)' : 'Your PIN';
    $('pinHint').hidden = mode !== 'name';
    $('claimBtn').textContent = mode === 'name' ? 'Continue' : mode === 'back' ? 'Log in' : 'Sign in';
    $('cmsg').textContent = ''; $('reuse').hidden = true;
  }
  $('gateName').onclick = function () { setGateMode('name'); };
  $('gateBack').onclick = function () { setGateMode('back'); };
  $('gateLogin').onclick = function () { setGateMode('login'); };
  function gateErr(t) { $('cmsg').className = 'msg err'; $('cmsg').textContent = t; $('claimBtn').disabled = false; }
  var RECOVER_ERR = { wrong_username_or_pin: 'Wrong username or PIN.', too_many_attempts: 'Too many wrong tries. Please wait 15 minutes, then try again.', already_has_username: 'This device already has a username. Sign out first.' };
  $('claimBtn').onclick = function () {
    var email = $('email').value.trim(), pass = $('password').value, un = $('un').value.trim(), pin = $('pin').value;
    var route = 'home';
    $('claimBtn').disabled = true; $('cmsg').className = 'msg'; $('cmsg').textContent = 'Please wait...';
    if (!REMOTE) {
      if (gateMode === 'login') { if (!lget(US, '')) return gateErr('Demo mode needs a username. Use the New tab.'); profile = { username: lget(US, ''), has_pin: true }; }
      else { if (!/^[A-Za-z0-9._]{3,15}$/.test(un)) return gateErr('Use 3 to 15 letters, numbers, dot or underscore. We add the number for you.'); var dh = un + '_' + (1000 + Math.floor(Math.random() * 9000)); lset(US, dh); profile = { username: dh, has_pin: true }; justCreated = dh; }
      finishGate(route); $('claimBtn').disabled = false; return;
    }
    var op;
    if (gateMode === 'login') {
      if (!email || !pass) return gateErr('Enter your email and password.');
      op = authSignIn(email, pass).then(function (d) {
        storeSess(d); currentUser = d.user;
        return loadProfile().then(function (p) {
          if (!p) { profileSetup = true; setGateMode('name'); $('gateSub').textContent = 'Signed in. Choose a username and a PIN to finish.'; throw { stop: true }; }
        });
      });
    } else {
      var maxLen = gateMode === 'back' ? 20 : 15;
      if (!new RegExp('^[A-Za-z0-9._]{3,' + maxLen + '}$').test(un)) return gateErr(gateMode === 'back' ? 'Type your full username with the number, for example rjay_4821.' : 'Use 3 to 15 letters, numbers, dot or underscore. We add the number for you.');
      if (pin.length < 4 || pin.length > 20) return gateErr('The PIN must be 4 to 20 characters.');
      var needSession = function () { return sessionGet() ? Promise.resolve(null) : authSignUpAnon(); };
      var keep = function (d) { if (d) { storeSess(d); currentUser = d.user; } };
      if (gateMode === 'back') {
        op = needSession().then(keep).then(function () { return rpc('recover_username', { p_username: un, p_pin: pin }); }).then(function (res) {
          if (!res || res.ok !== true) throw { msg: RECOVER_ERR[res && res.error] || 'Could not log in. Check your username and PIN.' };
          return loadProfile();
        });
      } else if (profileSetup) {
        op = claim(un, pin);
      } else {
        op = needSession().then(keep).then(function () { return claim(un, pin); });
      }
    }
    if (gateMode === 'name') op = op.then(function () { justCreated = profile && profile.username; });
    op.then(function () { finishGate(route); })
      .catch(function (e) {
        if (e && e.stop) return;
        var ad = e && e.data ? (e.data.msg || e.data.message || '') : '';
        var t = e.msg || ad || (e.status === 400 ? 'Email or password is incorrect, or the account needs email confirmation.' : dbHint(e));
        if (/anonymous/i.test(ad) || (e.data && e.data.error_code === 'anonymous_provider_disabled')) t = 'Username login is not switched on yet. In Supabase open Authentication > Sign In / Providers and turn on "Allow anonymous sign-ins".';
        if (e && e.status === 429) t = 'Too many tries from this network. Please wait a few minutes and try again.';
        gateErr(t);
      }).then(function () { $('claimBtn').disabled = false; });
  };
  ['password', 'email', 'un', 'pin'].forEach(function (id) { $(id).onkeydown = function (e) { if (e.key === 'Enter') $('claimBtn').click(); }; });
  $('pinSave').onclick = function () {
    var v = $('pinNew').value;
    if (v.length < 4 || v.length > 20) { toast('The PIN must be 4 to 20 characters.', true); return; }
    rpc('set_pin', { p_pin: v }).then(function () { profile.has_pin = true; $('pinNew').value = ''; $('pinNudge').hidden = true; toast('PIN saved. You can now log in on another phone.'); })
      .catch(function (e) { toast(dbHint(e), true); });
  };
  $('welcomeOk').onclick = function () { $('welcome').hidden = true; };
  $('swap').onclick = function () {
    if (currentUser && currentUser.is_anonymous && !confirm('You signed in with a username only. If you sign out, you cannot get this username or its Inbox back. Sign out anyway?')) return;
    authSignOut().then(function () { setGateMode('name'); showGate(); });
  };
  $('copy').onclick = function () {
    var b = $('copy');
    navigator.clipboard.writeText($('link').value).then(function () { b.textContent = 'Copied'; }, function () { $('link').select(); b.textContent = 'Select, copy'; });
    setTimeout(function () { b.textContent = 'Copy'; }, 1500);
  };

  /* ---------- detail view ---------- */
  function openD(id) {
    var m = cache[id]; if (!m) return;
    var hex = /^#[0-9a-f]{3,8}$/i.test(m.color), https = /^https:\/\//.test(m.color), col = hex ? m.color : '#27424F';
    var big = https ? '<img class="bigart" alt="" src="' + esc(m.color.replace('100x100', '600x600')) + '">' : '<span class="bigart" data-q="' + esc(m.song + ' ' + m.artist) + '" style="background:' + col + '"></span>';
    $('detail').innerHTML = '<button class="back" id="back">&larr; Back</button><h2 class="hi">Hello, ' + esc(m.to) + '</h2>' +
      '<p class="sub" style="text-align:center">' + (m.bot ? 'A song picked by the Anonymous bot.' : 'Someone sent you a song. They want you to hear this one.') + '</p>' +
      '<div class="dcard">' + big +
      '<div class="dinfo"><b>' + esc(m.song) + '</b><span>' + esc(m.artist) + '</span><em class="pv">30s preview</em></div>' + pbtn(m, ' circle') + '</div>' +
      '<p id="pnote" class="sub" style="text-align:center;min-height:1.2em"></p>' +
      '<p class="sub" style="text-align:center;margin-top:22px">Also, here is a message from the sender:</p><p class="hand">' + esc(m.text) + '</p>';
    SECS.forEach(function (x) { $(x).hidden = true; });
    $('tabs').hidden = true; $('detail').hidden = false; window.scrollTo(0, 0); hydrateArt();
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
      $('mqs').innerHTML = mqRow(rows[0], false) + mqRow(rows[1], true) + mqRow(rows[2], false); hydrateArt();
    });
  }
  function showHistory() { show($('hlist'), lget(SENT, []), 'Nothing sent from this device yet.', false); }
  document.addEventListener('click', function (e) { var g = e.target.closest('[data-go]'); if (g) tab(g.dataset.go); });
  $('homeLink').onclick = function () { tab('home'); };
  $('homeLink').onkeydown = function (e) { if (e.key === 'Enter') tab('home'); };

  /* ---------- small helpers: toast + anon headers ---------- */
  var toastT;
  function toast(msg, bad) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function fnHeaders() {
    var se = sessionGet(), h = { 'Content-Type': 'application/json', apikey: C.SUPABASE_KEY };
    if (se && se.access_token) h.Authorization = 'Bearer ' + se.access_token;
    else if (/^eyJ/.test(C.SUPABASE_KEY)) h.Authorization = 'Bearer ' + C.SUPABASE_KEY;
    return h;
  }
  var STATUS = { pending: 'Pending', in_progress: 'In progress', resolved: 'Resolved', draft: 'Draft', approved: 'Approved', archived: 'Archived' };
  function when(t) { try { return new Date(t).toLocaleString(); } catch (e) { return ''; } }

  /* ---------- support chat (public) ---------- */
  var chat = [], TIX = 'anon-tickets', busy = false;
  var CRISIS_TXT = C.CRISIS_TEXT || 'If you may be in danger, please reach out right now: call 911, or the NCMH Crisis Hotline at 1553 (mobile 0917-899-8727), or Hopeline at 0917-558-4673 (2919 is toll-free for Globe/TM). You can also tell a trusted adult near you.';
  function bub(role, text) { var d = document.createElement('div'); d.className = 'b ' + role; d.textContent = text; $('chatlog').appendChild(d); $('chatlog').scrollTop = 1e9; }
  function setBusy(b) { busy = b; $('chatsend').disabled = b; var t = $('typing'); if (t) { t.hidden = !b; if (b) $('chatlog').scrollTop = 1e9; } }
  function mySummary() {
    var u = chat.filter(function (m) { return m.role === 'user'; }).map(function (m) { return m.content; }).slice(-3).join(' ');
    return u.slice(0, 600);
  }
  function songChip(sg) {
    if (!sg || !sg.title) return;
    var q = encodeURIComponent(sg.title + ' ' + (sg.artist || '')), d = document.createElement('a');
    d.className = 'songchip'; d.target = '_blank'; d.rel = 'noopener'; d.href = 'https://open.spotify.com/search/' + q;
    d.textContent = 'Try listening: ' + String(sg.title).slice(0, 60) + (sg.artist ? ' by ' + String(sg.artist).slice(0, 40) : '');
    $('chatlog').appendChild(d); $('chatlog').scrollTop = 1e9;
  }
  var CHAT_ERR = {
    slow_down: 'You are sending messages quickly. Take a breath and try again in a minute.',
    busy: 'Support Buddy is resting for today because many people used it. You can still send your concern to a real person with the link below.',
    not_configured: 'The AI helper is not switched on yet. You can still send your concern to a real person with the link below.'
  };
  function sendChat(text) {
    var t = (typeof text === 'string' ? text : $('chatin').value).trim(); if (!t || busy) return;
    $('chatin').value = ''; $('chips').hidden = true; bub('me', t); chat.push({ role: 'user', content: t });
    if (!REMOTE) { bub('bot', 'The support chat needs the online database. Add your keys in config.js.'); return; }
    setBusy(true);
    fresh().then(function () { return fetch(C.SUPABASE_URL + '/functions/v1/support-chat', { method: 'POST', headers: fnHeaders(), body: JSON.stringify({ messages: chat.slice(-20) }) }); })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw d; return d; }); })
      .then(function (d) {
        chat.push({ role: 'assistant', content: d.reply }); bub('bot', d.reply); songChip(d.song);
        if (d.crisis) { $('crisisBox').textContent = CRISIS_TXT; $('crisisBox').hidden = false; }
        if (d.escalate) askConsent(d.summary || mySummary());
      })
      .catch(function (e) {
        bub('bot', (e && CHAT_ERR[e.error]) || 'I could not answer just now. Please try again in a moment, or send your concern to a real person with the link below.');
      }).then(function () { setBusy(false); });
  }
  function newChat() {
    chat = []; $('chatlog').innerHTML = ''; $('crisisBox').hidden = true; $('consent').hidden = true; $('chips').hidden = false;
    bub('bot', 'Hi, I am Support Buddy. I am an AI, not a therapist, so I can listen and share ideas, but I cannot diagnose or replace a real person. What is on your mind today?');
  }
  function askConsent(summary) {
    var c = $('consent'); c.hidden = false;
    c.innerHTML = '<b>Send this to the admin team?</b><p class="sub" style="margin:4px 0 8px">Only the text below will be shared, nothing else from this chat. Edit it if you like. It is not linked to your username.</p>' +
      '<textarea id="csum" maxlength="1500"></textarea><div class="row" style="margin-top:10px"><button class="btn" id="cyes">Yes, send it</button><button class="btn ghost" id="cno">No, keep it private</button></div>';
    $('csum').value = summary || '';
    $('cno').onclick = function () { c.hidden = true; bub('bot', 'Okay, nothing was shared. We can keep talking whenever you want.'); };
    $('cyes').onclick = function () {
      var txt = $('csum').value.trim(); if (txt.length < 5) { toast('Write a few words about your concern first.', true); return; }
      $('cyes').disabled = true;
      api('rpc/create_ticket', { method: 'POST', body: JSON.stringify({ p_summary: txt, p_consent: true }) }).then(function (r) {
        var a = lget(TIX, []); a.unshift({ no: r.ticket_no, code: r.code }); lset(TIX, a.slice(0, 20));
        c.hidden = true; bub('bot', 'Done. Your request #' + r.ticket_no + ' was sent to the admin team and is waiting for a reply. I cannot tell when someone will answer, but you can check below anytime.');
        refreshTix();
      }).catch(function (e) { $('cyes').disabled = false; toast(dbHint(e), true); });
    };
  }
  function refreshTix() {
    var a = lget(TIX, []); $('mytix').hidden = !a.length; if (!a.length || !REMOTE) return;
    Promise.all(a.map(function (t) { return api('rpc/ticket_status', { method: 'POST', body: JSON.stringify({ p_code: t.code }) }).catch(function () { return null; }); })).then(function (rs) {
      $('tixlist').innerHTML = rs.map(function (r, i) {
        if (!r) return '<p class="sub">Request #' + esc(a[i].no) + ': not found (it may have been deleted).</p>';
        return '<div class="tix"><b>Request #' + r.ticket_no + '</b> <span class="chip s-' + esc(r.status) + '">' + esc(STATUS[r.status]) + '</span>' +
          (r.admin_response ? '<p class="quote"><b>Reply from admin:</b> ' + esc(r.admin_response) + '</p>' : '<p class="sub" style="margin:6px 0 0">No reply yet.</p>') + '</div>';
      }).join('');
    });
  }
  $('chatsend').onclick = function () { sendChat(); };
  $('newchat').onclick = newChat;
  $('chips').onclick = function (e) { var b = e.target.closest('button'); if (b) sendChat(b.textContent); };
  $('chatin').onkeydown = function (e) { if (e.key === 'Enter') sendChat(); };
  $('human').onclick = function () { askConsent(mySummary()); };
  $('tixrefresh').onclick = refreshTix;
  newChat();


  /* ---------- boot ---------- */
  var h = location.hash.match(/(?:^#|&)to=([^&]+)/), redirecting = false;
  if (h) { redirecting = true; location.replace('send.html?to=' + h[1]); }      /* old personal links open the new link page */
  if (location.hash === '#admin') { redirecting = true; location.replace('admin.html'); }
  h = null;
  $('fine').textContent = REMOTE ? '' : 'Demo mode: data is saved on this device only. Connect Supabase to use real accounts and private Inbox access.';
  if (C.SUPPORT_EMAIL) { ['fb', 'fb2'].forEach(function (id) { $(id).href = 'mailto:' + C.SUPPORT_EMAIL + '?subject=Anonymous%20feedback'; $(id).hidden = false; }); $('fb2').style.display = 'block'; }

  function boot() {
    if (redirecting) return;
    if (!REMOTE) {
      profile = lget(US, '') ? { username: lget(US, '') } : null;
      setGateMode('name'); tab('home');
      return;
    }
    var sess = sessionGet();
    if (!sess || !sess.access_token) { setGateMode('name'); tab('home'); return; }
    fresh().then(authUser).then(function (u) {
      currentUser = u;
      return loadProfile();
    }).then(function (p) {
      profile = p;
      if (!profile) {
        profileSetup = true; setGateMode('name'); showGate();
        $('gateSub').textContent = 'You are signed in. Choose a username to finish.';
        return;
      }
      tab('home'); checkInbox(false);
    }).catch(function (e) {
      if (!(e && e.status && e.status >= 400 && e.status < 500)) { profile = null; setGateMode('name'); showGate(); $('cmsg').className = 'msg err'; $('cmsg').textContent = 'Could not reach the server. Check your connection and reload. You are not signed out.'; return; }
      sessionSet(null); currentUser = null; profile = null; setGateMode('name'); showGate();
    });
  }
  /* maintenance mode: the admin switches it in the Maintenance Center (admin.html) */
  if (REMOTE && !redirecting) api('settings?select=key,value').then(function (rows) {
    var st = {}; rows.forEach(function (x) { st[x.key] = x.value; });
    if (st.maintenance === 'true') { maint = st.maintenance_note || 'We will be right back.'; tab(cur); }
  }).catch(function () {});
  boot();

})();
