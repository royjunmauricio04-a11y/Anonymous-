(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var REMOTE = !!(C.SUPABASE_URL && C.SUPABASE_KEY);
  var $ = function (i) { return document.getElementById(i); };
  var LS = 'anon-msgs', US = 'anon-user', SENT = 'anon-sent';
  var SECS = ['gate', 'maint', 'home', 'submit', 'browse', 'mybox', 'profile', 'history', 'detail'];
  var cache = {}, cur = 'submit', pick = null, last = [], tmr, seen = {}, feedReady = false;
  var CAT = [
    ["Tingin", "Cup of Joe, Janine", "#3F6B55"],
    ["Sana", "I Belong to the Zoo", "#2C3E75"],
    ["Lucky", "Jason Mraz, Colbie Caillat", "#9C8F7A"],
    ["stranger", "Olivia Rodrigo", "#5B3A8C"],
    ["Binibini", "Zack Tabudlo", "#D4547A"],
    ["Perfect", "Ed Sheeran", "#D9A441"],
    ["Babylon", "Taylor Swift", "#1A1A2E"],
    ["Heather", "Conan Gray", "#6B4E71"],
    ["Die With A Smile", "Lady Gaga, Bruno Mars", "#C44569"],
    ["Multo", "Cup of Joe", "#2E5A4C"],
    ["Pagsamo", "Arthur Nery", "#4A6FA5"],
    ["Iris", "Goo Goo Dolls", "#3D5A80"],
    ["Kathang Isip", "Ben&Ben", "#C9822B"],
    ["Mundo", "IV Of Spades", "#B5452F"],
    ["Tadhana", "Up Dharma Down", "#3B5A6B"],
    ["Ere", "Juan Karlos", "#7A3E5C"],
    ["Raining in Manila", "Lola Amour", "#35506E"],
    ["Sining", "Dionela, Jay R", "#8A4B8C"],
    ["Pantropiko", "BINI", "#E5734B"],
    ["Mahika", "Adie, Janine Berdin", "#4C7A6A"],
    ["Someone You Loved", "Lewis Capaldi", "#4A4E69"],
    ["Dilaw", "Maki", "#D9A441"],
    ["Yellow", "Coldplay", "#D9B441"],
    ["Photograph", "Ed Sheeran", "#5E6B73"]
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s).trim().toLowerCase(); }
  function lget(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function lset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- auth + data layer ---------- */
  var AUTH = 'anon-auth', currentUser = null, profile = null;

  function dbHint(e) {
    if (!e || !e.status) return 'Could not reach the server. Check your connection and try again.';
    var code = '', msg = ''; try { var j = JSON.parse(e.text); code = j.code || ''; msg = j.msg || j.message || ''; } catch (x) {}
    try { console.warn('[anonymous] request failed', e.status, code, msg); } catch (x2) {}
    if (e.status === 300 || code === 'PGRST203') return 'Posting has a problem on our side. Please try again later.';
    if (msg === 'blocked_content') return 'That message has a word that is not allowed here. Please change it and try again.';
    if (msg === 'blocked_sender') return 'This person is not accepting messages from you.';
    if (msg === 'rate_limited') return 'You are sending too fast. Please try again in a while.';
    if (code === 'PGRST202') return 'This feature is not ready yet. Please try again later.';
    if (code === '42501' || e.status === 401 || e.status === 403) return 'Please log in again to do that.';
    if (code === '23505') return 'That username or account is already in use.';
    if (msg && /username/i.test(msg)) return msg;
    if (msg && /recipient/i.test(msg)) return 'That personal link is not connected to an account.';
    if (code === 'PGRST205' || code === '42P01' || e.status === 404) return 'Something is not set up on our side yet. Please try again later.';
    if (e.status >= 500) return 'The server is busy right now. Please try again in a moment.';
    return 'Something went wrong (' + e.status + '). Please try again.';
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

  /* CARDMODE: 'id' = posts point to a shared design (messages.card_id), 'inline' = old database that stored the whole design on each post, 'none' = no design columns at all */
  var CARDMODE = 'id', NOUSECARD = false, cardStore = {}, cardBusy = {};
  function fromRow(r) {
    return { id: r.id, to: r.to_name, key: r.to_key, type: r.delivery_type || 'direct', text: r.body, song: r.song, artist: r.artist, color: r.art || '', prev: r.preview || '', bot: !!r.is_bot, card: r.card || null, cardId: r.card_id || null, parent: r.parent_id || null, t: Date.parse(r.created_at) || 0, ts: r.created_at || '' };
  }
  function matchQ(m, q) {
    q = String(q || '').toLowerCase(); if (!q) return true;
    return (String(m.to) + ' ' + m.text + ' ' + m.song + ' ' + m.artist).toLowerCase().indexOf(q) > -1;
  }
  function fetchMsgs(key, before, search) {
    key = key ? String(key).trim().toLowerCase() : '';
    if (!REMOTE) {
      return Promise.resolve(lget(LS, []).filter(function (m) { return key ? (m.type !== 'public' && String(m.key).toLowerCase() === key) : m.type === 'public'; }).filter(function (m) { return matchQ(m, search); }));
    }
    var q = 'messages?select=id,to_name,to_key,delivery_type,body,song,artist,art,preview,is_bot,parent_id,created_at' + (CARDMODE === 'id' ? ',card_id' : CARDMODE === 'inline' ? ',card' : '') + '&order=created_at.desc&limit=' + (key ? 100 : 50);
    /* Inbox: the database only ever returns direct messages addressed to the signed-in account */
    q += key ? '&delivery_type=eq.direct' : '&delivery_type=eq.public';
    if (before) q += '&created_at=lt.' + encodeURIComponent(before);
    var sq = search ? String(search).replace(/[(),*%\\"]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (sq) { var pat = '*' + sq + '*'; q += '&or=' + encodeURIComponent('(to_name.ilike.' + pat + ',body.ilike.' + pat + ',song.ilike.' + pat + ',artist.ilike.' + pat + ')'); }
    return api(q).then(function (rows) { return rows.map(fromRow); }).catch(function (e) {
      var t = String((e && e.text) || '');
      if (CARDMODE === 'id' && /card_id/.test(t)) { CARDMODE = 'inline'; try { console.warn('[anonymous] messages.card_id is missing: run card-share-upgrade.sql'); } catch (x) {} return fetchMsgs(key, before, search); }
      if (CARDMODE === 'inline' && /card/.test(t) && /column|42703|PGRST204/.test(t)) { CARDMODE = 'none'; try { console.warn('[anonymous] messages.card is missing: run profile-upgrade.sql'); } catch (x) {} return fetchMsgs(key, before, search); }
      throw e;
    });
  }
  function saveMsg(m) {
    if (!REMOTE) { var a = lget(LS, []); a.unshift(m); lset(LS, a); return Promise.resolve(m); }
    var payload = {
      p_type: m.type,
      p_to_name: m.to,
      p_to_key: m.key,
      p_body: m.text,
      p_song: m.song,
      p_artist: m.artist,
      p_art: m.color,
      p_preview: m.prev
    };
    /* always send p_parent_id: only the 9-argument send_message can match, so PostgREST never answers HTTP 300 */
    payload.p_parent_id = m.parent || null;
    var useCard = lget('anon-card-send', true) !== false;
    var call = function () {
      var p = Object.assign({}, payload);
      if (!NOUSECARD) p.p_use_card = useCard;
      return rpc('send_message', p).catch(function (e) {
        /* old database (no p_use_card yet): send the old way once */
        if (!NOUSECARD && e && (e.status === 404 || e.status === 300 || /PGRST20|function/i.test(String(e.msg || e.message || e.code || '')))) { NOUSECARD = true; return call(); }
        throw e;
      });
    };
    return call().then(function (id) {
      if (NOUSECARD && useCard && profile && profile.card) setTimeout(function () { toast('Posted, but your card design could not be attached. Ask the site owner to run profile-upgrade.sql.', true); }, 1400);
      /* server returns the real UUID — keep it so reactions work later */
      if (id && (typeof id === 'string' || typeof id === 'number')) m.id = String(id).replace(/^"|"$/g, '');
      return m;
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

  /* ---------- small helpers: time ago, loading skeletons ---------- */
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }
  function skel(n) { var h = ''; for (var i = 0; i < n; i++) h += '<div class="skel-card" aria-hidden="true"></div>'; return '<div role="status" aria-label="Loading">' + h + '</div>'; }

  /* a thin bar under the top bar: used for the announcement and for "you are offline" */
  function topBar(id, cls) {
    var el = $(id);
    if (!el) {
      el = document.createElement('div'); el.id = id; el.className = cls; el.setAttribute('role', 'status'); el.hidden = true;
      var tb = document.querySelector('.topbar');
      if (tb && tb.parentNode) tb.parentNode.insertBefore(el, tb.nextSibling); else document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }
  function netBar() {
    var off = navigator.onLine === false, el = topBar('netbar', 'netbar');
    el.textContent = 'You are offline. Showing what was loaded earlier.'; el.hidden = !off;
  }
  window.addEventListener('offline', netBar);
  window.addEventListener('online', function () { netBar(); try { if (cur === 'browse') loadFeed(); checkInbox(false); } catch (e) {} });
  netBar();

  /* hide the floating help button while typing, so it never covers the keyboard or the Send button */
  function isField(el) { return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName); }
  document.addEventListener('focusin', function (e) { if (isField(e.target)) document.body.classList.add('kb-open'); });
  document.addEventListener('focusout', function () {
    setTimeout(function () { if (!isField(document.activeElement)) document.body.classList.remove('kb-open'); }, 80);
  });

  /* ---------- writing helpers: draft, counter, starters, surprise, daily prompt ---------- */
  var TEXT_PH = 'Write it here. Your name stays hidden.', DRAFT = 'anon-draft', draftT, lastSent = null;
  function clearDraft() { clearTimeout(draftT); try { localStorage.removeItem(DRAFT); } catch (e) {} }
  function saveDraft() {
    clearTimeout(draftT);
    draftT = setTimeout(function () {
      if (/(?:^#|&)to=/.test(location.hash)) return;
      var d = { to: $('to').value, text: $('text').value, t: Date.now() };
      if (!d.to.trim() && !d.text.trim()) { clearDraft(); return; }
      lset(DRAFT, d);
    }, 400);
  }
  function restoreDraft() {
    if (/(?:^#|&)to=/.test(location.hash)) return;
    var d = lget(DRAFT, null);
    if (!d || !d.t || Date.now() - d.t > 3 * 86400000) return;
    if (!$('to').value && !$('text').value) { $('to').value = d.to || ''; $('text').value = d.text || ''; }
  }
  function updCount() {
    var c = $('count'); if (!c) return;
    var n = $('text').value.length;
    c.textContent = n > 200 ? n + ' / 5000' : ''; c.className = 'count' + (n > 4500 ? ' warn' : '');
  }
  $('text').addEventListener('input', function () { updCount(); saveDraft(); $('sentActions').hidden = true; });
  $('to').addEventListener('input', function () { saveDraft(); $('sentActions').hidden = true; });

  var STARTERS = [['Sorry', 'Sorry for '], ['Thank you', 'Thank you for '], ['I miss you', 'I miss '], ['Pasensya na', 'Pasensya na sa '], ['Salamat', 'Salamat sa '], ['Crush kita', 'Crush kita kasi '], ['I forgive you', 'I forgive you for ']];
  $('promptChips').innerHTML = STARTERS.map(function (x, i) { return '<button type="button" data-i="' + i + '">' + esc(x[0]) + '</button>'; }).join('');
  $('promptChips').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var st = STARTERS[+b.dataset.i][1], t = $('text'), v = t.value;
    t.value = v.trim() ? v.replace(/\s*$/, ' ') + st : st;
    t.focus(); try { t.setSelectionRange(t.value.length, t.value.length); } catch (x) {}
    updCount(); saveDraft();
  };
  $('surprise').onclick = function () {
    var pool = CAT.filter(function (x) { return !pick || x[0] !== pick[0]; }), x = pool[Math.floor(Math.random() * pool.length)];
    pick = [x[0], x[1], x[2], '']; $('res').hidden = true; $('q').value = ''; $('q').hidden = true; renderPicked();
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
  };

  var PROMPTS = [
    'Who deserves a “sorry” you never said?', 'Sino ang hindi mo nasabihan ng salamat?', 'What song reminds you of someone you lost touch with?',
    'Sino ang namimiss mo ngayon?', 'Write to the version of you from five years ago.', 'What do you wish you said at the last goodbye?',
    'Who made your hard days lighter?', 'Sino ang crush mong hindi mo kayang aminin?', 'What would you tell your first love today?',
    'Who do you forgive, even if they never asked?', 'Anong kantang hindi mo na kayang pakinggan ngayon, at bakit?', 'Who believed in you before you believed in yourself?',
    'What do you want a friend to know but cannot say out loud?', 'Sino ang gusto mong batiin kahit hindi na kayo okay?', 'Tell someone why you are proud of them.',
    'What do you miss most about home?', 'Sino ang nagparamdam sa’yo na sapat ka?', 'Write to someone who is having a hard time right now.',
    'What would you say to someone you ghosted?', 'Who in your family never heard you say “I love you”?', 'What song would you dedicate to a stranger?',
    'Sino ang gusto mong balikan, kahit sandali lang?', 'Thank someone who stayed.', 'What would you apologize for, if you were braver?',
    'Who taught you something you never thanked them for?', 'What do you hope for someone you love?', 'Sino ang iniisip mo kapag tumutugtog ang paborito mong kanta?',
    'Who needs to hear “it is not your fault”?', 'Sino ang naging bahay mo noong wala kang matakbuhan?', 'What is the kindest thing someone did that they never knew about?'
  ], promptShift = 0;
  function paintPrompt() {
    var d = new Date(), day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    $('dailyQ').textContent = PROMPTS[(day + promptShift) % PROMPTS.length];
  }
  $('dailyShuffle').onclick = function () { promptShift++; paintPrompt(); };
  $('dailyGo').onclick = function () {
    var q = $('dailyQ').textContent;
    tab('submit'); $('text').placeholder = q;
    setTimeout(function () { if (!$('submit').hidden) $('to').focus(); }, 60);
  };
  paintPrompt();

  /* ---------- share a note as a picture (for stories and chats) ---------- */
  function hashColor(str) {
    var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return ['#E5334B', '#5B3A8C', '#2C3E75', '#3F6B55', '#C44569', '#1F6FEB', '#9C6B30', '#7A3E5C'][Math.abs(h) % 8];
  }
  function shade(hex, a) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, t = a < 0 ? 0 : 255, p = Math.abs(a);
    return 'rgb(' + Math.round((t - r) * p + r) + ',' + Math.round((t - g) * p + g) + ',' + Math.round((t - b) * p + b) + ')';
  }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function wrapLines(g, text, maxW) {
    var words = String(text).replace(/\s+/g, ' ').trim().split(' '), lines = [], line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }
  /* the song's cover picture (m.color holds the https art link). Resolves null when it cannot be loaded: the card then shows the music note */
  function loadArt(m) {
    var u = String(m.color || m.art || '');
    if (!/^https:\/\//.test(u)) return Promise.resolve(null);
    u = u.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)/, '/600x600bb.$2');
    return new Promise(function (res) {
      var im = new Image(), done = function (v) { clearTimeout(t); res(v); }, t = setTimeout(function () { res(null); }, 7000);
      im.crossOrigin = 'anonymous';
      im.onload = function () { done(im.naturalWidth ? im : null); };
      im.onerror = function () { done(null); };
      im.src = u;
    });
  }
  /* shared dark-plum backdrop (message card + link card) */
  function plumBg(g, W, H) {
    var bg = g.createLinearGradient(0, 0, W * .5, H); bg.addColorStop(0, '#2B1236'); bg.addColorStop(.55, '#150B24'); bg.addColorStop(1, '#0B0613');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    [[.12, .22, 420, 'rgba(229,51,75,.30)'], [.92, .62, 460, 'rgba(255,138,76,.20)'], [.2, .9, 380, 'rgba(120,80,220,.22)']].forEach(function (o) {
      var r = g.createRadialGradient(W * o[0], H * o[1], 0, W * o[0], H * o[1], o[2]); r.addColorStop(0, o[3]); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, W, H);
    });
    g.fillStyle = 'rgba(255,255,255,.10)'; g.textAlign = 'center';
    [[130, 330, 90, -14], [930, 420, 70, 12], [980, 1500, 110, 10], [90, 1560, 80, -10], [860, 250, 60, 8], [200, 1700, 64, 14]].forEach(function (n) {
      g.save(); g.translate(n[0], n[1]); g.rotate(n[3] * Math.PI / 180); g.font = '700 ' + n[2] + 'px system-ui, sans-serif'; g.fillText('♪', 0, 0); g.restore();
    });
  }
  /* a received (or sent) note as a picture: message in the middle, the song with its cover under it.
     Everything sits inside the middle 1080x1080 (y 420-1500) so story, square and 4:5 crops all keep the whole card. */
  function cardBlob(m, art) {
    var W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'), SANS = '"Plus Jakarta Sans", system-ui, sans-serif', HAND = 'Caveat, "Segoe Script", cursive';
    var base = /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : hashColor(String(m.song) + String(m.artist));
    plumBg(g, W, H);
    var x0 = 90, cw = 900, y0 = 450, ch = 950, hh = 290;
    g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 80; g.shadowOffsetY = 30; g.fillStyle = '#FFF9F4'; rrect(g, x0, y0, cw, ch, 64); g.fill(); g.restore();
    /* header */
    g.save(); rrect(g, x0, y0, cw, ch, 64); g.clip();
    var hg = g.createLinearGradient(x0, y0, x0 + cw, y0 + hh); hg.addColorStop(0, '#E5334B'); hg.addColorStop(.55, '#FF6A4C'); hg.addColorStop(1, '#FFB34D');
    g.fillStyle = hg; g.fillRect(x0, y0, cw, hh);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(x0 + cw - 40, y0 + 20, 180, 0, 7); g.fill(); g.beginPath(); g.arc(x0 + 30, y0 + hh, 110, 0, 7); g.fill();
    g.restore();
    drawMask(g, x0 + 44, y0 + 40, 70, '#fff', '#E5334B');
    g.fillStyle = 'rgba(0,0,0,.22)'; rrect(g, x0 + cw - 44 - 190, y0 + 40, 190, 58, 29); g.fill();
    g.fillStyle = '#fff'; g.font = '700 30px ' + SANS; g.textAlign = 'center'; g.fillText('From: ???', x0 + cw - 44 - 95, y0 + 79);
    g.save(); g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 12; g.shadowOffsetY = 4; g.fillStyle = '#fff';
    g.font = '700 84px ' + HAND; g.fillText('a song for', W / 2, y0 + 175);
    var to = String(m.to || 'you'), ts = 112; g.font = '700 ' + ts + 'px ' + HAND;
    while (g.measureText(to).width > 780 && ts > 52) { ts -= 6; g.font = '700 ' + ts + 'px ' + HAND; }
    while (g.measureText(to).width > 780 && to.length > 4) to = to.slice(0, -2) + '…';
    g.fillText(to, W / 2, y0 + 262); g.restore();
    /* message (shrinks to fit, centred) */
    var my = y0 + hh + 40, mh = 380, size = 96, lines;
    for (; size >= 44; size -= 4) {
      g.font = '700 ' + size + 'px ' + HAND; lines = wrapLines(g, m.text, 780);
      if (lines.length * size * 1.1 <= mh) break;
    }
    if (lines.length * size * 1.1 > mh) {
      var cap = Math.max(1, Math.floor(mh / (size * 1.1)));
      lines = lines.slice(0, cap); lines[cap - 1] = lines[cap - 1].replace(/\s*\S*$/, '') + '…';
    }
    g.fillStyle = '#17171A'; g.font = '700 ' + size + 'px ' + HAND;
    var used = lines.length * size * 1.1, ty = my + (mh - used) / 2;
    lines.forEach(function (ln, i) { g.fillText(ln, W / 2, ty + size * .85 + i * size * 1.1); });
    /* song panel */
    var px = x0 + 40, pw = cw - 80, py = y0 + ch - 40 - 190, ph = 190;
    g.fillStyle = '#F1E9E1'; rrect(g, px, py, pw, ph, 40); g.fill();
    var ax = px + 30, ay = py + 30, as = 130;
    g.fillStyle = shade(base, -.25); rrect(g, ax, ay, as, as, 26); g.fill();
    if (art) { g.save(); rrect(g, ax, ay, as, as, 26); g.clip(); g.drawImage(art, ax, ay, as, as); g.restore(); }
    else { g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '700 70px system-ui, sans-serif'; g.fillText('♪', ax + as / 2, ay + 92); }
    var tx = ax + as + 28, tw = px + pw - 30 - 84 - 24 - tx;
    function fit(txt, font) { g.font = font; if (g.measureText(txt).width <= tw) return txt; while (g.measureText(txt + '…').width > tw && txt.length > 3) txt = txt.slice(0, -1); return txt + '…'; }
    g.textAlign = 'left';
    g.fillStyle = '#17171A'; g.fillText(fit(String(m.song), '800 46px ' + SANS), tx, py + 92);
    g.fillStyle = '#6B6B74'; g.fillText(fit(String(m.artist), '500 34px ' + SANS), tx, py + 142);
    var cx = px + pw - 30 - 42, cy = py + ph / 2, pg = g.createLinearGradient(cx - 42, cy - 42, cx + 42, cy + 42); pg.addColorStop(0, '#E5334B'); pg.addColorStop(1, '#FF8A4C');
    g.fillStyle = pg; g.beginPath(); g.arc(cx, cy, 42, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx - 11, cy - 18); g.lineTo(cx - 11, cy + 18); g.lineTo(cx + 19, cy); g.closePath(); g.fill();
    /* brand under the card */
    g.textAlign = 'left'; drawMask(g, W / 2 - 150, 1428, 54, '#fff', '#2B1236');
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '800 44px ' + SANS; g.fillText('Anonymous', W / 2 - 84, 1469); g.textAlign = 'center';
    return new Promise(function (res) { cv.toBlob(res, 'image/png'); });
  }
  function shareCard(m, btn) {
    if (!m) return;
    var old = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = 'Making your image...'; }
    var fonts = (document.fonts && document.fonts.load) ? Promise.all([document.fonts.load('700 80px Caveat'), document.fonts.load('800 40px "Plus Jakarta Sans"')]).catch(function () {}) : Promise.resolve();
    fonts.then(function () { return loadArt(m); }).then(function (art) { return cardBlob(m, art); }).then(function (blob) {
      if (!blob) throw 0;
      var file; try { file = new File([blob], 'anonymous-note.png', { type: 'image/png' }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: 'Anonymous', text: 'Say it with a song' }).catch(function () {});
      }
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'anonymous-note.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      toast('Image saved. Post it on your story.');
    }).catch(function () { toast('Could not make the image. Try again.', true); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = old; } });
  }

  /* ---------- link sticker for stories (our own design, no third-party logos or artwork) ---------- */
  function drawMask(g, x, y, w, color, eye) {
    g.save(); g.translate(x, y); g.scale(w / 40, w / 40);
    g.fillStyle = color; g.fill(new Path2D('M2 8c6-4 12-4 18-1 6-3 12-3 18 1 0 8-5 13-10 13-4 0-6-3-8-3s-4 3-8 3C7 21 2 16 2 8z'));
    g.fillStyle = eye; g.beginPath(); g.ellipse(12.5, 12, 4.2, 2.6, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(27.5, 12, 4.2, 2.6, 0, 0, 7); g.fill();
    g.restore();
  }
  function loadImg(src) {
    return new Promise(function (res) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(src || '')) return res(null);
      var im = new Image(); im.onload = function () { res(im.naturalWidth ? im : null); }; im.onerror = function () { res(null); }; im.src = src;
    });
  }
  function storyBlob(user, link, av) {
    var W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'), SANS = '"Plus Jakarta Sans", system-ui, sans-serif', HAND = 'Caveat, "Segoe Script", cursive';
    plumBg(g, W, H);
    /* the card */
    var x0 = 90, cw = 900, y0 = 470, ch = 900, hh = 400;
    g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 80; g.shadowOffsetY = 30; g.fillStyle = '#FFF9F4'; rrect(g, x0, y0, cw, ch, 64); g.fill(); g.restore();
    g.save(); rrect(g, x0, y0, cw, ch, 64); g.clip();
    var hg = g.createLinearGradient(x0, y0, x0 + cw, y0 + hh); hg.addColorStop(0, '#E5334B'); hg.addColorStop(.55, '#FF6A4C'); hg.addColorStop(1, '#FFB34D');
    g.fillStyle = hg; g.fillRect(x0, y0, cw, hh);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(x0 + cw - 40, y0 + 30, 190, 0, 7); g.fill(); g.beginPath(); g.arc(x0 + 40, y0 + hh - 10, 120, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.22)'; g.font = '700 120px system-ui, sans-serif'; g.fillText('♫', x0 + 90, y0 + 150);
    g.restore();
    drawMask(g, W / 2 - 38, y0 + 38, 76, '#fff', '#E5334B');
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 104px ' + HAND; g.save(); g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 12; g.shadowOffsetY = 4;
    g.fillText('send me an', W / 2, y0 + 185); g.fillText('anonymous song', W / 2, y0 + 275); g.restore();
    /* avatar on the seam */
    var ar = 92, ay = y0 + hh;
    g.fillStyle = '#FFF9F4'; g.beginPath(); g.arc(W / 2, ay, ar + 14, 0, 7); g.fill();
    g.save(); g.beginPath(); g.arc(W / 2, ay, ar, 0, 7); g.clip();
    if (av) { var s = Math.max(2 * ar / av.width, 2 * ar / av.height), dw = av.width * s, dh = av.height * s; g.drawImage(av, W / 2 - dw / 2, ay - dh / 2, dw, dh); }
    else { var ag = g.createLinearGradient(W / 2 - ar, ay - ar, W / 2 + ar, ay + ar); ag.addColorStop(0, '#E5334B'); ag.addColorStop(1, '#FF8A4C'); g.fillStyle = ag; g.fillRect(W / 2 - ar, ay - ar, 2 * ar, 2 * ar);
      g.fillStyle = '#fff'; g.font = '800 96px ' + SANS; g.textBaseline = 'middle'; g.fillText(String(user).charAt(0).toUpperCase(), W / 2, ay + 6); g.textBaseline = 'alphabetic'; }
    g.restore();
    /* name + line */
    g.fillStyle = '#17171A'; var nm = '@' + user, ns = 62; g.font = '800 ' + ns + 'px ' + SANS; while (g.measureText(nm).width > 760 && ns > 30) { ns -= 3; g.font = '800 ' + ns + 'px ' + SANS; }
    g.fillText(nm, W / 2, ay + ar + 86);
    g.fillStyle = '#6B6B74'; g.font = '500 36px ' + SANS;
    wrapLines(g, 'Pick a song, write a message. I will never know it was you.', 700).forEach(function (ln, i) { g.fillText(ln, W / 2, ay + ar + 150 + i * 50); });
    /* link pill */
    var px = x0 + 50, pw = cw - 100, py = y0 + ch - 160, ph = 100;
    g.fillStyle = '#17171A'; rrect(g, px, py, pw, ph, 50); g.fill();
    var pg = g.createLinearGradient(px, py, px + ph, py + ph); pg.addColorStop(0, '#E5334B'); pg.addColorStop(1, '#FF8A4C');
    g.fillStyle = pg; g.beginPath(); g.arc(px + 50, py + 50, 36, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '700 40px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText('♪', px + 50, py + 53);
    var lk = String(link).replace(/^https?:\/\//, ''), ls = 38; g.textAlign = 'left'; g.font = '700 ' + ls + 'px ' + SANS;
    while (g.measureText(lk).width > pw - 150 && ls > 28) { ls -= 2; g.font = '700 ' + ls + 'px ' + SANS; }
    while (g.measureText(lk).width > pw - 150 && lk.length > 8) lk = lk.slice(0, -2) + '\u2026';
    g.fillStyle = '#fff'; g.fillText(lk, px + 110, py + 52); g.textBaseline = 'alphabetic'; g.textAlign = 'center';
    /* brand under the card (inside the safe middle square) */
    drawMask(g, W / 2 - 150, 1418, 54, '#fff', '#2B1236');
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '800 44px ' + SANS; g.textAlign = 'left'; g.fillText('Anonymous', W / 2 - 84, 1459); g.textAlign = 'center';
    return new Promise(function (res) { cv.toBlob(res, 'image/png'); });
  }
  function shareStory(user, link, avatar, btn) {
    var old = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = 'Making your story...'; }
    var fonts = (document.fonts && document.fonts.load) ? Promise.all([document.fonts.load('700 80px Caveat'), document.fonts.load('800 40px "Plus Jakarta Sans"')]).catch(function () {}) : Promise.resolve();
    Promise.all([fonts, loadImg(avatar)]).then(function (r) { return storyBlob(user, link, r[1]); }).then(function (blob) {
      if (!blob) throw 0;
      var file; try { file = new File([blob], 'anonymous-link-story.png', { type: 'image/png' }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: 'Anonymous' }).catch(function () {});
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'anonymous-link-story.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      toast('Image saved. Post it on your story and add your link sticker.');
    }).catch(function () { toast('Could not make the image. Try again.', true); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = old; } });
  }
  $('shareSent').onclick = function () { shareCard(lastSent, $('shareSent')); };
  $('seeBrowse').onclick = function () { tab('browse'); };
  $('writeMore').onclick = function () { $('sentActions').hidden = true; $('msg').textContent = ''; $('to').focus(); };

  /* ---------- tabs ---------- */
  var maint = null;
  function showMaint() {
    SECS.forEach(function (x) { $(x).hidden = x !== 'maint'; });
    $('maintNote').textContent = maint; $('tabs').hidden = true;
    if ($('supportFab')) $('supportFab').hidden = true;
    window.scrollTo(0, 0);
  }
  function showGate() {
    SECS.forEach(function (x) { $(x).hidden = x !== 'gate'; });
    $('tabs').hidden = true;
    if ($('supportFab')) $('supportFab').hidden = true;
    window.scrollTo(0, 0);
  }
  /* ---------- Android back button (history) ----------
     home is the base entry. Other tabs sit on top of home, so Back from any tab goes home,
     and Back from home leaves the app. Detail view and Support Buddy get their own entry. */
  var skipPop = false;
  try { history.replaceState({ t: 'home' }, ''); } catch (e) {}
  function navTo(t) {
    try {
      var st = history.state && history.state.t;
      if (st === t) return;
      if (t === 'home' || (st && st !== 'home')) history.replaceState({ t: t }, '');
      else history.pushState({ t: t }, '');
    } catch (e) {}
  }
  window.addEventListener('popstate', function (e) {
    if (skipPop) { skipPop = false; return; }
    var s = (e.state && e.state.t) || 'home';
    if (!$('supportOverlay').hidden && s !== 'support') { closeSupport(true); return; }
    if (s === 'detail' || s === 'support') return;
    if (!$('detail').hidden) { au.pause(); rst(); closeReactPicker(); }
    tab(s, true);
  });
  function isDirectLink() { return /(?:^#|&)to=/.test(location.hash); }
  function tab(t, fromPop) {
    if (maint !== null && t !== 'admin') { showMaint(); return; }
    if (!profile && ['submit', 'mybox', 'profile', 'history'].indexOf(t) > -1) { showGate(); return; }
    if (typeof au !== 'undefined') { au.pause(); rst(); }
    cur = t; window.scrollTo(0, 0);
    if (!fromPop) navTo(t);
    SECS.forEach(function (x) { $(x).hidden = x !== t; });
    $('tabs').hidden = t === 'admin' || (t === 'submit' && isDirectLink());
    if (t === 'submit') $('directHead').hidden = !isDirectLink();
    if ($('supportFab')) $('supportFab').hidden = false;
    if ($('supportOverlay') && !$('supportOverlay').hidden) { $('supportOverlay').hidden = true; document.body.style.overflow = ''; }
    [].forEach.call($('tabs').children, function (b) { b.setAttribute('aria-selected', b.dataset.t === t); });
    if (t !== 'submit' && $('sentActions')) $('sentActions').hidden = true;
    if (t === 'submit') setTimeout(updCount, 60);
    if (t === 'home') loadHome();
    if (t === 'history') showHistory();
    if (t === 'browse') loadFeed();
    if (t === 'submit') { try { drawSubPv(); } catch (e) {} }
    if (t === 'mybox') openInbox();
    if (t === 'profile') openProfile();
  }
  $('tabs').onclick = function (e) { var b = e.target.closest('button'); if (b) tab(b.dataset.t); };

  /* ---------- Support Buddy modal ---------- */
  function openSupport() {
    try { if (!(history.state && history.state.t === 'support')) history.pushState({ t: 'support' }, ''); } catch (e) {}
    $('supportOverlay').hidden = false;
    $('supportFab').hidden = true;
    document.body.style.overflow = 'hidden';
    refreshTix();
  }
  function closeSupport(fromPop) {
    $('supportOverlay').hidden = true;
    $('supportFab').hidden = false;
    document.body.style.overflow = '';
    if (fromPop !== true) {
      try { if (history.state && history.state.t === 'support') { skipPop = true; history.back(); } } catch (e) {}
    }
  }
  $('supportFab').onclick = openSupport;
  $('supportClose').onclick = function () { closeSupport(); };
  $('footerSupport').onclick = openSupport;
  $('supportOverlay').onclick = function (e) {
    if (e.target === $('supportOverlay')) closeSupport();
  };

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
  function draw(items, raw, isRec) {
    last = items;
    var head = isRec ? '<div class="res-head">Recommended for you</div>' : '';
    var free = raw ? '<button data-free="1">' + art('#999') + '<span><b>Use "' + esc(raw) + '"</b><span>Not listed? Add it as typed</span></span></button>' : '';
    $('res').innerHTML = head + items.map(function (s, i) {
      return '<button data-i="' + i + '">' + art(s.c, s.t + ' ' + s.a) + '<span><b>' + esc(s.t) + '</b><span>' + esc(s.a) + '</span></span></button>';
    }).join('') + free;
    $('res').hidden = false; hydrateArt();
  }
  function showRecs() {
    draw(CAT.map(function (s) { return { t: s[0], a: s[1], c: s[2] }; }), '', true);
  }
  $('q').onfocus = function () {
    if (!$('q').value.trim() && !pick) showRecs();
  };
  $('q').oninput = function () {
    var raw = $('q').value.trim(), v = norm(raw);
    clearTimeout(tmr);
    if (!v) { showRecs(); return; }
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
  /* close recommendations when tapping outside */
  document.addEventListener('click', function (e) {
    if (!$('res') || $('res').hidden) return;
    if (e.target.closest('#q') || e.target.closest('#res') || e.target.closest('#picked')) return;
    $('res').hidden = true;
  });
  $('res').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.free) { var t = $('q').value.trim().split(' - '); pick = [t[0], t[1] || 'Unknown artist', '#999', '']; }
    else { var o = last[+b.dataset.i]; pick = [o.t, o.a, o.c, o.p || '']; }
    $('res').hidden = true; $('q').value = ''; $('q').hidden = true;
    renderPicked();
  };
  function renderPicked() {
    if (!pick) { $('picked').innerHTML = ''; $('q').hidden = false; return; }
    /* Same circular play button as send.html (personal link page) */
    $('picked').innerHTML = '<div class="pick song-pick">' + art(pick[2], pick[0] + ' ' + pick[1]) +
      '<div class="pt"><b>' + esc(pick[0]) + '</b><span>' + esc(pick[1]) + '</span></div>' +
      '<button type="button" class="play-pick" id="pickPlay" aria-label="Play 30s preview">&#9654;</button>' +
      '<button type="button" class="x" id="x" aria-label="Remove song">×</button></div>';
    $('x').onclick = function () {
      if (typeof au !== 'undefined') { au.pause(); rst(); }
      pick = null; $('picked').innerHTML = ''; $('q').hidden = false;
    };
    $('pickPlay').onclick = function () {
      var b = $('pickPlay');
      if (pb === b) { au.pause(); rst(); return; }
      if (pb) rst();
      function playUrl(u) {
        if (!u) { toast('No 30s preview for this song.', true); return; }
        pick[3] = u;
        pb = b; b.innerHTML = '&#10073;&#10073;';
        au.src = u;
        au.play().catch(function () { rst(); toast('Could not play preview.', true); });
      }
      if (pick[3] && /^https:\/\//.test(pick[3])) {
        playUrl(pick[3]);
        return;
      }
      /* fetch preview from iTunes when recommendation had no URL yet */
      b.disabled = true;
      itunes(pick[0] + ' ' + pick[1], 1).then(function (d) {
        var u = d.results && d.results[0] && d.results[0].previewUrl;
        if (u) pick[3] = u;
        playUrl(u || '');
      }).catch(function () { playUrl(''); }).then(function () { b.disabled = false; });
    };
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
    if (replyParent) o.parent = replyParent;
    $('send').disabled = true;
    saveMsg(o).then(function (saved) {
      if (saved && saved.id) o.id = saved.id;
      var sent = pruneHistory(); sent.unshift(o); lset(SENT, sent.slice(0, 100));
      m.className = 'msg ok-pop';
      m.textContent = direct ? 'Sent anonymously. Only the owner of that personal link can see it in their Inbox.' : 'Posted anonymously to Browse. The named person will not receive an Inbox message.';
      $('to').value = direct ? $('to').value : ''; $('text').value = ''; pick = null; $('picked').innerHTML = ''; $('q').hidden = false;
      replyParent = null; lastSent = o; clearDraft(); updCount(); $('text').placeholder = TEXT_PH;
      $('sentActions').hidden = false; $('seeBrowse').hidden = direct;
      celebrateSend();
      if (!direct) loadFeed();
    }).catch(function (e) { m.className = 'msg err'; m.textContent = (e && e.msg) || dbHint(e); })
      .then(function () { $('send').disabled = false; });
  };

  var replyParent = null;
  function celebrateSend() {
    try { if (navigator.vibrate) navigator.vibrate([18, 40, 18]); } catch (e) {}
    var burst = $('successBurst');
    if (burst) {
      burst.hidden = false; burst.classList.remove('show');
      void burst.offsetWidth;
      burst.classList.add('show');
      setTimeout(function () { burst.hidden = true; burst.classList.remove('show'); }, 950);
    }
  };

  /* ---------- cards, feed, inbox search ---------- */
  function pbtn(m, cls) {
    return '<button class="play' + cls + '" aria-label="Play preview" data-src="' + esc(/^https:\/\//.test(m.prev) ? m.prev : '') + '" data-q="' + esc(m.song + ' ' + m.artist) + '">' + (cls ? '&#9654;' : '&#9654; Play') + '</button>';
  }
  var REACT_EMOJIS = ['❤️', '🔥', '🥺', '✨', '👏'];
  var reactCache = {}; /* id -> { counts: {emoji:n}, mine: emoji|null } */
  function isUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function reactTotal(st) {
    var n = 0, c = (st && st.counts) || {};
    Object.keys(c).forEach(function (k) { n += Number(c[k]) || 0; });
    return n;
  }
  function reactBar(m) {
    /* Only real public posts on the server (not History local ids, not samples) */
    if (!m || m.ex || m.type !== 'public' || !isUuid(m.id)) return '';
    var st = reactCache[m.id] || { counts: {}, mine: null }, mine = st.mine || '';
    return '<div class="reacts" data-mid="' + esc(m.id) + '">' + REACT_EMOJIS.map(function (e) {
      var n = (st.counts && st.counts[e]) || 0;
      return '<button type="button" class="react-btn' + (mine === e ? ' on' : '') + '" data-mid="' + esc(m.id) + '" data-e="' + e + '" aria-pressed="' + (mine === e) + '" aria-label="React ' + e + (n ? ', ' + n + ' so far' : '') + '"><span class="em">' + e + '</span>' + (n ? '<span class="n">' + n + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function paintReacts(mid) {
    var m = cache[mid];
    if (!m) return;
    document.querySelectorAll('.reacts[data-mid="' + mid + '"]').forEach(function (el) {
      el.outerHTML = reactBar(m);
    });
  }
  function loadReactions(ids) {
    ids = (ids || []).filter(isUuid);
    if (!REMOTE || !ids.length) return Promise.resolve();
    return rpc('reaction_counts', { p_ids: ids }).then(function (map) {
      if (!map || typeof map !== 'object') return;
      Object.keys(map).forEach(function (id) { reactCache[id] = map[id]; });
    }).catch(function () {});
  }
  function doReact(mid, emoji) {
    if (!mid || !emoji) return Promise.resolve();
    if (!profile || !sessionGet()) { showGate(); return Promise.resolve(); }
    if (!isUuid(mid)) {
      toast('Reactions work on Browse posts only.', true);
      return Promise.resolve();
    }
    if (!REMOTE) {
      var local = reactCache[mid] || { counts: {}, mine: null };
      if (local.mine === emoji) {
        local.counts[emoji] = Math.max(0, (local.counts[emoji] || 1) - 1);
        if (!local.counts[emoji]) delete local.counts[emoji];
        local.mine = null;
      } else {
        if (local.mine) {
          local.counts[local.mine] = Math.max(0, (local.counts[local.mine] || 1) - 1);
          if (!local.counts[local.mine]) delete local.counts[local.mine];
        }
        local.counts[emoji] = (local.counts[emoji] || 0) + 1;
        local.mine = emoji;
      }
      reactCache[mid] = local;
      paintReacts(mid);
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (x) {}
      return Promise.resolve();
    }
    return rpc('toggle_reaction', { p_message_id: mid, p_emoji: emoji }).then(function (r) {
      reactCache[mid] = { counts: (r && r.counts) || {}, mine: (r && r.mine) || null };
      paintReacts(mid);
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (x) {}
    }).catch(function (err) {
      var t = (err && err.text) || '';
      var msg = 'Could not react right now.';
      if (/not_public|P0002|22P02|foreign key|does not exist|not found/i.test(t))
        msg = 'That post is gone or not public anymore.';
      else if (/login_required|JWT|401|42501/i.test(t) || (err && err.status === 401))
        msg = 'Log in first to react.';
      else if (/404|PGRST202|could not find/i.test(t))
        msg = 'Reactions are not available yet.';
      else if (err && err.msg) msg = err.msg;
      toast(msg, true);
    });
  }
  function closeReactPicker() {
    var p = document.getElementById('reactPicker');
    if (p) p.remove();
  }
  function openReactPicker(mid, anchor) {
    closeReactPicker();
    var pop = document.createElement('div');
    pop.id = 'reactPicker';
    pop.className = 'react-picker';
    pop.setAttribute('data-mid', mid);
    REACT_EMOJIS.forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'react-pick-btn';
      b.textContent = e;
      b.setAttribute('data-emoji', e);
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = Math.min(window.innerWidth - pw - 8, Math.max(8, r.left + r.width / 2 - pw / 2));
    var top = r.top - ph - 10;
    if (top < 8) top = r.bottom + 10;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function cardH(m, isNew) {
    return '<div class="card' + (isNew ? ' new' : '') + '" data-id="' + esc(m.id) + '" role="button" tabindex="0" aria-label="Open message to ' + esc(m.to) + '">' +
      '<div class="top"><div class="thead"><span class="to">To: ' + esc(m.to) + '</span><span class="stamp">' + (m.ex ? 'Sample' : m.bot ? 'Bot' : m.parent ? 'Reply' : 'From: ???') + '</span>' + (m.t && !m.ex ? '<time class="when">' + esc(ago(m.t)) + '</time>' : '') + '</div><p class="hand clip">' + esc(m.text) + '</p></div>' +
      '<div class="song">' + art(m.color, m.song + ' ' + m.artist) + '<span><b>' + esc(m.song) + '</b><span>' + esc(m.artist) + '</span></span>' + pbtn(m, '') + '</div>' +
      reactBar(m) + '</div>';
  }

  /* ---------- designs that travel with a post ----------
     A post stores only a small id. The design itself (maybe a photo) is fetched ONCE per design and kept here. */
  function loadCardStyles(ids) {
    var need = [];
    ids.forEach(function (id) { if (id && !(id in cardStore) && !cardBusy[id] && need.indexOf(id) < 0) need.push(id); });
    need = need.slice(0, 40);
    if (!need.length || !REMOTE) return Promise.resolve();
    need.forEach(function (id) { cardBusy[id] = 1; });
    return rpc('get_cards', { p_ids: need }).then(function (r) {
      need.forEach(function (id) { cardStore[id] = (r && r[id]) || null; delete cardBusy[id]; });
    }).catch(function () { need.forEach(function (id) { delete cardBusy[id]; }); });   /* not remembered on failure, so it is tried again later */
  }
  function styleFor(m) { return (m && (m.card || (m.cardId && cardStore[m.cardId]))) || null; }
  function isSentHere(m) { return !!(m && lget(SENT, []).some(function (x) { return x && x.id === m.id; })); }

  /* ---------- per-card designs on Browse / History ----------
     A post to someone who made a card design wears THEIR design.
     A post you sent from this device and that has no owner design wears YOUR design. */
  var recCards = {}, csRules = {}, csSheet = null, csN = 0;
  function csClass(c) {
    var key = JSON.stringify(c); if (csRules[key]) return csRules[key];
    var b = window.CardStyle && CardStyle.bg(c); if (!b) return '';
    if (!csSheet) { csSheet = document.createElement('style'); document.head.appendChild(csSheet); }
    var l = CardStyle.light(c), n = 'cs' + (++csN);
    csSheet.appendChild(document.createTextNode('.' + n + '{--card-bg:' + b + ';--card-fg:' + (l ? '#16161a' : '#fff') + ';--card-sh:' + (l ? 'none' : '0 1px 8px rgba(0,0,0,.35)') + ';--card-glass:' + (l ? 'rgba(255,255,255,.55)' : 'rgba(10,10,14,.46)') + '}'));
    csRules[key] = n; return n;
  }
  function nameKey(m) { return String((m && m.to) || '').trim().toLowerCase(); }
  function decorate(el) {
    if (!window.CardStyle) return;
    var cards = [].slice.call(el.querySelectorAll('.card[data-id]'));
    var sent = {}; lget(SENT, []).forEach(function (m) { if (m && m.id) sent[m.id] = 1; });
    function paint() {
      cards.forEach(function (card) {
        var m = cache[card.dataset.id]; if (!m) return;
        var c = styleFor(m) || recCards[nameKey(m)] || (sent[m.id] && profile && profile.card) || null;   /* sender's design (saved on the post) > recipient's > yours on this device */
        var cls = c ? csClass(c) : '';
        if (card.dataset.cs && card.dataset.cs !== cls) card.classList.remove(card.dataset.cs, 'has-style');
        if (cls) { card.classList.add(cls, 'has-style'); card.dataset.cs = cls; } else { card.classList.remove('has-style'); delete card.dataset.cs; }
      });
    }
    paint();
    loadCardStyles(cards.map(function (card) { var m = cache[card.dataset.id]; return m && m.cardId; })).then(paint);
    var need = [];
    cards.forEach(function (card) {
      var m = cache[card.dataset.id], k = nameKey(m);
      if (m && REMOTE && /^[a-z0-9._]{3,20}$/.test(k) && !(k in recCards) && need.indexOf(k) < 0) need.push(k);
    });
    if (!need.length) return;
    rpc('public_cards', { p_names: need.slice(0, 60) }).then(function (r) {
      need.forEach(function (k) { recCards[k] = (r && r[k]) || null; });
      paint();
    }).catch(function () {});
  }

  function show(el, a, empty, animate) {
    a.forEach(function (m) { cache[m.id] = m; });
    el.innerHTML = a.length ? a.map(function (m) {
      return cardH(m, false);
    }).join('') : '<div class="empty">' + empty + '</div>';
    hydrateArt();
    if (el.id === 'feed' || el.id === 'hlist') decorate(el);
    var ids = a.filter(function (m) { return m.type === 'public' && !m.ex && isUuid(m.id); }).map(function (m) { return m.id; });
    if (ids.length) loadReactions(ids).then(function () {
      ids.forEach(function (id) { paintReacts(id); });
    });
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
  var feedTop = null, feedAll = [], feedMore = false, feedExpanded = false, feedQ = '', feedSort = 'new', feedPending = null, feedGen = 0, bqT;
  function sortedFeed(list) {
    if (feedSort !== 'hot') return list;
    return list.map(function (m, i) { return { m: m, i: i, n: reactTotal(reactCache[m.id]) }; })
      .sort(function (a, b) { return b.n - a.n || a.i - b.i; }).map(function (x) { return x.m; });
  }
  function paintFeed() {
    var ids = feedAll.filter(function (m) { return isUuid(m.id); }).map(function (m) { return m.id; });
    function go() {
      show($('feed'), sortedFeed(feedAll), feedQ ? 'No notes match “' + esc(feedQ) + '”. Try another word.' : 'No messages yet. Send the first one.', false);
      if (feedMore) {
        $('feed').insertAdjacentHTML('beforeend', '<button type="button" class="btn ghost full" id="feedMore">Load older messages</button>');
        $('feedMore').onclick = loadMoreFeed;
      }
    }
    if (feedSort === 'hot' && ids.length) loadReactions(ids).then(go); else go();
  }
  function loadMoreFeed() {
    var last = feedAll[feedAll.length - 1]; if (!last || !last.ts) return;
    var b = $('feedMore'); b.disabled = true; b.textContent = 'Loading...';
    fetchMsgs('', last.ts, feedQ).then(function (a) {
      var have = {}; feedAll.forEach(function (m) { have[m.id] = 1; });
      feedAll = feedAll.concat(a.filter(function (m) { return !have[m.id]; }));
      feedMore = a.length >= 50; feedExpanded = true; paintFeed();
    }).catch(function () { b.disabled = false; b.textContent = 'Could not load. Tap to try again.'; });
  }
  function applyFeed(a) {
    feedTop = a[0] && a[0].id; feedReady = true; feedAll = a; feedMore = REMOTE && a.length >= 50; paintFeed();
  }
  function showPill(n) {
    var p = $('newPill'); if (!p) return;
    p.textContent = (n > 1 ? n + ' new notes' : 'New note') + ' \u2191'; p.hidden = false;
  }
  function loadFeed(force) {
    if (feedQ) return;            /* searching: do not replace the results */
    if (feedExpanded && !force) return;   /* the person loaded older messages: keep their place */
    if (!feedReady) $('feed').innerHTML = skel(3);
    fetchMsgs('').then(function (a) {
      var top = a[0] && a[0].id;
      if (feedReady && top === feedTop && !force) return;
      /* someone is reading or listening: do not yank the list away, offer a pill instead */
      if (feedReady && !force && (window.scrollY > 240 || pb)) {
        feedPending = a; var known = {}; feedAll.forEach(function (m) { known[m.id] = 1; });
        showPill(a.filter(function (m) { return !known[m.id]; }).length); return;
      }
      feedPending = null; if ($('newPill')) $('newPill').hidden = true; applyFeed(a);
    }).catch(function (e) { if (!feedReady) $('feed').innerHTML = '<div class="empty">' + esc(dbHint(e)) + '</div>'; });
  }
  $('newPill').onclick = function () {
    $('newPill').hidden = true;
    if (feedPending) { applyFeed(feedPending); feedPending = null; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  function runSearch() {
    var q = $('bq').value.trim(); feedQ = q; feedPending = null; $('newPill').hidden = true;
    if (!q) { feedExpanded = false; feedReady = false; loadFeed(true); return; }
    $('feed').innerHTML = skel(2);
    var g = ++feedGen;
    fetchMsgs('', null, q).then(function (a) {
      if (g !== feedGen) return;
      feedAll = a; feedMore = REMOTE && a.length >= 50; paintFeed();
    }).catch(function (e) { if (g === feedGen) $('feed').innerHTML = '<div class="empty">' + esc(dbHint(e)) + '</div>'; });
  }
  $('bq').oninput = function () { clearTimeout(bqT); bqT = setTimeout(runSearch, 350); };
  $('bsort').onclick = function (e) {
    var b = e.target.closest('button[data-s]'); if (!b) return;
    feedSort = b.dataset.s;
    [].forEach.call($('bsort').querySelectorAll('button[data-s]'), function (x) { x.setAttribute('aria-pressed', x === b); });
    paintFeed();
  };
  $('bRefresh').onclick = function () {
    var b = $('bRefresh'); b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (x) {}
    feedPending = null; $('newPill').hidden = true;
    if (feedQ) { runSearch(); return; }
    feedExpanded = false; feedReady = false; loadFeed(true);
  };
  setInterval(function () { if (cur === 'browse' && !document.hidden) loadFeed(); }, 20000);


  /* link box + PIN nudge live on the Profile tab */
  function fillLinkBox() {
    var u = profile && profile.username;
    $('who').hidden = !u;
    if (!u) return null;
    var base = C.SITE_URL ? C.SITE_URL.replace(/\/+$/, '') + '/' : location.href.split('#')[0].split('?')[0].replace(/[^\/]*$/, '');
    var l = base + 'send.html?to=' + encodeURIComponent(u);
    if (C.SHORT_LINKS) l = base + encodeURIComponent(u);   /* NGL-style short link; needs the rewrite rule in README */
    var local = !C.SITE_URL && !/^https:/.test(location.protocol);
    $('linkNote').hidden = !local;
    if (local) $('linkNote').textContent = 'This link only works on this device. After you host the app, set SITE_URL in config.js.';
    $('whoName').textContent = '@' + u; $('link').value = l;
    $('share').innerHTML = '<a target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(l) + '">Facebook</a><button id="nat">Share to IG, Messenger, more</button><button id="storyBtn">Share link as story</button>';
    $('storyBtn').onclick = function () { shareStory(u, l, profile && profile.avatar, $('storyBtn')); };
    $('nat').onclick = function () {
      if (navigator.share) navigator.share({ title: 'Send me a song', text: 'Send me a song anonymously', url: l }).catch(function () {});
      else $('copy').click();
    };
    $('pinNudge').hidden = !(profile && profile.has_pin === false);
    return u;
  }
  /* Inbox tab: only the messages, drawn in your own card design */
  function openInbox() {
    var u = profile && profile.username;
    if (!u) return;
    $('mine').innerHTML = skel(2);
    fetchMsgs(u).then(function (a) {
      show($('mine'), a, 'No direct messages yet. Share your personal link (Profile tab) so someone can send you one.', false);
      lset(SEEN, a.map(function (m) { return m.id; }).slice(0, 200)); setInboxBadge(0);
      lastInbox = a;
      styleCards($('mine'), profile && profile.card);
    }).catch(function (e) {
      $('mine').innerHTML = '<div class="empty">' + esc(dbHint(e)) + '</div>';
    });
  }
  /* Profile tab: photo, stats, checklist, card style, link */
  function openProfile() {
    var u = fillLinkBox();
    if (!u) return;
    initProfile();
    profileUI(lastInbox);
    loadProfile().then(function () {
      return fetchMsgs(u).then(function (a) { lastInbox = a; profileUI(a); });
    }).catch(function () { profileUI(lastInbox); });
  }
  function inbox() { openInbox(); }



  /* ---------- live card preview on Submit (uses the recipient's design when they have one) ---------- */
  var pvStyle = {}, pvT;
  function drawSubPv() {
    var w = $('subPv'); if (!w || !window.CardStyle) return;
    var to = ($('to').value || '').trim();
    w.innerHTML = CardStyle.previewHtml({ to: to || 'someone', text: ($('text').value || '').trim(), song: pick && pick[0], artist: pick && pick[1], art: pick && pick[2] });
    CardStyle.apply($('subPvWrap'), pvStyle[to.toLowerCase()] || (profile && profile.card) || null);   /* recipient's design if they have one, otherwise the one you made in Profile */
  }
  function lookPv() {
    clearTimeout(pvT);
    pvT = setTimeout(function () {
      var to = ($('to').value || '').trim(), k = to.toLowerCase();
      if (!REMOTE || !/^[A-Za-z0-9._]{3,20}$/.test(to) || k in pvStyle) { drawSubPv(); return; }
      rpc('public_profile', { p_username: to }).then(function (p) { pvStyle[k] = (p && p.username && p.card) || null; drawSubPv(); }).catch(function () { pvStyle[k] = null; });
    }, 450);
  }
  ['to', 'text'].forEach(function (id) { $(id).addEventListener('input', function () { drawSubPv(); if (id === 'to') lookPv(); }); });
  var _rp = renderPicked; renderPicked = function () { _rp.apply(this, arguments); drawSubPv(); };
  drawSubPv();

  /* ---------- profile page + message card customization ---------- */
  var GRADS = {
    sunset: 'linear-gradient(135deg,#E5334B,#FF8A4C)', ocean: 'linear-gradient(135deg,#2C3E75,#4A9FC9)',
    forest: 'linear-gradient(135deg,#2E5A4C,#8BC48A)', grape: 'linear-gradient(135deg,#5B3A8C,#D4547A)',
    night: 'linear-gradient(135deg,#0C0C0E,#2A2A52)', gold: 'linear-gradient(135deg,#C9822B,#F2D06B)'
  };
  var cardDraft = null, lastInbox = [];
  function refreshProfile() { profileUI(lastInbox); }
  var LIGHT_GRADS = { gold: 1 };
  function cardBg(c) { return CardStyle.bg(c); }
  function styleCards(root, c) { return CardStyle.apply(root, c); }
  function shrink(file, max, q) {
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var r = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', q));
      };
      img.onerror = function () { no(); };
      img.src = url;
    });
  }
  function saveRpc(name, args, okMsg) {
    return rpc(name, args).then(function () { toast(okMsg); }).catch(function (e) { try { console.warn('[anonymous] save failed (is profile-upgrade.sql installed?)', e); } catch (x) {} toast('Could not save right now. Please try again later.', true); throw e; });
  }
  function profileUI(msgs) {
    if (!profile || !$('pf')) return;
    $('pf').hidden = false;
    var u = profile.username;
    $('pfName').textContent = '@' + u;
    $('pfLink').textContent = ($('link').value || '').replace(/^https?:\/\//, '');
    var av = $('pfAv'); $('pfInit').textContent = profile.avatar ? '' : u.charAt(0).toUpperCase();
    av.style.backgroundImage = profile.avatar ? 'url(' + profile.avatar + ')' : '';
    if ($('stView')) $('stView').textContent = (profile.views != null ? profile.views : 0);
    $('stMsg').textContent = msgs.length;
    loadActivity(msgs); refreshBlocks();
    $('stRep').textContent = msgs.filter(function (m) { return m.parent; }).length;
    $('stSong').textContent = Object.keys(msgs.reduce(function (o, m) { o[m.song + m.artist] = 1; return o; }, {})).length;
    var shared = !!lget('anon-shared', false);
    var steps = [
      ['Add profile photo', 10, !!profile.avatar, function () { $('pfFile').click(); }],
      ['Share your link', 30, shared, function () { $('pfLink').click(); }],
      ['Reply to a message', 20, msgs.some(function (m) { return m.parent; }), function () { tab('mybox'); }],
      ['Add a PIN', 20, profile.has_pin !== false, function () { $('pinNew').scrollIntoView({ behavior: 'smooth', block: 'center' }); }],
      ['Customize your card', 20, !!profile.card, function () { $('cvSw').scrollIntoView({ behavior: 'smooth', block: 'center' }); }]
    ];
    var pct = steps.reduce(function (n, x) { return n + (x[2] ? x[1] : 0); }, 0);
    $('pfPct').textContent = pct + '%'; $('pfBar').style.width = pct + '%';
    $('pfHint').textContent = pct >= 100 ? 'All set. Your profile is looking great!' : 'Finish the steps below to get more messages.';
    $('pfList').innerHTML = steps.map(function (x, i) {
      return '<li><button data-i="' + i + '" class="' + (x[2] ? 'done' : '') + '"><span class="ck">' + (x[2] ? '&#10003;' : '') + '</span><b>' + x[0] + '</b><em>+' + x[1] + '%</em></button></li>';
    }).join('');
    $('pfList').onclick = function (e) { var b = e.target.closest('button'); if (b) steps[+b.dataset.i][3](); };
    styleCards($('mine'), profile.card);
    cardDraft = profile.card ? JSON.parse(JSON.stringify(profile.card)) : null;
    drawCustom();
    initPage(); pageDraft = profile.page ? JSON.parse(JSON.stringify(profile.page)) : null; drawPage();
  }
  function drawCustom() {
    var sw = $('cvSw');
    sw.innerHTML = Object.keys(GRADS).map(function (k) {
      return '<button data-g="' + k + '" aria-label="' + k + '" aria-pressed="' + !!(cardDraft && cardDraft.kind === 'grad' && cardDraft.v === k) + '" style="background:' + GRADS[k] + '"></button>';
    }).join('') + '<label class="cv-col" aria-label="Pick a color"><input type="color" id="cvCol" value="' + (cardDraft && cardDraft.kind === 'color' ? cardDraft.v : '#E5334B') + '"></label>';
    styleCards($('cvPrev').parentNode, cardDraft);
    $('cvDim').value = (cardDraft && cardDraft.dim) || 35;
    $('cvDim').parentNode.querySelector('label[for=cvDim]').hidden = $('cvDim').hidden = !(cardDraft && cardDraft.kind === 'photo');
  }

  /* ---------- link-page background editor (separate from the message card) ---------- */
  var pageDraft = null;
  function drawPage() {
    var sw = $('pgSw'); if (!sw || !profile) return;
    sw.innerHTML = Object.keys(GRADS).map(function (k) {
      return '<button data-g="' + k + '" aria-label="' + k + '" aria-pressed="' + !!(pageDraft && pageDraft.kind === 'grad' && pageDraft.v === k) + '" style="background:' + GRADS[k] + '"></button>';
    }).join('') + '<label class="cv-col" aria-label="Pick a color"><input type="color" id="pgCol" value="' + (pageDraft && pageDraft.kind === 'color' ? pageDraft.v : '#E5334B') + '"></label>';
    $('pgName').textContent = '@' + profile.username;
    var av = $('pgAv'); av.textContent = profile.avatar ? '' : profile.username.charAt(0).toUpperCase();
    av.style.background = profile.avatar ? 'url(' + profile.avatar + ') center/cover' : '';
    CardStyle.hero($('pgPrev'), pageDraft);
    var ph = !!(pageDraft && pageDraft.kind === 'photo');
    $('pgDim').hidden = !ph; $('pgDimL').hidden = !ph; $('pgDim').value = (pageDraft && pageDraft.dim != null) ? pageDraft.dim : 30;
  }
  var pgOn = false;
  function initPage() {
    if (pgOn || !$('pgBox')) return; pgOn = true;
    $('pgSw').onclick = function (e) { var b = e.target.closest('button[data-g]'); if (!b) return; pageDraft = { kind: 'grad', v: b.dataset.g }; drawPage(); };
    $('pgSw').oninput = function (e) { if (e.target.id === 'pgCol') { pageDraft = { kind: 'color', v: e.target.value }; CardStyle.hero($('pgPrev'), pageDraft); } };
    $('pgUp').onclick = function () { $('pgFile').click(); };
    $('pgFile').onchange = function () {
      var f = this.files[0]; this.value = ''; if (!f) return;
      shrink(f, 900, 0.72).then(function (d) {
        if (d.length > 260000) { toast('That photo is too big. Try another.', true); return; }
        pageDraft = { kind: 'photo', v: d, dim: +$('pgDim').value || 30 }; drawPage();
      }).catch(function () { toast('Could not read that image.', true); });
    };
    $('pgDim').oninput = function () { if (pageDraft && pageDraft.kind === 'photo') { pageDraft.dim = +this.value; CardStyle.hero($('pgPrev'), pageDraft); } };
    $('pgClr').onclick = function () { pageDraft = null; drawPage(); };
    $('pgSave').onclick = function () {
      saveRpc('set_page_bg', { p_bg: pageDraft }, 'Link page background saved.').then(function () { profile.page = pageDraft; }).catch(function () {});
    };
  }

  function initProfile() {
    if (!$('pf') || $('pf').dataset.on) return; $('pf').dataset.on = 1;
    $('pfAv').onclick = function () { $('pfFile').click(); };
    $('pfFile').onchange = function () {
      var f = this.files[0]; this.value = ''; if (!f) return;
      shrink(f, 320, 0.8).then(function (d) {
        return saveRpc('set_avatar', { p_avatar: d }, 'Profile photo saved.').then(function () { profile.avatar = d; refreshProfile(); });
      }).catch(function () {});
    };
    $('pfLink').onclick = function () {
      var l = $('link').value; if (!l) return;
      var p = navigator.share ? navigator.share({ title: 'Send me a song', text: 'Send me a song anonymously', url: l })
        : navigator.clipboard.writeText(l).then(function () { toast('Link copied.'); });
      Promise.resolve(p).then(function () { lset('anon-shared', true); refreshProfile(); }).catch(function () {});   /* cancelled share = not shared */
    };
    $('cvSw').onclick = function (e) {
      var b = e.target.closest('button[data-g]'); if (!b) return;
      cardDraft = { kind: 'grad', v: b.dataset.g }; drawCustom();
    };
    $('cvSw').oninput = function (e) { if (e.target.id === 'cvCol') { cardDraft = { kind: 'color', v: e.target.value }; styleCards($('cvPrev').parentNode, cardDraft); } };
    $('cvUp').onclick = function () { $('cvFile').click(); };
    $('cvFile').onchange = function () {
      var f = this.files[0]; this.value = ''; if (!f) return;
      shrink(f, 720, 0.7).then(function (d) {
        if (d.length > 200000) { toast('That photo is too big. Try another.', true); return; }
        cardDraft = { kind: 'photo', v: d, dim: +$('cvDim').value || 35 }; drawCustom();
      }).catch(function () { toast('Could not read that image.', true); });
    };
    $('cvDim').oninput = function () { if (cardDraft && cardDraft.kind === 'photo') { cardDraft.dim = +this.value; styleCards($('cvPrev').parentNode, cardDraft); } };
    $('cvSend').checked = lget('anon-card-send', true) !== false;
    $('cvSend').onchange = function () { lset('anon-card-send', this.checked); toast(this.checked ? 'Your design will show on new posts.' : 'New posts will use the default design.'); };
    $('cvClr').onclick = function () { cardDraft = null; drawCustom(); };
    $('cvSave').onclick = function () {
      saveRpc('set_card_style', { p_card: cardDraft }, 'Card style saved.').then(function () {
        profile.card = cardDraft; refreshProfile();
      }).catch(function () {});
    };
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

  /* ---------- report a public post ---------- */
  var REASONS = [['hate', 'Hate or discrimination'], ['harassment', 'Bullying or harassment'], ['sexual', 'Sexual content'], ['selfharm', 'Self-harm'], ['spam', 'Spam'], ['other', 'Something else']];
  function openReport(m) {
    var box = $('reportBox'); if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.innerHTML = '<p class="sub" style="margin:10px 0 8px">Why are you reporting this post? An admin will review it.</p><div class="chips" id="reasonChips">' +
      REASONS.map(function (r) { return '<button type="button" data-r="' + r[0] + '">' + esc(r[1]) + '</button>'; }).join('') + '</div><p class="msg" id="reportMsg" role="status"></p>';
    box.hidden = false;
    $('reasonChips').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      [].forEach.call($('reasonChips').children, function (x) { x.disabled = true; });
      rpc('report_message', { p_message_id: m.id, p_reason: b.dataset.r, p_note: null }).then(function () {
        $('reportMsg').className = 'msg ok-pop'; $('reportMsg').textContent = 'Thank you. An admin will take a look.';
        var rb = $('reportBtn'); if (rb) rb.hidden = true;
      }).catch(function (err) {
        [].forEach.call($('reasonChips').children, function (x) { x.disabled = false; });
        var t = ''; try { t = JSON.parse(err.text).code || ''; } catch (x) {}
        $('reportMsg').className = 'msg err';
        $('reportMsg').textContent = t === 'PGRST202' ? 'Reporting is not switched on yet.' : (err && err.status === 401 ? 'Please open the app once more and try again.' : dbHint(err));
      });
    };
  }

  /* ---------- safety: block the sender of a private message (you never learn who it was) ---------- */
  function openBlock(m) {
    var box = $('blockBox'); if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.innerHTML = '<p class="sub" style="margin:10px 0 8px">Block this sender? They will not be able to message you again. You will not see who they are.</p>' +
      '<div class="row"><button type="button" class="btn danger" id="blockYes">Block</button><button type="button" class="btn ghost" id="blockNo">Cancel</button></div><p class="msg" id="blockMsg" role="status"></p>';
    box.hidden = false;
    $('blockNo').onclick = function () { box.hidden = true; };
    $('blockYes').onclick = function () {
      $('blockYes').disabled = true;
      rpc('block_sender', { p_message_id: m.id }).then(function (res) {
        if (res && res.ok) {
          $('blockMsg').className = 'msg ok-pop'; $('blockMsg').textContent = 'Blocked. That sender cannot message you again.';
          var bb = $('blockBtn'); if (bb) bb.hidden = true; refreshBlocks();
        } else {
          $('blockMsg').className = 'msg err'; $('blockMsg').textContent = 'This message was sent before blocking existed, so it cannot be blocked. New messages can.';
          $('blockYes').disabled = false;
        }
      }).catch(function (err) {
        var c = ''; try { c = JSON.parse(err.text).code; } catch (x) {}
        $('blockMsg').className = 'msg err';
        $('blockMsg').textContent = c === 'PGRST202' ? 'Blocking is not switched on yet.' : dbHint(err);
        $('blockYes').disabled = false;
      });
    };
  }
  function refreshBlocks() {
    var t = $('blkTxt'), b = $('unblockAll'); if (!t || !REMOTE || !profile) return;
    rpc('block_count', {}).then(function (n) {
      n = Number(n) || 0;
      t.textContent = n ? 'You have blocked ' + n + (n === 1 ? ' sender' : ' senders') + '. They cannot message you, and you cannot see who they are.'
        : 'You have not blocked anyone. If a private message is hurtful, open it and tap Block sender.';
      b.hidden = !n;
    }).catch(function () { t.textContent = 'If a private message is hurtful, open it and tap Block sender or Report.'; b.hidden = true; });
  }
  function loadActivity(msgs) {
    var box = $('actList'); if (!box || !REMOTE) return;
    var ev = msgs.filter(function (m) { return m.t; }).map(function (m) { return { t: m.t, k: 'msg', s: m.song, a: m.artist }; });
    rpc('my_recent_views', {}).catch(function () { return []; }).then(function (vs) {
      (vs || []).forEach(function (v) { var t = Date.parse(v); if (t) ev.push({ t: t, k: 'view' }); });
      ev.sort(function (a, b) { return b.t - a.t; });
      box.innerHTML = ev.length ? ev.slice(0, 15).map(function (e) {
        var msg = e.k === 'msg';
        return '<div class="act-row"><span class="act-ic' + (msg ? ' m' : '') + '" aria-hidden="true">' + (msg ? '&#9993;' : '&#128065;') + '</span><div><b>' +
          (msg ? 'New private message' : 'Someone opened your link') + '</b><span>' + (msg ? esc(e.s) + ' &middot; ' + esc(e.a) + ' &middot; ' : '') + esc(ago(e.t)) + '</span></div></div>';
      }).join('') : '<p class="sub" style="margin:0">Nothing yet. Share your link and it will show up here.</p>';
    });
  }
  $('unblockAll').onclick = function () {
    if (!window.confirm('Unblock everyone? Blocked senders will be able to message you again.')) return;
    rpc('unblock_all', {}).then(function () { toast('Everyone is unblocked.'); refreshBlocks(); }).catch(function (e) { toast(dbHint(e), true); });
  };

  /* ---------- detail view ---------- */
  function openD(id) {
    var m = cache[id]; if (!m) return;
    var hex = /^#[0-9a-f]{3,8}$/i.test(m.color), https = /^https:\/\//.test(m.color), col = hex ? m.color : '#27424F';
    var big = https ? '<img class="bigart" alt="" src="' + esc(m.color.replace('100x100', '600x600')) + '">' : '<span class="bigart" data-q="' + esc(m.song + ' ' + m.artist) + '" style="background:' + col + '"></span>';
    var isPublic = m.type === 'public' || m.ex;
    var isPrivateIn = m.type === 'direct' && !m.bot && !m.ex && isUuid(m.id) && REMOTE && !!profile;
    var subTxt = m.bot ? 'A song picked by the Anonymous bot.' :
      (m.type === 'direct' ? 'Someone sent you a song. They want you to hear this one.' : 'An anonymous note on Browse.') + (m.t && !m.ex ? ' ' + ago(m.t) + '.' : '');
    $('detail').innerHTML = '<button class="back" id="back">&larr; Back</button><h2 class="hi">Hello, ' + esc(m.to) + '</h2>' +
      '<p class="sub" style="text-align:center">' + subTxt + '</p>' +
      '<div class="dstage" id="dstage"><div class="dcard">' + big +
      '<div class="dinfo"><b>' + esc(m.song) + '</b><span>' + esc(m.artist) + '</span><em class="pv">30s preview</em></div>' + pbtn(m, ' circle') + '</div>' +
      '<p id="pnote" class="sub" style="text-align:center;min-height:1.2em"></p>' +
      '<p class="sub" style="text-align:center;margin-top:22px">Also, here is a message from the sender:</p><p class="hand">' + esc(m.text) + '</p></div>' +
      (isPublic && !m.ex && isUuid(m.id) ? '<div class="react-bar">' + reactBar(m) + '</div>' : '') +
      '<button type="button" class="btn ghost full reply-btn" id="replySong">Reply with a song</button>' +
      '<button type="button" class="btn ghost full share-btn" id="shareCard">Share as image</button>' +
      (isPublic && !m.ex && !m.bot && isUuid(m.id) && REMOTE ? '<button type="button" class="link report-link" id="reportBtn">Report this post</button><div id="reportBox" class="report-box" hidden></div>' : '') +
      (isPrivateIn ? '<section class="safety"><h3>Safety</h3>' +
        '<button type="button" class="srow" id="reportBtn"><span class="sic" aria-hidden="true">!</span><span>Report this message</span><i aria-hidden="true">&rsaquo;</i></button><div id="reportBox" class="report-box" hidden></div>' +
        '<button type="button" class="srow bad" id="blockBtn"><span class="sic" aria-hidden="true">&#8856;</span><span>Block sender</span><i aria-hidden="true">&rsaquo;</i></button><div id="blockBox" class="report-box" hidden></div>' +
        '<p class="sub safety-note">Nobody can see who sent this, including you and us. Blocking stops that sender from messaging you again. If you report it, an admin can read this message.</p></section>' : '');
    SECS.forEach(function (x) { $(x).hidden = true; });
    try { if (!(history.state && history.state.t === 'detail')) history.pushState({ t: 'detail' }, ''); } catch (e) {}
    $('tabs').hidden = true; $('detail').hidden = false; window.scrollTo(0, 0); hydrateArt();
    function stageStyle() {
      var st = $('dstage'); if (!st) return;
      var c = styleFor(m) || recCards[nameKey(m)] || (isSentHere(m) && profile && profile.card) || null, cls = c ? csClass(c) : '';
      if (st.dataset.cs && st.dataset.cs !== cls) st.classList.remove(st.dataset.cs, 'has-style');
      if (cls) { st.classList.add(cls, 'has-style'); st.dataset.cs = cls; } else { st.classList.remove('has-style'); delete st.dataset.cs; }
    }
    stageStyle();
    if (m.cardId && !(m.cardId in cardStore)) loadCardStyles([m.cardId]).then(stageStyle);
    if (isPublic && !m.ex && isUuid(m.id)) {
      loadReactions([m.id]).then(function () { paintReacts(m.id); });
    }
    if ($('reportBtn')) $('reportBtn').onclick = function () { openReport(m); };
    if ($('blockBtn')) $('blockBtn').onclick = function () { openBlock(m); };
    $('shareCard').onclick = function () { shareCard(m, $('shareCard')); };
    $('back').onclick = function () {
      au.pause(); rst(); closeReactPicker();
      if (history.state && history.state.t === 'detail') history.back(); else tab(cur, true);
    };
    $('replySong').onclick = function () {
      replyParent = (isPublic && !m.ex && isUuid(m.id)) ? m.id : null;
      var seed = isPublic
        ? ('Replying to an anonymous note about “' + m.song + '”. ')
        : ('Someone sent me “' + m.song + '”. Here is my anonymous reply on Browse. ');
      tab('submit');
      $('to').value = m.to || 'someone';
      $('text').value = seed; updCount();
      /* no toast — it covers the keyboard; the prefilled text already explains */
      setTimeout(function () { $('text').focus(); }, 50);
    };
  }

  /* Reactions: one tap on any emoji. Tap your own again to take it back. */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.react-btn'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var mid = b.dataset.mid, em = b.dataset.e;
    doReact(mid, em).then(function () {
      var nb = document.querySelector('.reacts[data-mid="' + mid + '"] .react-btn.on[data-e="' + em + '"]');
      if (nb) nb.classList.add('pop');
    });
  }, true);
  document.addEventListener('click', function (e) {
    var pick = e.target.closest('.react-pick-btn');
    if (pick) {
      e.preventDefault();
      e.stopPropagation();
      var mid = pick.closest('.react-picker') && pick.closest('.react-picker').getAttribute('data-mid');
      closeReactPicker();
      doReact(mid, pick.getAttribute('data-emoji'));
      return;
    }
    if (e.target.closest('.react-picker')) return;
    if (!e.target.closest('.react-main')) closeReactPicker();
    if (e.target.closest('.play,a,.react-btn,.reacts,.react-picker,.reply-btn,.share-btn,.play-pick')) return;
    var c = e.target.closest('.card[data-id]'); if (c) openD(c.dataset.id);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target.closest && e.target.closest('.reacts')) return;
    var c = e.target.closest && e.target.closest('.card[data-id]'); if (c) openD(c.dataset.id);
  });

  /* ---------- player (30s iTunes preview) ---------- */
  var au = new Audio(), pb = null;
  function rst() {
    if (pb) {
      if (pb.classList.contains('circle') || pb.classList.contains('play-pick')) pb.innerHTML = '&#9654;';
      else pb.innerHTML = '&#9654; Play';
      pb = null;
    }
  }
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
  /* History keeps only the last 7 days on this device */
  var HISTORY_DAYS = 7;
  function pruneHistory() {
    var cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
    var all = lget(SENT, []);
    var kept = all.filter(function (m) {
      var t = m && m.t;
      if (!t) return false;
      if (typeof t === 'string') t = Date.parse(t) || 0;
      return t >= cutoff;
    });
    if (kept.length !== all.length) lset(SENT, kept);
    return kept;
  }
  function showHistory() {
    var list = pruneHistory();
    show($('hlist'), list, 'Nothing sent from this device in the last 7 days.', false);
    var hs = $('hstats');
    if (!list.length) { hs.hidden = true; return; }
    var pub = list.filter(function (m) { return m.type === 'public'; }).length;
    function paint(react) {
      hs.innerHTML = '<div><b>' + list.length + '</b><span>sent this week</span></div><div><b>' + pub + '</b><span>on Browse</span></div><div><b>' + (list.length - pub) + '</b><span>private</span></div>' +
        (react != null ? '<div class="hot"><b>' + react + '</b><span>reactions on your posts</span></div>' : '');
      hs.hidden = false;
    }
    paint(null);
    var ids = list.filter(function (m) { return m.type === 'public' && isUuid(m.id); }).map(function (m) { return m.id; });
    if (ids.length) loadReactions(ids).then(function () {
      var n = 0; ids.forEach(function (id) { n += reactTotal(reactCache[id]); });
      if (cur === 'history') paint(n);
    });
  }
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
    paused: 'Support Buddy is taking a break right now. You can still send your concern to a real person with the link below, and the admin team will read it.',
    not_configured: 'The AI helper is not switched on yet. You can still send your concern to a real person with the link below.'
  };
  function sendChat(text) {
    var t = (typeof text === 'string' ? text : $('chatin').value).trim(); if (!t || busy) return;
    $('chatin').value = ''; $('chips').hidden = true; bub('me', t); chat.push({ role: 'user', content: t });
    if (!REMOTE) { bub('bot', 'The support chat needs the online database. Add your keys in config.js.'); return; }
    setBusy(true);
    /* admin can pause the AI chat (Maintenance Center). Check right now so it takes effect immediately; if the check fails, carry on. */
    api('settings?select=value&key=eq.chat_paused').catch(function () { return []; }).then(function (rows) {
      if (rows && rows[0] && rows[0].value === 'true') { var pe = { error: 'paused' }; throw pe; }
    }).then(function () { return fresh(); }).then(function () { return fetch(C.SUPABASE_URL + '/functions/v1/' + (C.CHAT_FUNCTION || 'support-chat'), { method: 'POST', headers: fnHeaders(), body: JSON.stringify({ messages: chat.slice(-20) }) }); })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw { error: d && d.error, status: r.status, msg: d && (d.message || d.msg) }; return d; }); })
      .then(function (d) {
        chat.push({ role: 'assistant', content: d.reply }); bub('bot', d.reply); songChip(d.song);
        if (d.crisis) { $('crisisBox').textContent = CRISIS_TXT; $('crisisBox').hidden = false; }
        if (d.escalate) askConsent(d.summary || mySummary());
      })
      .catch(function (e) {
        if (e && e.error === 'paused' && /(kill myself|suicid|end my life|want to die|self[- ]?harm|hurt myself|magpakamatay|mamatay|mag[- ]?suicide|saktan ang sarili)/i.test(t)) { $('crisisBox').textContent = CRISIS_TXT; $('crisisBox').hidden = false; }
        bub('bot', (e && CHAT_ERR[e.error]) || ('I could not answer just now. Please try again in a moment, or send your concern to a real person with the link below.  [code: ' + ((e && (e.error || e.status || e.msg || e.message)) || '?') + ']'));
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
  if (location.hash === '#admin') { redirecting = true; location.replace('/admin'); }
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
    showAnnouncement(st.announcement);
  }).catch(function () {});
  function showAnnouncement(txt) {
    txt = String(txt || '').trim();
    var el = $('announce');
    if (!txt) { if (el) el.hidden = true; return; }
    var seen = ''; try { seen = localStorage.getItem('anon-ann-seen') || ''; } catch (e) {}
    if (seen === txt) return;
    if (!el) {
      el = topBar('announce', 'announce');
      el.innerHTML = '<span id="announceTxt"></span><button type="button" id="announceX" aria-label="Dismiss announcement">&times;</button>';
      $('announceX').onclick = function () { el.hidden = true; try { localStorage.setItem('anon-ann-seen', $('announceTxt').textContent); } catch (e) {} };
    }
    $('announceTxt').textContent = txt; el.hidden = false;
  }

  /* ---------- theme toggle (button beside site name) ---------- */
  var THEME_KEY = 'anon-theme';
  function isDarkNow() {
    var m = lget(THEME_KEY, 'system');
    if (m === 'dark') return true;
    if (m === 'light') return false;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }
  function applyTheme(mode) {
    mode = mode || 'system';
    var root = document.documentElement;
    if (mode === 'light') root.setAttribute('data-theme', 'light');
    else if (mode === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    lset(THEME_KEY, mode);
    var btn = $('themeToggle');
    if (btn) {
      var dark = isDarkNow();
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = dark ? 'Light mode' : 'Dark mode';
    }
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = isDarkNow() ? '#0C0C0E' : '#E5334B';
    } catch (e) {}
  }
  applyTheme(lget(THEME_KEY, 'system'));
  if ($('themeToggle')) {
    $('themeToggle').onclick = function () {
      applyTheme(isDarkNow() ? 'light' : 'dark');
    };
  }
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (lget(THEME_KEY, 'system') === 'system') applyTheme('system');
    });
  } catch (e) {}

  /* ---------- inbox notifications (browser Notification API when tab is in background) ---------- */
  var notifAsked = false;
  function maybeAskNotif() {
    if (notifAsked || !('Notification' in window) || Notification.permission !== 'default') return;
    notifAsked = true;
    /* soft ask once after first successful inbox check with new items */
  }
  function notifyNewInbox(n) {
    if (n < 1 || document.visibilityState === 'visible') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = {
      body: n === 1 ? 'You have a new anonymous song in your Inbox.' : 'You have ' + n + ' new messages in your Inbox.',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'anon-inbox',
      renotify: true,
      data: { url: './index.html#inbox' }
    };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) { return reg.showNotification('Anonymous', opts); }).catch(function () {});
      } else { new Notification('Anonymous', opts); }
    } catch (e) {}
  }
  var _checkInbox = checkInbox;
  checkInbox = function (markSeen) {
    return _checkInbox(markSeen).then(function () {
      if (markSeen) return;
      var b = document.querySelector('#tabs [data-t=mybox] .badge');
      var n = b ? parseInt(b.textContent, 10) : 0;
      if (isNaN(n)) n = b && b.textContent.indexOf('+') > -1 ? 10 : 0;
      notifyNewInbox(n);
      if (n > 0 && 'Notification' in window && Notification.permission === 'default' && !notifAsked) {
        notifAsked = true;
        Notification.requestPermission().catch(function () {});
      }
    });
  };

  restoreDraft(); updCount();
  boot();

})();

/* hide the support button while scrolling so it never sits on top of Play buttons */
(function () { var t; window.addEventListener('scroll', function () { document.body.classList.add('scrolling'); clearTimeout(t); t = setTimeout(function () { document.body.classList.remove('scrolling'); }, 700); }, { passive: true }); })();
