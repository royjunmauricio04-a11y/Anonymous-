/* admin.html: Maintenance Center. Separate from the main app. Sign in with a Supabase Auth account
   that you listed in public.admins (see admin-user.sql). New tools need admin-upgrade.sql (run once). */
(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var REMOTE = !!(C.SUPABASE_URL && C.SUPABASE_KEY);
  var $ = function (i) { return document.getElementById(i); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function errParts(e) {
    var code = '', msg = ''; try { var j = JSON.parse(e.text); code = j.code || ''; msg = j.message || j.msg || ''; } catch (x) {}
    return { code: code, msg: msg };
  }
  function needsUpgrade(e) { return !!(e && e.status && errParts(e).code === 'PGRST202'); }
  function dbHint(e) {
    if (!e || !e.status) return 'Could not reach the database. Check your connection.';
    var p = errParts(e);
    if (p.code === 'PGRST202') return 'This tool is not installed yet. Run admin-upgrade.sql in Supabase.';
    if (p.code === '42501' || e.status === 403) return 'Not allowed. Is your account listed as an admin (admin-user.sql)?';
    if (p.code === 'PGRST205' || p.code === '42P01' || e.status === 404) return 'Tables are missing. Run setup.sql, then admin-upgrade.sql, in Supabase.';
    return p.msg || ('Database error (' + e.status + ').');
  }
  function api(path, opt) {
    opt = opt || {};
    var hd = { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (/^eyJ/.test(C.SUPABASE_KEY)) hd.Authorization = 'Bearer ' + C.SUPABASE_KEY;
    opt.headers = Object.assign(hd, opt.headers);
    return fetch(C.SUPABASE_URL + '/rest/v1/' + path, opt).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw { status: r.status, text: t }; });
      return r.json().catch(function () { return null; });
    });
  }
  var STATUS = { pending: 'Pending', in_progress: 'In progress', resolved: 'Resolved', draft: 'Draft', approved: 'Approved', archived: 'Archived', open: 'Open', dismissed: 'Kept', actioned: 'Removed' };
  var REASON = { hate: 'Hate', harassment: 'Harassment', sexual: 'Sexual content', selfharm: 'Self-harm', spam: 'Spam', other: 'Other' };
  function when(t) { try { return new Date(t).toLocaleString(); } catch (e) { return ''; } }
  function ago(t) {
    var s = Math.max(0, (Date.now() - Date.parse(t)) / 1000);
    if (isNaN(s)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 604800) return Math.floor(s / 86400) + ' d ago';
    return new Date(t).toLocaleDateString();
  }
  function anonHeaders() {
    var h = { apikey: C.SUPABASE_KEY };
    if (/^eyJ/.test(C.SUPABASE_KEY)) h.Authorization = 'Bearer ' + C.SUPABASE_KEY;
    return h;
  }
  var toastT;
  function toast(msg, bad) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function notify(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (r) { return r.showNotification(title, { body: body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'anon-admin', data: { url: './admin.html' } }); }).catch(function () {});
      } else { new Notification(title, { body: body, icon: 'icon-192.png' }); }
    } catch (e) {}
  }

  /* ---------- sign-in (Supabase Auth: email + password) ---------- */
  var SK = 'anon-admin-session', pollT = null, lastCounts = null;
  function sess() { try { return JSON.parse(localStorage.getItem(SK)); } catch (e) { return null; } }
  function sessSet(s) { try { if (s) localStorage.setItem(SK, JSON.stringify(s)); else localStorage.removeItem(SK); } catch (e) {} }
  function authCall(path, body, tok) {
    var h = anonHeaders(); h['Content-Type'] = 'application/json'; if (tok) h.Authorization = 'Bearer ' + tok;
    return fetch(C.SUPABASE_URL + '/auth/v1/' + path, { method: 'POST', headers: h, body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw { status: r.status, text: JSON.stringify(d), msg: d.msg || d.error_description || d.message || '' };
        return d;
      });
    });
  }
  function toSess(d) { return { access: d.access_token, refresh: d.refresh_token, exp: Math.floor(Date.now() / 1000) + (d.expires_in || 3600), email: (d.user && d.user.email) || '' }; }
  function token() {
    var s = sess(); if (!s) return Promise.reject({ msg: 'Signed out' });
    if (s.exp - 60 > Date.now() / 1000) return Promise.resolve(s.access);
    return authCall('token?grant_type=refresh_token', { refresh_token: s.refresh }).then(function (d) {
      var n = toSess(d); n.email = n.email || s.email; sessSet(n); return n.access;
    }).catch(function (e) { if (e && (e.status === 400 || e.status === 401 || e.status === 403)) sessSet(null); throw e; });
  }
  function A(path, opt) {
    return token().then(function (t) { opt = opt || {}; opt.headers = Object.assign({ Authorization: 'Bearer ' + t }, opt.headers); return api(path, opt); });
  }
  function rpcA(fn, args) { return A('rpc/' + fn, { method: 'POST', body: JSON.stringify(args || {}) }); }
  function aErr(e) {
    var t = (e && e.text) || '';
    if (e && e.status === 401 && !/not authorized/.test(t)) { signedOut('Your session ended. Please sign in again.'); return; }
    if (/blocked_content/.test(t)) { toast('That text is blocked.', true); return; }
    toast(/not authorized/.test(t) ? 'This account is not an admin.' : (e && e.msg && !e.status ? e.msg : dbHint(e)), true);
  }
  function signedOut(note) {
    sessSet(null); clearInterval(pollT); pollT = null; lastCounts = null; gen++;
    $('alogin').hidden = false; $('apanel').hidden = true; $('apanel').innerHTML = '';
    $('amsg').className = 'msg'; $('amsg').textContent = note || '';
  }
  function adminBoot() {
    if (!REMOTE) { $('amsg').textContent = 'Connect Supabase first (config.js).'; return; }
    if (!sess()) { signedOut(''); return; }
    rpcA('is_admin').then(function (ok) { if (ok === true) adminShell(); else notAdmin(); })
      .catch(function (e) { signedOut(e && e.status === 401 ? 'Please sign in.' : dbHint(e)); });
  }
  function notAdmin() {
    $('alogin').hidden = true; $('apanel').hidden = false;
    $('apanel').innerHTML = '<div class="a-login"><div class="box"><h3>Not an admin</h3><p class="sub">You are signed in as ' + esc((sess() || {}).email) + ', but this account is not on the admin list. See admin-user.sql.</p><button class="btn full" id="alogout">Sign out</button></div></div>';
    $('alogout').onclick = doLogout;
  }
  function doLogin() {
    var email = $('aemailIn').value.trim(), pw = $('apass').value;
    if (!REMOTE) { $('amsg').textContent = 'Connect Supabase first (config.js).'; return; }
    if (!email || !pw) { $('amsg').className = 'msg err'; $('amsg').textContent = 'Enter your email and password.'; return; }
    $('aOpen').disabled = true; $('amsg').textContent = '';
    authCall('token?grant_type=password', { email: email, password: pw }).then(function (d) {
      sessSet(toSess(d)); $('apass').value = ''; adminBoot();
    }).catch(function (e) {
      $('amsg').className = 'msg err';
      $('amsg').textContent = e && e.status === 400 ? 'Wrong email or password.' : (e && e.msg) || dbHint(e);
    }).then(function () { $('aOpen').disabled = false; });
  }
  function doLogout() {
    var s = sess(); if (s) authCall('logout', {}, s.access).catch(function () {});
    signedOut('You are signed out.');
  }
  $('aOpen').onclick = doLogin;
  $('apass').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };

  /* ---------- icons ---------- */
  function ic(d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
  var IC = {
    overview: ic('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
    posts: ic('<path d="M4 5h16v11H9l-5 4z"/>'),
    support: ic('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M6.3 6.3l3.6 3.6M14.1 14.1l3.6 3.6M17.7 6.3l-3.6 3.6M9.9 14.1l-3.6 3.6"/>'),
    people: ic('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.5c2 .7 3 2.7 3 5.5"/>'),
    controls: ic('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
    theme: ic('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
    out: ic('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>')
  };
  var LOGO = '<svg class="logo" viewBox="0 0 40 24" aria-hidden="true"><path d="M2 8c6-4 12-4 18-1 6-3 12-3 18 1 0 8-5 13-10 13-4 0-6-3-8-3s-4 3-8 3C7 21 2 16 2 8z" fill="var(--pink)"/><ellipse cx="12.5" cy="12" rx="4.2" ry="2.6" fill="var(--bg)"/><ellipse cx="27.5" cy="12" rx="4.2" ry="2.6" fill="var(--bg)"/></svg>';

  /* ---------- shell ---------- */
  var TABS = [['overview', 'Overview'], ['posts', 'Posts'], ['support', 'Support'], ['people', 'People'], ['controls', 'Controls']];
  var ATAB = 'overview', gen = 0, TK = {}, KB = {}, UPGRADE_SEEN = false;
  function pane() { return $('apane'); }
  function adminShell() {
    $('alogin').hidden = true; $('apanel').hidden = false;
    var email = esc((sess() || {}).email || 'Admin');
    var nav = TABS.map(function (t) {
      return '<button data-a="' + t[0] + '" aria-selected="false">' + IC[t[0]] + '<span>' + t[1] + '</span><span class="a-pip" id="pip-' + t[0] + '" hidden></span></button>';
    }).join('');
    $('apanel').innerHTML =
      '<div class="a-shell">' +
      '<header class="a-top"><div class="a-brand">' + LOGO + 'Maintenance</div><div class="a-top-actions"><span class="a-who">' + email + '</span>' +
      '<button class="a-iconbtn" id="atheme" aria-label="Switch theme">' + IC.theme + '</button><button class="a-iconbtn" id="alogout" aria-label="Sign out">' + IC.out + '</button></div></header>' +
      '<nav class="a-nav" id="anav" aria-label="Sections"><div class="a-side-brand">' + LOGO + 'Maintenance</div>' + nav +
      '<div class="a-side-foot">' + email + '<button id="atheme2">Switch theme</button><button id="alogout2">Sign out</button></div></nav>' +
      '<div class="a-main" id="apane"></div></div>';
    $('alogout').onclick = doLogout; $('alogout2').onclick = doLogout;
    $('atheme').onclick = $('atheme2').onclick = toggleTheme;
    $('anav').onclick = function (e) { var b = e.target.closest('button[data-a]'); if (b) go(b.dataset.a, true); };
    if ('Notification' in window && Notification.permission === 'default') {
      /* ask once, on the first tap anywhere, so the browser accepts it */
      document.addEventListener('click', function ask() { document.removeEventListener('click', ask); try { Notification.requestPermission(); } catch (e) {} }, { once: true });
    }
    go(ATAB, true); clearInterval(pollT); pollT = setInterval(poll, 30000); poll();
  }
  function toggleTheme() {
    var root = document.documentElement, dark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('anon-theme', JSON.stringify(next)); } catch (e) {}
  }
  function go(t, animate) {
    ATAB = t; gen++;
    [].forEach.call($('anav').querySelectorAll('button[data-a]'), function (b) { b.setAttribute('aria-selected', b.dataset.a === t); });
    var p = pane(); p.innerHTML = skel(3);
    if (animate) { p.className = 'a-main'; void p.offsetWidth; p.className = 'a-main a-pane'; }
    window.scrollTo(0, 0);
    ({ overview: vOverview, posts: vPosts, support: vSupport, people: vPeople, controls: vControls })[t]();
  }
  function skel(n) { var s = ''; for (var i = 0; i < n; i++) s += '<div class="a-skel"></div>'; return s; }
  function keepScroll(fn) { var y = window.scrollY; var r = fn(); Promise.resolve(r).then(function () { window.scrollTo(0, y); }); }
  function setPip(id, n) { var p = $('pip-' + id); if (p) { p.textContent = n > 99 ? '99+' : n; p.hidden = !n; } }
  function upgradeNote() {
    return '<div class="a-block" style="border-color:var(--warn)"><h3>One step left</h3><p class="sub" style="margin:0">Run <b>admin-upgrade.sql</b> once in Supabase (SQL Editor, New query, paste, Run). It turns on reports, people, the word filter and the bot pool tools.</p></div>';
  }

  /* background check: badges + alerts for new reports/tickets */
  function poll() {
    rpcA('admin_stats').catch(function (e) { if (needsUpgrade(e)) return rpcA('admin_state').then(function (s) { return { reports_open: 0, tickets_pending: s.tickets_pending || 0 }; }); throw e; })
      .then(function (st) {
        var r = st.reports_open || 0, t = st.tickets_pending || 0;
        setPip('posts', r); setPip('support', t);
        if (lastCounts) {
          if (r > lastCounts.r) { toast('New report (' + r + ' open).'); notify('New report', r + ' open'); }
          if (t > lastCounts.t) { toast('New support ticket (' + t + ' pending).'); notify('New support ticket', t + ' pending'); }
        }
        lastCounts = { r: r, t: t };
      }).catch(function () {});
  }

  /* =====================================================================
     Overview
     ===================================================================== */
  function chartSvg(days) {
    var W = 320, base = 88, maxH = 62, n = days.length, bw = 30, gap = (W - n * bw) / (n + 1);
    var mx = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.messages; })));
    var out = '<svg viewBox="0 0 ' + W + ' 112" role="img" aria-label="Messages per day, last 7 days">';
    days.forEach(function (d, i) {
      var h = Math.max(d.messages ? 4 : 2, Math.round(d.messages / mx * maxH)), x = Math.round(gap + i * (bw + gap)), today = i === n - 1;
      var wd = new Date(d.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
      out += '<rect class="bar' + (today ? ' today' : '') + '" x="' + x + '" y="' + (base - h) + '" width="' + bw + '" height="' + h + '" rx="6"/>' +
        '<text class="val" x="' + (x + bw / 2) + '" y="' + (base - h - 6) + '">' + d.messages + '</text>' +
        '<text x="' + (x + bw / 2) + '" y="106">' + esc(wd) + '</text>';
    });
    return out + '</svg>';
  }
  function vOverview() {
    var g = gen;
    Promise.all([
      rpcA('admin_state'),
      rpcA('admin_stats').catch(function (e) { if (needsUpgrade(e)) return null; throw e; }),
      rpcA('admin_recent').catch(function () { return []; })
    ]).then(function (res) {
      if (g !== gen) return;
      var st = res[0], x = res[1], recent = res[2] || [], s = st.settings || {};
      var on = s.bot_enabled === 'true', mt = s.maintenance === 'true', ann = (s.announcement || '').trim();
      var html = '<h2 class="a-h">Overview <small>updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</small></h2>';
      if (!x) {
        html += upgradeNote() +
          '<div class="a-stats"><div class="a-stat"><b>' + st.users + '</b><span>Usernames</span></div><div class="a-stat"><b>' + st.messages + '</b><span>Messages</span></div>' +
          '<div class="a-stat"><b>' + (st.tickets_pending || 0) + '</b><span>Pending tickets</span></div><div class="a-stat"><b>' + st.bots + '</b><span>Bot posts</span></div></div>';
      } else {
        setPip('posts', x.reports_open); setPip('support', x.tickets_pending);
        html += '<div class="a-stats">' +
          '<div class="a-stat"><b>' + x.users + '</b><span>Usernames' + (x.users_today ? ' (+' + x.users_today + ' today)' : '') + '</span></div>' +
          '<div class="a-stat"><b>' + x.messages_today + '</b><span>Messages today</span></div>' +
          '<button class="a-stat' + (x.reports_open ? ' hot' : '') + '" data-go="posts"><b>' + x.reports_open + '</b><span>Open reports</span></button>' +
          '<button class="a-stat' + (x.tickets_pending ? ' hot' : '') + '" data-go="support"><b>' + x.tickets_pending + '</b><span>Pending tickets</span></button></div>';
        var wk = x.days.reduce(function (a, d) { return a + d.messages; }, 0), wu = x.days.reduce(function (a, d) { return a + d.users; }, 0);
        html += '<div class="a-chart"><div class="a-chart-h"><b>Messages, last 7 days</b><span>' + wk + ' total</span></div>' + chartSvg(x.days) +
          '<div class="a-chart-foot"><span>' + wu + ' new usernames this week</span><span>' + x.reactions + ' reactions overall</span></div></div>';
      }
      html += '<h3 class="a-sec">Status</h3><div class="a-list">' +
        '<div class="a-row tap" data-go="controls"><div class="a-row-h"><b>Maintenance mode</b><span class="a-tag ' + (mt ? 'warn' : 'ok') + '">' + (mt ? 'On' : 'Off') + '</span></div><div class="a-meta">' + (mt ? 'Visitors see the maintenance screen.' : 'The app is open to everyone.') + '</div></div>' +
        '<div class="a-row tap" data-go="controls"><div class="a-row-h"><b>Bot</b><span class="a-tag ' + (on ? 'ok' : '') + '">' + (on ? 'Running' : 'Stopped') + '</span></div><div class="a-meta">' + (on ? 'Posts every ' + esc(s.bot_interval_min) + ' min' : 'Not posting') + ', ' + st.pool + ' messages in its pool.</div></div>' +
        '<div class="a-row tap" data-go="controls"><div class="a-row-h"><b>Announcement</b><span class="a-tag ' + (ann ? 'info' : '') + '">' + (ann ? 'Showing' : 'None') + '</span></div><div class="a-meta">' + (ann ? esc(ann) : 'Nothing is pinned for visitors.') + '</div></div>' +
        (x ? '<div class="a-row"><div class="a-row-h"><b>Support Buddy today</b></div><div class="a-meta">' + x.chat_today + ' AI replies so far. The daily limit is set in Supabase (DAILY_CAP).</div></div>' : '') +
        '</div>';
      html += '<h3 class="a-sec">Latest public posts</h3>' + (recent.length ? '<div class="a-list">' + recent.slice(0, 5).map(postRow).join('') + '</div><button class="a-btn a-more" data-go="posts">See all posts</button>' : '<div class="a-empty"><b>Nothing posted yet</b>New public posts show up here.</div>');
      pane().innerHTML = html;
      bindGo();
    }).catch(function (e) { if (g === gen) { pane().innerHTML = '<div class="a-empty"><b>Could not load</b>' + esc(dbHint(e)) + '</div>'; aErr(e); } });
  }
  function bindGo() {
    [].forEach.call(pane().querySelectorAll('[data-go]'), function (el) { el.onclick = function () { go(el.dataset.go, true); }; });
  }
  function postRow(m, opts) {
    opts = opts || {};
    return '<div class="a-row"><div class="a-row-h"><b>To: ' + esc(m.to_name) + '</b>' + (m.is_bot ? '<span class="a-tag">Bot</span>' : '') +
      (m.open_reports ? '<span class="a-tag bad">' + m.open_reports + ' report' + (m.open_reports > 1 ? 's' : '') + '</span>' : '') + '</div>' +
      '<p class="a-text">' + esc(m.body) + '</p>' +
      '<div class="a-meta">' + (m.song ? esc(m.song) + (m.artist ? ' by ' + esc(m.artist) : '') + ', ' : '') + esc(ago(m.created_at)) + (m.reactions ? ', ' + m.reactions + ' reactions' : '') + '</div>' +
      (opts.noDelete ? '' : '<div class="a-acts"><button class="a-btn danger" data-delpost="' + esc(m.id) + '">Delete post</button></div>') + '</div>';
  }
  document.addEventListener('click', function (e) {
    var d = e.target.closest('[data-delpost]'); if (!d) return;
    if (!confirm('Delete this post for good? This cannot be undone.')) return;
    d.disabled = true;
    rpcA('admin_delete_msg', { mid: d.dataset.delpost }).then(function () { toast('Post deleted.'); keepScroll(function () { return refreshCurrent(); }); }).catch(function (err) { d.disabled = false; aErr(err); });
  });
  function refreshCurrent() { go(ATAB, false); return new Promise(function (r) { setTimeout(r, 400); }); }

  /* =====================================================================
     Posts + reports
     ===================================================================== */
  var PS = { sub: 'reports', rstat: 'open', kind: 'all', q: '', rows: [], more: false };
  function vPosts() {
    var g = gen;
    var head = '<h2 class="a-h">Posts</h2><div class="a-seg" id="psub"><button data-s="reports" aria-pressed="' + (PS.sub === 'reports') + '">Reports</button><button data-s="all" aria-pressed="' + (PS.sub === 'all') + '">All posts</button></div>';
    pane().innerHTML = head + skel(2);
    $('psub').onclick = function (e) { var b = e.target.closest('button'); if (b) { PS.sub = b.dataset.s; go('posts', false); } };
    if (PS.sub === 'reports') {
      rpcA('admin_reports', { p_status: PS.rstat === 'open' ? 'open' : 'all' }).then(function (rows) {
        if (g !== gen) return;
        setPip('posts', rows.filter(function (r) { return r.status === 'open'; }).length);
        var html = head + '<div class="a-seg"><button data-r="open" aria-pressed="' + (PS.rstat === 'open') + '">Needs review</button><button data-r="all" aria-pressed="' + (PS.rstat !== 'open') + '">History</button></div>';
        html += rows.length ? '<div class="a-list">' + rows.map(reportRow).join('') + '</div>' :
          '<div class="a-empty"><b>' + (PS.rstat === 'open' ? 'No reports to review' : 'No reports yet') + '</b>When someone reports a public post, it appears here.</div>';
        pane().innerHTML = html;
        $('psub').onclick = function (e) { var b = e.target.closest('button'); if (b) { PS.sub = b.dataset.s; go('posts', false); } };
        [].forEach.call(pane().querySelectorAll('[data-r]'), function (b) { b.onclick = function () { PS.rstat = b.dataset.r; go('posts', false); }; });
        [].forEach.call(pane().querySelectorAll('[data-rep]'), function (b) {
          b.onclick = function () {
            var act = b.dataset.act;
            if (act === 'delete' && !confirm('Delete this post for good and close its reports?')) return;
            b.disabled = true;
            rpcA('admin_resolve_report', { p_id: b.dataset.rep, p_action: act }).then(function () { toast(act === 'delete' ? 'Post deleted.' : 'Post kept. Report closed.'); keepScroll(function () { return refreshCurrent(); }); }).catch(function (err) { b.disabled = false; aErr(err); });
          };
        });
      }).catch(function (e) { if (g !== gen) return; pane().innerHTML = head + (needsUpgrade(e) ? upgradeNote() : '<div class="a-empty"><b>Could not load</b>' + esc(dbHint(e)) + '</div>'); $('psub').onclick = function (ev) { var b = ev.target.closest('button'); if (b) { PS.sub = b.dataset.s; go('posts', false); } }; });
    } else {
      postsList(g, head, true);
    }
  }
  function reportRow(r) {
    var open = r.status === 'open';
    return '<div class="a-row"><div class="a-row-h"><span class="a-tag bad">' + esc(REASON[r.reason] || r.reason) + '</span>' +
      (r.report_count > 1 ? '<span class="a-tag">' + r.report_count + ' reports</span>' : '') +
      (open ? '' : '<span class="a-tag ' + (r.status === 'actioned' ? 'warn' : 'ok') + '">' + esc(STATUS[r.status]) + '</span>') + '</div>' +
      (r.body ? '<p class="a-text">' + esc(r.body) + '</p><div class="a-meta">To: ' + esc(r.to_name) + ', ' + esc(r.song) + ' by ' + esc(r.artist) + '</div>'
              : '<p class="a-text a-meta">This post was already removed.</p>') +
      (r.note ? '<div class="a-quote">Reporter note: ' + esc(r.note) + '</div>' : '') +
      '<div class="a-meta" style="margin-top:6px">Reported ' + esc(ago(r.created_at)) + '</div>' +
      (open ? '<div class="a-acts">' + (r.body ? '<button class="a-btn danger" data-rep="' + esc(r.id) + '" data-act="delete">Delete post</button>' : '') +
        '<button class="a-btn" data-rep="' + esc(r.id) + '" data-act="dismiss">' + (r.body ? 'Keep post' : 'Close') + '</button></div>' : '') + '</div>';
  }
  function postsList(g, head, first, before) {
    rpcA('admin_posts', { p_search: PS.q || null, p_kind: PS.kind, p_limit: 30, p_before: before || null }).then(function (rows) {
      if (g !== gen) return;
      PS.rows = first ? rows : PS.rows.concat(rows); PS.more = rows.length === 30;
      if (first) {
        pane().innerHTML = head +
          '<div class="a-search"><input id="pq" type="search" placeholder="Search text, name or song" value="' + esc(PS.q) + '" autocomplete="off"></div>' +
          '<div class="a-seg" id="pkind"><button data-k="all" aria-pressed="' + (PS.kind === 'all') + '">All</button><button data-k="people" aria-pressed="' + (PS.kind === 'people') + '">People</button><button data-k="bot" aria-pressed="' + (PS.kind === 'bot') + '">Bot</button></div><div id="plist"></div>';
        $('psub').onclick = function (e) { var b = e.target.closest('button'); if (b) { PS.sub = b.dataset.s; go('posts', false); } };
        var t; $('pq').oninput = function () { clearTimeout(t); t = setTimeout(function () { PS.q = $('pq').value.trim(); loadPostsOnly(); }, 350); };
        $('pkind').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; PS.kind = b.dataset.k; [].forEach.call($('pkind').children, function (x) { x.setAttribute('aria-pressed', x === b); }); loadPostsOnly(); };
      }
      paintPosts();
    }).catch(function (e) { if (g !== gen) return; if (first) pane().innerHTML = head + (needsUpgrade(e) ? upgradeNote() : '<div class="a-empty"><b>Could not load</b>' + esc(dbHint(e)) + '</div>'); else aErr(e); });
  }
  function loadPostsOnly() { var g = gen; postsList(g, '', false); PS.rows = []; var l = $('plist'); if (l) l.innerHTML = skel(2); }
  function paintPosts() {
    var l = $('plist'); if (!l) return;
    l.innerHTML = PS.rows.length ? '<div class="a-list">' + PS.rows.map(postRow).join('') + '</div>' + (PS.more ? '<button class="a-btn a-more" id="pmore">Load more</button>' : '') :
      '<div class="a-empty"><b>' + (PS.q ? 'No matches' : 'No posts yet') + '</b>' + (PS.q ? 'Try different words.' : 'Public posts appear here.') + '</div>';
    if ($('pmore')) $('pmore').onclick = function () { var last = PS.rows[PS.rows.length - 1]; $('pmore').disabled = true; postsList(gen, '', false, last && last.created_at); };
  }

  /* =====================================================================
     Support: tickets + knowledge
     ===================================================================== */
  var SS = { sub: 'tickets', f: 'all', kf: 'all' };
  function subSeg(sub) {
    return '<div class="a-seg" id="ssub"><button data-s="tickets" aria-pressed="' + (sub === 'tickets') + '">Tickets</button><button data-s="kb" aria-pressed="' + (sub === 'kb') + '">Knowledge</button></div>';
  }
  function bindSub() { $('ssub').onclick = function (e) { var b = e.target.closest('button'); if (b) { SS.sub = b.dataset.s; go('support', false); } }; }
  function fchips(cur, names) {
    return '<div class="a-seg" id="sf">' + names.map(function (n) { return '<button data-f="' + n + '" aria-pressed="' + (n === cur) + '">' + (n === 'all' ? 'All' : STATUS[n]) + '</button>'; }).join('') + '</div>';
  }
  function vSupport() { if (SS.sub === 'kb') supKB(); else supTickets(); }
  function supTickets() {
    var g = gen, f = SS.f;
    A('support_tickets?select=*&order=created_at.desc&limit=100' + (f === 'all' ? '' : '&status=eq.' + f)).then(function (rows) {
      if (g !== gen) return;
      rows.forEach(function (t) { TK[t.id] = t; });
      pane().innerHTML = '<h2 class="a-h">Support</h2>' + subSeg('tickets') + fchips(f, ['all', 'pending', 'in_progress', 'resolved']) +
        (rows.length ? '<div class="a-list">' + rows.map(function (t) {
          return '<div class="a-row tap" data-tk="' + esc(t.id) + '" role="button" tabindex="0"><div class="a-row-h"><b>#' + t.ticket_no + '</b><span class="a-tag ' + (t.status === 'resolved' ? 'ok' : t.status === 'pending' ? 'warn' : 'info') + '">' + esc(STATUS[t.status]) + '</span><span class="a-meta" style="margin-left:auto">' + esc(ago(t.created_at)) + '</span></div><p class="a-text" style="margin-bottom:0">' + esc(String(t.summary).slice(0, 140)) + (t.summary.length > 140 ? '...' : '') + '</p></div>';
        }).join('') + '</div>' : '<div class="a-empty"><b>No tickets here</b>Requests sent from Support Buddy appear here.</div>');
      bindSub();
      $('sf').onclick = function (e) { var b = e.target.closest('button'); if (b) { SS.f = b.dataset.f; go('support', false); } };
      [].forEach.call(pane().querySelectorAll('[data-tk]'), function (el) { el.onclick = function () { aTicket(el.dataset.tk); }; });
    }).catch(function (e) { if (g === gen) pane().innerHTML = '<div class="a-empty"><b>Could not load</b>' + esc(dbHint(e)) + '</div>'; aErr(e); });
  }
  function aTicket(id) {
    var t = TK[id]; if (!t) return;
    window.scrollTo(0, 0);
    pane().innerHTML = '<button class="a-back" id="tback">&larr; All tickets</button>' +
      '<div class="a-block"><h3>Ticket #' + t.ticket_no + ' <span class="a-tag ' + (t.status === 'resolved' ? 'ok' : t.status === 'pending' ? 'warn' : 'info') + '">' + esc(STATUS[t.status]) + '</span></h3>' +
      '<p class="sub" style="margin:0 0 6px">Received ' + esc(when(t.created_at)) + '. The user agreed to share only this text:</p>' +
      '<div class="a-quote">' + esc(t.summary) + '</div>' +
      '<label for="tres">Your response (the user sees it when they check their ticket)</label><textarea id="tres" maxlength="2000">' + esc(t.admin_response || '') + '</textarea>' +
      '<label for="tst">Status</label><select id="tst">' + ['pending', 'in_progress', 'resolved'].map(function (s) { return '<option value="' + s + '"' + (s === t.status ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('') + '</select>' +
      '<button class="btn full" id="tsend">Send response</button>' +
      '<div class="a-acts"><button class="a-btn" id="tres2">Mark resolved</button><button class="a-btn" id="tkb">Add to knowledge</button></div></div>';
    $('tback').onclick = function () { go('support', false); };
    function save(status) {
      var r = $('tres').value.trim(), body = { status: status };
      if (r) { body.admin_response = r; if (!t.responded_at || r !== t.admin_response) body.responded_at = new Date().toISOString(); }
      A('support_tickets?id=eq.' + id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) })
        .then(function () { toast(status === 'resolved' ? 'Marked resolved.' : 'Response saved.'); Object.assign(t, body); go('support', false); }).catch(aErr);
    }
    $('tsend').onclick = function () {
      if (!$('tres').value.trim()) { toast('Write a response first.', true); return; }
      var s = $('tst').value; save(s === 'pending' ? 'in_progress' : s);
    };
    $('tres2').onclick = function () { save('resolved'); };
    $('tkb').onclick = function () { aKBForm(null, { response: $('tres').value.trim(), source_ticket: id }); };
  }
  function supKB() {
    var g = gen, f = SS.kf;
    A('kb_entries?select=*&order=updated_at.desc&limit=200' + (f === 'all' ? '' : '&status=eq.' + f)).then(function (rows) {
      if (g !== gen) return;
      rows.forEach(function (k) { KB[k.id] = k; });
      pane().innerHTML = '<h2 class="a-h">Support</h2>' + subSeg('kb') + '<button class="btn full" id="knew" style="margin:0 0 14px">New entry</button>' + fchips(f, ['all', 'draft', 'approved', 'archived']) +
        (rows.length ? '<div class="a-list">' + rows.map(function (k) {
          return '<div class="a-row tap" data-kb="' + esc(k.id) + '" role="button" tabindex="0"><div class="a-row-h"><b>' + esc(k.category) + '</b><span class="a-tag ' + (k.status === 'approved' ? 'ok' : k.status === 'draft' ? 'warn' : '') + '">' + esc(STATUS[k.status]) + '</span></div><p class="a-text" style="margin-bottom:0">' + esc(String(k.problem).slice(0, 140)) + '</p></div>';
        }).join('') + '</div>' : '<div class="a-empty"><b>No entries here</b>Approved entries help Support Buddy answer better.</div>');
      bindSub();
      $('knew').onclick = function () { aKBForm(null, {}); };
      $('sf').onclick = function (e) { var b = e.target.closest('button'); if (b) { SS.kf = b.dataset.f; go('support', false); } };
      [].forEach.call(pane().querySelectorAll('[data-kb]'), function (el) { el.onclick = function () { aKBForm(el.dataset.kb, {}); }; });
    }).catch(function (e) { if (g === gen) pane().innerHTML = '<div class="a-empty"><b>Could not load</b>' + esc(dbHint(e)) + '</div>'; aErr(e); });
  }
  function aKBForm(id, pre) {
    var k = id ? KB[id] : Object.assign({ category: 'general', problem: '', response: '', status: 'draft' }, pre);
    window.scrollTo(0, 0);
    pane().innerHTML = '<button class="a-back" id="kback">&larr; Knowledge</button><div class="a-block"><h3>' + (id ? 'Edit entry' : 'New entry') + '</h3>' +
      '<p class="sub">Support Buddy may reuse APPROVED entries in other chats. Write in general terms: no names, places, handles or anything that points to one person.</p>' +
      '<label for="kcat">Category</label><input id="kcat" maxlength="60" value="' + esc(k.category) + '">' +
      '<label for="kpr">The concern (generalized)</label><textarea id="kpr" maxlength="1000">' + esc(k.problem) + '</textarea>' +
      '<label for="kres">Suggested response or guidance</label><textarea id="kres" maxlength="2000">' + esc(k.response) + '</textarea>' +
      '<label for="kst">Status</label><select id="kst">' + ['draft', 'approved', 'archived'].map(function (s) { return '<option value="' + s + '"' + (s === k.status ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('') + '</select>' +
      '<label class="check"><input type="checkbox" id="kok" style="width:auto;margin-right:8px"> I removed all personal details from this entry</label>' +
      '<button class="btn full" id="ksave">Save entry</button>' +
      '<div class="a-acts"><button class="a-btn" id="kapp">Approve</button><button class="a-btn" id="karch">Archive</button>' + (id ? '<button class="a-btn danger" id="kdel">Delete entry</button>' : '') + '</div></div>';
    $('kback').onclick = function () { SS.sub = 'kb'; go('support', false); };
    function save(status) {
      var b = { category: $('kcat').value.trim() || 'general', problem: $('kpr').value.trim(), response: $('kres').value.trim(), status: status };
      if (b.problem.length < 5 || b.response.length < 5) { toast('Fill in the concern and the response.', true); return; }
      if (status === 'approved' && !$('kok').checked) { toast('Tick the box to confirm no personal details.', true); return; }
      if (!id && pre.source_ticket) b.source_ticket = pre.source_ticket;
      A(id ? 'kb_entries?id=eq.' + id : 'kb_entries', { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(b) })
        .then(function () { toast(status === 'approved' ? 'Approved. Support Buddy can use it now.' : 'Entry saved.'); SS.sub = 'kb'; go('support', false); }).catch(aErr);
    }
    $('ksave').onclick = function () { save($('kst').value); };
    $('kapp').onclick = function () { save('approved'); };
    $('karch').onclick = function () { save('archived'); };
    if (id) $('kdel').onclick = function () { if (!confirm('Delete this entry for good?')) return; A('kb_entries?id=eq.' + id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).then(function () { toast('Entry deleted.'); SS.sub = 'kb'; go('support', false); }).catch(aErr); };
  }

  /* =====================================================================
     People
     ===================================================================== */
  var PQ = '';
  function vPeople() {
    var g = gen;
    pane().innerHTML = '<h2 class="a-h">People</h2><div class="a-search"><input id="uq" type="search" placeholder="Search a username" value="' + esc(PQ) + '" autocomplete="off" autocapitalize="none"></div><div id="ulist">' + skel(3) + '</div>';
    var t; $('uq').oninput = function () { clearTimeout(t); t = setTimeout(function () { PQ = $('uq').value.trim(); loadUsers(gen); }, 350); };
    loadUsers(g);
  }
  function loadUsers(g) {
    rpcA('admin_users', { p_search: PQ || null, p_limit: 60 }).then(function (rows) {
      if (g !== gen || !$('ulist')) return;
      $('ulist').innerHTML = rows.length ? '<p class="a-meta" style="margin:0 0 8px">' + rows.length + ' shown, newest first. PINs and private messages are never shown here.</p><div class="a-list">' + rows.map(function (u) {
        return '<div class="a-row"><div class="a-row-h"><b>@' + esc(u.username) + '</b><span class="a-tag ' + (u.has_pin ? 'ok' : 'warn') + '">' + (u.has_pin ? 'Has PIN' : 'No PIN') + '</span></div>' +
          '<div class="a-meta">Joined ' + esc(ago(u.created_at)) + ', ' + u.inbox_count + ' in Inbox</div>' +
          '<div class="a-acts"><button class="a-btn danger" data-du="' + esc(u.id) + '" data-name="' + esc(u.username) + '">Delete account</button></div></div>';
      }).join('') + '</div>' : '<div class="a-empty"><b>' + (PQ ? 'No matches' : 'No usernames yet') + '</b>' + (PQ ? 'Check the spelling, including the number.' : 'Accounts appear here as people join.') + '</div>';
      [].forEach.call($('ulist').querySelectorAll('[data-du]'), function (b) {
        b.onclick = function () {
          if (!confirm('Delete @' + b.dataset.name + '? Their username, login and Inbox are removed for good.')) return;
          b.disabled = true;
          rpcA('admin_delete_user', { p_id: b.dataset.du }).then(function () { toast('Account deleted.'); loadUsers(gen); }).catch(function (e) { b.disabled = false; aErr(e); });
        };
      });
    }).catch(function (e) { if (g !== gen || !$('ulist')) return; $('ulist').innerHTML = needsUpgrade(e) ? upgradeNote() : '<div class="a-empty"><b>Could not load</b>' + esc(dbHint(e)) + '</div>'; });
  }

  /* =====================================================================
     Controls
     ===================================================================== */
  function vControls() {
    var g = gen;
    Promise.all([
      rpcA('admin_state'),
      rpcA('admin_words').catch(function (e) { return needsUpgrade(e) ? null : []; }),
      rpcA('admin_pool').catch(function (e) { return needsUpgrade(e) ? null : []; })
    ]).then(function (res) {
      if (g !== gen) return;
      var st = res[0], words = res[1], pool = res[2], s = st.settings || {};
      var on = s.bot_enabled === 'true', mt = s.maintenance === 'true', upgraded = words !== null;
      var html = '<h2 class="a-h">Controls</h2>' + (upgraded ? '' : upgradeNote());

      html += '<div class="a-block"><h3>Announcement</h3><p class="sub">A short notice pinned at the top of the app for everyone. Leave empty to hide it.</p>' +
        '<div class="a-field"><input id="ann" maxlength="200" placeholder="For example: New feature this weekend" value="' + esc(s.announcement || '') + '"' + (upgraded ? '' : ' disabled') + '></div>' +
        '<div class="a-acts"><button class="a-btn pri" id="annSave"' + (upgraded ? '' : ' disabled') + '>Save announcement</button><button class="a-btn" id="annClear"' + (upgraded ? '' : ' disabled') + '>Remove</button></div></div>';

      html += '<div class="a-block"><div class="a-switch-row"><div><h3>Maintenance mode</h3><p class="sub" style="margin:0">' + (mt ? 'On: visitors see the maintenance screen.' : 'Off: the app is open to everyone.') + '</p></div>' +
        '<button class="a-switch warn" role="switch" aria-checked="' + mt + '" aria-label="Maintenance mode" id="mtSw"></button></div>' +
        '<label for="anote">Message for visitors</label><div class="a-field" style="margin-top:0"><input id="anote" maxlength="200" value="' + esc(s.maintenance_note || '') + '"><button class="a-btn" id="anoteSave">Save</button></div></div>';

      html += '<div class="a-block"><div class="a-switch-row"><div><h3>Posting bot</h3><p class="sub" style="margin:0">' + (on ? 'Running. Posts one message from its pool every ' + esc(s.bot_interval_min) + ' min.' : 'Stopped. Its posts carry a Bot stamp.') + '</p></div>' +
        '<button class="a-switch" role="switch" aria-checked="' + on + '" aria-label="Posting bot" id="botSw"></button></div>' +
        '<label for="aiv">Post every</label><select id="aiv">' + [5, 15, 30, 60, 180, 720].map(function (m) { return '<option value="' + m + '"' + (String(m) === s.bot_interval_min ? ' selected' : '') + '>' + m + ' min</option>'; }).join('') + '</select>' +
        '<div class="a-acts"><button class="a-btn pri" id="anow">Post one now</button><button class="a-btn danger" id="adel">Delete all bot posts (' + st.bots + ')</button></div></div>';

      if (pool) {
        html += '<div class="a-block"><h3>Bot message pool <span class="a-tag">' + pool.length + '</span></h3><p class="sub">What the bot picks from. Add your own, or remove ones you do not like.</p>' +
          '<div class="a-grid2"><input id="pto" maxlength="40" placeholder="To (name)"><input id="psong" maxlength="200" placeholder="Song title"></div>' +
          '<div class="a-grid2"><input id="partist" maxlength="200" placeholder="Artist"><input id="pbody" maxlength="500" placeholder="Message"></div>' +
          '<div class="a-acts"><button class="a-btn pri" id="padd">Add to pool</button></div>' +
          (pool.length ? '<details style="margin-top:12px"><summary class="a-meta" style="cursor:pointer">Show all ' + pool.length + ' messages</summary><div class="a-list" style="margin-top:10px">' + pool.map(function (p) {
            return '<div class="a-row"><div class="a-row-h"><b>To: ' + esc(p.to_name) + '</b></div><p class="a-text">' + esc(p.body) + '</p><div class="a-meta">' + esc(p.song) + ' by ' + esc(p.artist) + '</div><div class="a-acts"><button class="a-btn danger" data-pd="' + p.id + '">Remove</button></div></div>';
          }).join('') + '</div></details>' : '') + '</div>';
      }

      if (words) {
        html += '<div class="a-block"><h3>Blocked words <span class="a-tag">' + words.length + '</span></h3><p class="sub">Messages containing these words cannot be sent. Not case sensitive. Matches inside longer words too, so keep them specific.</p>' +
          '<div class="a-field" style="margin-top:0"><input id="wnew" maxlength="40" placeholder="Add a word or phrase" autocapitalize="none"><button class="a-btn pri" id="wadd">Add</button></div>' +
          (words.length ? '<div class="a-words">' + words.map(function (w) { return '<span class="a-word">' + esc(w) + '<button data-wd="' + esc(w) + '" aria-label="Remove ' + esc(w) + '">&times;</button></span>'; }).join('') + '</div>' : '') + '</div>';
      }

      html += '<details class="a-block"><summary>System settings</summary><div style="margin-top:10px">' + Object.keys(s).map(function (k) { return '<div class="a-kv"><span>' + esc(k) + '</span><b>' + esc(s[k]) + '</b></div>'; }).join('') + '</div></details>';
      pane().innerHTML = html;

      var again = function () { keepScroll(function () { return refreshCurrent(); }); };
      $('mtSw').onclick = function () { rpcA('admin_set', { k: 'maintenance', v: mt ? 'false' : 'true' }).then(function () { toast(mt ? 'Maintenance is off.' : 'Maintenance is on.'); again(); }).catch(aErr); };
      $('anoteSave').onclick = function () { rpcA('admin_set', { k: 'maintenance_note', v: $('anote').value }).then(function () { toast('Message saved.'); }).catch(aErr); };
      $('botSw').onclick = function () { rpcA('admin_set', { k: 'bot_enabled', v: on ? 'false' : 'true' }).then(function () { toast(on ? 'Bot stopped.' : 'Bot started.'); again(); }).catch(aErr); };
      $('aiv').onchange = function () { rpcA('admin_set', { k: 'bot_interval_min', v: $('aiv').value }).then(function () { toast('Interval saved.'); again(); }).catch(aErr); };
      $('anow').onclick = function () { rpcA('admin_post_now').then(function () { toast('Posted one bot message.'); }).catch(aErr); };
      $('adel').onclick = function () { if (!confirm('Delete all bot posts?')) return; rpcA('admin_delete_bots').then(function (n) { toast('Deleted ' + n + ' bot posts.'); again(); }).catch(aErr); };
      if (upgraded) {
        $('annSave').onclick = function () { rpcA('admin_set', { k: 'announcement', v: $('ann').value.trim() }).then(function () { toast('Announcement saved.'); }).catch(aErr); };
        $('annClear').onclick = function () { rpcA('admin_set', { k: 'announcement', v: '' }).then(function () { toast('Announcement removed.'); $('ann').value = ''; }).catch(aErr); };
      }
      if (pool) {
        $('padd').onclick = function () {
          var a = { p_to: $('pto').value, p_body: $('pbody').value, p_song: $('psong').value, p_artist: $('partist').value };
          if (!a.p_to.trim() || !a.p_body.trim() || !a.p_song.trim() || !a.p_artist.trim()) { toast('Fill in all four fields.', true); return; }
          rpcA('admin_pool_add', a).then(function () { toast('Added to the pool.'); again(); }).catch(aErr);
        };
        [].forEach.call(pane().querySelectorAll('[data-pd]'), function (b) {
          b.onclick = function () { if (!confirm('Remove this message from the pool?')) return; rpcA('admin_pool_del', { p_id: +b.dataset.pd }).then(function () { toast('Removed.'); again(); }).catch(aErr); };
        });
      }
      if (words) {
        var addWord = function () { var w = $('wnew').value.trim(); if (w.length < 2) { toast('Use at least 2 letters.', true); return; } rpcA('admin_word_add', { p_word: w }).then(function () { toast('Word blocked.'); again(); }).catch(aErr); };
        $('wadd').onclick = addWord; $('wnew').onkeydown = function (e) { if (e.key === 'Enter') addWord(); };
        [].forEach.call(pane().querySelectorAll('[data-wd]'), function (b) {
          b.onclick = function () { rpcA('admin_word_del', { p_word: b.dataset.wd }).then(function () { toast('Word allowed again.'); again(); }).catch(aErr); };
        });
      }
    }).catch(function (e) { if (g === gen) pane().innerHTML = '<div class="a-empty"><b>Could not load</b>' + esc(dbHint(e)) + '</div>'; aErr(e); });
  }

  adminBoot();
})();
