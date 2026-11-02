/* citations.js: Laurevine Plum Citation Library, BibTeX parsing & serialization, and bibliography manager.
   Exposes window.RPE.bib. */
(function (RPE) {
  'use strict';

  const {
    $, $$, esc, ic, h, paint, toast, dlg, F, note, str, texEsc, tocMask, menu, closePop
  } = RPE.ui;

  const ctx = new Proxy({}, {
    get: (_, k) => (RPE.ctx || {})[k],
    set: (_, k, v) => { if (RPE.ctx) RPE.ctx[k] = v; return true; }
  });
  const TOC_BOOKISH = /^[ 	]*\documentclass(?:\[[^\]]*\])?\{(book|report|memoir|scrbook|scrreprt)\}/m;
  const relPath = (p) => {
    const proj = (ctx.PROJECT && ctx.PROJECT.length) ? ctx.PROJECT : ((window.RPE && window.RPE.explorer && window.RPE.explorer.PROJECT) || []);
    const root = proj && proj[0];
    if (!p || !root || !root.path) return p || '';
    return p.startsWith(root.path + '/') ? p.slice(root.path.length + 1) : (p === root.path ? '' : p);
  };

  // Live bridges to editor and explorer via ctx
  const fmtEdit = (...a) => ctx.fmtEdit(...a);
  const syncFmtBtns = (...a) => ctx.syncFmtBtns(...a);
  const refreshDir = (...a) => ctx.refreshDir(...a);
  const renderExplorer = (...a) => ctx.renderExplorer(...a);
  const tocGo = (...a) => ctx.tocGo(...a);
  const openViewer = (...a) => ctx.openViewer(...a);

  /* ---------- Citation Library: durable reference store (localStorage, independent of any open document), .bib parse/serialize,
     and the Manage Sources panel (D.bib). Records: { id, key, type, fields:{name:value}, added }. Unedited/unknown fields are kept as imported. ---------- */
  const LIB_KEY = 'lplum.library.v1', LIB = { items: [] };
  try { const v = JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); if (Array.isArray(v)) LIB.items = v.filter((r) => r && r.id && r.key && r.fields && typeof r.fields === 'object'); } catch (e) { /* corrupt or unavailable: start empty */ }
  const libSave = () => { try { localStorage.setItem(LIB_KEY, JSON.stringify(LIB.items)); return true; } catch (e) { toast('Could not save the library (browser storage unavailable or full)'); return false; } };
  const libId = () => 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const BIB_TYPES = ['article', 'book', 'inproceedings', 'incollection', 'phdthesis', 'mastersthesis', 'techreport', 'misc'];
  const PUB_FIELDS = ['journal', 'booktitle', 'publisher', 'school', 'institution', 'howpublished'];
  const pubField = (t) => ({ article: 'journal', inproceedings: 'booktitle', conference: 'booktitle', incollection: 'booktitle', inbook: 'booktitle', book: 'publisher', phdthesis: 'school', mastersthesis: 'school', techreport: 'institution' }[t] || 'howpublished');
  const pubOf = (r) => { const f = PUB_FIELDS.find((k) => r.fields[k]); return f ? r.fields[f] : ''; };
  const normDoi = (s) => String(s || '').trim().toLowerCase().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/, '');
  const normTitle = (s) => String(s || '').toLowerCase().replace(/\\[a-z]+/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
  const keyOk = (k) => !!k && !/[\s,{}()"#%'=\\~]/.test(k);
  const bracesOk = (s) => { let d = 0; for (const c of s) { if (c === '{') d++; else if (c === '}' && --d < 0) return false; } return d === 0; };
  const keyTaken = (k, set) => set.has(k.toLowerCase());   // BibTeX treats keys case-insensitively
  const bibEsc = (s) => String(s || '').replace(/(^|[^\\])([&%$#_])/g, '$1\\$2');
  const BIB_REQ = { article: ['author', 'title', 'journal', 'year'], book: ['author', 'title', 'publisher', 'year'], inproceedings: ['author', 'title', 'booktitle', 'year'], conference: ['author', 'title', 'booktitle', 'year'], incollection: ['author', 'title', 'booktitle', 'publisher', 'year'], phdthesis: ['author', 'title', 'school', 'year'], mastersthesis: ['author', 'title', 'school', 'year'], techreport: ['author', 'title', 'institution', 'year'] };
  function uniqueKey(base, set) {
    if (!keyTaken(base, set)) return base;
    const m = /^(.+?)([a-z])$/i.exec(base), stem = m ? m[1] : base;
    let i = m ? m[2].toLowerCase().charCodeAt(0) - 96 : 0, k = stem + (i < 26 ? String.fromCharCode(97 + i) : '_' + (i - 25));
    while (keyTaken(k, set)) { i++; k = stem + (i < 26 ? String.fromCharCode(97 + i) : '_' + (i - 25)); }
    return k;
  }
  const lastName = (a) => { a = a.trim(); return a.includes(',') ? a.split(',')[0].trim() : a.split(/\s+/).pop(); };
  const authorsShort = (s) => { const a = String(s || '').split(/\s+and\s+/).filter(Boolean).map(lastName); return a.length > 3 ? a[0] + ' et al.' : a.join(', '); };
  const autoKey = (f) => { const ln = (f.author ? lastName(f.author.split(/\s+and\s+/)[0]) : '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase(); return (ln || 'ref') + (String(f.year || '').match(/\d{4}/) || [''])[0]; };

  /* ---- Library PDFs: each imported PDF is kept as a Blob in an app-managed IndexedDB ('lplum-pdfs', key = reference id) and linked from
     its record via rec.pdf = {name, size}. Metadata comes only from what the PDF itself embeds (Info dictionary + XMP); nothing is guessed. ---- */
  const pdfDb = () => new Promise((res, rej) => { const rq = indexedDB.open('lplum-pdfs', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('pdfs'); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const pdfOp = async (mode, fn) => { const db = await pdfDb(); return new Promise((res, rej) => { const t = db.transaction('pdfs', mode), rq = fn(t.objectStore('pdfs')); t.oncomplete = () => res(rq.result); t.onerror = t.onabort = () => rej(t.error); }); };
  const pdfPut = (id, blob) => pdfOp('readwrite', (st) => st.put(blob, id));
  const pdfGet = (id) => pdfOp('readonly', (st) => st.get(id));
  const pdfDel = (id) => pdfOp('readwrite', (st) => st.delete(id)).catch(() => {});
  function pdfMeta(bytes) {
    const t = new TextDecoder('latin1').decode(bytes), out = {};
    const pdfStr = (src) => {   // literal (…) with escapes, or <hex>; UTF-16BE when it starts with FEFF
      let b = [];
      if (src[0] === '<') { const hx = src.slice(1, -1).replace(/\s+/g, ''); for (let i = 0; i + 1 < hx.length; i += 2) b.push(parseInt(hx.substr(i, 2), 16)); }
      else { const q = src.slice(1, -1); for (let i = 0; i < q.length; i++) { let c = q.charCodeAt(i); if (c === 92) { const n = q[++i]; if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(q[i + 1] || '')) o += q[++i]; c = parseInt(o, 8) & 255; } else if (n === '\r' || n === '\n') { if (n === '\r' && q[i + 1] === '\n') i++; continue; } else c = { n: 10, r: 13, t: 9, b: 8, f: 12 }[n] ?? n.charCodeAt(0); } b.push(c); } }
      return (b[0] === 254 && b[1] === 255 ? new TextDecoder('utf-16be').decode(Uint8Array.from(b.slice(2))) : String.fromCharCode(...b)).replace(/\s+/g, ' ').trim();
    };
    const info = (k) => { let m, v = ''; const re = new RegExp('/' + k + '\\s*(\\((?:\\\\[\\s\\S]|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)', 'g'); while ((m = re.exec(t))) v = pdfStr(m[1]) || v; return v; };   // last occurrence wins (incremental updates)
    const xmp = (tag) => { const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>').exec(t); if (!m) return []; const li = [...m[1].matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g)].map((x) => x[1]); const u = (x) => { try { return decodeURIComponent(escape(x)); } catch (e) { return x; } }; return (li.length ? li : [m[1]]).map((x) => u(x.replace(/<[^>]+>/g, '')).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim()).filter(Boolean); };
    const junk = (x) => !x || /^(untitled|microsoft word - |\S+\.(docx?|tex|pdf)$)/i.test(x);
    const title = info('Title'), tx2 = xmp('dc:title')[0] || '', ti = junk(title) ? (junk(tx2) ? '' : tx2) : title;
    const au = xmp('dc:creator'), aInfo = info('Author'), a = au.length ? au.join(' and ') : (/;/.test(aInfo) ? aInfo.split(/\s*;\s*/).filter(Boolean).join(' and ') : aInfo);
    const doi = ((xmp('prism:doi')[0] || xmp('pdfx:doi')[0] || xmp('dc:identifier').find((x) => /10\.\d{4,9}\//.test(x)) || (/\b(10\.\d{4,9}\/[^\s"<>]+)/.exec(info('Subject')) || [])[1] || '').replace(/^doi:\s*/i, '').trim());
    if (ti) out.title = ti; if (a && !junk(a) && !/^(unknown|anonymous)$/i.test(a)) out.author = a; if (/^10\.\d{4,9}\//.test(doi)) out.doi = doi;
    return out;
  }

  /* BibTeX parser. Entries must start at the beginning of a line; text between entries is ignored (as BibTeX does). @string macros are
     expanded, `#` concatenation joined. A malformed entry is reported with its line number and skipped; parsing resumes at the next entry. */
  function parseBib(src) {
    const out = { entries: [], errors: [], warnings: [] }, strs = {}, n = src.length; let i = 0;
    const lineOf = (p) => src.slice(0, p).split('\n').length, skipWs = () => { while (i < n && /\s/.test(src[i])) i++; };
    const braced = () => { let d = 0; const s = i + 1; for (; i < n; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return src.slice(s, i++); } throw new Error('unbalanced braces: a closing "}" is missing'); };
    const quoted = () => { let d = 0; const s = ++i; for (; i < n; i++) { if (src[i] === '{') d++; else if (src[i] === '}') d--; else if (src[i] === '"' && d === 0) return src.slice(s, i++); } throw new Error('unterminated "quoted" value'); };
    const value = () => {
      const parts = [];
      for (;;) {
        skipWs(); const c = src[i];
        if (c === '{') parts.push(braced()); else if (c === '"') parts.push(quoted());
        else { const m = /^[^\s,{}()"#=@]+/.exec(src.slice(i, i + 200)); if (!m) throw new Error(i >= n ? 'unexpected end of file' : 'missing field value'); i += m[0].length; parts.push(/^\d+$/.test(m[0]) ? m[0] : (strs[m[0].toLowerCase()] ?? m[0])); }
        skipWs(); if (src[i] === '#') { i++; continue; } break;
      }
      return parts.join('').replace(/\s+/g, ' ').trim();
    };
    while ((i = src.indexOf('@', i)) !== -1) {
      const start = i++; let key = '';
      if (!/^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', start - 1) + 1, start))) continue;   // an "@" inside text (e-mail, comment): not an entry
      try {
        const m = /^\s*([A-Za-z]+)\s*([{(])/.exec(src.slice(i, i + 80)), t = (/^\s*([A-Za-z]+)/.exec(src.slice(i, i + 40)) || [])[1];
        if (t && t.toLowerCase() === 'comment') continue;
        if (!m) throw new Error('not a valid entry (expected @type{key, …})');
        i += m[0].length; const type = m[1].toLowerCase(), close = m[2] === '{' ? '}' : ')'; skipWs();
        if (type === 'preamble') { value(); skipWs(); if (src[i] !== close) throw new Error('malformed @preamble'); i++; continue; }
        if (type === 'string') { const nm = /^[^\s={}(),"#]+/.exec(src.slice(i, i + 80)); if (!nm) throw new Error('malformed @string'); i += nm[0].length; skipWs(); if (src[i] !== '=') throw new Error('@string is missing "="'); i++; strs[nm[0].toLowerCase()] = value(); skipWs(); if (src[i] !== close) throw new Error('malformed @string'); i++; continue; }
        const km = /^[^\s,{}()"#%'=\\~]+/.exec(src.slice(i, i + 200)); if (!km) throw new Error('missing citation key'); key = km[0]; i += key.length; skipWs();
        if (src[i] === ',') i++; else if (src[i] !== close) throw new Error('missing "," after the citation key');
        const fields = {};
        for (;;) {
          skipWs(); if (i >= n) throw new Error('unexpected end of file: the entry is never closed');
          if (src[i] === close) { i++; break; } if (src[i] === ',') { i++; continue; }
          const fm = /^[A-Za-z][^\s={},"#()]*/.exec(src.slice(i, i + 80)); if (!fm) throw new Error('unexpected "' + src[i] + '" where a field name was expected (missing closing brace?)');
          i += fm[0].length; skipWs(); if (src[i] !== '=') throw new Error('field "' + fm[0] + '" has no "="'); i++;
          const v = value(), fn = fm[0].toLowerCase(); if (fn in fields) out.warnings.push('Line ' + lineOf(start) + ' (' + key + '): duplicate field "' + fn + '": the first one was kept'); else fields[fn] = v;
          skipWs(); if (src[i] === ',') i++; else if (src[i] !== close) throw new Error('missing "," between fields');
        }
        out.entries.push({ type, key, fields, line: lineOf(start) });
      } catch (e) { out.errors.push({ line: lineOf(start), key, msg: e.message, snippet: src.slice(start, start + 70).split('\n')[0] }); i = start + 1; }
    }
    return out;
  }
  const bibEntry = (r) => '@' + r.type + '{' + r.key + ',\n' + Object.entries(r.fields).map(([k, v]) => '  ' + k + ' = {' + (k === 'doi' || k === 'url' ? v : bibEsc(v)) + '}').join(',\n') + '\n}\n';
  const bibText = () => LIB.items.map(bibEntry).join('\n');

  function bibDialog() {
    const sel = { id: null };
    const r = dlg({ t: 'Manage Sources', i: 'folder-open', w: 800, btns: ['Close'], focus: '#bibQ', b: `<div id="bibRoot"></div>` }), root = $('#bibRoot', r.el), $r = (s) => $(s, root);
    const tx = (s) => esc(s || ''), field = (id, l, v) => `<div class="field"><label class="field__label">${l}<input id="${id}" value="${tx(v)}" autocomplete="off"></label></div>`;
    const itemOf = (id) => LIB.items.find((x) => x.id === id);

    function main() {
      root.innerHTML = `<div class="dlg-grid" style="grid-template-columns:1.25fr 1fr"><div>
        <div class="field"><label class="field__label">Search<input id="bibQ" placeholder="Key, title, author, year, publication, DOI" autocomplete="off"></label></div>
        <div id="bibCount" class="muted" style="margin:6px 0 4px"></div>
        <div style="max-height:280px;overflow:auto"><table class="tbl"><thead><tr><th>Key</th><th>Authors</th><th>Year</th><th>Title</th></tr></thead><tbody id="bibRows"></tbody></table></div>
        <div style="display:flex;gap:6px;margin-top:10px"><button class="btn btn--sm" id="bibImp">${ic('cloud-upload')}Import .bib…</button><button class="btn btn--sm" id="bibPdf">${ic('file-down')}Import PDF(s)…</button><button class="btn btn--sm" id="bibExp">${ic('download')}Export .bib</button></div>
      </div><div id="bibForm"></div></div>`;
      paint(root); $r('#bibQ').oninput = list; $r('#bibImp').onclick = pickBib; $r('#bibPdf').onclick = () => pickPdf(); $r('#bibExp').onclick = exportBib;
      $r('#bibRows').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) pick(tr.dataset.id); };
      $r('#bibRows').onkeydown = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && e.key === 'Enter') pick(tr.dataset.id); };
      list(); form();
    }
    function list() {
      const q = $r('#bibQ').value.toLowerCase().split(/\s+/).filter(Boolean), tb = $r('#bibRows');
      const rows = LIB.items.filter((x) => { const hay = [x.key, x.fields.title, x.fields.author, x.fields.year, pubOf(x), x.fields.doi].join(' ').toLowerCase(); return q.every((t) => hay.includes(t)); });
      $r('#bibCount').textContent = LIB.items.length ? (q.length ? rows.length + ' of ' + LIB.items.length + ' references match' : LIB.items.length + ' reference' + (LIB.items.length === 1 ? '' : 's')) : 'No references yet. Add one, or import a .bib file or PDFs.';
      tb.innerHTML = rows.map((x) => `<tr data-id="${x.id}" tabindex="0" class="${x.id === sel.id ? 'on' : ''}" style="cursor:pointer"><td>${tx(x.key)}</td><td>${tx(authorsShort(x.fields.author))}</td><td>${tx(x.fields.year)}</td><td>${x.pdf ? ic('file-text') + ' ' : ''}${tx(x.fields.title || (x.pdf ? x.pdf.name : ''))}</td></tr>`).join('');
    }
    function pick(id) { sel.id = id; $$('#bibRows tr', root).forEach((tr) => tr.classList.toggle('on', tr.dataset.id === id)); form(); }
    function form(confirmDel) {
      const x = sel.id ? itemOf(sel.id) : null, f = x ? x.fields : {}, type = x ? x.type : 'article', types = BIB_TYPES.includes(type) ? BIB_TYPES : [type].concat(BIB_TYPES);
      const extra = x ? Object.keys(f).filter((k) => !['title', 'author', 'year', 'doi'].concat(PUB_FIELDS).includes(k)).length : 0;
      $r('#bibForm').innerHTML = `<div class="field__label" style="margin-bottom:6px">${x ? 'Edit reference' : 'New reference'}</div>${field('bibT', 'Title', f.title)}${field('bibA', 'Authors (Last, First and Last, First)', f.author)}
        <div class="dlg-grid" style="margin-top:10px">${field('bibY', 'Year', f.year)}<div class="field"><label class="field__label">Type<select id="bibTy">${types.map((t) => `<option ${t === type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div></div>
        <div style="margin-top:10px">${field('bibP', 'Publication (journal / book title / publisher…)', x ? pubOf(x) : '')}</div><div style="margin-top:10px">${field('bibD', 'DOI', f.doi)}</div>
        <div style="margin-top:10px"><div class="field"><label class="field__label" style="display:flex;justify-content:space-between;align-items:center"><span>Citation key <span class="muted" style="font-weight:normal">(blank = generate)</span></span><button type="button" class="btn btn--sm" id="bibGenKey" style="padding:1px 6px">${ic('refresh-cw')}Generate</button></label><input id="bibK" value="${tx(x ? x.key : '')}" autocomplete="off" placeholder="Leave blank to auto-generate"></div></div>
        ${x ? `<div id="bibPdfRow" class="muted" style="margin-top:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">${x.pdf ? `<span style="flex:1 1 100%">${ic('file-text')} ${tx(x.pdf.name)} (${Math.max(1, Math.round(x.pdf.size / 1024))} KB)</span><button class="btn btn--sm" id="bibPdfOpen">Open PDF</button><button class="btn btn--sm" id="bibPdfRm">Unlink PDF</button>` : `<button class="btn btn--sm" id="bibPdfAdd">${ic('file-down')}Attach PDF…</button>`}</div>` : ''}
        ${extra ? `<div class="muted" style="margin-top:6px">${extra} other field${extra === 1 ? '' : 's'} (pages, volume…) kept unchanged.</div>` : ''}
        <div id="bibAct" style="display:flex;gap:6px;margin-top:12px;align-items:center;flex-wrap:wrap">${confirmDel ? `<span style="flex:1 1 100%">Remove “${tx(x.key)}” from the library? This can’t be undone.</span><button class="btn btn--sm" id="bibNo">Cancel</button><button class="btn btn--sm btn--danger" id="bibYes">${ic('trash-2')}Remove</button>`
          : `<button class="btn btn--sm btn--primary" id="bibSave">${ic('save')}${x ? 'Save changes' : 'Add reference'}</button><button class="btn btn--sm" id="bibNew">${ic('plus')}New</button>${x ? `<button class="btn btn--sm" id="bibDel">${ic('trash-2')}Remove</button>` : ''}`}</div>`;
      paint($r('#bibForm'));
      const on = (id, fn) => { const b = $r('#' + id); if (b) b.onclick = fn; };
      on('bibPdfOpen', openPdf); on('bibPdfRm', unlinkPdf); on('bibPdfAdd', () => pickPdf(sel.id)); on('bibSave', save); on('bibNew', () => { sel.id = null; list(); form(); $r('#bibT').focus(); }); on('bibDel', () => form(true)); on('bibNo', () => form());
      on('bibGenKey', () => {
        const author = $r('#bibA').value.trim(), year = $r('#bibY').value.trim(), title = $r('#bibT').value.trim();
        const others = new Set(LIB.items.filter((y) => !x || y.id !== x.id).map((y) => y.key.toLowerCase()));
        const gen = uniqueKey(autoKey({ author, year, title }) || 'ref', others);
        $r('#bibK').value = gen; toast('Generated key: ' + gen);
      });
      on('bibYes', () => { LIB.items = LIB.items.filter((y) => y.id !== sel.id); pdfDel(sel.id); sel.id = null; libSave(); list(); form(); toast('Reference removed'); });
    }
    function save() {
      const v = (id) => $r('#' + id).value.trim(), x = sel.id ? itemOf(sel.id) : null, type = $r('#bibTy').value;
      const vals = { title: bibEsc(v('bibT')), author: bibEsc(v('bibA')), year: v('bibY'), doi: v('bibD') }, pub = bibEsc(v('bibP'));
      for (const [k, s] of Object.entries(vals).concat([['publication', pub]])) if (!bracesOk(s)) return toast('Unbalanced { } in ' + k + ': fix it before saving');
      const f = x ? x.fields : {}, pf = (x && PUB_FIELDS.find((k) => f[k])) || pubField(type);
      const req = BIB_REQ[type] || ['title'];
      const fAll = Object.assign({}, f, vals); if (pub) fAll[pf] = pub;
      if (type === 'book' && (fAll.editor || fAll.author)) fAll.author = fAll.author || fAll.editor;
      const missing = req.filter((k) => !fAll[k] || !String(fAll[k]).trim());
      if (missing.length) return toast('Missing required field' + (missing.length > 1 ? 's' : '') + ' for @' + type + ': ' + missing.join(', '));
      const others = new Set(LIB.items.filter((y) => !x || y.id !== x.id).map((y) => y.key.toLowerCase()));
      let key = v('bibK'), suffixed = false;
      if (key) {
        if (!keyOk(key)) return toast('Citation key can’t contain spaces or , { } ( ) " # % \' = \\ ~');
        if (keyTaken(key, others)) { const orig = key; key = uniqueKey(key, others); suffixed = true; }
      } else key = uniqueKey(autoKey(vals) || 'ref', others);
      const nf = Object.assign({}, f);   // update in place so field order and every other field survive
      Object.entries(vals).forEach(([k, s]) => { if (s) nf[k] = s; else delete nf[k]; });
      if (pub) nf[pf] = pub; else delete nf[pf];
      if (x) { x.key = key; x.type = type; x.fields = nf; } else { const rec = { id: libId(), key, type, fields: nf, added: Date.now() }; LIB.items.push(rec); sel.id = rec.id; }
      libSave(); list(); form(); toast(suffixed ? 'Key already exists: saved with suffix as ' + key : (x ? 'Reference saved' : 'Reference added as ' + key));
    }
    /* Import PDFs: one new record per file (or, with `attachTo`, link one PDF to that existing record without touching its fields). Empty/failed extraction → a mostly-empty record. */
    function pickPdf(attachTo) {
      const inp = window.RPE.fsBridge.fileInput('.pdf,application/pdf', !attachTo, 'Choose PDF' + (attachTo ? '' : ' Files'));
      inp.onchange = async () => {
        const files = [...inp.files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'); if (!files.length) return toast('Choose PDF files');
        const taken = new Set(LIB.items.map((x) => x.key.toLowerCase())); let ok = 0, bare = 0, last = null; const failed = [], dups = [];
        for (const f of files) {
          try {
            const bytes = new Uint8Array(await f.arrayBuffer());
            if (String.fromCharCode(...bytes.slice(0, 1024)).indexOf('%PDF-') < 0) throw new Error('not a PDF');
            let meta = {}; try { meta = pdfMeta(bytes); } catch (e) { /* extraction is best-effort */ }
            const link = { name: f.name, size: f.size }, x = attachTo ? itemOf(attachTo) : null;
            const id = x ? x.id : libId(); await pdfPut(id, new Blob([bytes], { type: 'application/pdf' }));
            if (x) { x.pdf = link; last = x.id; ok++; continue; }
            const dk = normDoi(meta.doi), same = dk && LIB.items.find((y) => normDoi(y.fields.doi) === dk); if (same) dups.push(f.name + ' (same DOI as ' + same.key + ')');
            const key = uniqueKey(autoKey(meta) || 'ref', taken); taken.add(key.toLowerCase());
            if (!Object.keys(meta).length) bare++;
            LIB.items.push({ id, key, type: 'misc', fields: meta, pdf: link, added: Date.now() }); last = id; ok++;
          } catch (e) { failed.push(f.name); }
        }
        if (ok) libSave(); if (last) sel.id = last; list(); form();
        toast(ok ? (attachTo ? 'PDF linked' : 'Imported ' + ok + ' PDF' + (ok === 1 ? '' : 's') + (bare ? ': ' + bare + ' had no embedded metadata, fill in the empty record' : '')) + (dups.length ? '; possible duplicate: ' + dups.join(', ') : '') + (failed.length ? '; could not read ' + failed.join(', ') : '') : 'Could not read ' + failed.join(', ') + ': not a valid PDF');
      };
      inp.click();
    }
    async function openPdf() {
      const x = itemOf(sel.id); if (!x || !x.pdf) return;
      let blob; try { blob = await pdfGet(x.id); } catch (e) { /* fall through */ }
      if (!blob) return toast('The stored PDF is missing. Unlink it and import the file again');
      r.close(); openViewer({ n: x.pdf.name, path: '(library)/' + x.id, handle: { getFile: async () => blob } }, 'pdf');
    }
    function unlinkPdf() { const x = itemOf(sel.id); if (!x) return; delete x.pdf; pdfDel(x.id); libSave(); list(); form(); toast('PDF unlinked and removed from app storage'); }
    function exportBib() {
      if (!LIB.items.length) return toast('The library is empty. Nothing to export');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bibText()], { type: 'text/plain;charset=utf-8' })); a.download = 'references.bib'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Exported ' + LIB.items.length + ' reference' + (LIB.items.length === 1 ? '' : 's') + ' to references.bib');
    }
    function pickBib() {
      const inp = window.RPE.fsBridge.fileInput('.bib,.txt,text/plain', false, 'Choose a BibTeX File');
      inp.onchange = async () => { const f = inp.files[0]; if (!f) return; let txt; try { txt = await f.text(); } catch (e) { return toast('Could not read that file'); } review(f.name, parseBib(txt.replace(/^\uFEFF/, ''))); };
      inp.click();
    }
    /* Import review: every parsed entry is listed with its status; likely duplicates default to Skip but are never merged. */
    function review(name, res) {
      const idx = { doi: new Map(), title: new Map(), key: new Map() };
      const add = (k, e, map) => { if (k && !map.has(k)) map.set(k, e); };
      LIB.items.forEach((x) => { add(normDoi(x.fields.doi), x.key, idx.doi); add(normTitle(x.fields.title), x.key, idx.title); add(x.key.toLowerCase(), x, idx.key); });
      const rows = res.entries.map((e) => {
        const dk = normDoi(e.fields.doi), tk = normTitle(e.fields.title), kx = idx.key.get(e.key.toLowerCase()), kt = kx && tk && normTitle(kx.fields ? kx.fields.title : '') === tk;
        let s = '', dup = false;
        if (dk && idx.doi.has(dk)) { s = 'Same DOI as ' + idx.doi.get(dk); dup = true; }
        else if (kt) { s = 'Same key and title already in the library'; dup = true; }
        else if (tk && idx.title.has(tk)) { s = 'Same title as ' + idx.title.get(tk) + ' (not merged)'; dup = true; }
        else if (kx) s = 'Key already used: will be renamed automatically';
        add(dk, e.key, idx.doi); add(tk, e.key, idx.title); add(e.key.toLowerCase(), { fields: e.fields }, idx.key);
        return { e, s, dup };
      });
      root.innerHTML = `<div class="field__label" style="margin-bottom:6px">Import ${esc(name)}</div>
        ${res.errors.length ? `<div class="prev" style="text-align:left;font:12px var(--font);padding:8px 10px;margin-bottom:8px"><b>${res.errors.length} malformed entr${res.errors.length === 1 ? 'y was' : 'ies were'} not imported:</b><ul style="margin:4px 0 0 16px;padding:0">${res.errors.map((x) => `<li>Line ${x.line}${x.key ? ' (' + tx(x.key) + ')' : ''}: ${tx(x.msg)}<br><code>${tx(x.snippet)}</code></li>`).join('')}</ul></div>` : ''}
        ${res.warnings.length ? `<div class="muted" style="margin-bottom:8px">${res.warnings.map(tx).join('<br>')}</div>` : ''}
        ${rows.length ? `<div style="max-height:260px;overflow:auto"><table class="tbl"><thead><tr><th>Key</th><th>Title</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map((x, n) => `<tr><td>${tx(x.e.key)}</td><td>${tx(x.e.fields.title)}</td><td>${x.s ? (x.dup ? '⚠ ' : '') + tx(x.s) : 'New'}</td><td><select data-n="${n}"><option${x.dup ? '' : ' selected'}>Import</option><option${x.dup ? ' selected' : ''}>Skip</option></select></td></tr>`).join('')}</tbody></table></div>` : '<p>No valid entries were found in this file.</p>'}
        <div style="display:flex;gap:6px;margin-top:12px;justify-content:flex-end"><button class="btn" id="bibBack">${rows.length ? 'Cancel' : 'Back'}</button>${rows.length ? '<button class="btn btn--primary" id="bibGo">Import selected</button>' : ''}</div>`;
      paint(root);   // rows are injected after the dialog opens: theme their Import/Skip selects like every other dropdown
      $r('#bibBack').onclick = main;
      const go = $r('#bibGo'); if (!go) return;
      go.onclick = () => {
        const taken = new Set(LIB.items.map((x) => x.key.toLowerCase())), fresh = []; let skipped = 0, renamed = 0;
        $$('select[data-n]', root).forEach((s) => {
          if (s.value !== 'Import') return void skipped++;
          const e = rows[+s.dataset.n].e, key = uniqueKey(e.key, taken); if (key !== e.key) renamed++;
          taken.add(key.toLowerCase()); fresh.push({ id: libId(), key, type: e.type, fields: e.fields, added: Date.now() });
        });
        if (!fresh.length) { toast('Nothing imported'); return main(); }
        LIB.items.push(...fresh); const ok = libSave(); main();
        if (ok) toast('Imported ' + fresh.length + (renamed ? ' (' + renamed + ' key' + (renamed === 1 ? '' : 's') + ' renamed)' : '') + (skipped ? ', skipped ' + skipped : '') + (res.errors.length ? ', ' + res.errors.length + ' malformed' : ''));
      };
    }
    main();
  }
  /* Insert ▸ Citation: searchable multi-select picker over the Citation Library (LIB). Inserts \cite{k1,k2} at the cursor (selection end).
     A key that isn't in the library only goes in through the explicit "custom key" field. Optionally appends the chosen library entries to the
     document's .bib (new keys only, existing entries/files are never overwritten) and adds \bibliography / \addbibresource only if none exists. */
  const bibDecl = (t) => {   // .bib files the document already declares (uncommented \bibliography / \addbibresource lines)
    const out = []; let m; const r1 = /^[ \t]*\\bibliography\{([^}]*)\}/gm, r2 = /^[ \t]*\\addbibresource(?:\[[^\]]*\])?\{([^}]*)\}/gm;
    while ((m = r1.exec(t))) m[1].split(',').forEach((n) => { n = n.trim(); if (n) out.push(/\.bib$/i.test(n) ? n : n + '.bib'); });
    while ((m = r2.exec(t))) { const n = m[1].trim(); if (n) out.push(n); }
    return out;
  };
  function citeDialog() {
    const ta = $('#codeInput'); if (!ta) return;
    const t0 = ta.value, q0 = ta.selectionEnd, bs = t0.indexOf('\\begin{document}'), be0 = t0.indexOf('\\end{document}');
    if (bs < 0 || q0 < bs + 16 || (be0 >= 0 && q0 > be0)) return toast('Place the cursor inside the document body to insert a citation');
    const decl = bibDecl(t0), target = decl[0] || 'references.bib', pick = new Set(), custom = [], tx = (s) => esc(s || '');
    const hasBiblatex = /\\usepackage(?:\[[^\]]*\])?\{[^}]*\bbiblatex\b[^}]*\}/.test(t0);
    const hasNatbib = /\\usepackage(?:\[[^\]]*\])?\{[^}]*\bnatbib\b[^}]*\}/.test(t0);
    const citeCmds = hasNatbib ? ['citep', 'citet', 'cite', 'citealp'] : hasBiblatex ? ['textcite', 'parencite', 'cite', 'autocite'] : ['cite', 'citep', 'textcite'];
    const d = dlg({ t: 'Insert Citation', i: 'captions', w: 620, btns: ['Cancel', 'Insert'], focus: '#ciQ', b: `<div class="field"><label class="field__label">Search<input id="ciQ" placeholder="Key, title, author, year, DOI" autocomplete="off"></label></div>
      <div id="ciCount" class="muted" style="margin:6px 0 4px"></div><div id="ciList" style="max-height:220px;overflow:auto;border:1px solid var(--border,#8884);border-radius:6px"></div>
      <div style="display:flex;gap:6px;align-items:flex-end;margin-top:10px"><div class="field" style="flex:1"><label class="field__label">Custom key (not in the library)<input id="ciC" autocomplete="off"></label></div><button class="btn btn--sm" id="ciAdd">Add</button></div>
      <div id="ciCust" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px"><label class="field__label" style="margin:0;display:flex;align-items:center;gap:6px">Citation command:<select id="ciCmd" style="padding:2px 6px">${citeCmds.map((c) => `<option value="${c}">\\${c}</option>`).join('')}</select></label><span class="muted" style="font-size:12px">${hasNatbib ? 'natbib detected' : hasBiblatex ? 'biblatex detected' : 'standard LaTeX'}</span></div>
      <div class="field__label" style="margin-top:10px">Will insert</div><code id="ciPrev" style="display:block;padding:6px 8px;border-radius:6px;background:var(--panel-2,#8882);word-break:break-all"></code>
      <div style="margin-top:10px">${ctx.rootDirHandle ? `<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="ciBib" checked><span>Add the selected library entries to <b>${tx(target)}</b> in the project (new keys only)${decl.length ? '' : '; also adds the bibliography lines to this document'}</span></label>` : '<span class="muted">Open a project folder to also add entries to a .bib file.</span>'}</div>` });
    const $d = (s) => $(s, d.el);
    function prev() { const k = [...pick, ...custom], cmd = $d('#ciCmd') ? $d('#ciCmd').value : citeCmds[0]; $d('#ciPrev').textContent = k.length ? '\\' + cmd + '{' + k.join(',') + '}' : '-'; $d('#ciCust').innerHTML = custom.map((k) => `<button class="btn btn--sm" data-k="${tx(k)}" title="Remove">${tx(k)} ×</button>`).join(''); }
    function list() {
      const q = $d('#ciQ').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const rows = LIB.items.filter((x) => { const f = x.fields, hay = [x.key, f.title, f.author, f.year, f.doi, pubOf(x)].join(' ').toLowerCase(); return q.every((w) => hay.includes(w)); });
      $d('#ciCount').textContent = LIB.items.length ? rows.length + ' of ' + LIB.items.length + ' references' : 'The library is empty. Add references in Manage Sources, or type a custom key below.';
      $d('#ciList').innerHTML = LIB.items.length ? rows.map((x) => `<label style="display:flex;gap:8px;padding:6px 8px;cursor:pointer;align-items:flex-start"><input type="checkbox" data-k="${tx(x.key)}" ${pick.has(x.key) ? 'checked' : ''}><span><b>${tx(x.key)}</b>: ${tx(authorsShort(x.fields.author))} ${x.fields.year ? '(' + tx(x.fields.year) + ')' : ''}<br><span class="muted">${tx(x.fields.title)}</span></span></label>`).join('') || '<div class="muted" style="padding:8px">No match</div>' : `<div style="padding:8px"><button class="btn btn--sm" id="ciMng">Manage Sources…</button></div>`;
      const m = $d('#ciMng'); if (m) m.onclick = () => { d.close(); RPE.openD('bib'); };
    }
    $d('#ciQ').addEventListener('input', list);
    $d('#ciCmd').addEventListener('change', prev);
    $d('#ciList').addEventListener('change', (e) => { const k = e.target.dataset.k; if (k) { e.target.checked ? pick.add(k) : pick.delete(k); prev(); } });
    $d('#ciCust').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { custom.splice(custom.indexOf(b.dataset.k), 1); prev(); } });
    const add = () => {
      const k = $d('#ciC').value.trim(); if (!k) return;
      if (!keyOk(k)) return toast('Citation key can’t contain spaces or , { } ( ) " # % \' = \\ ~');
      if (LIB.items.some((x) => x.key === k)) pick.add(k); else if (!custom.includes(k)) custom.push(k);
      $d('#ciC').value = ''; list(); prev();
    };
    $d('#ciAdd').onclick = add; $d('#ciC').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    list(); prev();
    $('.dlg__foot .btn--primary', d.el).onclick = async () => {
      const keys = [...pick, ...custom]; if (!keys.length) return toast('Select at least one reference, or add a custom key');
      const lib = keys.map((k) => LIB.items.find((x) => x.key === k)).filter(Boolean), bibCb = $d('#ciBib');
      let cfg = null, note = '';
      if (bibCb && bibCb.checked && lib.length) {
        const okName = (n) => /^[\w. -]+(\/[\w. -]+)*\.bib$/i.test(n) && !n.split('/').includes('..');
        try {
          if (!okName(target)) throw new Error('unsupported .bib path “' + target + '”');
          const have = new Set(); let mine = '';
          for (const n of decl.length ? decl : [target]) {
            if (!okName(n)) continue; const fh = await ctx.handleByRel(n); if (!fh) continue;
            const txt = await (await fh.getFile()).text(), p = parseBib(txt);
            if (p.errors.length) throw new Error('“' + n + '” has entries that could not be parsed, so it was left untouched');
            p.entries.forEach((e) => have.add(e.key.toLowerCase())); if (n === target) mine = txt;
          }
          const fresh = []; const seen = new Set(have);
          for (const x of lib) { const k = x.key.toLowerCase(); if (!seen.has(k)) { seen.add(k); fresh.push(x); } }
          if (fresh.length) {
            if (!(await ctx.ensureWrite())) throw new Error('write access to the project was not granted');
            let dh = ctx.rootDirHandle; const parts = target.split('/'); for (const s of parts.slice(0, -1)) dh = await dh.getDirectoryHandle(s);
            const w = await (await dh.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
            await w.write((mine.trim() ? mine.replace(/\s*$/, '\n\n') : '') + fresh.map(bibEntry).join('\n')); await w.close();
            ctx.fileCache.delete(ctx.PROJECT[0].path + '/' + target); const root = ctx.PROJECT[0]; await refreshDir(root.path); renderExplorer();
          }
          note = fresh.length ? ' · added ' + fresh.length + ' to ' + target : ' · already in ' + target;
          if (!decl.length) {   // document has no bibliography yet: configure it once idempotently
            const hasPrint = /\\printbibliography\b/.test(t0), hasBib = /\\bibliography\s*\{/.test(t0), base = target.replace(/\.bib$/i, '');
            const blMatch = /^[ \t]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\bbiblatex\b[^}]*\}/m.exec(t0);
            if (blMatch) {
              const hasRes = new RegExp('\\\\addbibresource(?:\[[^\]]*\])?\\s*\\{[^}]*' + target.replace('.', '\\.')).test(t0);
              cfg = { pre: hasRes ? null : { pos: blMatch.index + blMatch[0].length, str: '\n\\addbibresource{' + target + '}' }, end: hasPrint ? '' : '\\printbibliography\n' };
            } else {
              cfg = { end: hasBib ? '' : ((/\\bibliographystyle\{/.test(t0) ? '' : '\\bibliographystyle{plain}\n') + '\\bibliography{' + base + '}\n') };
            }
            if (be0 < 0) { cfg = null; note += ' (add \\bibliography{' + base + '} to the document yourself. No \\end{document})'; }
          }
        } catch (e) { note = ' · .bib not updated: ' + (e.message || 'file error'); }
      }
      const cur = ta.value; if (cur !== t0 || ta.selectionEnd !== q0) { d.close(); return toast('The source changed. Place the cursor and try again' + (note ? note : '')); }
      const cmd = $d('#ciCmd') ? $d('#ciCmd').value : citeCmds[0];
      const str = '\\' + cmd + '{' + keys.join(',') + '}', end = q0 + str.length; d.close();
      if (cfg && cfg.end) { const at = be0; fmtEdit(ta, at, at, (t0[at - 1] === '\n' || at === 0 ? '' : '\n') + cfg.end, at, at); }   // after the cursor: no shift
      fmtEdit(ta, q0, q0, str, end, end);
      if (cfg && cfg.pre) fmtEdit(ta, cfg.pre.pos, cfg.pre.pos, cfg.pre.str, end + cfg.pre.str.length, end + cfg.pre.str.length);
      syncFmtBtns(); toast('Inserted ' + str + note);
    };
  }

  /* Multi-format reference importer: BibTeX, CSL JSON, RIS -> BibTeX entries, preview with checkboxes & duplicate flags, merges into project .bib */
  function detectAndParseRefs(raw) {
    const s = String(raw || '').replace(/^\uFEFF/, '').trim();
    if (!s) return { entries: [], errors: [], warnings: [] };
    if (s[0] === '[' || s[0] === '{') {
      try {
        const data = JSON.parse(s);
        const items = Array.isArray(data) ? data : (data && Array.isArray(data.items)) ? data.items : (data && typeof data === 'object' && (data.title || data.type || data.id) ? [data] : []);
        if (items.length) {
          const CSL_MAP = { 'article-journal': 'article', 'article': 'article', 'article-magazine': 'article', 'article-newspaper': 'article', 'book': 'book', 'chapter': 'incollection', 'paper-conference': 'inproceedings', 'proceedings-article': 'inproceedings', 'thesis': 'phdthesis', 'report': 'techreport' };
          const entries = [];
          items.forEach((it, idx) => {
            if (!it || typeof it !== 'object') return;
            const type = CSL_MAP[it.type] || 'misc';
            const fields = {};
            if (it.title) fields.title = String(it.title);
            if (Array.isArray(it.author)) fields.author = it.author.map((a) => a.literal || (a.family ? (a.given ? a.family + ', ' + a.given : a.family) : (a.given || ''))).filter(Boolean).join(' and ');
            let yr = '';
            if (it.issued) { const dp = it.issued['date-parts']; if (Array.isArray(dp) && dp[0] && dp[0][0]) yr = String(dp[0][0]); else if (it.issued.raw) yr = String(it.issued.raw); else if (it.issued.literal) yr = String(it.issued.literal); }
            const ym = /\d{4}/.exec(yr); if (ym) fields.year = ym[0];
            const cont = it['container-title'] || it['publication-title'];
            if (cont) fields[type === 'article' ? 'journal' : 'booktitle'] = String(cont);
            if (it.publisher) fields.publisher = String(it.publisher);
            if (it.volume) fields.volume = String(it.volume);
            if (it.issue) fields.number = String(it.issue);
            if (it.page) fields.pages = String(it.page);
            if (it.DOI || it.doi) fields.doi = normDoi(it.DOI || it.doi);
            if (it.URL || it.url) fields.url = String(it.URL || it.url);
            if (it.ISBN || it.isbn) fields.isbn = String(it.ISBN || it.isbn);
            let key = it.id ? String(it.id).trim() : '';
            if (!keyOk(key)) key = autoKey(fields) || ('ref' + (idx + 1));
            entries.push({ type, key, fields, line: idx + 1 });
          });
          if (entries.length) return { entries, errors: [], warnings: [] };
        }
      } catch (e) {
        if (!/@\s*[a-zA-Z]+\s*[{(]/.test(s) && !/^TY\s*-/m.test(s)) {
          return { entries: [], errors: [{ line: 1, msg: 'Invalid JSON: ' + e.message }], warnings: [] };
        }
      }
    }
    if (/^TY\s*-|\nTY\s*-/m.test(s)) {
      const lines = s.replace(/\r\n?/g, '\n').split('\n');
      const entries = [], typeMap = { JOUR: 'article', BOOK: 'book', CHAP: 'incollection', CONF: 'inproceedings', CPAPER: 'inproceedings', THES: 'phdthesis', RPRT: 'techreport' };
      let cur = null, sp = '', ep = '';
      const finish = () => {
        if (!cur) return;
        if (sp || ep) cur.fields.pages = sp && ep ? sp + '-' + ep : (sp || ep);
        if (cur._au && cur._au.length) cur.fields.author = cur._au.join(' and ');
        delete cur._au;
        if (!cur.key) cur.key = autoKey(cur.fields) || 'ref';
        if (!keyOk(cur.key)) cur.key = cur.key.replace(/[\s,{}()"#%'=\\~]/g, '') || autoKey(cur.fields) || 'ref';
        entries.push(cur);
        cur = null; sp = ''; ep = '';
      };
      for (let idx = 0; idx < lines.length; idx++) {
        const l = lines[idx], m = /^([A-Z0-9]{2})\s*-\s*(.*)$/.exec(l);
        if (m) {
          const tag = m[1], val = m[2].trim();
          if (tag === 'TY') {
            finish();
            cur = { type: typeMap[val.toUpperCase()] || 'misc', key: '', fields: {}, line: idx + 1, _au: [] };
          } else if (cur) {
            if (tag === 'ER') finish();
            else if (tag === 'ID') cur.key = val;
            else if (tag === 'AU' || tag === 'A1') { if (val) cur._au.push(val); }
            else if (tag === 'TI' || tag === 'T1') cur.fields.title = val;
            else if (tag === 'JF' || tag === 'T2' || tag === 'JO' || tag === 'JA') cur.fields[cur.type === 'article' ? 'journal' : 'booktitle'] = val;
            else if (tag === 'PY' || tag === 'Y1' || tag === 'DA') { const ym = /\d{4}/.exec(val); if (ym) cur.fields.year = ym[0]; }
            else if (tag === 'VL') cur.fields.volume = val;
            else if (tag === 'IS') cur.fields.number = val;
            else if (tag === 'SP') sp = val;
            else if (tag === 'EP') ep = val;
            else if (tag === 'DO') cur.fields.doi = normDoi(val);
            else if (tag === 'UR') cur.fields.url = val;
            else if (tag === 'PB') cur.fields.publisher = val;
            else if (tag === 'SN') cur.fields.isbn = val;
          }
        }
      }
      finish();
      if (entries.length) return { entries, errors: [], warnings: [] };
      return { entries: [], errors: [{ line: 1, msg: 'RIS format detected but no valid records were found' }], warnings: [] };
    }
    const bib = parseBib(s);
    if (bib.entries.length || bib.errors.length) return bib;
    return { entries: [], errors: [{ line: 1, msg: 'Unrecognized format: expected BibTeX (@article{…}), CSL JSON, or RIS (TY  - …)' }], warnings: [] };
  }

  function bibImportDialog() {
    const d = dlg({
      t: 'Import references',
      i: 'file-down',
      w: 820,
      btns: ['Close', 'Import selected'],
      focus: '#impPaste',
      cls: 'dlg--imp',
      b: `<div class="imp" id="impRoot">
        <div id="impDrop" class="imp__drop" role="button" tabindex="0" aria-label="Choose a reference file">
          <span class="imp__dropico">${ic('cloud-upload')}</span>
          <span class="imp__droptxt"><b>Drop a file here, or click to browse</b><small>Duplicates are flagged before anything is added to your library.</small></span>
          <span class="imp__chips"><i>.bib</i><i>.json</i><i>.ris</i><i>.txt</i></span>
        </div>
        <label class="imp__label" for="impPaste">Or paste references <span>BibTeX · CSL JSON · RIS</span></label>
        <textarea id="impPaste" class="imp__paste" rows="4" spellcheck="false" placeholder="@article{key, title = {…}}   ·   [{&quot;id&quot;: …}]   ·   TY  - JOUR"></textarea>
        <div id="impErr" class="imp__err" role="alert" hidden></div>
        <div class="imp__bar">
          <div id="impCount" class="imp__count">Paste or choose a file above to preview references</div>
          <div class="imp__btns">
            <button type="button" class="btn btn--sm" id="impSelAll">Select all</button>
            <button type="button" class="btn btn--sm" id="impDeselAll">Deselect all</button>
          </div>
        </div>
        <div class="imp__tablewrap">
          <table class="tbl imp__tbl">
            <thead><tr><th class="imp__chk"><input type="checkbox" id="impToggleAll" title="Toggle all" aria-label="Toggle all"></th><th>Key</th><th>Type</th><th>Title</th><th>Authors</th><th>Year</th><th>Status</th></tr></thead>
            <tbody id="impRows"><tr class="imp__empty"><td colspan="7">No references loaded</td></tr></tbody>
          </table>
        </div>
        <div id="impTargetNote" class="imp__note"></div>
      </div>`
    });

    const $i = (s) => $(s, d.el), drop = $i('#impDrop'), paste = $i('#impPaste'), errBox = $i('#impErr');
    const countEl = $i('#impCount'), rowsEl = $i('#impRows'), noteEl = $i('#impTargetNote'), toggleAll = $i('#impToggleAll');
    const primary = $('.dlg__foot .btn--primary', d.el);
    let currentEntries = [], baseCount = '';
    const emptyRow = (m) => `<tr class="imp__empty"><td colspan="7">${esc(m)}</td></tr>`;
    function syncSel() {   // selection-dependent UI: row tint, count, tri-state header checkbox, Import button
      const all = $$('input[data-idx]', rowsEl), n = all.filter((c) => c.checked).length;
      all.forEach((c) => c.closest('tr').classList.toggle('is-off', !c.checked));
      countEl.textContent = baseCount + (all.length ? ' · ' + n + ' selected' : '');
      toggleAll.disabled = !all.length; toggleAll.checked = !!all.length && n === all.length; toggleAll.indeterminate = n > 0 && n < all.length;
      primary.disabled = !n; primary.textContent = n ? 'Import ' + n + ' selected' : 'Import selected';
    }
    const setCount = (t) => { baseCount = t; syncSel(); };

    const getTarget = () => {
      if (ctx.activePath && /\.bib$/i.test(ctx.activePath)) return relPath(ctx.activePath);
      const decl = bibDecl($('#codeInput') ? $('#codeInput').value : ctx.SRC);
      return decl[0] || 'references.bib';
    };
    const target = getTarget();
    noteEl.textContent = ctx.rootDirHandle
      ? 'Target: ' + target + ' in the project (and Citation Library)'
      : (ctx.activePath && /\.bib$/i.test(ctx.activePath) ? 'Target: active ' + target + ' in editor (and Citation Library)' : 'Target: Citation Library (open project folder to write to ' + target + ')');

    async function getExistingIndex() {
      const idx = { doi: new Map(), title: new Map(), key: new Map() };
      const add = (k, e, map) => { if (k && !map.has(k)) map.set(k, e); };
      LIB.items.forEach((x) => { add(normDoi(x.fields.doi), x.key, idx.doi); add(normTitle(x.fields.title), x.key, idx.title); add(x.key.toLowerCase(), x, idx.key); });
      let bibText = '';
      if (ctx.activePath && (ctx.activePath.endsWith('/' + target) || ctx.activePath === target)) {
        const ta = $('#codeInput'); if (ta) bibText = ta.value;
      } else if (ctx.rootDirHandle) {
        const fh = await ctx.handleByRel(target);
        if (fh) { try { bibText = await (await fh.getFile()).text(); } catch (e) {} }
      }
      if (bibText) {
        const p = parseBib(bibText);
        p.entries.forEach((x) => { add(normDoi(x.fields.doi), x.key, idx.doi); add(normTitle(x.fields.title), x.key, idx.title); add(x.key.toLowerCase(), x, idx.key); });
      }
      return idx;
    }

    async function parseAndRender(raw) {
      const txt = String(raw || '').trim();
      if (!txt) {
        errBox.style.display = 'none'; errBox.innerHTML = '';
        rowsEl.innerHTML = emptyRow('No references loaded');
        currentEntries = []; setCount('Paste or choose a file above to preview references'); return;
      }
      const res = detectAndParseRefs(txt);
      if (res.errors && res.errors.length) {
        errBox.style.display = 'block';
        errBox.innerHTML = `<b>${res.errors.length} malformed entr${res.errors.length === 1 ? 'y' : 'ies'}:</b><ul style="margin:4px 0 0 16px;padding:0">${res.errors.map((e) => `<li>${e.line ? 'Line ' + e.line + (e.key ? ' (' + esc(e.key) + ')' : '') + ': ' : ''}${esc(e.msg)}${e.snippet ? '<br><code>' + esc(e.snippet) + '</code>' : ''}</li>`).join('')}</ul>`;
      } else {
        errBox.style.display = 'none'; errBox.innerHTML = '';
      }
      if (!res.entries.length) {
        rowsEl.innerHTML = emptyRow('No valid entries found');
        currentEntries = []; setCount(res.errors.length ? 'Errors found. Fix input above' : 'No entries found'); return;
      }
      const idx = await getExistingIndex();
      const add = (k, e, map) => { if (k && !map.has(k)) map.set(k, e); };
      currentEntries = res.entries;
      let dupsCount = 0;
      const rows = res.entries.map((e, n) => {
        const dk = normDoi(e.fields.doi), tk = normTitle(e.fields.title), kx = idx.key.get(e.key.toLowerCase());
        let dup = false, flag = 'New';
        if (dk && idx.doi.has(dk)) { dup = true; flag = 'Duplicate DOI (' + idx.doi.get(dk) + ')'; }
        else if (kx) { dup = true; flag = 'Duplicate key (' + e.key + ')'; }
        else if (tk && idx.title.has(tk)) { dup = true; flag = 'Duplicate title (' + idx.title.get(tk) + ')'; }
        if (dup) dupsCount++;
        add(dk, e.key, idx.doi); add(tk, e.key, idx.title); add(e.key.toLowerCase(), e, idx.key);
        return `<tr class="${dup ? 'is-dup' : ''}">
          <td class="imp__chk"><input type="checkbox" data-idx="${n}" aria-label="Import ${esc(e.key)}" ${dup ? '' : 'checked'}></td>
          <td><code>${esc(e.key)}</code></td>
          <td class="imp__type">${esc(e.type)}</td>
          <td class="imp__clip imp__title" title="${esc(e.fields.title || '')}">${esc(e.fields.title || '-')}</td>
          <td class="imp__clip" title="${esc(e.fields.author || '')}">${esc(authorsShort(e.fields.author))}</td>
          <td class="imp__year">${esc(e.fields.year || '-')}</td>
          <td>${dup ? `<span class="imp__tag imp__tag--dup" title="${esc(flag)}">${esc(flag)}</span>` : `<span class="imp__tag imp__tag--new">New</span>`}</td>
        </tr>`;
      });
      rowsEl.innerHTML = rows.join('');
      setCount(`${res.entries.length} reference${res.entries.length === 1 ? '' : 's'}${dupsCount ? ' (' + dupsCount + ' duplicate' + (dupsCount === 1 ? '' : 's') + ')' : ''}`);
    }

    const loadFile = async (f) => {
      try { const txt = await f.text(); paste.value = txt; parseAndRender(txt); }
      catch (e) { toast('Could not read that file'); }
    };
    const browse = () => { const fi = window.RPE.fsBridge.fileInput('.bib,.json,.ris,.txt', false, 'Choose a Reference File'); fi.onchange = () => { if (fi.files && fi.files[0]) loadFile(fi.files[0]); }; fi.click(); };
    drop.onclick = browse;
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); } };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('is-over'); };
    drop.ondragleave = drop.ondragend = () => drop.classList.remove('is-over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('is-over'); const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return; if (!/\.(bib|json|ris|txt)$/i.test(f.name)) return toast('Unsupported file type. Use .bib, .json, .ris or .txt'); loadFile(f); };
    paste.oninput = () => parseAndRender(paste.value);

    const setAll = (v) => { $$('input[data-idx]', rowsEl).forEach((c) => { c.checked = v; }); syncSel(); };
    $i('#impSelAll').onclick = () => setAll(true);
    $i('#impDeselAll').onclick = () => setAll(false);
    toggleAll.onchange = () => setAll(toggleAll.checked);
    rowsEl.onchange = syncSel;
    rowsEl.onclick = (e) => { const tr = e.target.closest('tr'), c = tr && tr.querySelector('input[data-idx]'); if (!c || e.target === c) return; c.checked = !c.checked; syncSel(); };   // click anywhere on a row to toggle it
    syncSel();

    $('.dlg__foot .btn--primary', d.el).onclick = async () => {
      const cbs = $$('input[data-idx]:checked', rowsEl);
      if (!cbs.length) return toast('Select at least one reference to import');
      const chosen = cbs.map((c) => currentEntries[+c.dataset.idx]);
      const taken = new Set(LIB.items.map((x) => x.key.toLowerCase()));
      const fresh = [];
      chosen.forEach((e) => {
        const key = uniqueKey(e.key, taken);
        taken.add(key.toLowerCase());
        fresh.push({ id: libId(), key, type: e.type, fields: e.fields, added: Date.now() });
      });
      LIB.items.push(...fresh); libSave();

      // Merge into project .bib
      let targetText = '', fh = null;
      if (ctx.activePath && (ctx.activePath.endsWith('/' + target) || ctx.activePath === target)) {
        const ta = $('#codeInput'); if (ta) targetText = ta.value;
      } else if (ctx.rootDirHandle) {
        fh = await ctx.handleByRel(target);
        if (fh) { try { targetText = await (await fh.getFile()).text(); } catch (e) {} }
      }
      const newBibStr = fresh.map(bibEntry).join('\n');
      const merged = (targetText.trim() ? targetText.replace(/\s*$/, '\n\n') : '') + newBibStr;

      if (ctx.rootDirHandle && (await ctx.ensureWrite())) {
        try {
          let dh = ctx.rootDirHandle; const parts = target.split('/').filter(Boolean);
          for (const s of parts.slice(0, -1)) dh = await dh.getDirectoryHandle(s, { create: true });
          const w = await (await dh.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
          await w.write(merged); await w.close();
          ctx.fileCache.set(ctx.PROJECT[0].path + '/' + target, merged);
          await refreshDir(ctx.PROJECT[0].path); renderExplorer();
        } catch (e) { /* fall through to toast */ }
      }
      if (ctx.activePath && (ctx.activePath.endsWith('/' + target) || ctx.activePath === target || (ctx.activePath && /\.bib$/i.test(ctx.activePath) && !ctx.rootDirHandle))) {
        const ta = $('#codeInput');
        if (ta) { ta.value = merged; ctx.SRC = merged; ctx.checkBibErrors(); ctx.renderCode(); ctx.syncSaveState(); }
      }
      d.close();
      toast('Imported ' + fresh.length + ' reference' + (fresh.length === 1 ? '' : 's') + ' into ' + target);
    };
  }
  /* References ▸ Bibliography. bibSys() detects what the document already uses (BibTeX \bibliography vs biblatex \printbibliography, never mixed,
     never a second system). Insert Bibliography (cursor / end of document) adds the matching commands; the heading menu edits \refname|\bibname
     (BibTeX) or \printbibliography[title=…] (biblatex) in place; Update Bibliography compiles with a real bibtex/biber pass (server) and reports its result. */
  let bibHeading = null;
  const BIB_NOCLS = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{(letter|beamer)\}/m;
  function bibSys(t) {
    const mk = tocMask(t), bl = /\\usepackage(?:\[([^\]]*)\])?\{[^}]*\bbiblatex\b[^}]*\}/.exec(mk), bt = /\\bibliography\s*\{/.exec(mk) || /\\bibliographystyle\s*\{/.exec(mk), man = /\\begin\{thebibliography\}/.exec(mk);
    const sys = (bl && bt) || (man && (bl || bt)) ? 'mixed' : bl ? 'biblatex' : bt ? 'bibtex' : man ? 'manual' : 'none';
    const backend = bl ? (bl[1] && /\bbackend\s*=\s*(bibtex|biber)\b/i.exec(bl[1]) ? RegExp.$1.toLowerCase() : 'biber') : 'bibtex';
    const tool = sys === 'biblatex' ? backend : 'bibtex';
    return { mk, sys, bl, backend, tool, has: bl ? /\\printbibliography(?![a-zA-Z])/.exec(mk) : man || /\\bibliography\s*\{/.exec(mk) };
  }
  function bibRefuse(I) {   // shared guard: true (after a toast) when this document can't be safely handled
    if (BIB_NOCLS.test(I.mk)) return toast('This document class has no bibliography section'), true;
    if (I.sys === 'mixed') return toast('This document mixes bibliography systems (BibTeX, biblatex, thebibliography). Resolve that first; nothing was changed'), true;
    if (I.sys === 'manual') return toast('This document uses a hand-written thebibliography: it is left alone so two systems aren’t mixed'), true;
    return false;
  }
  function bibTitleEdit(t, I, label) {   // edit that sets the heading on the document's existing bibliography, or null if already so
    if (I.sys === 'biblatex') {
      const m = /\\printbibliography(?![a-zA-Z])(\s*\[([^\]]*)\])?/.exec(I.mk); if (!m) return null;
      const o = m[2], tt = 'title=' + label, no = o === undefined ? '[' + tt + ']' : /\btitle\s*=/.test(o) ? '[' + o.replace(/\btitle\s*=\s*(\{[^}]*\}|[^,]*)/, tt) + ']' : '[' + tt + (o.trim() ? ',' + o : '') + ']';
      const str = '\\printbibliography' + no; return str === m[0] ? null : { a: m.index, b: m.index + m[0].length, str };
    }
    const nm = TOC_BOOKISH.test(I.mk) ? 'bibname' : 'refname', cmd = '\\renewcommand{\\' + nm + '}{' + label + '}', re = new RegExp('\\\\renewcommand\\s*\\{\\\\' + nm + '\\}\\s*\\{[^}]*\\}'), m = re.exec(I.mk);
    if (m) return m[0] === cmd ? null : { a: m.index, b: m.index + m[0].length, str: cmd };
    const bi = /\\bibliography\s*\{/.exec(I.mk); if (!bi) return null;
    const ls = t.lastIndexOf('\n', bi.index - 1) + 1, at = t.slice(ls, bi.index).trim() ? bi.index : ls;   // right before the \bibliography line (survives babel's caption reset)
    return { a: at, b: at, str: cmd + '\n' };
  }
  function bibApplyEds(ta, eds) {   // apply from the end backwards; selection is carried through each edit
    let s0 = ta.selectionStart, s1 = ta.selectionEnd; const mv = (x, e) => (x >= e.b ? x + e.str.length - (e.b - e.a) : Math.min(x, e.a));
    eds.sort((x, y) => y.a - x.a || y.b - x.b).forEach((e) => { s0 = mv(s0, e); s1 = mv(s1, e); fmtEdit(ta, e.a, e.b, e.str, s0, s1); });
    syncFmtBtns();
  }
  async function bibApply(ta, t, I, where, q, be) {
    const res = 'references.bib', bt = I.sys !== 'biblatex', eds = []; let note = '', mkBib = false;
    let str = bt ? (/\\bibliographystyle\s*\{/.test(I.mk) ? '' : '\\bibliographystyle{plain}\n') : '';
    if (bt) {
      if (bibHeading) {   // reuse an existing \renewcommand{\refname|\bibname} (edit in place) rather than adding a second one
        const nm = TOC_BOOKISH.test(I.mk) ? 'bibname' : 'refname', cmd = '\\renewcommand{\\' + nm + '}{' + bibHeading + '}', m = new RegExp('\\\\renewcommand\\s*\\{\\\\' + nm + '\\}\\s*\\{[^}]*\\}').exec(I.mk);
        if (!m) str += cmd + '\n'; else if (m[0] !== cmd) eds.push({ a: m.index, b: m.index + m[0].length, str: cmd });
      }
      if (!/\\bibliography\s*\{/.test(I.mk)) { str += '\\bibliography{' + res.replace(/\.bib$/, '') + '}\n'; mkBib = true; }
    }
    else {
      if (!/\\printbibliography(?![a-zA-Z])/.test(I.mk)) str = '\\printbibliography' + (bibHeading ? '[title=' + bibHeading + ']' : '') + '\n';
      if (!/\\addbibresource(?:\[[^\]]*\])?\s*\{/.test(I.mk)) { eds.push({ a: I.bl.index + I.bl[0].length, b: I.bl.index + I.bl[0].length, str: '\n\\addbibresource{' + res + '}' }); mkBib = true; }
    }
    const rootDir = ctx.rootDirHandle || (window.RPE && window.RPE.explorer && window.RPE.explorer.rootDirHandle);
    if (mkBib && rootDir) {
      try {
        const fh = await (ctx.handleByRel ? ctx.handleByRel(res) : (window.RPE && window.RPE.explorer && window.RPE.explorer.handleByRel(res)));
        const proj = (ctx.PROJECT && ctx.PROJECT.length) ? ctx.PROJECT : ((window.RPE && window.RPE.explorer && window.RPE.explorer.PROJECT) || []);
        const rootPath = proj[0] ? proj[0].path : '';
        if (!fh && (await ctx.ensureWrite())) {
          const content = LIB.items.length ? bibText() : '% Bibliography database. Add entries via Manage Sources\n';
          const w = await (await rootDir.getFileHandle(res, { create: true })).createWritable();
          await w.write(content); await w.close();
          const fc = ctx.fileCache || (window.RPE && window.RPE.explorer && window.RPE.explorer.fileCache);
          if (fc && rootPath) fc.set(rootPath + '/' + res, content);
          if (rootPath) await refreshDir(rootPath);
          renderExplorer();
          note = ' · created ' + res + (LIB.items.length ? ' with ' + LIB.items.length + ' source' + (LIB.items.length === 1 ? '' : 's') : '');
        } else if (fh && LIB.items.length && (await ctx.ensureWrite())) {
          const txt = await (await fh.getFile()).text(), p = parseBib(txt);
          const have = new Set(p.entries.map((e) => e.key.toLowerCase()));
          const fresh = LIB.items.filter((x) => !have.has(x.key.toLowerCase()));
          if (fresh.length) {
            const merged = (txt.trim() ? txt.replace(/\s*$/, '\n\n') : '') + fresh.map(bibEntry).join('\n');
            const w = await (await rootDir.getFileHandle(res, { create: true })).createWritable();
            await w.write(merged); await w.close();
            const fc = ctx.fileCache || (window.RPE && window.RPE.explorer && window.RPE.explorer.fileCache);
            if (fc && rootPath) fc.set(rootPath + '/' + res, merged);
            if (rootPath) await refreshDir(rootPath);
            renderExplorer();
            note = ' · added ' + fresh.length + ' source' + (fresh.length === 1 ? '' : 's') + ' to ' + res;
          }
        }
      } catch (e) { note = ' · could not write ' + res + ' (' + (e.message || e) + ')'; }
    } else if (mkBib) note = ' · create ' + res + ' next to the document';
    if (ta.value !== t) return toast('The source changed. Try again');
    let a = q, pre = (t[q - 1] === '\n' || q === 0) ? '' : '\n';
    if (where === 'end') { const ls = t.lastIndexOf('\n', be - 1) + 1; a = t.slice(ls, be).trim() ? be : ls; const before = t.slice(0, a); pre = /\n\n$/.test(before) || a === 0 ? '' : before.endsWith('\n') ? '\n' : '\n\n'; }
    eds.push({ a, b: a, str: pre + str });
    bibApplyEds(ta, eds);
    toast('Inserted ' + (bt ? '\\bibliography{' + res.replace(/\.bib$/, '') + '}' : '\\printbibliography') + note);
  }
  function bibInsert(where) {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, I = bibSys(t), bs = I.mk.indexOf('\\begin{document}'), be = I.mk.lastIndexOf('\\end{document}'), q = ta.selectionEnd;
    if (bibRefuse(I)) return;
    if (bs < 0) return toast('Open the main .tex file (the one with \\begin{document}) to insert a bibliography');
    if (I.has) { toast('This document already has a bibliography: jumping to it'); return tocGo(ta, I.has.index); }
    if (where === 'end' ? be < bs : (q < bs + 16 || (be >= 0 && q > be))) return toast(where === 'end' ? 'No \\end{document} found: can’t insert at the end of the document' : 'Place the cursor inside the document body to insert the bibliography');
    if (I.sys !== 'none') return bibApply(ta, t, I, where, q, be);
    const d = dlg({ t: 'Set up a bibliography', i: 'folder-open', w: 470, btns: ['Cancel', 'Set up BibTeX'], b: `<p>This document has no bibliography system yet. I’ll set up the baseline <b>BibTeX</b> workflow:</p><p><code>\\bibliographystyle{plain}</code><br><code>\\bibliography{references}</code></p><p>and ${LIB.items.length ? 'populate <code>references.bib</code> with the ' + LIB.items.length + ' source' + (LIB.items.length === 1 ? '' : 's') + ' from your Citation Library' : 'create an empty <code>references.bib</code>'} if a project folder is open. Add entries with Manage Sources or Insert Citation; <b>Update Bibliography</b> then runs BibTeX through the compile server (it needs <code>bibtex</code> installed).</p>` });
    $('.dlg__foot .btn--primary', d.el).onclick = () => { d.close(); bibApply(ta, t, I, where, q, be); };
  }
  function bibHeadingPick(label) {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, I = bibSys(t); if (bibRefuse(I)) return;
    bibHeading = label;
    if (!I.has) return toast('Heading “' + label + '” will be used when you insert the bibliography' + (I.sys === 'none' ? '' : ': this document has none yet'));
    const e = bibTitleEdit(t, I, label); if (!e) return toast('Bibliography heading is already “' + label + '”');
    bibApplyEds(ta, [e]); toast('Bibliography heading: ' + label);
  }
  const CITE_STYLES = { APA: ['apa', 'apalike'], Vancouver: ['vancouver', 'unsrt'], Chicago: ['chicago-authordate', 'chicago'], IEEE: ['ieee', 'IEEEtran'] };   // [biblatex style, BibTeX .bst]
  function citeStyle(label) {   // References ▸ Citations ▸ Style: edits biblatex style= or \bibliographystyle{}; true when applied
    const ta = $('#codeInput'); if (!ta) return false;
    const t = ta.value, I = bibSys(t), [bl, bt] = CITE_STYLES[label] || []; if (!bl || bibRefuse(I)) return false;
    if (!/\\begin\{document\}/.test(I.mk)) return toast('Open the main .tex file to set the citation style'), false;
    let e = null, nm;
    if (I.sys === 'biblatex') {
      const m = /\\usepackage(?:\[([^\]]*)\])?\{biblatex\}/.exec(I.mk); if (!m) return toast('Could not find a plain \\usepackage{biblatex} line. Set style= there by hand'), false;
      const o = m[1], opt = o === undefined ? 'style=' + bl : /(^|,)\s*style\s*=/.test(o) ? o.replace(/(^|,)(\s*)style\s*=\s*[^,\]]*/, '$1$2style=' + bl) : 'style=' + bl + (o.trim() ? ',' + o : ''), str = '\\usepackage[' + opt + ']{biblatex}';
      if (str !== m[0]) e = { a: m.index, b: m.index + m[0].length, str }; nm = 'style=' + bl;
    } else if (I.sys === 'bibtex') {
      const m = /\\bibliographystyle\s*\{[^}]*\}/.exec(I.mk), str = '\\bibliographystyle{' + bt + '}'; nm = bt + '.bst';
      if (m) { if (m[0] !== str) e = { a: m.index, b: m.index + m[0].length, str }; }
      else { const b = I.mk.indexOf('\\bibliography{'), ls = t.lastIndexOf('\n', b - 1) + 1; e = { a: ls, b: ls, str: str + '\n' }; }
    } else return toast('No bibliography yet. Use Bibliography ▸ Insert Bibliography first'), false;
    if (!e) return toast('Citation style is already ' + label), true;
    bibApplyEds(ta, [e]); toast('Citation style: ' + label + ' (' + nm + '): ' + (I.sys === 'biblatex' ? 'needs the biblatex-' + bl.split('-')[0] + ' style package' : 'needs ' + bt + '.bst') + ' in your TeX install'); return true;
  }
  function bibMenu(l) { if (l === 'Insert Bibliography') bibInsert('cursor'); else if (l === 'Insert at End of Document') bibInsert('end'); else bibHeadingPick(l); }
  function bibUpdate() {
    const ta = $('#codeInput'), t = ta ? ta.value : '';
    if (/\\begin\{document\}/.test(tocMask(t))) {   // an open root document can be checked up front; otherwise the server decides from the compiled output
      const I = bibSys(t); if (bibRefuse(I)) return;
      if (I.sys === 'none') return toast('No bibliography yet. Use Bibliography ▸ Insert Bibliography first');
      if (!I.has) return toast('Add \\' + (I.sys === 'biblatex' ? 'printbibliography' : 'bibliography{…}') + ' to the document first (Bibliography ▸ Insert Bibliography)');
      toast('Updating bibliography with ' + I.tool + '…');
    }
    ctx.runCompile({ bib: true });
  }

  RPE.bib = {
    LIB_KEY, LIB, libSave, libId, BIB_TYPES, PUB_FIELDS, pubField, pubOf, normDoi, normTitle,
    keyOk, bracesOk, keyTaken, bibEsc, BIB_REQ, uniqueKey, lastName, authorsShort, autoKey,
    pdfDb, pdfOp, pdfPut, pdfGet, pdfDel, pdfMeta,
    parseBib, bibEntry, bibText,
    bibDialog, citeDialog, detectAndParseRefs, bibImportDialog,
    CITE_STYLES, bibSys, bibRefuse, bibApplyEds, bibApply, bibInsert,
    bibHeadingPick, bibMenu, bibUpdate
  };
})(window.RPE = window.RPE || {});