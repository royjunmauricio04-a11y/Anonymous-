/* card-style.js: one place that turns a saved card style into CSS. Used by the app and by the link page. */
(function (w) {
  var GRADS = {
    sunset: 'linear-gradient(135deg,#E5334B,#FF8A4C)', ocean: 'linear-gradient(135deg,#1F5F8B,#4FB3D9)',
    forest: 'linear-gradient(135deg,#2E5A4C,#8BC48A)', grape: 'linear-gradient(135deg,#5B3A8C,#D4547A)',
    night: 'linear-gradient(135deg,#0C0C0E,#2A2A52)', gold: 'linear-gradient(135deg,#C9822B,#F2D06B)'
  };
  var LIGHT = { gold: 1 };
  function bg(c, extraDim) {
    if (!c) return '';
    if (c.kind === 'grad' && GRADS[c.v]) return GRADS[c.v];
    if (c.kind === 'color' && /^#[0-9a-f]{6}$/i.test(c.v)) return c.v;
    if (c.kind === 'photo' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(c.v || '')) {
      var d = Math.min(85, Math.max(0, (+c.dim || 0) + (extraDim || 0))) / 100;
      return 'linear-gradient(rgba(0,0,0,' + d + '),rgba(0,0,0,' + d + ')),url(' + c.v + ') center/cover';
    }
    return '';
  }
  function light(c) {
    if (!c) return false;
    if (c.kind === 'grad') return !!LIGHT[c.v];
    if (c.kind === 'color' && /^#[0-9a-f]{6}$/i.test(c.v)) {
      var n = parseInt(c.v.slice(1), 16);
      return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62;
    }
    return false;
  }
  /* sets --card-bg / --card-fg / --card-sh on root and adds .has-style */
  function apply(root, c, extraDim) {
    var b = bg(c, extraDim);
    root.classList.toggle('has-style', !!b);
    ['--card-bg', '--card-fg', '--card-sh', '--card-glass'].forEach(function (k) { if (!b) root.style.removeProperty(k); });
    if (!b) return false;
    var l = light(c);
    root.style.setProperty('--card-bg', b);
    root.style.setProperty('--card-fg', l ? '#16161a' : '#fff');
    root.style.setProperty('--card-sh', l ? 'none' : '0 1px 8px rgba(0,0,0,.35)');
    root.style.setProperty('--card-glass', l ? 'rgba(255,255,255,.55)' : 'rgba(10,10,14,.46)');
    return true;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* static preview card (no play button) */
  function previewHtml(m) {
    var art = /^https:\/\//.test(m.art || '') ? '<img class="art" alt="" src="' + esc(m.art) + '">' : '<span class="art art-ph"></span>';
    return '<div class="card pv-card"><div class="top"><div class="thead"><span class="to">To: ' + esc(m.to || 'you') + '</span><span class="stamp">From: ???</span><time class="when">just now</time></div>' +
      '<p class="hand">' + esc(m.text || 'your message will look like this') + '</p></div>' +
      '<div class="song">' + art + '<span><b>' + esc(m.song || 'Your song') + '</b><span>' + esc(m.artist || 'Your artist') + '</span></span></div></div>';
  }
  w.CardStyle = { previewHtml: previewHtml, GRADS: GRADS, bg: bg, light: light, apply: apply };
})(window);
