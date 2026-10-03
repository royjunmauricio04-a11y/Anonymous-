(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var REMOTE = !!(C.SUPABASE_URL && C.SUPABASE_KEY);
  var $ = function (i) { return document.getElementById(i); };
  var LS = 'anon-msgs', US = 'anon-user', SENT = 'anon-sent';
  var SECS = ['gate', 'maint', 'admin', 'home', 'submit', 'browse', 'mybox', 'history', 'support', 'detail'];
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

  function sessionGet() { try { return JSON.parse(sessionStorage.getItem(AUTH)) || null; } catch (e) { return null; } }
  function sessionSet(v) { try { if (v) sessionStorage.setItem(AUTH, JSON.stringify(v)); else sessionStorage.removeItem(AUTH); } catch (e) {} }

  function api(path, opt) {
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
    if (!REMOTE) {
      return Promise.resolve(lget(LS, []).filter(function (m) { return key ? (m.type !== 'public' && m.key === key) : m.type === 'public'; }));
    }
    var q = 'messages?select=id,to_name,to_key,delivery_type,body,song,artist,art,preview,is_bot,created_at&order=created_at.desc&limit=' + (key ? 100 : 50);
    q += key ? '&delivery_type=eq.direct&to_key=eq.' + encodeURIComponent(key) : '&delivery_type=eq.public';
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
  function claim(u) {
    u = u.trim();
    if (!/^[A-Za-z0-9._]{3,20}$/.test(u)) return Promise.reject({ msg: 'Use 3 to 20 letters, numbers, dot or underscore.' });
    if (!REMOTE) { lset(US, u); profile = { username: u }; return Promise.resolve(); }
    return rpc('claim_username', { p_username: u }).then(function (p) {
      profile = p || { username: u };
      lset(US, u);
    }).catch(function (e) {
      var msg = '';
      try { msg = JSON.parse(e.text).message || ''; } catch (x) {}
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
    }).catch(function (e) { $('feed').innerHTML = '<div class="empty">' + esc(dbHint(e)) + '</div>'; });
  }
  setInterval(function () { if (cur === 'browse' && !document.hidden) loadFeed(); }, 20000);


  function inbox() {
    var u = profile && profile.username, base = (C.SITE_URL || location.href).split('#')[0];
    $('who').hidden = !u;
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
    $('mine').innerHTML = '<div class="empty">Loading your private messages...</div>';
    fetchMsgs(u).then(function (a) {
      show($('mine'), a, 'No direct messages yet. Share your personal link so someone can send you one.', false);
    }).catch(function (e) {
      $('mine').innerHTML = '<div class="empty">' + esc(dbHint(e)) + '</div>';
    });
  }

  function finishGate(route) {
    profileSetup = false; $('cmsg').className = 'msg'; $('cmsg').textContent = '';
    $('gate').hidden = true;
    if (route === 'submit') tab('submit'); else tab('home');
  }

  var gateMode = 'login', profileSetup = false;
  function setGateMode(mode) {
    gateMode = mode;
    $('gateLogin').setAttribute('aria-selected', mode === 'login');
    $('gateCreate').setAttribute('aria-selected', mode === 'create');
    $('gateSub').textContent = mode === 'login' ? 'Sign in to send anonymously, receive messages, and keep your personal link.' : 'Create an account. Your name stays hidden when you send anonymously.';
    $('unWrap').hidden = mode !== 'create';
    $('claimBtn').textContent = mode === 'login' ? 'Sign in' : 'Create account';
    $('reuse').hidden = true;
  }
  $('gateLogin').onclick = function () { setGateMode('login'); };
  $('gateCreate').onclick = function () { setGateMode('create'); };
  $('claimBtn').onclick = function () {
    var email = $('email').value.trim(), pass = $('password').value, un = $('un').value.trim();
    var route = location.hash.indexOf('to=') > -1 ? 'submit' : 'home';
    $('claimBtn').disabled = true; $('cmsg').className = 'msg'; $('cmsg').textContent = 'Please wait...';
    if (!REMOTE) {
      if (gateMode === 'create') { if (!un) { $('cmsg').className = 'msg err'; $('cmsg').textContent = 'Choose a username.'; $('claimBtn').disabled = false; return; } lset(US, un); profile = { username: un }; finishGate(route); }
      else if (!lget(US, '')) { $('cmsg').className = 'msg err'; $('cmsg').textContent = 'Demo mode needs a username. Use Create account.'; $('claimBtn').disabled = false; return; }
      else { profile = { username: lget(US, '') }; finishGate(route); }
      $('claimBtn').disabled = false; return;
    }
    if (!email || !pass || pass.length < 6 || (gateMode === 'create' && !un)) {
      $('cmsg').className = 'msg err'; $('cmsg').textContent = gateMode === 'create' ? 'Enter email, password (6+ characters), and username.' : 'Enter your email and password.';
      $('claimBtn').disabled = false; return;
    }
    var op;
    if (profileSetup) {
      if (!un) { $('cmsg').className = 'msg err'; $('cmsg').textContent = 'Choose a username to finish your profile.'; $('claimBtn').disabled = false; return; }
      op = claim(un);
    } else if (gateMode === 'create') {
      op = authSignUp(email, pass).then(function (d) {
        if (!d.access_token) throw { msg: 'Account created. Check your email to confirm the account, then sign in.' };
        sessionSet({ access_token: d.access_token, refresh_token: d.refresh_token, user: d.user }); currentUser = d.user;
        return claim(un);
      });
    } else {
      op = authSignIn(email, pass).then(function (d) {
        sessionSet({ access_token: d.access_token, refresh_token: d.refresh_token, user: d.user }); currentUser = d.user;
        return loadProfile().then(function (p) {
          if (!p) {
            profileSetup = true; setGateMode('create'); $('unWrap').hidden = false; $('gateSub').textContent = 'Signed in. Choose a username to finish your profile.'; $('claimBtn').textContent = 'Create profile';
            throw { stop: true };
          }
        });
      });
    }
    op.then(function () { finishGate(route); })
      .catch(function (e) {
        if (e && e.stop) return;
        $('cmsg').className = 'msg err';
        var ad = e && e.data ? (e.data.msg || e.data.message || '') : '';
        $('cmsg').textContent = e.msg || ad || (e.status === 400 ? 'Email or password is incorrect, or the account needs email confirmation.' : dbHint(e));
        if (e && e.taken) $('reuse').hidden = false;
      }).then(function () { $('claimBtn').disabled = false; });
  };
  $('password').onkeydown = function (e) { if (e.key === 'Enter') $('claimBtn').click(); };
  $('email').onkeydown = function (e) { if (e.key === 'Enter') $('claimBtn').click(); };
  $('un').onkeydown = function (e) { if (e.key === 'Enter') $('claimBtn').click(); };
  $('swap').onclick = function () { authSignOut().then(showGate); };
  $('copy').onclick = function () {
    var b = $('copy');
    navigator.clipboard.writeText($('link').value).then(function () { b.textContent = 'Copied'; }, function () { $('link').select(); b.textContent = 'Select, copy'; });
    setTimeout(function () { b.textContent = 'Copy'; }, 1500);
  };

  /* ---------- detail view ---------- */
  function openD(id) {
    var m = cache[id]; if (!m) return;
    var hex = /^#[0-9a-f]{3,8}$/i.test(m.color), https = /^https:\/\//.test(m.color), col = hex ? m.color : '#27424F';
    var big = https ? '<img class="bigart" alt="" src="' + esc(m.color.replace('100x100', '600x600')) + '">' : '<span class="bigart" style="background:' + col + '"></span>';
    $('detail').innerHTML = '<button class="back" id="back">&larr; Back</button><h2 class="hi">Hello, ' + esc(m.to) + '</h2>' +
      '<p class="sub" style="text-align:center">' + (m.bot ? 'A song picked by the Anonymous bot.' : 'Someone sent you a song. They want you to hear this one.') + '</p>' +
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

  /* ---------- maintenance center (open the site with #admin) ---------- */
  var AP = '';
  function rpc(name, args) { return api('rpc/' + name, { method: 'POST', body: JSON.stringify(args) }); }
  function aFlash(t, bad) { var f = $('aflash'); if (f) { f.className = 'msg' + (bad ? ' err' : ''); f.textContent = t; } }
  function aErr(e) { aFlash(dbHint(e), true); }
  function aRefresh(note) {
    return rpc('admin_state', { p: AP }).then(function (st) {
      if (!st.ok) { AP = ''; $('alogin').hidden = false; $('apanel').hidden = true; $('amsg').textContent = 'Passcode no longer accepted.'; return; }
      adminRender(st); if (note) aFlash(note);
    }).catch(aErr);
  }
  function adminRender(st) {
    var s = st.settings || {}, on = s.bot_enabled === 'true', mt = s.maintenance === 'true';
    $('alogin').hidden = true; $('apanel').hidden = false;
    $('apanel').innerHTML =
      '<p id="aflash" class="msg" role="status"></p>' +
      '<div class="box"><h3>Bot</h3><p class="who">' + (on ? 'Running' : 'Stopped') + '</p>' +
      '<p class="sub">Posts one message from its pool every ' + esc(s.bot_interval_min) + ' min. Its posts carry a Bot stamp.</p>' +
      '<label for="aiv">Post every</label><select id="aiv">' + [5, 15, 30, 60, 180, 720].map(function (m) { return '<option value="' + m + '"' + (String(m) === s.bot_interval_min ? ' selected' : '') + '>' + m + ' min</option>'; }).join('') + '</select>' +
      '<div class="row" style="margin-top:14px"><button class="btn" id="abot">' + (on ? 'Stop bot' : 'Start bot') + '</button><button class="btn ghost" id="anow">Post one now</button></div>' +
      '<button class="link" id="adel">Delete all bot posts (' + st.bots + ')</button></div>' +
      '<div class="box" style="margin-top:16px"><h3>Maintenance mode</h3><p class="sub">' + (mt ? 'ON: visitors see the maintenance screen.' : 'OFF: the app is open to everyone.') + '</p>' +
      '<label for="anote">Message for visitors</label><input id="anote" maxlength="200" value="' + esc(s.maintenance_note || '') + '">' +
      '<button class="btn full" id="amt">' + (mt ? 'Turn maintenance off' : 'Turn maintenance on') + '</button></div>' +
      '<div class="box" style="margin-top:16px"><h3>Numbers</h3><p style="margin:0">' + st.users + ' usernames, ' + st.messages + ' messages (' + st.bots + ' from the bot), ' + st.pool + ' in the bot pool.</p></div>' +
      '<h2 class="sec">Recent messages</h2><div id="arecent"></div>';
    $('abot').onclick = function () { rpc('admin_set', { p: AP, k: 'bot_enabled', v: on ? 'false' : 'true' }).then(function () { return aRefresh(on ? 'Bot stopped.' : 'Bot started.'); }).catch(aErr); };
    $('aiv').onchange = function () { rpc('admin_set', { p: AP, k: 'bot_interval_min', v: $('aiv').value }).then(function () { return aRefresh('Interval saved.'); }).catch(aErr); };
    $('anow').onclick = function () { rpc('admin_post_now', { p: AP }).then(function () { return aRefresh('Posted one message.'); }).catch(aErr); };
    $('adel').onclick = function () { if (!confirm('Delete all bot posts?')) return; rpc('admin_delete_bots', { p: AP }).then(function (n) { return aRefresh('Deleted ' + n + ' bot posts.'); }).catch(aErr); };
    $('amt').onclick = function () {
      rpc('admin_set', { p: AP, k: 'maintenance_note', v: $('anote').value }).then(function () { return rpc('admin_set', { p: AP, k: 'maintenance', v: mt ? 'false' : 'true' }); })
        .then(function () { return aRefresh(mt ? 'Maintenance is off.' : 'Maintenance is on.'); }).catch(aErr);
    };
    rpc('admin_recent', { p: AP }).then(function (list) {
      $('arecent').innerHTML = list.length ? list.map(function (m) {
        return '<div class="box" style="margin-bottom:10px;padding:14px"><b>To: ' + esc(m.to_name) + '</b>' + (m.is_bot ? ' <span class="stamp">Bot</span>' : '') +
          '<p style="margin:6px 0;color:var(--muted)">' + esc(m.body) + '</p><button class="link" data-del="' + esc(m.id) + '">Delete</button></div>';
      }).join('') : '<div class="empty">No messages yet.</div>';
    }).catch(function () {});
  }
  $('aOpen').onclick = function () {
    if (!REMOTE) { $('amsg').textContent = 'Connect Supabase first (config.js).'; return; }
    AP = $('apass').value; $('amsg').textContent = '';
    rpc('admin_state', { p: AP }).then(function (st) {
      if (!st.ok) { AP = ''; $('amsg').textContent = 'Wrong passcode, or locked for 5 minutes after too many tries.'; return; }
      adminRender(st);
    }).catch(function (e) { AP = ''; $('amsg').textContent = dbHint(e); });
  };
  $('apass').onkeydown = function (e) { if (e.key === 'Enter') $('aOpen').click(); };
  document.addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]'); if (!d || !confirm('Delete this message for good?')) return;
    rpc('admin_delete_msg', { p: AP, mid: d.dataset.del }).then(function () { return aRefresh('Message deleted.'); }).catch(aErr);
  });
  window.addEventListener('hashchange', function () { if (location.hash === '#admin') tab('admin'); });

  /* ---------- boot ---------- */
  var h = location.hash.match(/(?:^#|&)to=([^&]+)/);
  if (h) {
    try {
      $('to').value = decodeURIComponent(h[1]);
      $('toLabel').textContent = 'Sending to';
      $('to').placeholder = 'Recipient username';
      $('to').readOnly = true;
      $('directHead').hidden = false;
      $('directTitle').textContent = 'Send an anonymous message to @' + decodeURIComponent(h[1]);
      $('sendHint').textContent = 'This is a direct anonymous message. Only the owner of this personal link can see it in their Inbox.';
      $('warn').textContent = 'You are sending privately through this person’s personal link.';
    } catch (e) {}
  }
  $('fine').textContent = REMOTE ? '' : 'Demo mode: data is saved on this device only. Connect Supabase to use real accounts and private Inbox access.';
  if (C.SUPPORT_EMAIL) { ['fb', 'fb2'].forEach(function (id) { $(id).href = 'mailto:' + C.SUPPORT_EMAIL + '?subject=Anonymous%20feedback'; $(id).hidden = false; }); $('fb2').style.display = 'block'; }

  function boot() {
    if (!REMOTE) {
      profile = lget(US, '') ? { username: lget(US, '') } : null;
      setGateMode('create');
      tab(location.hash === '#admin' ? 'admin' : (h ? 'submit' : 'home'));
      return;
    }
    var sess = sessionGet();
    if (!sess || !sess.access_token) {
      setGateMode('login');
      tab(location.hash === '#admin' ? 'admin' : (h ? 'submit' : 'home'));
      return;
    }
    authUser().then(function (u) {
      currentUser = u;
      return loadProfile();
    }).then(function (p) {
      profile = p;
      if (!profile) {
        profileSetup = true;
        setGateMode('create');
        showGate();
        $('unWrap').hidden = false;
        $('gateSub').textContent = 'Your account is signed in. Choose a username to finish your profile.';
        $('claimBtn').textContent = 'Create profile';
        return;
      }
      tab(location.hash === '#admin' ? 'admin' : (h ? 'submit' : 'home'));
    }).catch(function () {
      sessionSet(null); currentUser = null; profile = null; setGateMode('login'); showGate();
    });
  }
  boot();

})();
