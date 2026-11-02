/* fs-bridge.js: Laurevine Plum file access without the browser's "allow this site to edit files" prompt.
   When the local Plum server is reachable, window.showDirectoryPicker / showOpenFilePicker / showSaveFilePicker are replaced by an
   in-app picker dialog, and the handles they return talk to the server's /api/fs/* endpoints (see server/server.js). The handles
   implement the parts of the File System Access API the app uses, so explorer.js, editor.js, flow.js and citations.js work unchanged.
   Without the server (static hosting) the browser's own pickers are used exactly as before. */
(function (RPE) {
  'use strict';

  const NATIVE = { dir: window.showDirectoryPicker, open: window.showOpenFilePicker, save: window.showSaveFilePicker };
  const HDR = { 'X-Plum': '1' };
  let SEP = '/', HOME = null, probe = null;

  const abort = () => new DOMException('The user aborted a request.', 'AbortError');
  const notFound = (n) => new DOMException('A requested file or directory could not be found: ' + (n || ''), 'NotFoundError');
  const mismatch = (n) => new DOMException('“' + n + '” is the wrong kind of entry.', 'TypeMismatchError');
  const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);
  const joinPath = (a, b) => a + (/[\\/]$/.test(a) ? '' : SEP) + b;
  const normKey = (p) => String(p).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  const u = (op, p, extra) => '/api/fs/' + op + '?p=' + encodeURIComponent(p) + (extra || '');

  async function call(url, opts) {
    const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, HDR, opts && opts.headers) }));
    return r;
  }
  async function json(url, opts) {
    const r = await call(url, opts); let j = null;
    try { j = await r.json(); } catch (e) { /* non-JSON error */ }
    if (!r.ok || !j || !j.ok) { const code = (j && j.error) || r.status; const err = r.status === 404 ? notFound(code) : new DOMException(String(code), r.status === 403 ? 'NotAllowedError' : 'InvalidStateError'); throw err; }
    return j;
  }
  function available() {   // is the local server (with the file API) reachable? checked once
    if (!probe) {
      probe = (location.protocol === 'http:' || location.protocol === 'https:')
        ? json('/api/fs/home').then((j) => { SEP = j.sep || '/'; HOME = j; return true; }).catch(() => false)
        : Promise.resolve(false);
    }
    return probe;
  }

  class SrvHandle {
    constructor(kind, p) { this.kind = kind; this.path = p; this.name = baseName(p); this.__srv = true; }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async isSameEntry(o) { return !!(o && o.__srv && o.kind === this.kind && normKey(o.path) === normKey(this.path)); }
    async resolve(o) {
      if (!o || !o.__srv) return null;
      const a = normKey(this.path), b = normKey(o.path);
      if (a === b) return [];
      if (!b.startsWith(a + '/')) return null;
      return String(o.path).replace(/\\/g, '/').slice(String(this.path).replace(/\\/g, '/').replace(/\/+$/, '').length + 1).split('/');
    }
    async getFile() {
      if (this.kind !== 'file') throw mismatch(this.name);
      const r = await call(u('read', this.path));
      if (!r.ok) throw r.status === 404 ? notFound(this.name) : new DOMException('Could not read “' + this.name + '”.', 'NotAllowedError');
      const blob = await r.blob();
      return new File([blob], this.name, { lastModified: Number(r.headers.get('X-Mtime')) || Date.now(), type: blob.type });
    }
    async createWritable() {
      if (this.kind !== 'file') throw mismatch(this.name);
      const path = this.path, chunks = [];
      return {
        async write(d) {
          if (d && typeof d === 'object' && !(d instanceof Blob) && !ArrayBuffer.isView(d) && !(d instanceof ArrayBuffer) && 'type' in d) {
            if (d.type === 'truncate') { chunks.length = 0; return; }
            d = d.data;
          }
          chunks.push(d == null ? '' : d);
        },
        async close() {
          const r = await call(u('write', path, '&create=1'), { method: 'POST', body: new Blob(chunks) });
          if (!r.ok) throw new DOMException('Could not save “' + baseName(path) + '”.', 'NotAllowedError');
        },
        async abort() { chunks.length = 0; }
      };
    }
    async *entries() {
      if (this.kind !== 'directory') throw mismatch(this.name);
      const j = await json(u('list', this.path));
      for (const e of j.entries) yield [e.name, new SrvHandle(e.kind, joinPath(this.path, e.name))];
    }
    async *keys() { for await (const [n] of this.entries()) yield n; }
    async *values() { for await (const [, h] of this.entries()) yield h; }
    [Symbol.asyncIterator]() { return this.entries(); }
    async _child(name, kind, create) {
      const p = joinPath(this.path, name);
      let st = null;
      try { st = await json(u('stat', p)); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
      if (st) { if (st.kind !== kind) throw mismatch(name); return new SrvHandle(kind, p); }
      if (!create) throw notFound(name);
      if (kind === 'directory') await json(u('mkdir', p), { method: 'POST' });
      else await json(u('write', p, '&create=1'), { method: 'POST', body: new Blob([]) });
      return new SrvHandle(kind, p);
    }
    getFileHandle(name, o) { return this._child(name, 'file', !!(o && o.create)); }
    getDirectoryHandle(name, o) { return this._child(name, 'directory', !!(o && o.create)); }
    async rename(name) { const j = await json(u('rename', this.path, '&to=' + encodeURIComponent(name)), { method: 'POST' }); return new SrvHandle(this.kind, j.path); }   // renames this entry on disk (used for the project folder)
    async removeEntry(name, o) { await json(u('remove', joinPath(this.path, name), o && o.recursive ? '&recursive=1' : ''), { method: 'POST' }); }
  }

  /* Handles stored in IndexedDB come back as plain objects (methods don't survive structured clone); this rebuilds them. */
  function revive(v) { return v && v.__srv === true && typeof v.path === 'string' && (v.kind === 'file' || v.kind === 'directory') ? new SrvHandle(v.kind, v.path) : v; }

  async function grant(p) { await json('/api/fs/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) }); }

  /* ---------- the in-app picker dialog ---------- */
  let styled = false;
  function injectStyle() {
    if (styled) return; styled = true;
    const st = document.createElement('style');
    st.textContent = `
.dlg--fsp .dlg__head { padding: 18px 22px 16px 28px; }
.dlg--fsp .dlg__title { font-size: 16px; letter-spacing: .01em; }
.dlg--fsp .dlg__body { padding: 0; overflow: hidden; }
.dlg--fsp .dlg__foot { padding: 16px 28px 20px; gap: 10px; }
.dlg--fsp .dlg__foot .btn { min-width: 92px; height: 34px; border-radius: var(--r, 3px); }
.fsp { display: grid; grid-template-columns: 216px minmax(0, 1fr); height: min(560px, 68vh); }
.fsp__side { overflow: auto; display: flex; flex-direction: column; gap: 2px; padding: 20px 14px 20px 18px; background: var(--app-bg); border-right: 1px solid var(--border); }
.fsp__side h6 { margin: 18px 12px 8px; font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-2); }
.fsp__side h6:first-child { margin-top: 2px; }
.fsp__place { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 12px; border: 0; border-radius: var(--r, 3px); background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; transition: background .15s, color .15s; }
.fsp__place svg { width: 16px; height: 16px; flex: none; color: var(--text-2); }
.fsp__place span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fsp__place:hover { background: var(--hover); }
.fsp__place.is-cur { background: var(--accent); color: var(--fsp-on, #fff); font-weight: 600; }
.fsp__place.is-cur svg { color: var(--fsp-on, #fff); }
.fsp__main { display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: 14px; padding: 20px 26px 16px; }
.fsp__bar { display: flex; gap: 10px; align-items: center; }
.fsp__up { width: 38px; height: 38px; flex: none; display: grid; place-items: center; padding: 0; border: 1px solid var(--border-2); border-radius: var(--r, 3px); background: var(--surface); color: var(--text); cursor: pointer; transition: background .15s, border-color .15s; }
.fsp__up:hover:not(:disabled) { background: var(--hover); border-color: var(--accent); }
.fsp__up:disabled { opacity: .4; cursor: default; }
.fsp__up svg { width: 16px; height: 16px; }
.fsp__path { flex: 1; min-width: 0; height: 38px; display: flex; align-items: center; padding: 0 8px 0 10px; border: 1px solid var(--border-2); border-radius: var(--r, 3px); background: var(--surface); cursor: text; transition: border-color .15s, box-shadow .15s; }
.fsp__path:hover, .fsp__path:focus-within { border-color: var(--accent); }
.fsp__path:focus-within { box-shadow: 0 0 0 3px var(--sel-border, transparent); }
.fsp__crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 1px; overflow: hidden; white-space: nowrap; height: 100%; }
.fsp__crumbs[hidden] { display: none; }
.fsp__crumb { display: inline-flex; align-items: center; gap: 7px; padding: 4px 8px; border: 0; border-radius: var(--r, 3px); background: transparent; color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer; flex: none; transition: background .15s, color .15s; }
.fsp__crumb svg { width: 14px; height: 14px; }
.fsp__crumb:hover { background: var(--hover); color: var(--text); }
.fsp__crumb:last-of-type { color: var(--text); font-weight: 600; }
.fsp__sep { display: inline-flex; color: var(--text-2); opacity: .5; flex: none; }
.fsp__sep svg { width: 13px; height: 13px; }
.fsp__path input { flex: 1; width: 100%; min-width: 0; height: 100%; padding: 0 4px; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; }
.fsp__list { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border-2); border-radius: var(--r, 3px); background: var(--surface); }
.fsp__cols, .fsp__row { display: grid; grid-template-columns: minmax(0, 1fr) 176px 88px; gap: 16px; align-items: center; }
.fsp__cols { position: sticky; top: 0; z-index: 1; padding: 11px 20px; background: var(--surface); border-bottom: 1px solid var(--border); font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--text-2); }
.fsp__row { content-visibility: auto; contain-intrinsic-size: auto 46px; width: 100%; min-height: 46px; padding: 6px 20px; border: 0; border-bottom: 1px solid transparent; background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; transition: background .12s; }
.fsp__row:hover { background: var(--hover); }
.fsp__row.is-sel { background: var(--sel-bg, var(--hover)); box-shadow: inset 3px 0 0 var(--accent); }
.fsp__row.is-dim { opacity: .4; cursor: default; }
.fsp__row.is-dim:hover { background: transparent; }
.fsp__name { display: flex; align-items: center; gap: 13px; min-width: 0; }
.fsp__name b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fsp__row[data-k="directory"] .fsp__name b { font-weight: 600; }
.fsp__ico { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: var(--r, 3px); background: var(--hover); color: var(--text-2); }
.fsp__ico svg { width: 16px; height: 16px; }
.fsp__row[data-k="directory"] .fsp__ico { background: var(--accent); color: var(--fsp-on, #fff); }
.fsp__meta { font-size: 12px; color: var(--text-2); white-space: nowrap; }
.fsp__cols span:last-child, .fsp__row .fsp__meta:last-child { text-align: right; }
.fsp__cols button { display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; }
.fsp__cols button:last-child { justify-self: end; }
.fsp__cols button:hover, .fsp__cols button[aria-sort] { color: var(--text); }
.fsp__cols button svg { width: 12px; height: 12px; }
.fsp__empty { padding: 56px 20px; text-align: center; color: var(--text-2); font-size: 13px; }
.fsp__foot { display: flex; align-items: center; gap: 12px; min-height: 36px; font-size: 12.5px; color: var(--text-2); }
.fsp__foot > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fsp__foot label { color: var(--text); font-weight: 500; flex: none; }
.fsp__foot input { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border: 1px solid var(--border-2); border-radius: var(--r, 3px); background: var(--surface); color: var(--text); font: inherit; font-size: 13px; }
.fsp__foot input:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--sel-border, transparent); }
.fsp__warn { color: var(--text); flex: none; }
@media (max-width: 760px) { .fsp { grid-template-columns: 1fr; } .fsp__side { display: none; } .fsp__cols, .fsp__row { grid-template-columns: minmax(0, 1fr) 70px; } .fsp__cols button:nth-child(2), .fsp__row .fsp__meta:nth-child(2) { display: none; } }`;
    document.head.append(st);
  }

  const svg = (inner) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  const SVG = {
    folder: svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>'),
    home: svg('<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>'),
    drive: svg('<line x1="22" x2="2" y1="12" y2="12"></line><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" x2="6.01" y1="16" y2="16"></line><line x1="10" x2="10.01" y1="16" y2="16"></line>'),
    up: svg('<path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path>'),
    asc: svg('<path d="m18 15-6-6-6 6"></path>'),
    desc: svg('<path d="m6 9 6 6 6-6"></path>'),
    chev: svg('<path d="m9 18 6-6-6-6"></path>'),
    file: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path>'),
    code: svg('<path d="M10 12.5 8 15l2 2.5"></path><path d="m14 12.5 2 2.5-2 2.5"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"></path>'),
    image: svg('<rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>')
  };
  const CODE_EXT = /\.(tex|sty|cls|bst|dtx|ins|def|clo|bib|bbl|py|lua|sh|r|js|json|yaml|yml|xml|toml|ini|cfg)$/i, IMG_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;
  const fileIcon = (n) => (CODE_EXT.test(n) ? SVG.code : IMG_EXT.test(n) ? SVG.image : SVG.file);
  const fmtSize = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(1) + ' GB');
  const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });   // one formatter for every row
  const fmtDate = (t) => (t ? DATE_FMT.format(new Date(t)) : '');
  function crumbPaths(p) {   // "/a/b" or "C:\a\b" → one entry per level, root first
    const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean), win = /^[A-Za-z]:$/.test(parts[0] || ''), out = [];
    let cur = win ? parts.shift() + '\\' : '/';
    out.push({ n: win ? cur : 'Computer', p: cur, root: true });
    parts.forEach((x) => { cur = joinPath(cur, x); out.push({ n: x, p: cur }); });
    return out;
  }

  /* Text/icon colour for anything filled with the theme accent: white on a dark accent, near-black on a light one (some dark themes use pastel accents). */
  function onAccent() {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    if (!m) return '#fff';
    let h = m[1]; if (h.length === 3) h = h.replace(/./g, '$&$&');
    const L = [0, 2, 4].map((i) => { const c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2] < 0.3 ? '#fff' : '#16141f';
  }

  const LAST_KEY = 'plum.fsLast';   // last folder per kind of picker (mode + title + accepted types), kept across restarts
  const lastGet = (k) => { try { return (JSON.parse(localStorage.getItem(LAST_KEY)) || {})[k] || ''; } catch (e) { return ''; } };
  const lastSet = (k, v) => { try { const m = JSON.parse(localStorage.getItem(LAST_KEY)) || {}; m[k] = v; localStorage.setItem(LAST_KEY, JSON.stringify(m)); } catch (e) { /* storage unavailable */ } };

  function picker(o) {   // o: {mode: 'dir'|'file'|'save', title, exts, multiple, name} → Promise<[paths]|null>
    return new Promise((resolve) => {
      const ui = RPE.ui; injectStyle();
      let sortKey = 'name', sortDir = 1, lastGo = 0, cwd = '', parent = null, entries = [], entryMap = new Map(), rowMap = new Map(), paintTok = 0, sel = [], done = false;
      const lastK = o.mode + '|' + (o.title || '') + '|' + (o.exts || []).join(',');
      const supported = (n) => !(o.exts && o.exts.length) || o.exts.some((x) => n.toLowerCase().endsWith(x));
      const label = o.mode === 'dir' ? 'Open' : o.mode === 'save' ? 'Save' : 'Open';
      const kindOf = (n) => { const e = entryMap.get(n); return e && e.kind; };
      const d = ui.dlg({
        t: o.title, i: o.mode === 'dir' ? 'folder-open' : 'file-code', w: 960, btns: ['Cancel', label], cls: 'dlg--fsp',
        b: `<div class="fsp"><div class="fsp__side" id="fspSide"></div><div class="fsp__main">
          <div class="fsp__bar"><button type="button" class="fsp__up" id="fspUp" aria-label="Up one folder" title="Up one folder">${SVG.up}</button>
            <div class="fsp__path" id="fspBar" title="Click to type a path"><div class="fsp__crumbs" id="fspCrumbs" aria-label="Current folder"></div><input id="fspPath" aria-label="Folder path" spellcheck="false" hidden></div></div>
          <div class="fsp__list" id="fspList" role="listbox" aria-label="Folder contents"></div>
          <div class="fsp__foot" id="fspFoot"></div></div></div>`,
        ok: () => { finish(); }
      });
      const el = d.el, $ = (s) => el.querySelector(s), primary = el.querySelector('.dlg__foot .btn:last-child');
      el.style.setProperty('--fsp-on', onAccent());
      const nameIn = () => $('#fspName');
      function chosen() {
        if (o.mode === 'dir') { const f = sel.find((n) => kindOf(n) === 'directory'); return [f ? joinPath(cwd, f) : cwd]; }
        if (o.mode === 'save') { const n = (nameIn() && nameIn().value || '').trim(); return n ? [joinPath(cwd, n)] : []; }
        return sel.filter((n) => kindOf(n) === 'file').map((n) => joinPath(cwd, n));
      }
      function refreshState() {
        const picked = chosen(), foot = $('#fspFoot'); primary.disabled = !picked.length;
        if (o.mode === 'save') {
          const n = (nameIn() && nameIn().value || '').trim(), exists = kindOf(n) === 'file';
          primary.textContent = exists ? 'Replace' : 'Save';
          $('#fspWarn').textContent = exists ? 'This file already exists and will be replaced.' : '';
        } else if (o.mode === 'dir') {
          foot.innerHTML = '<span>Will open: <b style="color:var(--text);font-weight:600"></b></span>'; foot.querySelector('b').textContent = picked[0] || cwd;
        } else {
          const files = picked.map(baseName);
          foot.innerHTML = '<span></span>'; foot.firstChild.textContent = files.length ? 'Selected: ' + files.join(', ') : ((o.exts && o.exts.length) ? 'Faded files aren’t supported by this action.' : 'Double-click a file to open it.');
        }
      }
      function setSel(names) {
        sel = names; el.querySelectorAll('#fspList .is-sel').forEach((r) => r.classList.remove('is-sel')); sel.forEach((n) => { const r = rowMap.get(n); if (r) r.classList.add('is-sel'); }); refreshState();
      }
      const $$rows = () => Array.from(el.querySelectorAll('#fspList .fsp__row'));
      function sortEntries() {   // folders always first; within each group by the chosen column, click a header again to reverse
        const nm = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
        entries.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
          const by = sortKey === 'date' ? (a.mtime || 0) - (b.mtime || 0) : sortKey === 'size' && a.kind === 'file' ? (a.size || 0) - (b.size || 0) : nm(a, b);
          return (by || nm(a, b)) * sortDir;
        });
      }
      const rowHtml = (e) => { const dir = e.kind === 'directory', dim = !dir && o.mode === 'file' && !supported(e.name);
        return `<button type="button" class="fsp__row${dim ? ' is-dim' : ''}${sel.includes(e.name) ? ' is-sel' : ''}" role="option" data-n="${ui.esc(e.name)}" data-k="${e.kind}"${dim ? ' aria-disabled="true" tabindex="-1"' : ''}><span class="fsp__name"><span class="fsp__ico">${dir ? SVG.folder : fileIcon(e.name)}</span><b>${ui.esc(e.name)}</b></span><span class="fsp__meta">${fmtDate(e.mtime)}</span><span class="fsp__meta">${dir || typeof e.size !== 'number' ? '' : fmtSize(e.size)}</span></button>`; };
      function paintList() {   // the first screenful appears at once; the rest of a big folder is added in small slices so the dialog never freezes
        const list = $('#fspList'), tok = ++paintTok; let i = 0; rowMap = new Map();
        list.innerHTML = `<div class="fsp__cols">${[['name', 'Name'], ['date', 'Date modified'], ['size', 'Size']].map(([k, t]) => `<button type="button" data-sort="${k}"${sortKey === k ? ` aria-sort="${sortDir > 0 ? 'ascending' : 'descending'}"` : ''}>${t}${sortKey === k ? (sortDir > 0 ? SVG.asc : SVG.desc) : ''}</button>`).join('')}</div>` + (entries.length ? '' : '<div class="fsp__empty">This folder is empty.</div>');
        const step = () => {
          if (tok !== paintTok || !el.isConnected || i >= entries.length) return;
          const t = document.createElement('template'); t.innerHTML = entries.slice(i, i + 200).map(rowHtml).join(''); i += 200;
          for (const r of t.content.children) rowMap.set(r.dataset.n, r);
          list.append(t.content); if (i < entries.length) setTimeout(step, 0);
        };
        step(); list.scrollTop = 0;
      }
      function paintCrumbs() {
        const box = $('#fspCrumbs'), cs = crumbPaths(cwd);
        box.innerHTML = cs.map((c, i) => (i ? `<span class="fsp__sep">${SVG.chev}</span>` : '') + `<button type="button" class="fsp__crumb" data-go="${ui.esc(c.p)}" title="${ui.esc(c.p)}">${c.root ? SVG.drive : ''}<span>${ui.esc(c.n)}</span></button>`).join('');
        box.scrollLeft = box.scrollWidth;
        $$side().forEach((b) => b.classList.toggle('is-cur', normKey(b.dataset.go) === normKey(cwd)));
      }
      const $$side = () => Array.from(el.querySelectorAll('#fspSide .fsp__place'));
      async function go(p, quiet) {
        try {
          const j = await json('/api/fs/browse?p=' + encodeURIComponent(p));
          cwd = j.path; parent = j.parent; sel = []; lastGo = Date.now();
          entries = j.entries.slice(); entryMap = new Map(entries.map((x) => [x.name, x])); sortEntries();
          $('#fspUp').disabled = !parent; paintList(); paintCrumbs(); refreshState(); return true;
        } catch (e) { if (!quiet) ui.toast('Can’t open that folder'); return false; }
      }
      function finish() {
        if (done) return; const picked = chosen(); if (!picked.length) return; done = true;
        lastSet(lastK, o.mode === 'dir' && picked[0] === cwd && parent ? parent : cwd);   // a chosen project folder is remembered by its parent, so it shows up selectable next time
        Promise.all(picked.map(grant)).then(() => resolve(picked)).catch(() => { ui.toast('Could not get access to that location'); resolve(null); });
      }
      // sidebar
      const side = $('#fspSide'), place = (p, ic) => `<button type="button" class="fsp__place" data-go="${ui.esc(p.path)}">${ic}<span>${ui.esc(p.name)}</span></button>`;
      side.innerHTML = '<h6>Places</h6>' + HOME.places.map((p) => place(p, p.name === 'Home' ? SVG.home : SVG.folder)).join('') + `<h6>${HOME.roots.length > 1 ? 'Drives' : 'This computer'}</h6>` + HOME.roots.map((p) => place(p, SVG.drive)).join('');
      side.onclick = (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); };
      // address bar: breadcrumbs, or (click on the bar) the whole path as editable text
      const bar = $('#fspBar'), crumbs = $('#fspCrumbs'), pin = $('#fspPath');
      function editPath() { crumbs.hidden = true; pin.hidden = false; pin.value = cwd; pin.focus(); pin.select(); }
      function endEdit() { pin.hidden = true; crumbs.hidden = false; }
      bar.onclick = (e) => {
        const c = e.target.closest('.fsp__crumb');
        if (c) { go(c.dataset.go); return; }
        if (pin.hidden) editPath();
      };
      pin.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const v = pin.value.trim(); endEdit(); if (v) go(v); } };
      pin.onblur = () => setTimeout(endEdit, 0);
      $('#fspUp').onclick = () => { if (parent) go(parent); };
      // list: click selects, double-click (or Enter) opens a folder / chooses a file
      const list = $('#fspList');
      const rowOf = (e) => e.target.closest('.fsp__row');
      list.addEventListener('click', (e) => {
        const h = e.target.closest('.fsp__cols button'); if (!h) return;
        if (sortKey === h.dataset.sort) sortDir = -sortDir; else { sortKey = h.dataset.sort; sortDir = 1; }
        sortEntries(); paintList();
      });
      list.onclick = (e) => {
        const b = rowOf(e); if (!b || b.classList.contains('is-dim')) return; const n = b.dataset.n, k = b.dataset.k;
        if (o.mode === 'file' && o.multiple && k === 'file' && (e.ctrlKey || e.metaKey)) setSel(sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n]);
        else setSel([n]);
        if (o.mode === 'save' && k === 'file' && nameIn()) { nameIn().value = n; refreshState(); }
      };
      list.ondblclick = (e) => {
        const b = rowOf(e); if (!b || b.classList.contains('is-dim')) return;
        if (b.dataset.k === 'directory') return go(joinPath(cwd, b.dataset.n));
        if (o.mode === 'dir') return;
        setSel([b.dataset.n]); if (o.mode === 'save' && nameIn()) { nameIn().value = b.dataset.n; refreshState(); }
        if (!primary.disabled) primary.click();
      };
      list.onkeydown = (e) => {
        const b = rowOf(e), ok = (n) => n.classList.contains('fsp__row') && !n.classList.contains('is-dim');
        const nxt = (r, k) => { for (let n = k > 0 ? r.nextElementSibling : r.previousElementSibling; n; n = k > 0 ? n.nextElementSibling : n.previousElementSibling) if (ok(n)) return n; return null; };   // walks neighbours: no scan of the whole folder per keypress
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const t = b && ok(b) ? nxt(b, e.key === 'ArrowDown' ? 1 : -1) || b : list.querySelector('.fsp__row:not(.is-dim)'); if (t) { t.focus(); setSel([t.dataset.n]); } }
        else if (e.key === 'Backspace' && parent) { e.preventDefault(); go(parent); }
        else if (e.key === 'Enter' && b) { e.preventDefault(); e.stopPropagation(); if (b.dataset.k === 'directory') go(joinPath(cwd, b.dataset.n)); else { setSel([b.dataset.n]); if (!primary.disabled) primary.click(); } }
      };
      // footer content per mode
      if (o.mode === 'save') {
        const foot = $('#fspFoot');
        foot.innerHTML = '<label for="fspName">File name</label><input id="fspName" spellcheck="false"><span class="fsp__warn" id="fspWarn"></span>';
        nameIn().value = o.name || ''; nameIn().oninput = refreshState;
        nameIn().onkeydown = (e) => { if (e.key === 'Enter' && !primary.disabled) { e.preventDefault(); e.stopPropagation(); primary.click(); } };
      }
      primary.disabled = true;
      // closing without choosing (Cancel, X, Esc, click outside) resolves null
      const mo = new MutationObserver(() => { if (!el.isConnected) { mo.disconnect(); if (!done) { done = true; resolve(null); } } });
      mo.observe(document.body, { childList: true });
      const first = o.start || lastGet(lastK);
      if (first) go(first, true).then((ok) => { if (!ok) go(HOME.home); }); else go(HOME.home);   // a remembered folder that no longer exists falls back to Home
      if (o.mode === 'save' && nameIn()) nameIn().focus();
    });
  }

  const extsFrom = (types) => [].concat(...(types || []).map((t) => [].concat(...Object.values(t.accept || {})))).map((x) => String(x).toLowerCase()).filter((x) => x.startsWith('.'));

  function wrap(kind, nativeFn, make) {
    return async function (opts) {
      opts = opts || {};
      if (!(await available())) {
        if (typeof nativeFn === 'function') return nativeFn.call(window, opts);
        throw new DOMException('Opening files needs the Plum app server or a Chromium browser.', 'NotSupportedError');
      }
      return make(opts);
    };
  }

  window.showDirectoryPicker = wrap('dir', NATIVE.dir, async () => {
    const r = await picker({ mode: 'dir', title: 'Open Folder' });
    if (!r) throw abort();
    return new SrvHandle('directory', r[0]);
  });
  window.showOpenFilePicker = wrap('open', NATIVE.open, async (opts) => {
    const r = await picker({ mode: 'file', title: 'Open File', exts: extsFrom(opts.types), multiple: !!opts.multiple });
    if (!r) throw abort();
    return r.map((p) => new SrvHandle('file', p));
  });
  window.showSaveFilePicker = wrap('save', NATIVE.save, async (opts) => {
    const r = await picker({ mode: 'save', title: 'Save As', name: opts.suggestedName || '' });
    if (!r) throw abort();
    const h = new SrvHandle('file', r[0]);
    try { await json(u('stat', r[0])); } catch (e) { await json(u('write', r[0], '&create=1'), { method: 'POST', body: new Blob([]) }); }   // like the native picker, the file exists once chosen
    return h;
  });

  /* Drop-in replacement for <input type=file> used by every Insert/Import action: fileInput(accept, multiple, title) → {files, onchange, click()}.
     With the Plum server it opens the in-app picker (unsupported files faded and unselectable); otherwise a native input restricted to `accept`. */
  let srvState = null; available().then((v) => { srvState = v; });
  function fileInput(accept, multiple, title) {
    const exts = String(accept || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => x.startsWith('.'));
    const okName = (n) => !exts.length || exts.some((x) => String(n).toLowerCase().endsWith(x));
    const api = { accept: accept || '', multiple: !!multiple, files: [], onchange: null };
    const fire = (files) => {
      const ok = files.filter((f) => okName(f.name));
      if (!ok.length) { if (files.length) RPE.ui.toast('That file type isn’t supported here'); return; }
      api.files = ok; if (typeof api.onchange === 'function') api.onchange({ target: api });
    };
    const nativeClick = () => {
      const n = document.createElement('input'); n.type = 'file'; n.accept = api.accept; n.multiple = api.multiple; n.style.display = 'none';
      n.onchange = () => { const fs = [...n.files]; n.remove(); fire(fs); };
      document.body.append(n); n.click();
    };
    const srvClick = async () => {
      try {
        const r = await picker({ mode: 'file', title: title || 'Open File', exts, multiple: api.multiple });
        if (r && r.length) fire(await Promise.all(r.map((p) => new SrvHandle('file', p).getFile())));
      } catch (e) { RPE.ui.toast('Could not read that file'); }
    };
    api.click = () => {
      if (srvState === true) return srvClick();
      if (srvState === false) return nativeClick();
      return available().then((v) => (v ? srvClick() : nativeClick()));
    };
    return api;
  }

  RPE.fsBridge = { available, revive, SrvHandle, fileInput };
})(window.RPE = window.RPE || {});