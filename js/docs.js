/* docs.js: Markdown parsing, documentation dialogs, and Help reference panels.
   Exposes window.RPE.docs. */
(function (RPE) {
  'use strict';

  const { $, $$, esc, ic, paint, toast, dlg } = RPE.ui;

  /* ---------- Markdown docs (Documentation / Getting Started / LaTeX Basics) ---------- */
  const MD_DOCS = {
    docs: ['Documentation', 'docs/documentation.md'],
    start: ['Getting Started', 'docs/getting-started.md'],
    basics: ['LaTeX Basics', 'docs/latex-basics.md']
  };

  const MD_TXT = {};   // url → Promise of the file's text; filled at startup so the dialogs open with their content already loaded
  const mdText = (u) => MD_TXT[u] || (MD_TXT[u] = fetch(u).then((r) => { if (!r.ok) throw 0; return r.text(); }).catch((e) => { delete MD_TXT[u]; throw e; }));
  setTimeout(() => Object.values(MD_DOCS).forEach((d) => mdText(d[1]).catch(() => {})), 0);

  const mdUrl = (u, base) => {
    try {
      const x = new URL(u, new URL(base, location.href));
      return /^(https?:|mailto:)/.test(x.protocol) || /^data:image\//.test(x.href) ? x.href : '';
    } catch (e) {
      return '';
    }
  };

  function mdInline(t, base) {
    const st = [], put = (x) => '\u0000' + (st.push(x) - 1) + '\u0000';
    t = t.replace(/`([^`]+)`/g, (m, c) => put('<code>' + esc(c) + '</code>'));
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, a, u) => {
      const s = mdUrl(u, base);
      return put(s ? `<img src="${esc(s)}" alt="${esc(a)}">` : esc(a));
    });
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, a, u) => {
      if (u[0] === '#') return put(`<a href="${esc(u)}">${mdInline(a, base)}</a>`);
      const s = mdUrl(u, base);
      if (!s) return put(mdInline(a, base));
      return put(`<a href="${esc(s)}" ${/\.md(#.*)?$/.test(u) && !/^[a-z]+:/i.test(u) ? `data-md="${esc(s)}"` : 'target="_blank" rel="noopener noreferrer"'}>${mdInline(a, base)}</a>`);
    });
    t = esc(t).replace(/\*\*(.+?)\*\*|__(.+?)__/g, (m, a, b) => `<strong>${a || b}</strong>`)
             .replace(/\*(.+?)\*|\b_(.+?)_\b/g, (m, a, b) => `<em>${a || b}</em>`)
             .replace(/~~(.+?)~~/g, '<del>$1</del>');
    return t.replace(/\u0000(\d+)\u0000/g, (m, i) => st[i]);
  }

  function mdRender(src, base) {
    const L = src.replace(/\r\n?/g, '\n').split('\n'), out = [], inl = (x) => mdInline(x, base);
    const isHr = (l) => /^ {0,3}([-*_])( ?\1){2,}\s*$/.test(l);
    const isLi = (l) => /^\s*([-*+]|\d+\.)\s+/.test(l);
    const isSep = (l) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.includes('-');
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const special = (l, n) => /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || isHr(l) || isLi(l) || (l.includes('|') && n != null && isSep(n));

    let i = 0;
    while (i < L.length) {
      const l = L[i];
      if (!l.trim()) { i++; continue; }
      if (/^```/.test(l)) {
        const code = []; i++;
        while (i < L.length && !/^```/.test(L[i])) code.push(L[i++]);
        i++; out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue;
      }
      let m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (m) { out.push(`<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`); i++; continue; }
      if (isHr(l)) { out.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(l)) {
        const q = []; while (i < L.length && /^\s*>/.test(L[i])) q.push(L[i++].replace(/^\s*> ?/, ''));
        out.push(`<blockquote>${mdRender(q.join('\n'), base)}</blockquote>`); continue;
      }
      if (l.includes('|') && i + 1 < L.length && isSep(L[i + 1])) {
        const hd = cells(l), al = cells(L[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
        i += 2; const rows = [];
        while (i < L.length && L[i].trim() && L[i].includes('|')) rows.push(cells(L[i++]));
        const td = (t, c, k) => `<${t}${al[k] ? ` style="text-align:${al[k]}"` : ''}>${inl(c || '')}</${t}>`;
        out.push(`<table><thead><tr>${hd.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${hd.map((_, k) => td('td', r[k], k)).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      if (isLi(l)) {
        const ind = (x) => x.match(/^\s*/)[0].length, base0 = ind(l), tag = /^\s*\d/.test(l) ? 'ol' : 'ul', items = [];
        while (i < L.length && (L[i].trim() ? (ind(L[i]) > base0 || (ind(L[i]) === base0 && isLi(L[i]))) : (i + 1 < L.length && isLi(L[i + 1]) && ind(L[i + 1]) >= base0))) {
          const x = L[i++]; if (!x.trim()) continue;
          if (ind(x) === base0 && isLi(x)) items.push([x.replace(/^\s*([-*+]|\d+\.)\s+/, ''), []]);
          else if (items.length) items[items.length - 1][1].push(x.slice(Math.min(ind(x), base0 + 2)));
        }
        out.push(`<${tag}>${items.map((it) => `<li>${inl(it[0])}${it[1].length ? mdRender(it[1].join('\n'), base) : ''}</li>`).join('')}</${tag}>`);
        continue;
      }
      const p = [l]; i++;
      while (i < L.length && L[i].trim() && !special(L[i], L[i + 1])) p.push(L[i++]);
      out.push(`<p>${inl(p.map((x) => x.trim()).join(' '))}</p>`);
    }
    return out.join('');
  }

  function mdDialog(id) {
    const d = MD_DOCS[id];
    if (!d) return;
    const d1 = dlg({ t: d[0], i: 'circle-help', w: 720, cls: 'dlg--md', btns: ['Close'], b: '<div class="md">Loading…</div>' });
    const box = $('.md', d1.el);
    const load = async (url) => {
      try {
        box.innerHTML = mdRender(await mdText(url.split('#')[0]), url.split('#')[0]);
        box.parentNode.scrollTop = 0;
      } catch (e) {
        box.innerHTML = `<p>Could not load <code>${esc(url.replace(location.origin + '/', ''))}</code>. Documentation files are loaded from the local server.</p>`;
      }
    };
    box.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-md]');
      if (a) { e.preventDefault(); load(a.dataset.md); }
    });
    load(d[1]);
  }

  function openDoc(u) {
    let x = null; try { x = new URL(String(u || '')); } catch (e) { /* not an absolute URL */ }
    if (!x || !/^https?:$/.test(x.protocol) || !x.hostname) return toast('No valid documentation link: only http(s) addresses can be opened');
    window.open(x.href, '_blank', 'noopener,noreferrer');
  }

  function refPanel(o) {
    const d = dlg({
      t: o.t, i: o.i, w: o.w || 720, cls: 'dlg--ref', btns: ['Close'], focus: '.ref__q',
      b: `<div class="ref ref--${o.mode}"><input class="input ref__q" type="search" placeholder="${esc(o.ph)}" aria-label="${esc(o.ph)}"><div class="ref__main"><div class="ref__list"><p class="muted">Loading…</p></div>${o.mode === 'split' ? '<div class="ref__detail md" aria-live="polite"></div>' : ''}</div></div>`
    });
    const qi = $('.ref__q', d.el), list = $('.ref__list', d.el), det = $('.ref__detail', d.el), open = new Set();
    let items = [], sel = o.pick || null;

    const render = () => {
      const q = qi.value.trim().toLowerCase().split(/\s+/).filter(Boolean), hits = items.filter((it) => q.every((w) => it.hay.includes(w)));
      if (o.mode === 'split' && !hits.some((it) => it.id === sel)) sel = hits.length ? hits[0].id : null;
      let cat = null, html = '';
      hits.forEach((it) => {
        if (it.cat && it.cat !== cat) { cat = it.cat; html += `<div class="ref__cat">${esc(cat)}</div>`; }
        const sub = it.sub ? `<small>${esc(it.sub)}</small>` : '';
        if (o.mode === 'flat') return (html += `<div class="ref__row"><span>${esc(it.title)}${sub}</span><span class="ref__keys">${it.right}</span></div>`);
        const on = o.mode === 'split' ? it.id === sel : open.has(it.id);
        html += `<div class="ref__it${on ? ' is-on' : ''}"><button class="ref__btn" data-id="${esc(it.id)}" aria-${o.mode === 'split' ? 'current' : 'expanded'}="${on}"><b>${esc(it.title)}</b>${sub}</button>${o.mode === 'expand' && on ? `<div class="ref__body md">${it.body(it)}</div>` : ''}</div>`;
      });
      list.innerHTML = html || `<p class="muted">No matches for “${esc(qi.value.trim())}”.</p>`;
      if (det) { const it = hits.find((x) => x.id === sel); det.innerHTML = it ? it.body(it) : ''; det.scrollTop = 0; }
      paint(d.el);
    };

    qi.addEventListener('input', render);
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.ref__btn'); if (!b) return; const id = b.dataset.id;
      if (o.mode === 'split') sel = id; else if (open.has(id)) open.delete(id); else open.add(id);
      render(); const nb = $(`.ref__btn[data-id="${CSS.escape(id)}"]`, list); if (nb) nb.focus();
    });
    d.el.addEventListener('click', (e) => { const b = e.target.closest('[data-doc]'); if (b) openDoc(b.dataset.doc); });
    Promise.resolve().then(o.load).then((arr) => {
      items = arr.map((it) => Object.assign({}, it, { hay: [it.title, it.sub, it.cat, it.hay].join(' ').toLowerCase() }));
      render();
    }).catch(() => {
      list.innerHTML = `<p class="muted">${esc(o.err || 'Could not load this reference.')}</p>`;
    });
    return d;
  }

  const refJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); }).then((j) => { if (!Array.isArray(j)) throw new Error(url); return j; });
  const str = (v) => (typeof v === 'string' ? v : '');

  let PKCAT = null;
  const pkCat = () => PKCAT || (PKCAT = refJson('docs/packages.json').then((j) => j.filter((p) => p && /^[\w-]+$/.test(str(p.name)))).catch((e) => { PKCAT = null; throw e; }));
  const pkBody = (p) => {
    const uses = (Array.isArray(p.uses) ? p.uses : []).map(str).filter(Boolean), cmds = (Array.isArray(p.commands) ? p.commands : []).filter((c) => c && str(c.c));
    return `<h3>${esc(p.name)}</h3><p class="muted">${esc(str(p.short))}</p>${mdRender(str(p.details) || str(p.desc), 'docs/')}`
      + (uses.length ? `<h4>Typical uses</h4><ul>${uses.map((u) => `<li>${mdInline(u, 'docs/')}</li>`).join('')}</ul>` : '')
      + (cmds.length ? `<h4>Common commands</h4><table><tbody>${cmds.map((c) => `<tr><td><code>${esc(c.c)}</code></td><td>${mdInline(str(c.d), 'docs/')}</td></tr>`).join('')}</tbody></table>` : '')
      + (str(p.notes) ? `<h4>Notes</h4>${mdRender(str(p.notes), 'docs/')}` : '')
      + `<p><button class="btn btn--sm" data-doc="${esc(str(p.ctan || p.doc))}">${ic('share')}Open Documentation Site</button></p>`;
  };

  const refPackages = (pick) => refPanel({
    t: 'Package Reference', i: 'layers', w: 820, mode: 'split', pick, ph: 'Search packages, commands, uses…',
    err: 'Could not load docs/packages.json: the package catalogue is loaded from the local server.',
    load: () => pkCat().then((j) => j.map((p) => ({
      id: p.name, title: p.name, sub: str(p.short),
      hay: [str(p.desc), str(p.details), str(p.notes)].concat(Array.isArray(p.uses) ? p.uses : [], (Array.isArray(p.commands) ? p.commands : []).map((c) => c && str(c.c) + ' ' + str(c.d))).join(' '),
      body: () => pkBody(p)
    })))
  });

  const MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  const SHORTCUTS = [
    ['General', 'Save document', 'Mod+S'], ['General', 'Save As (copy / new file)', 'Mod+Shift+S'],
    ['General', 'Compile', 'Mod+Enter'], ['General', 'Command search', 'Mod+K'], ['General', 'Find and Replace', 'Mod+F'],
    ['General', 'Close the open dialog, menu, Find panel or File view', 'Esc'], ['General', 'Cancel Format Painter', 'Esc'],
    ['Editor', 'Undo', 'Mod+Z', 'Per-file history with selection restore'],
    ['Editor', 'Redo', 'Mod+Y / Mod+Shift+Z', 'Per-file history with selection restore'],
    ['Find and Replace panel', 'Next match', 'Enter', 'In the Find box'], ['Find and Replace panel', 'Previous match', 'Shift+Enter', 'In the Find box'],
    ['Find and Replace panel', 'Replace current match', 'Enter', 'In the Replace box'], ['Find and Replace panel', 'Close panel', 'Esc'],
    ['Dialogs', 'Next / previous control', 'Tab / Shift+Tab'], ['Dialogs', 'Next ▢ placeholder', 'Tab', 'In the Equation dialog formula box'],
    ['Comments', 'Add or save a comment', 'Mod+Enter'], ['Comments', 'Cancel editing a comment', 'Esc'],
    ['PDF preview', 'Zoom the PDF', 'Mod+Scroll', 'Or pinch on a trackpad']
  ];
  const keyName = (k) => (k === 'Mod' ? (MAC ? '⌘' : 'Ctrl') : k === 'Shift' && MAC ? '⇧' : k);
  const keyHtml = (spec) => spec.split(' / ').map((c) => c.split('+').map((k) => `<kbd>${esc(keyName(k))}</kbd>`).join(' + ')).join(' <span class="muted">or</span> ');

  const refShortcuts = () => refPanel({
    t: 'Keyboard Shortcuts', i: 'keyboard', w: 560, mode: 'flat', ph: 'Search shortcuts…',
    load: () => SHORTCUTS.map((r, i) => ({ id: 'k' + i, cat: r[0], title: r[1], sub: r[3] || '', right: keyHtml(r[2]), hay: r[2].replace(/Mod/g, 'ctrl cmd ⌘') }))
  });

  const refTrouble = () => refPanel({
    t: 'Troubleshooting', i: 'triangle-alert', w: 700, mode: 'expand', ph: 'Search problems and fixes…',
    err: 'Could not load docs/troubleshooting.json: the FAQ is loaded from the local server.',
    load: () => refJson('docs/troubleshooting.json').then((j) => j.filter((e) => e && str(e.q) && str(e.a)).map((e, i) => ({
      id: str(e.id) || 'q' + i, cat: str(e.cat), title: str(e.q), hay: str(e.tags) + ' ' + str(e.a), body: () => mdRender(str(e.a), 'docs/')
    })))
  });

  RPE.docs = {
    MD_DOCS, mdInline, mdRender, mdDialog, openDoc, refPanel, refPackages, refShortcuts, refTrouble, pkCat
  };
})(window.RPE = window.RPE || {});