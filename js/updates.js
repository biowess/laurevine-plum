/* updates.js: the "update available" dialog. The notice itself (checked once per launch, in the main process: server/update-check.js)
   arrives through the existing window.plumDesktop bridge. Nothing is downloaded or installed here.
   Install now → download page in the OS browser · Remind me later → asked again next launch · Not now → never shown again for this version. */
(function (RPE) {
  'use strict';
  const br = window.plumDesktop;
  if (!br || typeof br.getUpdate !== 'function' || typeof br.onUpdate !== 'function' || !RPE.ui) return;   // plain browser, or no bridge: nothing to do
  const { $, esc, h, dlg } = RPE.ui;
  let shown = false, queued = false;

  /* Small, safe Markdown subset for release notes: headings, bold, italic, strikethrough, `code`, fenced code, https links,
     bullet / numbered lists, block quotes, rules. Everything is HTML-escaped first, so markup in the notes is only ever shown as text. */
  function mdInline(t) {
    const code = [];
    let s = esc(t).replace(/`([^`\n]+)`/g, (m, c) => { code.push(c); return '\u0000' + (code.length - 1) + '\u0000'; });
    s = s.replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/g, (m, a, b) => '<strong>' + (a || b) + '</strong>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + code[+i] + '</code>');
  }
  function md(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n'), out = [];
    let para = [], list = null, quote = [];
    const flushPara = () => { if (para.length) out.push('<p>' + para.map(mdInline).join(' ') + '</p>'); para = []; };
    const flushList = () => { if (list) out.push('<' + list.t + '>' + list.items.map((i) => '<li>' + mdInline(i) + '</li>').join('') + '</' + list.t + '>'); list = null; };
    const flushQuote = () => { if (quote.length) out.push('<blockquote>' + quote.map(mdInline).join(' ') + '</blockquote>'); quote = []; };
    const flush = () => { flushPara(); flushList(); flushQuote(); };
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (/^\s*```/.test(ln)) {   // fenced code: up to the closing fence (or the end)
        flush(); const buf = [];
        for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) buf.push(lines[i]);
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); continue;
      }
      let m;
      if (!ln.trim()) { flush(); continue; }
      if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(ln))) { flush(); out.push('<h4>' + mdInline(m[2]) + '</h4>'); continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); out.push('<hr>'); continue; }
      if ((m = /^\s*>\s?(.*)$/.exec(ln))) { flushPara(); flushList(); quote.push(m[1]); continue; }
      if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(ln))) {
        const t = /\d/.test(m[1]) ? 'ol' : 'ul';
        flushPara(); flushQuote();
        if (list && list.t !== t) flushList();
        (list = list || { t, items: [] }).items.push(m[2]); continue;
      }
      if (list && /^\s+\S/.test(ln)) { list.items[list.items.length - 1] += ' ' + ln.trim(); continue; }   // wrapped list item
      flushList(); flushQuote(); para.push(ln.trim());
    }
    flush();
    return out.join('');
  }

  const fmtDate = (d) => { const t = Date.parse(d); return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); };

  function open(n) {
    if (shown || !n || typeof n.version !== 'string' || typeof n.notes !== 'string') return;
    shown = true;
    const when = fmtDate(n.releaseDate);
    const d = dlg({
      t: 'Update available', i: 'download', w: 480, cls: 'upd', btns: [], focus: '[data-upd="install"]',
      b: `<p class="upd__lead"><strong>${esc(n.name || 'Laurevine Plum')} ${esc(n.version)}</strong> is available${when ? ` <span class="muted">· ${esc(when)}</span>` : ''}.</p><div class="upd__notes">${md(n.notes)}</div>`
    });
    const foot = $('.dlg__foot', d.el), act = (a) => { try { br.updateAction(a); } catch (e) { /* bridge gone */ } d.close(); };
    foot.innerHTML = '';
    [['skip', 'Not now', 'dlg__foot-left'], ['later', 'Remind me later', ''], ['install', 'Install now', 'btn--primary']].forEach(([a, l, c]) => {
      const b = h(`<button class="btn ${c}" data-upd="${a}">${esc(l)}</button>`); b.onclick = () => act(a); foot.append(b);
    });   // Esc / × / clicking outside just close the dialog: same as Remind me later (nothing saved)
  }

  const idle = () => document.body.classList.contains('is-ready') && !document.querySelector('.dlg-backdrop, .wiz');   // never on top of the setup wizard or another dialog
  function offer(n) {
    if (shown || queued || !n) return;
    queued = true;
    let tries = 0;
    const go = () => { if (shown) return; if (idle()) return open(n); if (++tries < 100) setTimeout(go, 3000); };   // waits up to ~5 minutes, then gives up until next launch
    go();
  }

  br.onUpdate(offer);
  Promise.resolve(br.getUpdate()).then(offer, () => {});   // the check may already have finished before this page was listening
})(window.RPE = window.RPE || {});