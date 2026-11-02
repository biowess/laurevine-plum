/* pdf-viewer.js: Laurevine Plum PDF viewer (PDF.js wrapper), compilation diagnostics, and problems log parser.
   Exposes window.RPE.pv. */
(function (RPE) {
  'use strict';

  const {
    $, $$, esc, ic, h, paint, toast, clearToasts, dlg, note, str
  } = RPE.ui;

  const ctx = new Proxy({}, {
    get: (_, k) => (RPE.ctx || {})[k],
    set: (_, k, v) => { if (RPE.ctx) RPE.ctx[k] = v; return true; }
  });

  let PROB_LINES = new Map(), PROB_LINES_TIP = new Map();
  /* ---------- Compilation Diagnostics: read-only view of the last runCompile() outcome ---------- */
  let lastCompile = null, diagEl = null;   // lastCompile: { at, ok, summary, log, exitCode }, set by recordCompile()
  function diagFill(el) {
    const b = $('.diag__body', el), c = lastCompile;
    if (!c) { b.innerHTML = '<p class="muted">No compilation has run in this session yet. Press Compile to generate diagnostics.</p>'; return; }
    const kind = (l) => /^!|Fatal error|Emergency stop|Undefined control sequence|Error:|ERROR/.test(l) ? 'err' : /Warning|Overfull|Underfull/.test(l) ? 'warn' : 'info';
    const lines = c.log ? c.log.split(/\r?\n/) : [], n = { err: 0, warn: 0 };
    const rows = lines.map((l) => { const k = kind(l); if (k !== 'info') n[k]++; return `<span class="diag-${k}">${esc(l)}</span>`; }).join('\n');
    b.innerHTML = `<p><b class="${c.ok ? '' : 'diag-err'}">${c.ok ? 'Succeeded' : 'Failed'}</b> · ${esc(c.at.toLocaleString())}${c.exitCode == null ? '' : ' · exit status ' + esc(c.exitCode)}<br>${esc(c.summary)}</p>` +
      (c.log ? `<p class="muted">${n.err} error line${n.err === 1 ? '' : 's'}, ${n.warn} warning line${n.warn === 1 ? '' : 's'}</p><pre class="codebox diag__log">${rows}</pre>` : '<p class="muted">The compiler produced no log output.</p>');
  }
  let PROB = { items: [], showErr: true, showWarn: true };   // parsed problems from last compile log

  /* Parse LaTeX log into structured problem objects.
     Matches:  ./file.tex:42: message   (pdflatex/xelatex style)
     Also:     Overfull \hbox ... at lines 42--43   and   LaTeX Warning: ... on input line 42  */
  function parseProblems(log) {
    if (!log) return [];
    const out = [];
    const lines = log.split(/\r?\n/);
    // file:line: message, may be preceded by optional path prefix in parens
    const RE_FL = /^(?:\.\/)?(.+?\.(?:tex|sty|cls|bib|def|cfg|fd|ldf|ltx|dtx)):(\d+):\s*(.*)/;
    // Overfull/Underfull hbox/vbox
    const RE_OVF = /^(Overfull|Underfull) \\[hv]box.*?at lines? (\d+)/i;
    // LaTeX Warning / Package Warning on input line N
    const RE_WARN = /^(?:LaTeX|Package \S+) Warning:(.+)/i;
    // ! Error
    const RE_ERR = /^! (.+)/;
    let pendingWarn = null, pendingErrFile = null, pendingErrLine = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      let m;
      if ((m = RE_FL.exec(l))) {
        const sev = /^!|error/i.test(m[3]) ? 'err' : 'warn';
        out.push({ file: m[1], line: +m[2] - 1, msg: m[3].trim() || lines[i + 1]?.trim() || l, sev });
      } else if ((m = RE_OVF.exec(l))) {
        out.push({ file: null, line: +m[2] - 1, msg: l.trim(), sev: 'warn' });
      } else if ((m = RE_ERR.exec(l))) {
        pendingWarn = null;
        // look ahead for "l.N" line number
        const ahead = lines.slice(i + 1, i + 6).join('\n');
        const lm = /^l\.(\d+)/m.exec(ahead);
        out.push({ file: pendingErrFile, line: lm ? +lm[1] - 1 : null, msg: m[1].trim(), sev: 'err' });
      } else if ((m = RE_WARN.exec(l))) {
        const joined = m[1] + lines.slice(i + 1, i + 4).filter(x => /^\(|^on input/.test(x.trim())).join(' ');
        const lm = /on input line (\d+)/i.exec(joined) || /on input line (\d+)/i.exec(lines.slice(i, i + 5).join('\n'));
        pendingWarn = { file: null, line: lm ? +lm[1] - 1 : null, msg: ('LaTeX Warning:' + joined).replace(/\s+/g, ' ').trim(), sev: 'warn' };
        out.push(pendingWarn);
      } else if (/^\(\.\/(.+?\.tex)/.test(l)) {
        // track currently-open file for ! errors that follow
        pendingErrFile = /^\(\.\/(.+?\.tex)/.exec(l)?.[1] || null;
      }
    }
    // deduplicate by file+line+msg
    const seen = new Set();
    return out.filter((p) => { const k = (p.file || '') + ':' + p.line + ':' + p.msg; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function probRender() {
    const items = PROB.items.filter(p => (p.sev === 'err' ? PROB.showErr : PROB.showWarn));
    const body = $('#probBody'); if (!body) return;
    if (!items.length) {
      body.innerHTML = `<p class="muted" style="padding:8px 4px;font-size:12px">${PROB.items.length ? 'All problems hidden by current filter.' : 'No problems found.'}</p>`;
      return;
    }
    body.innerHTML = items.map((p, i) =>
      `<div class="cmt prob__row prob__row--${p.sev}" data-pi="${i}" tabindex="0" title="${esc((p.file ? p.file + (p.line != null ? ':' + (p.line + 1) : '') + ': ' : '') + p.msg)}">` +
      `<span class="prob__sev">${ic(p.sev === 'err' ? 'circle-x' : 'triangle-alert')}</span>` +
      `<span class="prob__msg">${esc(p.msg.length > 120 ? p.msg.slice(0, 117) + '…' : p.msg)}</span>` +
      `${p.line != null ? `<span class="prob__loc">${esc(p.file ? p.file.split('/').pop() + ':' + (p.line + 1) : 'line ' + (p.line + 1))}</span>` : ''}` +
      `</div>`
    ).join('');
    paint(body);
    body.querySelectorAll('.prob__row').forEach((row) => {
      const p = items[+row.dataset.pi];
      row.onclick = () => probJump(p);
      row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); probJump(p); } };
    });
  }

  async function probJump(p) {
    if (p.line == null) return;
    const jump = () => { ctx.goToLine(p.line); const ta = $('#codeInput'); if (ta) { ta.focus(); ta.setSelectionRange((ctx.LINE_START || [])[p.line] || 0, ((ctx.LINE_START || [])[p.line] || 0) + ((ctx.LINES || [])[p.line] || '').length); } ctx.setCurLine(p.line); };
    if (!p.file || !ctx.activePath || ctx.activePath.endsWith('/' + p.file) || ctx.activePath === p.file) { jump(); return; }
    // different file, search project tree by path suffix
    function findBySuffix(suf, nodes) { for (const n of (nodes || ctx.PROJECT)) { if (n.path.endsWith('/' + suf) || n.path === suf) return n; if (n.t === 'folder' && n.c) { const f = findBySuffix(suf, n.c); if (f) return f; } } return null; }
    const node = findBySuffix(p.file);
    if (node) { await ctx.openFileNode(node); jump(); }
    else { toast('Could not locate ' + p.file + ' in the project. Navigate there manually'); }
  }

  function probUpdateGutter() {
    PROB_LINES = new Map(); PROB_LINES_TIP = new Map();
    // Only mark lines for the active file
    PROB.items.forEach((p) => {
      if (p.line == null) return;
      const inActiveFile = !p.file || (ctx.activePath && (ctx.activePath.endsWith('/' + p.file) || ctx.activePath === p.file));
      if (!inActiveFile) return;
      const existing = PROB_LINES.get(p.line);
      if (!existing || (p.sev === 'err' && existing === 'warn')) PROB_LINES.set(p.line, p.sev);
      PROB_LINES_TIP.set(p.line, (PROB_LINES_TIP.get(p.line) ? PROB_LINES_TIP.get(p.line) + '\n' : '') + p.msg);
    });
    ctx.ensureWindow(true);
  }

  function probBadgeSync() {
    const badge = $('#probBadge'); if (!badge) return;
    const errs = PROB.items.filter(p => p.sev === 'err').length;
    const warns = PROB.items.filter(p => p.sev === 'warn').length;
    if (!errs && !warns) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.innerHTML = (errs ? `${ic('circle-x')} ${errs}` : '') + (errs && warns ? ' ' : '') + (warns ? `${ic('triangle-alert')} ${warns}` : '');
    paint(badge);
    badge.classList.toggle('prob-badge--err', errs > 0);
    badge.classList.toggle('prob-badge--warn', errs === 0 && warns > 0);
  }

  function recordCompile(ok, summary, log, exitCode) {
    lastCompile = { at: new Date(), ok, summary, log: String(log || ''), exitCode };
    if (diagEl && diagEl.isConnected) diagFill(diagEl);   // refresh an open dialog; never triggers a compile
    PROB.items = ok ? [] : parseProblems(String(log || ''));
    probRender(); probUpdateGutter(); probBadgeSync();
    if (ok) { const p = $('#probPanel'); if (p) p.hidden = true; }
    else if (PROB.items.length) { const p = $('#probPanel'); if (p) p.hidden = false; }
  }
  function diagDialog() {
    const d = dlg({ t: 'Compilation Diagnostics', i: 'terminal', w: 640, btns: ['Close'], b: '<div class="diag__body"></div><div><button class="btn" id="diagCopy">Copy log</button></div>' });
    diagEl = d.el; diagFill(d.el);
    $('#diagCopy', d.el).onclick = () => {
      if (!lastCompile) return toast('Nothing to copy yet. No compilation has run');
      const t = lastCompile.summary + '\n\n' + lastCompile.log;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Log copied'), () => toast('Could not copy. Select the log text and copy it manually'));
    };
  }
  let compiling = false, compileAC = null;
  // compileState: idle | compiling | success | error | stale
  let compileState = 'idle';
  function setCompileStatus(text, color, state) {
    const t = $('#statusMainText'); if (t) t.textContent = text;
    const d = $('#statusDot'); if (d) d.style.background = color;
    compileState = state || compileState;
    if (state === 'success' || state === 'error') {
      const last = $('#lastCompileStatus');
      const outcome = state === 'success' ? 'succeeded' : 'failed';
      if (last) last.textContent = 'Last compile: ' + outcome + ' at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  // Mark PDF stale when source changes after a successful compile
  let lastCompiledSrc = null, autoCompileTimer = 0;
  function triggerAutoCompileSoon() {
    if (!ctx.PREFS.acp) return;
    clearTimeout(autoCompileTimer);
    autoCompileTimer = setTimeout(() => {
      if (!ctx.PREFS.acp || compiling) return;   // 2s debounce, skipped while compiling
      ctx.runCompile();
    }, 2000);
  }
  function markCompileStale() {
    const isOut = lastCompiledSrc != null && (ctx.SRC !== lastCompiledSrc);
    const badge = $('#pdfStaleBadge'); if (badge) badge.hidden = !isOut;
    if (isOut && compileState === 'success') {
      setCompileStatus('Out of date', '#C9A23A', 'stale');
      compileState = 'stale';
    } else if (!isOut && compileState === 'stale') {
      setCompileStatus('Ready', '#6C8F6E', 'success');
      compileState = 'success';
    }
    triggerAutoCompileSoon();
  }
  /* ---------- PDF viewer: PDF.js (vendored in js/vendor/) draws each page onto a canvas in #pdfPages ---------- */
  const PV = { doc: null, wraps: [], sizes: [], scale: 1, fit: 'width', mode: 'pdf', pin: 0, pinTop: 0, token: 0, io: null, raf: 0, savedView: null };   // fit: 'width' | 'page' | null (manual zoom)
  const PV_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4], PV_MIN = 0.25, PV_MAX = 4, PV_NOPDF = 'Compile the document first to preview the PDF';
  function pvMsg(t) { const m = $('#pdfMsg'); m.textContent = t || ''; m.hidden = !t; }
  function pvClear() {
    PV.token++; PV.pin = 0; if (PV.io) PV.io.disconnect(); PV.wraps = []; PV.sizes = [];
    if (PV.doc) { PV.doc.destroy(); PV.doc = null; }
    $('#pdfPages').replaceChildren(); $('#pdfPages').hidden = true; pvMsg('');
    if ($('#compileLog').hidden && $('#pdfFrame').hidden && $('#pdfEmpty')) $('#pdfEmpty').hidden = false;
    if (!$('#pdfThumbs').hidden) renderThumbs();
  }
  function pvLabels() {
    const n = PV.doc ? PV.doc.numPages : 0, c = n ? pvCurrent() : 0, z = Math.round(PV.scale * 100) + '%', pi = $('#pvPageIn'), zi = $('#pvZoom');
    if (document.activeElement !== pi) pi.value = n ? c : '';
    if (document.activeElement !== zi) zi.value = z;
    $('#pvTotal').textContent = n || '–'; $('#sbPage').textContent = n ? `Page ${c} of ${n}` : 'No PDF'; $('#sbZoom').textContent = z;
    pi.disabled = zi.disabled = !n;
    $('#pvPrev').disabled = !n || c <= 1; $('#pvNext').disabled = !n || c >= n;
    $('#pvOut').disabled = !n || PV.scale <= PV_MIN + 0.001; $('#pvIn').disabled = !n || PV.scale >= PV_MAX - 0.001;
    $('#pvFit').disabled = $('#pvFitP').disabled = !n;
    const thumbs = $$('.pdf-thumb');
    if (thumbs.length) thumbs.forEach((t) => t.classList.toggle('is-active', Number(t.dataset.page) === c));
  }
  function pvCurrent() {
    if (PV.pin) return PV.pin;   // set by pvTo so a page too short to reach the reading line still counts as current
    const sc = $('.pdf-scroll'), line = sc.getBoundingClientRect().top + sc.clientHeight * 0.3;
    for (let i = 0; i < PV.wraps.length; i++) if (PV.wraps[i].getBoundingClientRect().bottom > line) return i + 1;
    return PV.wraps.length;
  }
  function pvLayout() {   // size every page box for the current scale; canvases are (re)drawn lazily when visible
    if (!PV.doc) return;
    const sc = $('.pdf-scroll'), cs = getComputedStyle(sc);
    const aw = sc.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ah = sc.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (aw < 50 || ah < 50) return;   // pane hidden, ResizeObserver retries when shown
    PV.pin = 0;
    if (PV.fit) {
      const mw = Math.max(...PV.sizes.map((x) => x.w)), mh = Math.max(...PV.sizes.map((x) => x.h));
      PV.scale = Math.max(PV_MIN, Math.min(aw / mw, PV.fit === 'page' ? ah / mh : Infinity, 2));
    }
    PV.wraps.forEach((w, i) => {
      w.style.width = PV.sizes[i].w * PV.scale + 'px'; w.style.height = PV.sizes[i].h * PV.scale + 'px';
      w.dataset.r = ''; w.className = 'pdf-page'; w.replaceChildren(); PV.io.unobserve(w); PV.io.observe(w);
    });
    pvLabels();
  }
  async function pvRender(i) {
    const doc = PV.doc, w = PV.wraps[i], key = String(PV.scale);
    if (!doc || !w || w.dataset.r === key) return; w.dataset.r = key;
    try {
      const page = await doc.getPage(i + 1), vp = page.getViewport({ scale: PV.scale }), dpr = window.devicePixelRatio || 1;
      const cv = document.createElement('canvas'); cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
      cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';   // scale canvas back to CSS px for HiDPI
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      if (PV.doc === doc && w.dataset.r === key) w.replaceChildren(cv);
    } catch (e) {
      if (PV.doc === doc && w.dataset.r === key) { w.className = 'pdf-page pdf-page--err'; w.textContent = `Page ${i + 1} could not be rendered`; }
    }
  }
  function pvSet(z) {   // explicit zoom (clamped); keeps the reading position
    const sc = $('.pdf-scroll'), ratio = sc.scrollTop / Math.max(1, sc.scrollHeight);
    PV.fit = null; PV.scale = Math.min(PV_MAX, Math.max(PV_MIN, z)); pvLayout(); sc.scrollTop = ratio * sc.scrollHeight; pvLabels();
  }
  function pvZoom(dir, quiet) {
    if (!PV.doc) return toast(PV_NOPDF);
    const next = dir > 0 ? PV_STEPS.find((x) => x > PV.scale + 0.01) : [...PV_STEPS].reverse().find((x) => x < PV.scale - 0.01);
    if (!next) return quiet || toast(dir > 0 ? 'Maximum zoom' : 'Minimum zoom');
    pvSet(next);
  }
  function pvFit(kind) {   // 'width' | 'page'
    if (!PV.doc) return toast(PV_NOPDF);
    const n = pvCurrent(); PV.fit = kind; pvLayout(); pvTo(n);
  }
  function pvTo(n) {
    if (!PV.doc) return toast(PV_NOPDF);
    n = Math.min(PV.wraps.length, Math.max(1, n)); const sc = $('.pdf-scroll');
    sc.scrollTop += PV.wraps[n - 1].getBoundingClientRect().top - sc.getBoundingClientRect().top - parseFloat(getComputedStyle(sc).paddingTop);
    PV.pin = n; PV.pinTop = sc.scrollTop; pvLabels();
  }
  const pvGo = (d) => PV.doc ? pvTo(pvCurrent() + d) : toast(PV_NOPDF);
  function pvMode(m) {   // one viewer, three looks: same #pdfPages, only classes + layout change; page and zoom are kept
    const n = PV.doc ? pvCurrent() : 0, box = $('.pdf'); PV.mode = m;
    box.classList.toggle('pv-print', m === 'print'); box.classList.toggle('pv-read', m === 'read');
    if (n) { pvLayout(); pvTo(n); }
  }
  function pvAct(k, el) {   // ribbon View ▸ PDF View / Zoom controls
    if (k === 'pdf' || k === 'print' || k === 'read') { $$('.rbtn', el.parentNode).forEach((x) => x.classList.remove('is-on')); el.classList.add('is-on'); return pvMode(k); }
    if (!PV.doc) return toast(PV_NOPDF);
    if ($('.pdf').hidden) return toast('Show the PDF pane first (View ▸ PDF Pane)');
    if (k === 'in') pvZoom(1); else if (k === 'out') pvZoom(-1); else pvFit(k);
  }
  function pvNav(l) {   // ribbon View ▸ Page Navigation menu
    if (!PV.doc) return toast(PV_NOPDF);
    if ($('.pdf').hidden) return toast('Show the PDF pane first (View ▸ PDF Pane)');
    if (l === 'First Page') pvTo(1); else if (l === 'Last Page') pvTo(PV.doc.numPages); else if (l === 'Previous Page') pvGo(-1); else if (l === 'Next Page') pvGo(1);
    else { const pi = $('#pvPageIn'); pi.focus(); pi.select(); }   // Go to Page…
  }
  let thumbsToken = 0;
  async function renderThumbs() {
    const box = $('#pdfThumbs');
    if (!box || box.hidden) return;
    if (!PV.doc) { box.innerHTML = '<div class="pdf-thumbs__empty muted">No pages yet</div>'; return; }
    const tok = ++thumbsToken, doc = PV.doc, n = doc.numPages, curP = pvCurrent();
    box.replaceChildren();
    for (let i = 1; i <= n; i++) {
      const item = document.createElement('div');
      item.className = 'pdf-thumb' + (i === curP ? ' is-active' : '');
      item.dataset.page = i;
      item.onclick = () => pvTo(i);
      const cv = document.createElement('canvas'), num = document.createElement('span');
      num.className = 'pdf-thumb__num'; num.textContent = i;
      item.append(cv, num); box.append(item);
    }
    const boxW = Math.max(120, (box.clientWidth || 200) - 28);
    for (let i = 1; i <= n; i++) {
      if (tok !== thumbsToken || PV.doc !== doc) return;
      try {
        const page = await doc.getPage(i), unscaled = page.getViewport({ scale: 1 });
        const scale = boxW / unscaled.width, vp = page.getViewport({ scale });
        const item = box.querySelector(`.pdf-thumb[data-page="${i}"]`);
        if (!item) continue;
        const cv = item.querySelector('canvas');
        if (!cv) continue;
        const dpr = window.devicePixelRatio || 1;
        cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
        cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      } catch (e) {}
    }
  }
  function toggleThumbs(force) {
    const box = $('#pdfThumbs'), btn = $('#pvThumbsToggle'), rz = $('#pdfThumbsResizer');
    if (!box) return;
    const next = typeof force === 'boolean' ? force : box.hidden;
    box.hidden = !next;
    if (rz) rz.hidden = !next;
    if (btn) { btn.classList.toggle('is-on', next); btn.setAttribute('aria-pressed', next); }
    $$('[data-a="thumbs"]').forEach((b) => { b.classList.toggle('is-on', next); b.setAttribute('aria-pressed', next); });
    if (ctx.prefSet) ctx.prefSet('thumbs', next);
    if (next) renderThumbs();
  }
  function pvInit() {
    const sc = $('.pdf-scroll'), pi = $('#pvPageIn'), zi = $('#pvZoom'), box = $('#pdfThumbs'), rz = $('#pdfThumbsResizer');
    if (rz && box) {
      const savedW = parseInt(localStorage.getItem('lplum.thumbsW'), 10);
      if (savedW >= 120 && savedW <= 500) document.documentElement.style.setProperty('--thumbs-w', savedW + 'px');
      rz.onpointerdown = (e) => {
        e.preventDefault();
        try { rz.setPointerCapture(e.pointerId); } catch (_) {}
        document.body.classList.add('is-resizing');
        const startX = e.clientX, startW = box.getBoundingClientRect().width;
        let lastW = startW;
        const mv = (ev) => {
          lastW = Math.min(500, Math.max(120, startW + (ev.clientX - startX)));
          document.documentElement.style.setProperty('--thumbs-w', lastW + 'px');
        };
        rz.addEventListener('pointermove', mv);
        rz.addEventListener('pointerup', () => {
          rz.removeEventListener('pointermove', mv);
          document.body.classList.remove('is-resizing');
          try { localStorage.setItem('lplum.thumbsW', String(Math.round(lastW))); } catch (_) {}
          if (PV.doc && !box.hidden) renderThumbs();
        }, { once: true });
      };
      rz.onkeydown = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const w = Math.min(500, Math.max(120, box.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 20 : -20)));
          document.documentElement.style.setProperty('--thumbs-w', w + 'px');
          try { localStorage.setItem('lplum.thumbsW', String(Math.round(w))); } catch (_) {}
          if (PV.doc && !box.hidden) renderThumbs();
        }
      };
    }
    PV.io = new IntersectionObserver((es) => es.forEach((en) => {
      const i = PV.wraps.indexOf(en.target);
      if (en.isIntersecting) { pvRender(i); }
      else if (i >= 0 && en.target.dataset.r) { en.target.dataset.r = ''; en.target.replaceChildren(); }   // release off-screen canvas
    }), { root: sc, rootMargin: '1200px 0px' });
    sc.addEventListener('scroll', () => { if (!PV.raf) PV.raf = requestAnimationFrame(() => { PV.raf = 0; if (PV.pin && Math.abs(sc.scrollTop - PV.pinTop) > 2) PV.pin = 0; pvLabels(); }); });
    new ResizeObserver(() => { if (PV.doc && PV.fit) pvLayout(); }).observe(sc);   // follows split-view resizing
    let wt = 0; sc.addEventListener('wheel', (e) => {   // Ctrl/⌘ + wheel or pinch zooms the PDF itself, not the whole page
      if (!(e.ctrlKey || e.metaKey) || !PV.doc) return; e.preventDefault();
      if (Date.now() - wt > 120) { wt = Date.now(); pvZoom(e.deltaY < 0 ? 1 : -1, true); }
    }, { passive: false });
    $('#pvPrev').onclick = () => pvGo(-1); $('#pvNext').onclick = () => pvGo(1);
    $('#pvOut').onclick = () => pvZoom(-1); $('#pvIn').onclick = () => pvZoom(1);
    $('#pvFit').onclick = () => pvFit('width'); $('#pvFitP').onclick = () => pvFit('page');
    const tb = $('#pvThumbsToggle'); if (tb) tb.onclick = () => toggleThumbs();
    const field = (inp, commit) => {
      inp.onfocus = () => inp.select(); inp.onblur = pvLabels;
      inp.onkeydown = (e) => { if (e.key === 'Enter') { commit(); inp.blur(); } else if (e.key === 'Escape') inp.blur(); };
    };
    field(pi, () => { const n = PV.doc ? PV.doc.numPages : 0, v = /^\s*\d+\s*$/.test(pi.value) ? parseInt(pi.value, 10) : 0; if (n) { if (v >= 1 && v <= n) pvTo(v); else toast(`Enter a page number from 1 to ${n}`); } });
    field(zi, () => {
      const v = parseFloat(zi.value.replace('%', '').replace(',', '.')); if (!PV.doc) return;
      if (!(v > 0)) return toast(`Enter a zoom between ${PV_MIN * 100}% and ${PV_MAX * 100}%`);
      if (v / 100 < PV_MIN || v / 100 > PV_MAX) toast(`Zoom is limited to ${PV_MIN * 100}%–${PV_MAX * 100}%`);
      pvSet(v / 100);
    });
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
    if (ctx.PREFS.thumbs) toggleThumbs(true);
    pvLabels();
  }
  function hideCompileLog() { $('#compileLog').hidden = true; }
  async function showCompiledPdf(url) {
    hideCompileLog(); if ($('#pdfEmpty')) $('#pdfEmpty').hidden = true;
    if (!window.pdfjsLib) {   // vendored renderer missing: fall back to the browser's own viewer
      const frame = $('#pdfFrame'); frame.src = url + '?t=' + Date.now(); frame.hidden = false; return;
    }
    const tok = ++PV.token, sc = $('.pdf-scroll');
    const curP = pvCurrent(), curW = PV.wraps[curP - 1];
    const saved = (PV.doc && PV.wraps.length) ? {
      page: curP,
      pageOffset: curW ? (sc.scrollTop - curW.offsetTop) : 0,
      top: sc.scrollTop,
      left: sc.scrollLeft,
      scale: PV.scale,
      fit: PV.fit
    } : (PV.savedView || { top: sc.scrollTop, left: sc.scrollLeft, scale: PV.scale, fit: PV.fit });
    PV.savedView = null;
    if (!PV.doc) pvMsg('Loading PDF…');   // on a refresh the previous pages stay visible until the new ones are ready
    let doc;
    try {
      const r = await fetch(url + '?t=' + Date.now());
      if (r.status === 404) throw new Error('The compiled PDF is missing on the server. Compile again.');
      if (!r.ok) throw new Error(`The server could not deliver the PDF (HTTP ${r.status}).`);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!new TextDecoder('latin1').decode(buf.subarray(0, 1024)).includes('%PDF-')) throw new Error('The compiled file is not a valid PDF.');
      doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
      if (tok !== PV.token) { doc.destroy(); return; }   // a newer compile superseded this one
      PV.sizes = pages.map((p) => { const v = p.getViewport({ scale: 1 }); return { w: v.width, h: v.height }; });
    } catch (e) {
      if (doc) doc.destroy();
      if (tok !== PV.token) return;
      showCompileError('The PDF could not be displayed.', e && e.name === 'InvalidPDFException' ? 'The compiled file is not a valid PDF.' : String((e && e.message) || e));
      return;
    }
    if (PV.doc) PV.doc.destroy();
    PV.doc = doc; $('#pdfFrame').hidden = true; pvMsg('');
    if (saved.fit != null) PV.fit = saved.fit; else { PV.fit = null; PV.scale = saved.scale; }
    PV.wraps = PV.sizes.map(() => { const d = document.createElement('div'); d.className = 'pdf-page'; return d; });
    $('#pdfPages').replaceChildren(...PV.wraps); $('#pdfPages').hidden = false;
    pvLayout();
    if (saved.page && PV.wraps[saved.page - 1]) {
      sc.scrollTop = Math.max(0, PV.wraps[saved.page - 1].offsetTop + (saved.pageOffset || 0));
    } else {
      sc.scrollTop = saved.top || 0;
    }
    sc.scrollLeft = saved.left || 0;
    pvLabels();
    if (!$('#pdfThumbs').hidden) renderThumbs();
  }
  function showCompileError(message, log) {
    pvClear(); pvLabels(); $('#pdfFrame').hidden = true; $('#pdfFrame').removeAttribute('src'); if ($('#pdfEmpty')) $('#pdfEmpty').hidden = true;
    $('#compileLogBody').textContent = log ? message + '\n\n' + log : message;
    $('#compileLog').hidden = false;
  }
  /* ---- Export PDF: reuses the last successful compile only if it was built from exactly the project as it is on disk now ---- */
  let lastPdf = null;   // { url, sig } of the last successful compile
  function payloadSig(p) { const t = JSON.stringify(p); let a = 2166136261, b = 5381; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b, 33) ^ c) | 0; } return t.length + ':' + (a >>> 0) + ':' + (b >>> 0); }
  async function fetchPdfBytes(url) {
    try { const r = await fetch(url + '?t=' + Date.now()); if (!r.ok) return null; const buf = await r.arrayBuffer(); return new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength))).includes('%PDF-') ? buf : null; } catch (e) { return null; }
  }
  async function exportPdf() {
    if (compiling) return toast('A compile is already running. Try again when it finishes');
    clearToasts();
    if (await ctx.docDirty()) {   // save first through the normal workflow
      await ctx.saveDoc({ quiet: true });   // exportPdf compiles itself, no extra compile-on-save here
      if (await ctx.docDirty()) return toast('Export PDF cancelled: the document has unsaved changes');
    }
    let payload = null;
    try { payload = await ctx.compilePayload(); } catch (e) { return toast((e && e.message) || 'Could not gather the project files'); }
    if (!payload) return;
    const sig = payloadSig(payload);
    let buf = null;
    if (compileState === 'success' && lastPdf && lastPdf.sig === sig) {
      buf = await fetchPdfBytes(lastPdf.url);
    }
    if (!buf) {
      const prog = toast('Compiling PDF for export…');
      await ctx.runCompile({ quiet: true });
      prog.remove();
      if (compileState !== 'success' || !lastPdf) {
        return toast('Export PDF cancelled: the document did not compile (see the PDF pane)');
      }
      buf = await fetchPdfBytes(lastPdf.url);
    }
    if (!buf) return toast('Export PDF failed: the compiled PDF could not be retrieved');
    const name = (ctx.PROJ_NAME || 'document').replace(/[^\w.\- ]+/g, '_') + '.pdf';
    const saved = await ctx.saveExport(buf, name, { description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } });
    if (saved) {
      clearToasts();
      toast('Exported “' + saved + '”');
    } else {
      clearToasts();
    }
  }
  /* ---- Export Project as ZIP / Open Output Folder ---- */
  const ZIP_SKIP_DIR = /(^|\/)(build|out|output|_build|tmp|temp|\.cache|__pycache__|node_modules|\.git|\.svn|\.vscode|\.idea|__fonts|latex\.out|_minted[^/]*|auto|\.aux)\//i;
  const ZIP_SKIP_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex(\.gz)?|xdv|bcf|blg|run\.xml|nav|snm|vrb|idx|ind|ilg|glo|gls|glg|ist|acn|acr|alg|mw|bak|tmp|swp|dvi)$/i;

  async function collectProjectFiles(dirHandle, parentRel) {
    const list = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith('.')) continue;
      const rel = parentRel ? parentRel + '/' + name : name;
      if (handle.kind === 'directory') {
        if (ZIP_SKIP_DIR.test(rel + '/')) continue;
        list.push(...(await collectProjectFiles(handle, rel)));
      } else if (handle.kind === 'file') {
        if (ZIP_SKIP_FILE.test(rel)) continue;
        const key = ctx.rootDirHandle.name + '/' + rel, ext = ctx.extOf(rel);
        if (ctx.TEXT_EXTS.has(ext)) {
          let text = key === ctx.activePath ? ctx.SRC : ctx.fileCache.get(key);
          if (text === undefined) text = await (await handle.getFile()).text();
          list.push({ path: rel, text });
        } else {
          const buf = await (await handle.getFile()).arrayBuffer();
          list.push({ path: rel, b64: ctx.toB64(buf) });
        }
      }
    }
    return list;
  }

  async function exportZip() {
    clearToasts();
    const prog = toast('Building project ZIP…');
    let files = [], main = 'main.tex';
    try {
      if (ctx.rootDirHandle) {
        files = await collectProjectFiles(ctx.rootDirHandle, '');
        main = ctx.mainPath ? ctx.relPath(ctx.mainPath) : ((files.find((f) => /\.tex$/i.test(f.path)) || {}).path || 'main.tex');
      } else {
        const name = (ctx.activePath ? ctx.activePath.split('/').pop() : 'main.tex') || 'main.tex';
        files = [{ path: name, text: ctx.SRC }];
        main = name;
      }
    } catch (e) {
      prog.remove();
      return toast('Could not gather project files: ' + ((e && e.message) || e));
    }
    if (!files.length) { prog.remove(); return toast('No project files found to export'); }
    const payload = { name: ctx.PROJ_NAME || 'project', main, files };
    let res;
    try {
      res = await fetch('/api/export-zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) {
      prog.remove();
      return toast('Export failed: the server isn’t reachable');
    }
    prog.remove();
    if (!res.ok || !/zip/.test(res.headers.get('Content-Type') || '')) {
      let m = ''; try { m = (await res.json()).error; } catch (e) {}
      return toast(m || 'Export failed: server returned HTTP ' + res.status);
    }
    const blob = await res.blob(), saved = decodeURIComponent(res.headers.get('X-Saved-Path') || '');
    const fname = (ctx.PROJ_NAME || 'project').replace(/[^\w.\- ]+/g, '_') + '.zip';
    const savedName = await ctx.saveExport(blob, fname, { description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } });
    if (savedName) {
      clearToasts();
      toast('Exported ' + savedName + (saved ? ': copy saved to ' + saved : ''));
    } else {
      clearToasts();
    }
  }

  /* ---- Export Single .tex: downloads or saves active document without altering active state ---- */
  async function exportTex() {
    clearToasts();
    const ta = $('#codeInput'), text = ta ? ta.value : ctx.SRC;
    const base = (ctx.activePath ? ctx.activePath.split('/').pop() : (ctx.PROJ_NAME || 'document')).replace(/[^\w.\- ]+/g, '_').replace(/\.tex$/i, '');
    const fname = (base || 'document') + '.tex';
    const blob = new Blob([text], { type: 'text/x-tex;charset=utf-8' });
    const saved = await ctx.saveExport(blob, fname, { description: 'LaTeX document', accept: { 'text/x-tex': ['.tex'] } });
    if (saved) {
      clearToasts();
      toast('Exported “' + saved + '”');
    } else {
      clearToasts();
    }
  }
  async function openOutputFolder() {
    let r = null;
    try { r = await (await fetch('/api/open-output', { method: 'POST' })).json(); } catch (e) { return toast('Could not open the output folder: the server isn’t reachable or is out of date'); }
    toast(r && r.ok ? 'Opened ' + r.dir : (r && r.error ? r.error + (r.dir ? ' (' + r.dir + ')' : '') : 'Could not open the output folder'));
  }

  RPE.pv = {
    lastCompile: () => lastCompile,
    diagEl: () => diagEl,
    diagFill, diagDialog, recordCompile,
    PROB,
    get PROB_LINES() { return PROB_LINES; },
    get PROB_LINES_TIP() { return PROB_LINES_TIP; },
    parseProblems, probRender, probJump, probUpdateGutter, probBadgeSync,
    PV, PV_STEPS, PV_MIN, PV_MAX, PV_NOPDF,
    pvMsg, pvClear, pvLabels, pvCurrent, pvLayout, pvRender, pvSet, pvZoom, pvFit, pvMode, pvNav, pvAct, pvInit,
    renderThumbs, toggleThumbs, showCompiledPdf, showCompileError,
    exportPdf, exportZip, exportTex, openOutputFolder,
    // needed by runCompile in app.js
    get compiling() { return compiling; },
    set compiling(v) { compiling = v; },
    get compileAC() { return compileAC; },
    set compileAC(v) { compileAC = v; },
    payloadSig,
    setCompileStatus,
    markCompileStale,
    get lastPdf() { return lastPdf; },
    set lastPdf(v) { lastPdf = v; },
    get lastCompiledSrc() { return lastCompiledSrc; },
    set lastCompiledSrc(v) { lastCompiledSrc = v; }
  };
})(window.RPE = window.RPE || {});
