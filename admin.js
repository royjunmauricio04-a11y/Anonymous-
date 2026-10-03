/* admin.html: Maintenance Center. Separate from the main app. Sign in with a Supabase Auth account
   that you listed in public.admins (see admin-user.sql). */
(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var REMOTE = !!(C.SUPABASE_URL && C.SUPABASE_KEY);
  var $ = function (i) { return document.getElementById(i); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function dbHint(e) {
    if (!e || !e.status) return 'Could not reach the database. Check your connection.';
    var code = '', msg = ''; try { var j = JSON.parse(e.text); code = j.code || ''; msg = j.message || j.msg || ''; } catch (x) {}
    if (code === 'PGRST202') return 'The admin tools are not installed. Run setup.sql in Supabase.';
    if (code === '42501' || e.status === 403) return 'Not allowed. Is your account listed as an admin (admin-user.sql)?';
    if (code === 'PGRST205' || code === '42P01' || e.status === 404) return 'Tables are missing. Run setup.sql in Supabase.';
    return msg || ('Database error (' + e.status + ').');
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
  var STATUS = { pending: 'Pending', in_progress: 'In progress', resolved: 'Resolved', draft: 'Draft', approved: 'Approved', archived: 'Archived' };
  function when(t) { try { return new Date(t).toLocaleString(); } catch (e) { return ''; } }
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
  /* ---------- admin sign-in (Supabase Auth: email + password) ---------- */
  var SK = 'anon-admin-session', pollT = null, lastPending = null;
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
    }).catch(function (e) { sessSet(null); throw e; });
  }
  function A(path, opt) {
    return token().then(function (t) { opt = opt || {}; opt.headers = Object.assign({ Authorization: 'Bearer ' + t }, opt.headers); return api(path, opt); });
  }
  function rpcA(fn, args) { return A('rpc/' + fn, { method: 'POST', body: JSON.stringify(args || {}) }); }
  function aErr(e) {
    var t = (e && e.text) || '';
    if (e && e.status === 401 && !/not authorized/.test(t)) { signedOut('Your session ended. Please sign in again.'); return; }
    toast(/not authorized/.test(t) ? 'This account is not an admin.' : (e && e.msg && !e.status ? e.msg : dbHint(e)), true);
  }
  function signedOut(note) {
    sessSet(null); clearInterval(pollT); pollT = null; lastPending = null;
    $('alogin').hidden = false; $('apanel').hidden = true; $('amsg').className = 'msg'; $('amsg').textContent = note || '';
  }
  function adminBoot() {
    if (!REMOTE) { $('amsg').textContent = 'Connect Supabase first (config.js).'; return; }
    if (!sess()) { signedOut(''); return; }
    rpcA('is_admin').then(function (ok) { if (ok === true) adminShell(); else { $('amsg').textContent = ''; notAdmin(); } })
      .catch(function (e) { signedOut(e && e.status === 401 ? 'Please sign in.' : dbHint(e)); });
  }
  function notAdmin() {
    $('alogin').hidden = true; $('apanel').hidden = false;
    $('apanel').innerHTML = '<div class="box"><h3>Not an admin</h3><p class="sub">You are signed in as ' + esc((sess() || {}).email) + ', but this account is not on the admin list. See admin-user.sql.</p><button class="btn full" id="alogout">Sign out</button></div>';
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

  /* ---------- maintenance center ---------- */
  var ATAB = 'overview', TK = {}, KB = {};
  function adminShell() {
    $('alogin').hidden = true; $('apanel').hidden = false;
    $('apanel').innerHTML =
      '<div class="between"><span class="who" id="aemail"></span><span><button class="link" id="aalerts">Alerts</button> <button class="link" id="alogout">Sign out</button></span></div>' +
      '<div class="atabs" id="atabs"><button data-a="overview">Overview</button><button data-a="support">Support <span class="badge" id="abadge" hidden></span></button><button data-a="kb">Knowledge</button></div>' +
      '<div id="apane"></div>';
    $('aemail').textContent = (sess() || {}).email || 'Admin';
    $('alogout').onclick = doLogout;
    $('aalerts').onclick = function () {
      if (!('Notification' in window)) { toast('This browser does not support alerts.', true); return; }
      Notification.requestPermission().then(function (p) { toast(p === 'granted' ? 'Alerts on while this page is open.' : 'Alerts are blocked.', p !== 'granted'); });
    };
    $('atabs').onclick = function (e) { var b = e.target.closest('button'); if (b) aGo(b.dataset.a); };
    aGo(ATAB); clearInterval(pollT); pollT = setInterval(aPoll, 30000);
  }
  function aGo(t) {
    ATAB = t;
    [].forEach.call($('atabs').children, function (b) { b.setAttribute('aria-selected', b.dataset.a === t); });
    if (t === 'overview') aOverview(); else if (t === 'support') aSupport('all'); else aKB('all');
  }
  function aPoll() {
    rpcA('admin_state').then(function (st) { badge(st.tickets_pending || 0); }).catch(function () {});
  }
  function badge(n) {
    var b = $('abadge'); if (b) { b.textContent = n; b.hidden = !n; }
    if (lastPending !== null && n > lastPending) {
      toast('New support ticket (' + n + ' pending).');
      try { if (window.Notification && Notification.permission === 'granted') new Notification('New support ticket', { body: n + ' pending' }); } catch (e) {}
    }
    lastPending = n;
  }
  function aOverview() {
    rpcA('admin_state').then(function (st) {
      badge(st.tickets_pending || 0);
      var s = st.settings || {}, on = s.bot_enabled === 'true', mt = s.maintenance === 'true';
      $('apane').innerHTML =
        '<div class="box"><h3>Bot <span class="dot ' + (on ? 'on' : 'off') + '"></span></h3><p class="who">' + (on ? 'Running' : 'Stopped') + '</p>' +
        '<p class="sub">Posts one message from its pool every ' + esc(s.bot_interval_min) + ' min. Its posts carry a Bot stamp.</p>' +
        '<label for="aiv">Post every</label><select id="aiv">' + [5, 15, 30, 60, 180, 720].map(function (m) { return '<option value="' + m + '"' + (String(m) === s.bot_interval_min ? ' selected' : '') + '>' + m + ' min</option>'; }).join('') + '</select>' +
        '<div class="row" style="margin-top:14px"><button class="btn" id="abot">' + (on ? 'Stop bot' : 'Start bot') + '</button><button class="btn ghost" id="anow">Post one now</button></div>' +
        '<button class="link" id="adel">Delete all bot posts (' + st.bots + ')</button></div>' +
        '<div class="box" style="margin-top:16px"><h3>Maintenance mode <span class="dot ' + (mt ? 'warn' : 'off') + '"></span></h3><p class="sub">' + (mt ? 'ON: visitors see the maintenance screen.' : 'OFF: the app is open to everyone.') + '</p>' +
        '<label for="anote">Announcement for visitors</label><input id="anote" maxlength="200" value="' + esc(s.maintenance_note || '') + '">' +
        '<button class="btn full" id="amt">' + (mt ? 'Turn maintenance off' : 'Turn maintenance on') + '</button></div>' +
        '<div class="box" style="margin-top:16px"><h3>Numbers</h3><p style="margin:0">' + st.users + ' usernames, ' + st.messages + ' messages (' + st.bots + ' from the bot), ' + st.pool + ' in the bot pool.<br>' + (st.tickets_pending || 0) + ' pending of ' + (st.tickets_total || 0) + ' tickets, ' + (st.kb_approved || 0) + ' approved knowledge entries.</p></div>' +
        '<div class="box" style="margin-top:16px"><h3>System settings</h3>' + Object.keys(s).map(function (k) { return '<p class="kv"><span>' + esc(k) + '</span><b>' + esc(s[k]) + '</b></p>'; }).join('') + '</div>' +
        '<h2 class="sec">Recent messages</h2><div id="arecent"></div>';
      $('abot').onclick = function () { rpcA('admin_set', { k: 'bot_enabled', v: on ? 'false' : 'true' }).then(function () { toast(on ? 'Bot stopped.' : 'Bot started.'); aOverview(); }).catch(aErr); };
      $('aiv').onchange = function () { rpcA('admin_set', { k: 'bot_interval_min', v: $('aiv').value }).then(function () { toast('Interval saved.'); aOverview(); }).catch(aErr); };
      $('anow').onclick = function () { rpcA('admin_post_now').then(function () { toast('Posted one bot message.'); aOverview(); }).catch(aErr); };
      $('adel').onclick = function () { if (!confirm('Delete all bot posts?')) return; rpcA('admin_delete_bots').then(function (n) { toast('Deleted ' + n + ' bot posts.'); aOverview(); }).catch(aErr); };
      $('amt').onclick = function () {
        rpcA('admin_set', { k: 'maintenance_note', v: $('anote').value }).then(function () { return rpcA('admin_set', { k: 'maintenance', v: mt ? 'false' : 'true' }); })
          .then(function () { toast(mt ? 'Maintenance is off.' : 'Maintenance is on.'); aOverview(); }).catch(aErr);
      };
      rpcA('admin_recent').then(function (list) {
        $('arecent').innerHTML = list.length ? list.map(function (m) {
          return '<div class="box" style="margin-bottom:10px;padding:14px"><b>To: ' + esc(m.to_name) + '</b>' + (m.is_bot ? ' <span class="stamp">Bot</span>' : '') +
            '<p style="margin:6px 0;color:var(--muted)">' + esc(m.body) + '</p><span class="sub" style="font-size:.8rem">' + esc(when(m.created_at)) + '</span> <button class="link" data-del="' + esc(m.id) + '">Delete</button></div>';
        }).join('') : '<div class="empty">No messages yet.</div>';
      }).catch(function () {});
    }).catch(aErr);
  }
  document.addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]'); if (!d) return;
    if (!confirm('Delete this message for good?')) return;
    rpcA('admin_delete_msg', { mid: d.dataset.del }).then(function () { toast('Message deleted.'); aOverview(); }).catch(aErr);
  });

  /* support inbox */
  function chips(cur, names, fn) {
    return '<div class="fchips">' + names.map(function (n) { return '<button data-f="' + n + '" aria-pressed="' + (n === cur) + '">' + (n === 'all' ? 'All' : STATUS[n]) + '</button>'; }).join('') + '</div>';
  }
  function aSupport(f) {
    A('support_tickets?select=*&order=created_at.desc&limit=100' + (f === 'all' ? '' : '&status=eq.' + f)).then(function (rows) {
      rows.forEach(function (t) { TK[t.id] = t; });
      $('apane').innerHTML = chips(f, ['all', 'pending', 'in_progress', 'resolved']) +
        (rows.length ? rows.map(function (t) {
          return '<div class="box tk" data-tk="' + esc(t.id) + '" role="button" tabindex="0"><b>#' + t.ticket_no + '</b> <span class="chip s-' + esc(t.status) + '">' + esc(STATUS[t.status]) + '</span><span class="sub" style="font-size:.8rem;margin-left:8px">' + esc(when(t.created_at)) + '</span><p style="margin:6px 0 0;color:var(--muted)">' + esc(t.summary.slice(0, 110)) + '</p></div>';
        }).join('') : '<div class="empty">No tickets here.</div>');
      $('apane').querySelector('.fchips').onclick = function (e) { var b = e.target.closest('button'); if (b) aSupport(b.dataset.f); };
      [].forEach.call($('apane').querySelectorAll('.tk'), function (el) { el.onclick = function () { aTicket(el.dataset.tk); }; });
    }).catch(aErr);
  }
  function aTicket(id) {
    var t = TK[id]; if (!t) return;
    $('apane').innerHTML = '<button class="back" id="tback">&larr; All tickets</button>' +
      '<div class="box"><h3>Ticket #' + t.ticket_no + ' <span class="chip s-' + esc(t.status) + '">' + esc(STATUS[t.status]) + '</span></h3>' +
      '<p class="sub" style="margin:0 0 10px">Received ' + esc(when(t.created_at)) + '. The user agreed to share only this text:</p>' +
      '<p class="quote">' + esc(t.summary) + '</p>' +
      '<label for="tres">Your response (the user sees it when they check their ticket)</label><textarea id="tres" maxlength="2000">' + esc(t.admin_response || '') + '</textarea>' +
      '<label for="tst">Status</label><select id="tst">' + ['pending', 'in_progress', 'resolved'].map(function (s) { return '<option value="' + s + '"' + (s === t.status ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('') + '</select>' +
      '<button class="btn full" id="tsend">Send response</button>' +
      '<div class="row" style="margin-top:10px"><button class="btn ghost" id="tres2">Mark resolved</button><button class="btn ghost" id="tkb">Add to knowledge</button></div></div>';
    $('tback').onclick = function () { aSupport('all'); };
    function save(status) {
      var r = $('tres').value.trim(), body = { status: status };
      if (r) { body.admin_response = r; if (!t.responded_at || r !== t.admin_response) body.responded_at = new Date().toISOString(); }
      A('support_tickets?id=eq.' + id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) })
        .then(function () { toast(status === 'resolved' ? 'Marked resolved.' : 'Saved.'); Object.assign(t, body); aSupport('all'); }).catch(aErr);
    }
    $('tsend').onclick = function () {
      if (!$('tres').value.trim()) { toast('Write a response first.', true); return; }
      var s = $('tst').value; save(s === 'pending' ? 'in_progress' : s);
    };
    $('tres2').onclick = function () { save('resolved'); };
    $('tkb').onclick = function () { aKBForm(null, { response: $('tres').value.trim(), source_ticket: id }); };
  }

  /* knowledge base */
  function aKB(f) {
    A('kb_entries?select=*&order=updated_at.desc&limit=200' + (f === 'all' ? '' : '&status=eq.' + f)).then(function (rows) {
      rows.forEach(function (k) { KB[k.id] = k; });
      $('apane').innerHTML = '<button class="btn full" id="knew" style="margin:0 0 14px">New entry</button>' + chips(f, ['all', 'draft', 'approved', 'archived']) +
        (rows.length ? rows.map(function (k) {
          return '<div class="box tk" data-kb="' + esc(k.id) + '" role="button" tabindex="0"><b>' + esc(k.category) + '</b> <span class="chip s-' + esc(k.status) + '">' + esc(STATUS[k.status]) + '</span><p style="margin:6px 0 0;color:var(--muted)">' + esc(k.problem.slice(0, 110)) + '</p></div>';
        }).join('') : '<div class="empty">No entries here.</div>');
      $('knew').onclick = function () { aKBForm(null, {}); };
      $('apane').querySelector('.fchips').onclick = function (e) { var b = e.target.closest('button'); if (b) aKB(b.dataset.f); };
      [].forEach.call($('apane').querySelectorAll('[data-kb]'), function (el) { el.onclick = function () { aKBForm(el.dataset.kb, {}); }; });
    }).catch(aErr);
  }
  function aKBForm(id, pre) {
    var k = id ? KB[id] : Object.assign({ category: 'general', problem: '', response: '', status: 'draft' }, pre);
    $('apane').innerHTML = '<button class="back" id="kback">&larr; Knowledge</button><div class="box"><h3>' + (id ? 'Edit entry' : 'New entry') + '</h3>' +
      '<p class="sub" style="margin:0">The chatbot may reuse APPROVED entries in other chats. Write in general terms: no names, places, handles or anything that points to one person.</p>' +
      '<label for="kcat">Category</label><input id="kcat" maxlength="60" value="' + esc(k.category) + '">' +
      '<label for="kpr">The concern (generalized)</label><textarea id="kpr" maxlength="1000">' + esc(k.problem) + '</textarea>' +
      '<label for="kres">Suggested response or guidance</label><textarea id="kres" maxlength="2000">' + esc(k.response) + '</textarea>' +
      '<label for="kst">Status</label><select id="kst">' + ['draft', 'approved', 'archived'].map(function (s) { return '<option value="' + s + '"' + (s === k.status ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('') + '</select>' +
      '<label class="check"><input type="checkbox" id="kok"> I removed all personal details from this entry</label>' +
      '<button class="btn full" id="ksave">Save</button>' +
      '<div class="row" style="margin-top:10px"><button class="btn ghost" id="kapp">Approve</button><button class="btn ghost" id="karch">Archive</button></div>' +
      (id ? '<button class="link" id="kdel">Delete entry</button>' : '') + '</div>';
    $('kback').onclick = function () { aKB('all'); };
    function save(status) {
      var b = { category: $('kcat').value.trim() || 'general', problem: $('kpr').value.trim(), response: $('kres').value.trim(), status: status };
      if (b.problem.length < 5 || b.response.length < 5) { toast('Fill in the concern and the response.', true); return; }
      if (status === 'approved' && !$('kok').checked) { toast('Tick the box to confirm no personal details.', true); return; }
      if (!id && pre.source_ticket) b.source_ticket = pre.source_ticket;
      A(id ? 'kb_entries?id=eq.' + id : 'kb_entries', { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(b) })
        .then(function () { toast(status === 'approved' ? 'Approved. The bot can use it now.' : 'Saved.'); aKB('all'); }).catch(aErr);
    }
    $('ksave').onclick = function () { save($('kst').value); };
    $('kapp').onclick = function () { save('approved'); };
    $('karch').onclick = function () { save('archived'); };
    if (id) $('kdel').onclick = function () { if (!confirm('Delete this entry for good?')) return; A('kb_entries?id=eq.' + id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).then(function () { toast('Entry deleted.'); aKB('all'); }).catch(aErr); };
  }


  adminBoot();
})();
