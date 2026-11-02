/* explorer.js: Laurevine Plum Project Explorer, File System Access API, file actions and compile bundle.
   Exposes window.RPE.explorer. */
(function (RPE) {
  'use strict';

  const { $, $$, esc, ic, h, paint, toast, clearToasts, menu, openPop, closePop, dlg, str, F, tocMask, noDoc } = RPE.ui;

  const ctx = new Proxy({}, {
    get: (_, k) => (RPE.ctx || {})[k] || (RPE.editor || {})[k] || window[k],
    set: (_, k, v) => { if (RPE.ctx) RPE.ctx[k] = v; return true; }
  });

  const flowDialog = (...a) => (window.RPE && RPE.flow && RPE.flow.flowDialog ? RPE.flow.flowDialog(...a) : null);

  const getEd = () => (window.RPE && RPE.editor) || {};
  const cmtSync = (...a) => getEd().cmtSync?.(...a);
  const updateFindUI = (...a) => getEd().updateFindUI?.(...a);
  const needsXeTeX = (...a) => getEd().needsXeTeX?.(...a);
  const fontOK = (...a) => getEd().fontOK?.(...a);
  const fontSet = (...a) => getEd().fontSet?.(...a);
  const cmtMove = (...a) => getEd().cmtMove?.(...a);
  const cmtLoad = (...a) => getEd().cmtLoad?.(...a) || [];
  const cmtSave = (...a) => getEd().cmtSave?.(...a);
  const sectRe = (...a) => getEd().sectRe?.(...a);
  const sectOurs = (...a) => getEd().sectOurs?.(...a);
  const docDiffEdit = (...a) => getEd().docDiffEdit?.(...a);

  const HD_RE = new Proxy(/./, { get: (_, k) => (getEd().HD_RE || /./)[k] });
  const HF_RE = new Proxy(/./, { get: (_, k) => (getEd().HF_RE || /./)[k] });
  const PD_RE = new Proxy(/./, { get: (_, k) => (getEd().PD_RE || /./)[k] });
  const THEME_HEAD = new Proxy([], { get: (_, k) => (getEd().THEME_HEAD || [])[k] });
  const THEME_ROLES = new Proxy({}, { get: (_, k) => (getEd().THEME_ROLES || {})[k] });
  const CMT = new Proxy({}, { get: (_, k) => (getEd().CMT || {})[k] });
  const TRK = new Proxy({}, { get: (_, k) => (getEd().TRK || {})[k] });
  const FIND = new Proxy({}, { get: (_, k) => (getEd().FIND || {})[k] });

  const backstage = (...a) => ctx.backstage(...a);
  const runCompile = (...a) => ctx.runCompile(...a);
  const loadIntoEditor = (...a) => ctx.loadIntoEditor(...a);
  const renderCode = (...a) => ctx.renderCode(...a);
  const renderOutline = (...a) => ctx.renderOutline(...a);
  const historyUIUpdate = (...a) => ctx.historyUIUpdate(...a);
  const probUpdateGutter = (...a) => ctx.probUpdateGutter(...a);
  const histClear = (...a) => ctx.histClear(...a);
  const fmtEdit = (...a) => ctx.fmtEdit(...a);
  const ensurePackage = (...a) => ctx.ensurePackage(...a);
  const APP_NAME = 'Laurevine Plum';
  const DOC_BASE = ['article', 'report', 'book', 'letter'];
  const docClasses = () => [...new Set([...DOC_BASE, ...Object.keys(window.LP_CLASS_THUMBS || {})])];   // a class thumbnail added to LP_CLASS_THUMBS adds its icon + menu entry

  /* ---------- sidebar: Project Explorer, backed by the real local filesystem via the File System
     Access API (showDirectoryPicker / FileSystemDirectoryHandle). Nothing here is mock data, the
     tree is walked from the folder the user picks, folders load their contents lazily on first
     expand, and clicking a text-like file reads its real bytes into the editor. Entirely client-side:
     no backend endpoint is involved (server/server.js is unchanged) and no new dependency is added. ---------- */
  const FILE_ICON = { tex: 'file-code', sty: 'file-code', cls: 'file-code', bst: 'file-code', bib: 'file-text', pdf: 'file-text', txt: 'file-text', md: 'file-text', csv: 'file-text', log: 'file-text', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', eps: 'image', webp: 'image', bmp: 'image', json: 'braces', py: 'file-code', lua: 'file-code', sh: 'file-code', yaml: 'file-text', yml: 'file-text', xml: 'file-code', toml: 'file-text' };
  const TEXT_EXTS = new Set(['tex', 'bib', 'sty', 'cls', 'bst', 'txt', 'md', 'csv', 'cfg', 'def', 'clo', 'ins', 'dtx', 'bbl', 'log', 'json', 'yaml', 'yml', 'xml', 'py', 'lua', 'sh', 'r', 'toml', 'ini']);
  const FS_SUPPORTED = typeof window.showDirectoryPicker === 'function';
  let PROJ_NAME = 'Untitled';   // project name shown in the title bar; renaming it only relabels the title and the root row, it never touches real files
  let PROJECT = [];             // real tree nodes once a folder is open: { t:'folder'|'file', n, path, open, c, handle }
  let rootDirHandle = null;     // the FileSystemDirectoryHandle for the open project root
  let activePath = null;        // path of whichever file is currently loaded into the editor
  let pendingHandle = null, pendingHandleName = null;   // a persisted handle whose permission needs a user gesture to reconfirm
  let mainPath = null;          // path of the project's main file (the one Compile builds); persisted per project folder in IndexedDB
  const fileCache = new Map();  // path -> this session's in-memory text for a file (holds edits not yet written back to disk)
  const RECOVERED = new Set();  // paths whose text was restored from a recovery draft and not yet saved by the user: autosave and the clean-state check leave them (and their drafts) alone

  /* ---- a tiny IndexedDB key/value store, just to remember the last-opened directory handle across reloads ---- */
  const IDB_NAME = 'lplum-fs', IDB_OLD_NAME = 'latex-studio-fs', IDB_STORE = 'handles', IDB_KEY = 'root';
  function idbOpenRaw(name) {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(name, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(IDB_STORE);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  }
  let idbMigrated = false;
  async function migrateIdbOnce() {   // one-time move of the saved folder/file handle, recent-project entries and per-folder main-file choices from the
    if (idbMigrated) return; idbMigrated = true;   // old product's 'latex-studio-fs' database into this build's 'lplum-fs' database, so an upgrade doesn't lose anything already granted by the user
    try { if (indexedDB.databases) { const dbs = await indexedDB.databases(); if (!dbs.some((d) => d.name === IDB_OLD_NAME)) return; } } catch (e) { /* databases() unsupported here: fall through and try anyway */ }
    let oldDb; try { oldDb = await idbOpenRaw(IDB_OLD_NAME); } catch (e) { return; }
    try {
      const keys = await new Promise((res, rej) => { const rq = oldDb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAllKeys(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
      if (keys && keys.length) {
        const newDb = await idbOpenRaw(IDB_NAME);
        for (const k of keys) {
          const val = await new Promise((res, rej) => { const rq = oldDb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
          await new Promise((res, rej) => { const tx = newDb.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(val, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        }
        newDb.close();
      }
      oldDb.close(); try { indexedDB.deleteDatabase(IDB_OLD_NAME); } catch (e) { /* best-effort cleanup */ }
    } catch (e) { try { oldDb.close(); } catch (e2) { /* ignore */ } }
  }
  function idbOpen() { return migrateIdbOnce().then(() => idbOpenRaw(IDB_NAME)); }
  async function idbSet(key, val) { const db = await idbOpen(); return new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  async function idbDel(key) { const db = await idbOpen(); return new Promise((res) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).delete(key); tx.oncomplete = res; tx.onerror = res; }); }
  async function idbGet(key) { const db = await idbOpen(); return new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, 'readonly'), rq = tx.objectStore(IDB_STORE).get(key); rq.onsuccess = () => res((RPE.fsBridge ? RPE.fsBridge.revive(rq.result) : rq.result) || null); rq.onerror = () => rej(rq.error); }); }

  /* ---- crash recovery drafts store (in IDB_STORE under 'draft:<path>') ---- */
  const DRAFT_MAX = 20, DRAFT_MAX_BYTES = 500000;
  async function idbDraftList() {
    try {
      const db = await idbOpen();
      const keys = await new Promise((res, rej) => { const rq = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAllKeys(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error); });
      const draftKeys = keys.filter((k) => typeof k === 'string' && k.startsWith('draft:'));
      const items = [];
      for (const k of draftKeys) {
        try {
          const val = await idbGet(k);
          if (val && typeof val === 'object' && typeof val.path === 'string' && typeof val.text === 'string' && typeof val.at === 'number' && !Number.isNaN(val.at)) {
            items.push(val);
          } else {
            await idbDel(k);
          }
        } catch (e) { try { await idbDel(k); } catch (e2) {} }
      }
      items.sort((a, b) => b.at - a.at);
      return items;
    } catch (e) { return []; }
  }
  const projectRef = () => rootDirHandle || (PROJECT[0] && PROJECT[0].path === '(open file)' && PROJECT[0].c && PROJECT[0].c[0] ? PROJECT[0].c[0].handle : null);   // what a draft belongs to: the project folder, or the single opened file
  async function idbDraftSet(path, text, name, at) {
    if (!path || typeof text !== 'string' || text.length > DRAFT_MAX_BYTES) return;
    try {
      const rec = { path, text, name: name || path.split('/').pop() || 'Untitled.tex', at: at || Date.now() }, root = path === '(scratch)' ? null : projectRef();
      try { await idbSet('draft:' + path, root ? Object.assign({}, rec, { root }) : rec); }   // root: so Restore can reopen the same folder, and Save / Save As work again
      catch (e) { await idbSet('draft:' + path, rec); }                                       // a handle that can't be stored must never cost the text
      const all = await idbDraftList();
      if (all.length > DRAFT_MAX) {
        for (const d of all.slice(DRAFT_MAX)) {
          await idbDel('draft:' + d.path);
        }
      }
    } catch (e) { /* storage unavailable or quota exceeded */ }
  }
  async function idbDraftDel(path) {
    if (!path) return;
    try { await idbDel('draft:' + path); } catch (e) {}
  }
  async function draftSync(path, text) {   // a file whose unsaved edits are only held in memory (another file is open): keep a draft while it differs from disk, so every modified file is recoverable, not just the open one
    try {
      const n = findNode(path), fh = (n && n.handle) || await handleByRel(relPath(path));
      if (!fh) return;
      const disk = await (await fh.getFile()).text();
      if (path === activePath || (fileCache.has(path) && fileCache.get(path) !== text)) return;   // opened again, or newer edits exist: the open file's own timer / a later call owns the draft
      if (text !== disk) idbDraftSet(path, text, path.split('/').pop()); else if (!RECOVERED.has(path)) idbDraftDel(path);
    } catch (e) { /* best-effort */ }
  }
  async function checkDraftRecovery() {
    let drafts = [];
    try { drafts = await idbDraftList(); } catch (e) { return; }
    if (!drafts.length) return;
    const bodyHtml = `<p>Unsaved work from a previous session was found. Would you like to restore your changes?</p>` +
      `<div style="max-height:200px;overflow:auto;margin:12px 0;border:1px solid var(--border);border-radius:4px;padding:6px 10px;background:var(--bg-card)">` +
      drafts.map((d) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px;border-bottom:1px solid var(--border)">` +
        `<span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px">${esc(d.name)}</span>` +
        `<small class="muted" style="white-space:nowrap">${new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>` +
      `</div>`).join('') +
      `</div><p class="demo-note" style="margin:0">Discard will remove these saved drafts.</p>`;

    dlg({
      t: 'Restore unsaved work?',
      i: 'history',
      w: 480,
      btns: ['Discard', 'Restore'],
      b: bodyHtml,
      ok: async () => {
        try { await restoreDrafts(drafts); }
        catch (e) { toast('Could not restore all unsaved work: the drafts were kept'); }   // never discard a draft on a failure
      }
    });

    // If Discard was clicked (first button), clear the drafts
    const foot = document.querySelector('.dlg-backdrop:last-child .dlg__foot');
    if (foot && foot.firstChild) {
      const discardBtn = foot.firstChild;
      const origClick = discardBtn.onclick;
      discardBtn.onclick = async (e) => {
        for (const d of drafts) await idbDraftDel(d.path);
        toast('Discarded unsaved work');
        if (origClick) origClick.call(discardBtn, e);
      };
    }
  }

  /* ---- recovery: put the drafts back into the project they came from (folder reopened, every modified file restored into the
     in-memory cache, nothing written to disk until the user saves) ---- */
  async function draftRoot(d) {   // the project handle a draft belongs to: stored with it; older drafts: the last-opened / recent folder with that name
    const rv = (x) => (RPE.fsBridge ? RPE.fsBridge.revive(x) : x);
    if (d.root) return rv(d.root);
    const seg = d.path.split('/')[0];
    try { const h = await idbGet(IDB_KEY); if (h && h.name === seg) return h; } catch (e) { /* none */ }
    for (const r of RECENT) { if (r.kind === 'folder' && r.name === seg) { try { const h = await idbGet('recent:' + r.id); if (h) return h; } catch (e) { /* unreadable entry */ } } }
    return null;
  }
  async function nodeAtPath(path) {   // the tree node for a project path (exact case), loading and opening the folders on the way; null when it isn't there
    let cur = PROJECT[0];
    if (!cur || !path.startsWith(cur.path + '/')) return null;
    for (const seg of path.slice(cur.path.length + 1).split('/')) {
      if (cur.t !== 'folder') return null;
      if (cur.c === null) { try { cur.c = await listDir(cur.handle, cur.path); } catch (e) { return null; } }
      cur.open = true;
      cur = cur.c.find((x) => x.n === seg);
      if (!cur) return null;
    }
    return cur;
  }
  function showRecovered(text, name, node) {   // the recovered text becomes the open document (node null: an unsaved document with no file behind it)
    ctx.SRC = text; activePath = node ? node.path : null;
    loadIntoEditor(); hideWelcome(); renderCode(); renderOutline();
    $('#srcName').textContent = node ? node.n : name;
    renderExplorer(); probUpdateGutter(); syncSaveSoon();
  }
  async function restoreDrafts(drafts) {   // drafts: newest first
    const lead = drafts[0], plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    if (lead.path === '(scratch)') {   // an untitled document: no project behind it
      showRecovered(lead.text, lead.name, null);
      return toast('Restored “' + lead.name + '”' + (drafts.length > 1 ? ' · ' + plural(drafts.length - 1, 'other draft') + ' kept' : ''));
    }
    const groups = [];   // drafts of the same project folder together (a session has one project: the newest one is restored, the rest stay saved)
    for (const d of drafts) {
      if (d.path === '(scratch)') continue;
      const h = await draftRoot(d), seg = d.path.split('/')[0]; let g = null;
      for (const x of groups) { if (x.seg !== seg) continue; try { if (!x.h || !h || await x.h.isSameEntry(h)) { g = x; break; } } catch (e) { /* unreadable: keep apart */ } }
      if (!g) groups.push(g = { seg, h, items: [] }); else if (!g.h) g.h = h;
      g.items.push(d);
    }
    const g = groups[0], rest = drafts.length - g.items.length;
    let h = g.h; if (!h && rootDirHandle && rootDirHandle.name === g.seg) h = rootDirHandle;
    let ready = false;
    if (h) {
      let same = false; try { same = !!rootDirHandle && await rootDirHandle.isSameEntry(h); } catch (e) { /* not the open project */ }
      if (same) ready = true;
      else if (await recentState(h, true) === 'ok') ready = h.kind === 'file' ? await openFileHandle(h) : await openFolderHandle(h, false);   // the Restore click is the gesture that lets the browser re-grant access
    }
    if (!ready) {   // the original folder is gone or can't be read: keep every draft; the newest opens as an unsaved document that Save As can write anywhere
      const sd = drafts.find((d) => d.path === '(scratch)');
      if (sd) { showRecovered(sd.text, sd.name, null); return toast('“' + g.seg + '” could not be opened: its drafts were kept'); }
      await idbDraftSet('(scratch)', lead.text, lead.name, lead.at);   // written first, so the text is never only in memory
      await idbDraftDel(lead.path);                                      // and not stored twice
      showRecovered(lead.text, lead.name, null);
      return toast('“' + g.seg + '” could not be opened: restored “' + lead.name + '” as an unsaved document (use Save As)' + (g.items.length > 1 ? '. The other drafts were kept' : ''));
    }
    g.items.forEach((d) => RECOVERED.add(d.path));   // from here on autosave and the clean-state check leave these files and drafts alone
    const placed = [], kept = [], newer = [];
    for (const d of g.items) {
      const n = await nodeAtPath(d.path);
      if (!n || n.t !== 'file' || !n.handle) { kept.push(d); continue; }
      let disk = null; try { const f = await n.handle.getFile(); disk = await f.text(); if (f.lastModified > d.at) newer.push(n.n); } catch (e) { /* unreadable: still restorable */ }
      if (disk === d.text) { RECOVERED.delete(d.path); idbDraftDel(d.path); continue; }   // the file already holds this text: nothing to recover
      placed.push({ d, n });
    }
    kept.forEach((d) => RECOVERED.delete(d.path));   // no file to put it in: its draft stays as it is
    const notes = [];
    if (kept.length) notes.push(plural(kept.length, 'draft') + ' kept (the file is no longer in the folder)');
    if (rest) notes.push(plural(rest, 'draft') + ' from another document kept');
    if (!placed.length) return toast(kept.length || rest ? notes.join('; ') : 'The saved drafts match the files on disk: nothing to restore');
    const top = placed[0];
    if (activePath !== top.n.path) await openFileNode(top.n);   // the file leaving the editor is cached with its disk text first
    placed.forEach(({ d, n }) => { fileCache.set(n.path, d.text); idbDraftSet(d.path, d.text, d.name, d.at); });   // set after the navigation so nothing overwrites it; the draft is re-written in case opening a file cleared it
    showRecovered(top.d.text, top.n.n, top.n);
    if (newer.length) notes.push(newer.map((x) => '“' + x + '”').join(', ') + ' changed on disk after the draft: saving replaces the disk version');
    toast('Restored ' + plural(placed.length, 'unsaved file') + ' in “' + PROJ_NAME + '”' + (notes.length ? ' · ' + notes.join('; ') : ''));
  }

  async function listDir(dirHandle, parentPath) {   // one level of real directory contents, folders first then files, both alphabetical
    const out = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith('.')) continue;   // skip hidden files/folders (.git, .DS_Store, …)
      const path = parentPath + '/' + name;
      if (handle.kind === 'directory') out.push({ t: 'folder', n: name, path, open: false, c: null, handle });
      else out.push({ t: 'file', n: name, path, handle });
    }
    out.sort((a, b) => (a.t !== b.t ? (a.t === 'folder' ? -1 : 1) : a.n.localeCompare(b.n, undefined, { sensitivity: 'base', numeric: true })));
    return out;
  }
  function findNode(path, nodes) {
    for (const n of (nodes || PROJECT)) {
      if (n.path === path) return n;
      if (n.t === 'folder' && n.c) { const f = findNode(path, n.c); if (f) return f; }
    }
    return null;
  }
  async function toggleFolder(node) {
    node.open = !node.open;
    if (node.open && node.c === null) {
      try { node.c = await listDir(node.handle, node.path); }
      catch (e) { node.c = []; toast('Could not read “' + node.n + '”'); }
    }
    renderExplorer();
  }
  /* ---- file viewer: a user's own PDF / PNG / JPG is shown in place of the editor + compiled preview ---- */
  const VIEW_MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
  let viewPath = null, viewUrl = null, viewSeq = 0;
  function closeViewer() {
    viewSeq++; if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = null; }
    viewPath = null; $('#fvBody').innerHTML = ''; $('#fileView').hidden = true; $('#main').classList.remove('viewing');
  }
  async function openViewer(node, ext) {
    const seq = ++viewSeq;
    if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = null; }
    viewPath = node.path; $('#fvName').textContent = node.n; $('#fileView').hidden = false; $('#main').classList.add('viewing');
    const body = $('#fvBody');
    const msg = (t, retry) => { body.innerHTML = `<div class="fview__msg">${esc(t)}${retry ? '<br><button class="btn btn--sm" id="fvRetry">Try again</button>' : ''}</div>`; const r = $('#fvRetry'); if (r) r.onclick = () => openViewer(node, ext); };
    msg('Loading ' + node.n + '…'); renderExplorer();
    try {
      const file = await node.handle.getFile();
      if (seq !== viewSeq) return;                                   // user clicked something else meanwhile
      if (!file.size) { msg(node.n + ' is empty.'); return; }
      viewUrl = URL.createObjectURL(new Blob([file], { type: VIEW_MIME[ext] }));
      if (ext === 'pdf') { body.innerHTML = '<iframe title="PDF viewer"></iframe>'; body.firstChild.src = viewUrl; }
      else {
        const img = new Image(); img.alt = node.n;
        img.onerror = () => { if (seq === viewSeq) msg('Could not display ' + node.n + ': the image may be damaged.', true); };
        img.src = viewUrl; body.innerHTML = ''; body.append(img);
      }
    } catch (e) { if (seq === viewSeq) msg('Could not read ' + node.n + ': check permissions.', true); }
  }
  $('#fvBack').onclick = () => { closeViewer(); renderExplorer(); };
  async function openFileNode(node) {
    if (node.n.endsWith('.diagram.json')) return flowDialog(node);
    const ext = (node.n.split('.').pop() || '').toLowerCase();
    if (VIEW_MIME[ext]) { await openViewer(node, ext); return; }
    if (!TEXT_EXTS.has(ext)) { toast(node.n + ' can’t be opened in the text editor'); return; }
    if (viewPath) closeViewer();
    cmtSync(true);                                    // settle comment anchors against the file we're leaving
    if (activePath) { fileCache.set(activePath, ctx.SRC); draftSync(activePath, ctx.SRC); }   // keep this session's edits to the file we're leaving (and a recovery draft of them)
    activePath = node.path; renderExplorer();              // highlight row immediately, before async read
    let text = fileCache.get(node.path);
    if (text === undefined) {
      try { const file = await node.handle.getFile(); text = await file.text(); }
      catch (e) { activePath = null; renderExplorer(); toast('Could not read ' + node.n); return; }
      fileCache.set(node.path, text);
    }
    ctx.SRC = text;
    loadIntoEditor(); hideWelcome();
    FIND.matches = []; FIND.idx = -1; updateFindUI();
    renderCode(); renderOutline(); $('#srcName').textContent = node.n; renderExplorer(); cmtSync(true); syncSaveState();
    historyUIUpdate(); probUpdateGutter();
  }
  async function loadProjectFromHandle(handle, pick) {   // → true once loaded; pick = ask which .tex is the main file when the folder has several
    const root = { t: 'folder', n: handle.name, path: handle.name, open: true, c: null, handle };
    try { root.c = await listDir(handle, handle.name); }
    catch (e) { toast('Could not read that folder. Check permissions and try again.'); renderExplorer(); return false; }
    rootDirHandle = handle; pendingHandle = null; pendingHandleName = null;
    closeViewer(); PROJECT = [root]; fileCache.clear(); RECOVERED.clear(); activePath = null; histClear();
    mainPath = await resolveMain(root);
    PROJ_NAME = handle.name; $('#docFileName').textContent = PROJ_NAME; syncPdfName();
    let mainTex = (mainPath && findNode(mainPath));
    if (!mainTex && root.c) mainTex = root.c.find((n) => n.t === 'file' && /\.tex$/i.test(n.n)) || root.c.find((n) => n.t === 'file');
    if (mainTex) await openFileNode(mainTex);
    else renderExplorer();
    toast('Opened “' + PROJ_NAME + '”');
    if (pick) await promptMain(root);
    return true;
  }
  async function renameProjectFolder(next) {   // renames the open project folder on disk and reopens it → 'label' when it can't (no folder, or a browser handle without rename: the caller then only relabels)
    const old = rootDirHandle; if (!old || typeof old.rename !== 'function') return 'label';
    if (next === old.name) return 'same';
    guardDirty(async () => {
      const n0 = old.name, rel = activePath ? activePath.slice(n0.length) : '', mRel = mainPath ? mainPath.slice(n0.length) : null;
      const keep = [...fileCache].filter(([p]) => p !== activePath && p.startsWith(n0 + '/'));
      let nh; try { nh = await old.rename(next); } catch (e) { return toast('Could not rename the folder: ' + ((e && e.message) || 'unknown error')); }
      try { await idbSet('main:' + next, mRel === null ? null : next + mRel); } catch (e) { /* best-effort */ }
      for (const r of RECENT.filter((x) => x.kind === 'folder')) { try { const o = await idbGet('recent:' + r.id); if (o && await o.isSameEntry(old)) recentRemove(r.id); } catch (e) { /* unreadable entry: leave it */ } }
      if (!(await openFolderHandle(nh))) return;
      keep.forEach(([p, v]) => { fileCache.set(next + p.slice(n0.length), v); idbDraftDel(p); draftSync(next + p.slice(n0.length), v); });
      const n = rel && findNode(next + rel); if (n && n.path !== activePath) await openFileNode(n);
      toast('Folder renamed to “' + next + '”');
    });
    return 'renamed';
  }
  async function promptMain(root) {   // scan all .tex recursively for \documentclass, prompt only when ambiguous
    let saved = null; try { saved = await idbGet(mainKey()); } catch (e) { /* best-effort */ }
    if (saved) return;
    const { texFiles, withDocClass } = await findMainCandidates(root);
    let ambiguous = false, choices = [];
    if (withDocClass.length > 1) {
      ambiguous = true;
      choices = withDocClass;
    } else if (withDocClass.length === 0 && texFiles.length > 1) {
      ambiguous = true;
      choices = texFiles;
    }
    if (!ambiguous) return;
    dlg({ t: 'Choose the main file', i: 'file-code', w: 460, btns: ['Cancel', 'Set as Main'],
      b: `<p class="mainpick__lead">Multiple potential main files were found. Compile builds the main file: which one is it?</p><div class="mainpick">${choices.map((n) => `<label class="mainpick__row"><input type="radio" name="mainPick" value="${esc(n.path)}"${n.path === mainPath ? ' checked' : ''}><span>${esc(relPath(n.path) || n.n)}</span></label>`).join('')}</div>`,
      ok: (el) => { const i = $('input[name="mainPick"]:checked', el), n = i && findNode(i.value); if (n) guardDirty(async () => { setMain(n); await openFileNode(n); toast('“' + n.n + '” is now the main file'); }); } });
  }
  async function openFolderHandle(handle, pick = true) {   // pick: ask which .tex is the main file when the folder has several
    if (!(await loadProjectFromHandle(handle, pick))) return false;
    try { await idbSet(IDB_KEY, handle); } catch (e) { /* persistence is best-effort */ }
    await recentAdd('folder', handle); return true;
  }
  function openProjectFolder() {
    if (!FS_SUPPORTED) { toast('Opening local folders isn’t supported in this browser. Try Chrome or Edge.'); return; }
    guardDirty(async () => {
      let handle;
      try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
      catch (e) { return; }   // the user cancelled the picker, not an error
      await openFolderHandle(handle);
    });
  }
  /* ---- Open File: a single text file becomes a one-file project (no folder, so \input/figures next to it aren't resolved) ---- */
  async function openFileHandle(h) {
    if (!TEXT_EXTS.has(extOf(h.name))) { toast(h.name + ' can’t be opened in the text editor'); return false; }
    let text; try { text = await (await h.getFile()).text(); } catch (e) { toast('Could not read “' + h.name + '”'); return false; }
    const node = { t: 'file', n: h.name, path: '(open file)/' + h.name, handle: h };
    closeViewer(); rootDirHandle = null; pendingHandle = null; pendingHandleName = null; mainPath = null;
    PROJECT = [{ t: 'folder', n: 'Open file', path: '(open file)', open: true, c: [node], handle: null }];
    fileCache.clear(); RECOVERED.clear(); fileCache.set(node.path, text); activePath = null; histClear();
    PROJ_NAME = h.name.replace(/\.[^.]+$/, ''); $('#docFileName').textContent = PROJ_NAME; syncPdfName();
    try { await idbSet(IDB_KEY, null); } catch (e) { /* best-effort: don't restore an older folder on reload */ }
    await openFileNode(node); toast('Opened “' + h.name + '”');
    await recentAdd('file', h); return true;
  }
  function openFile() {
    if (typeof window.showOpenFilePicker !== 'function') { toast('Opening files isn’t supported in this browser. Try Chrome or Edge.'); return; }
    guardDirty(async () => {
      let hs;
      try { hs = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'LaTeX and text files', accept: { 'text/plain': [...TEXT_EXTS].map((x) => '.' + x) } }] }); }
      catch (e) { return; }   // cancelled
      await openFileHandle(hs[0]);
    });
  }
  async function reconnectProject() {
    if (!pendingHandle) return;
    try {
      let perm = await pendingHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await pendingHandle.requestPermission({ mode: 'read' });   // still allow read-only browsing
      if (perm !== 'granted') { toast('Permission to read the folder was not granted'); return; }
      await loadProjectFromHandle(pendingHandle);
    } catch (e) { toast('Could not reconnect to the project folder'); }
  }
  async function restoreProject() {   // silently reattach to the last-opened folder on reload, where the browser allows it
    if (!FS_SUPPORTED || !('indexedDB' in window)) return;
    try {
      const handle = await idbGet(IDB_KEY); if (!handle) return;
      const perm = await handle.queryPermission({ mode: 'read' });   // queryPermission never prompts, so this needs no user gesture
      if (perm === 'granted') await loadProjectFromHandle(handle);
      else { pendingHandle = handle; pendingHandleName = handle.name; renderExplorer(); }
    } catch (e) { /* no persisted handle, or the browser can't restore one, fall back to the empty state */ }
  }
  /* ---- Recent Projects: metadata in localStorage (like the other prefs), the real handles in the IndexedDB store above ('recent:<id>').
     Browsers never expose a full disk path, so each entry shows its name, kind and last-opened time. Removing an entry never touches files. ---- */
  const RECENT_KEY = 'lplum.recent', RECENT_MAX = 20;
  let RECENT = [];
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY)); if (Array.isArray(v)) RECENT = v.filter((r) => r && r.id && r.name && (r.kind === 'file' || r.kind === 'folder')).slice(0, RECENT_MAX); } catch (e) { /* corrupt or unavailable: start empty */ }
  const recentSave = () => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(RECENT)); } catch (e) { toast('Could not save the recent list (browser storage unavailable)'); } };
  async function recentAdd(kind, handle) {   // record a real successful open; reopening the same file/folder just moves it to the top
    try {
      let ex = null;
      for (const r of RECENT) { if (r.kind !== kind) continue; try { const o = await idbGet('recent:' + r.id); if (o && await o.isSameEntry(handle)) { ex = r; break; } } catch (e) { /* unreadable entry: not a match */ } }
      const id = ex ? ex.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      RECENT = [{ id, kind, name: handle.name, at: Date.now() }, ...RECENT.filter((r) => r !== ex)];
      RECENT.splice(RECENT_MAX).forEach((r) => idbDel('recent:' + r.id));
      await idbSet('recent:' + id, handle); recentSave(); renderWelcomeRecents();
    } catch (e) { /* the list is a convenience; never block an open */ }
  }
  function recentRemove(id) { RECENT = RECENT.filter((r) => r.id !== id); idbDel('recent:' + id); recentSave(); renderWelcomeRecents(); }
  async function recentState(h, ask) {   // 'ok' | 'perm' (needs a click to re-grant read access) | 'missing' (gone or unreadable)
    try {
      let p = await h.queryPermission({ mode: 'read' });
      if (p !== 'granted' && ask) p = await h.requestPermission({ mode: 'read' });
      if (p !== 'granted') return 'perm';
      if (h.kind === 'directory') await h.entries().next(); else await h.getFile();
      return 'ok';
    } catch (e) { return 'missing'; }
  }
  function reopenRecent(id) {
    const r = RECENT.find((x) => x.id === id); if (!r) return;
    guardDirty(async () => {
      let h = null; try { h = await idbGet('recent:' + id); } catch (e) { /* treated as missing */ }
      const st = h ? await recentState(h, true) : 'missing';
      if (st === 'perm') return toast('Permission to read “' + r.name + '” wasn’t granted');
      if (st === 'missing') return dlg({ t: 'Can’t open this project', i: 'triangle-alert', w: 460, btns: ['Keep', 'Remove from List'],
        b: `<p>“${esc(r.name)}” was moved, renamed or can’t be accessed any more. Remove it from the Recent Projects list? Your files are not deleted.</p>`,
        ok: () => { recentRemove(id); toast('Removed from the recent list'); } });
      if (r.kind === 'folder') await openFolderHandle(h); else await openFileHandle(h);
    });
  }
  function recentPanel(box) {
    const fmt = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    box.innerHTML = RECENT.length ? `<div class="bs-rec-head"><b>Recent Projects</b><button class="btn btn--sm" id="recClear">Clear list</button></div>` + RECENT.map((r) => `<div class="bs-rec" data-rid="${r.id}"><button class="bs-rec__open">${ic(r.kind === 'folder' ? 'folder-open' : 'file-code')}<span><b>${esc(r.name)}</b><small>${r.kind === 'folder' ? 'Folder' : 'File'} · opened ${esc(fmt(r.at))}</small></span></button><button class="bs-rec__rm" data-rm="${r.id}" title="Remove from list (files are not deleted)" aria-label="Remove ${esc(r.name)} from list">${ic('x')}</button></div>`).join('') : '<p class="bs-note">No recent projects yet: files and folders you open appear here.</p>';
    paint(box);
    RECENT.forEach(async (r) => {   // flag entries whose file/folder is gone (never prompts for permission)
      let h = null; try { h = await idbGet('recent:' + r.id); } catch (e) { /* missing */ }
      const st = h ? await recentState(h, false) : 'missing', row = $('.bs-rec[data-rid="' + r.id + '"]', box), sm = row && $('small', row);
      if (sm && st === 'missing') { row.classList.add('is-missing'); sm.textContent = 'Not found or inaccessible. Remove it with ✕'; }
      else if (sm && st === 'perm') sm.textContent += ' · click to re-grant access';
    });
  }
  function renderWelcomeRecents() {
    const box = $('#welcomeRecList'); if (!box) return;
    const fmt = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const recs = RECENT.slice(0, 5);
    box.innerHTML = recs.length ? recs.map((r) =>
      `<div class="welcome-rec" data-rid="${r.id}"><button class="welcome-rec__open">${ic(r.kind === 'folder' ? 'folder-open' : 'file-code')}<span><b>${esc(r.name)}</b><small>${r.kind === 'folder' ? 'Folder' : 'File'} · opened ${esc(fmt(r.at))}</small></span></button><button class="welcome-rec__rm" data-rm="${r.id}" title="Remove from list" aria-label="Remove ${esc(r.name)} from list">${ic('x')}</button></div>`
    ).join('') : '<p class="welcome-recents__empty">No recent projects yet: files and folders you open appear here.</p>';
    paint(box);
    recs.forEach(async (r) => {
      let h = null; try { h = await idbGet('recent:' + r.id); } catch (e) { /* missing */ }
      const st = h ? await recentState(h, false) : 'missing', row = $('.welcome-rec[data-rid="' + r.id + '"]', box), sm = row && $('small', row);
      if (sm && st === 'missing') { row.classList.add('is-missing'); sm.textContent = 'Not found or inaccessible. Remove with ✕'; }
      else if (sm && st === 'perm') sm.textContent += ' · click to re-grant access';
    });
  }
  function showWelcome(show) {
    const w = $('#welcomePanel'); if (!w) return;
    const on = typeof show === 'boolean' ? show : w.hidden;
    w.hidden = !on;
    if (on) { renderWelcomeRecents(); paint(w); }
  }
  function hideWelcome() {   // a document is now open: unlock the editor (it stays read-only on the welcome screen)
    showWelcome(false);
    const ta = $('#codeInput'); if (ta) ta.readOnly = false;
    const sn = $('#srcName'); if (sn && sn.textContent === 'No document open') sn.textContent = 'Untitled.tex';
  }
  function recentClick(e) {   // → true when the click belonged to the Recent Projects list
    const rm = e.target.closest('[data-rm]'), row = e.target.closest('.bs-rec');
    if (rm) { recentRemove(rm.dataset.rm); recentPanel($('#recList')); return true; }
    if (e.target.closest('#recClear')) { RECENT.forEach((r) => idbDel('recent:' + r.id)); RECENT = []; recentSave(); renderWelcomeRecents(); recentPanel($('#recList')); toast('Recent list cleared. No files were deleted'); return true; }
    if (row) { backstage(false); reopenRecent(row.dataset.rid); return true; }
    return false;
  }
  /* ---------- Project Explorer file actions: right-click menu, Set as Main, and the compile bundle.
     Everything acts on the real FileSystemFileHandles above. Rename/Duplicate/Delete need write access,
     which is requested (read-write) the first time one of them is used. ---------- */
  const relPath = (p) => p.split('/').slice(1).join('/');          // 'Root/chapters/a.tex' -> 'chapters/a.tex'
  const parentOf = (p) => p.slice(0, p.lastIndexOf('/'));
  const extOf = (n) => (n.split('.').pop() || '').toLowerCase();
  const mainKey = () => 'main:' + rootDirHandle.name;
  async function handleByRel(rel) {                                   // real file handle for a project-relative path, or null
    try {
      const parts = rel.split('/').filter(Boolean);
      if (!rootDirHandle || !parts.length || parts.includes('..')) return null;
      let d = rootDirHandle;
      for (const s of parts.slice(0, -1)) d = await d.getDirectoryHandle(s);
      return await d.getFileHandle(parts[parts.length - 1]);
    } catch (e) { return null; }
  }
  async function scanAllTexNodes(folderNode) {
    const res = [];
    if (!folderNode) return res;
    async function walk(f) {
      if (f.c === null && f.handle) {
        try { f.c = await listDir(f.handle, f.path); } catch (e) { f.c = []; }
      }
      for (const item of (f.c || [])) {
        if (item.t === 'file' && /\.tex$/i.test(item.n)) res.push(item);
        else if (item.t === 'folder') await walk(item);
      }
    }
    await walk(folderNode);
    return res;
  }
  async function findMainCandidates(root) {
    const texFiles = await scanAllTexNodes(root);
    const withDocClass = [];
    for (const node of texFiles) {
      let text = fileCache.get(node.path);
      if (text === undefined && node.handle) {
        try { text = await (await node.handle.getFile()).text(); } catch (e) { text = ''; }
      }
      if (text && /\\documentclass\b/.test(text)) withDocClass.push(node);
    }
    return { texFiles, withDocClass };
  }
  async function defaultMain(root) {
    if (!root) return null;
    const { texFiles, withDocClass } = await findMainCandidates(root);
    if (withDocClass.length === 1) return withDocClass[0].path;
    const pool = withDocClass.length > 1 ? withDocClass : texFiles;
    const m = pool.find((n) => n.n.toLowerCase() === 'main.tex') || pool[0];
    return m ? m.path : null;
  }
  async function resolveMain(root) {                                  // saved choice if that file still exists, else scan for \documentclass
    try {
      const saved = await idbGet(mainKey());
      if (saved && saved.startsWith(root.path + '/') && await handleByRel(relPath(saved))) return saved;
    } catch (e) { /* persistence is best-effort */ }
    return await defaultMain(root);
  }
  function syncPdfName() { $('#pdfName').textContent = ((mainPath || '').split('/').pop().replace(/\.[^.]+$/, '') || PROJ_NAME || 'Untitled') + '.pdf'; }   // the PDF pane title = main .tex file name + .pdf
  function setMain(node) {
    mainPath = node ? node.path : null; syncPdfName();
    if (rootDirHandle) idbSet(mainKey(), mainPath).catch(() => {});
    renderExplorer();
  }
  async function syncDirTree(dirNode) {
    if (!dirNode || !dirNode.handle) return;
    const oldFiles = new Map((dirNode.c || []).filter((n) => n.t === 'file').map((n) => [n.n, n]));
    const oldFolders = new Map((dirNode.c || []).filter((n) => n.t === 'folder').map((n) => [n.n, n]));
    const diskEntries = await listDir(dirNode.handle, dirNode.path);
    const newChildren = [];
    for (const item of diskEntries) {
      if (item.t === 'folder') {
        const prev = oldFolders.get(item.n);
        if (prev) {
          prev.handle = item.handle;
          if (prev.c !== null) await syncDirTree(prev);
          newChildren.push(prev);
        } else {
          newChildren.push(item);
        }
      } else {
        const prev = oldFiles.get(item.n);
        if (prev) { prev.handle = item.handle; newChildren.push(prev); }
        else newChildren.push(item);
      }
    }
    dirNode.c = newChildren;
  }
  let checkingFs = false;
  async function checkExternalFsChanges() {
    if (checkingFs || !rootDirHandle || !PROJECT.length) return;
    checkingFs = true;
    try {
      await syncDirTree(PROJECT[0]);
      let changed = false;
      if (activePath) {
        const node = findNode(activePath);
        if (!node) {
          fileCache.delete(activePath);
          const fname = activePath.split('/').pop();
          toast('“' + fname + '” was removed or renamed externally');
          activePath = null;
          changed = true;
          const next = mainPath && findNode(mainPath);
          if (next) await openFileNode(next); else clearEditor();
        }
      }
      if (mainPath && !findNode(mainPath)) {
        mainPath = await defaultMain(PROJECT[0]); syncPdfName();
        if (rootDirHandle) idbSet(mainKey(), mainPath).catch(() => {});
        changed = true;
      }
      renderExplorer();
    } catch (e) { /* ignore */ }
    finally { checkingFs = false; }
  }
  async function ensureWrite(h = rootDirHandle) {
    try {
      if (await h.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
      if (await h.requestPermission({ mode: 'readwrite' }) === 'granted') return true;
    } catch (e) { /* fall through */ }
    toast('Write permission wasn’t granted. Nothing was changed');
    return false;
  }
  async function existsIn(dir, name) {
    try { await dir.getFileHandle(name); return true; } catch (e) { /* not a file */ }
    try { await dir.getDirectoryHandle(name); return true; } catch (e) { return false; }
  }
  async function refreshDir(dirPath) {                                // re-list one folder, keeping already-expanded subfolders as they were
    const p = findNode(dirPath); if (!p) return;
    const old = new Map((p.c || []).filter((n) => n.t === 'folder').map((n) => [n.n, n]));
    p.c = (await listDir(p.handle, p.path)).map((n) => (n.t === 'folder' && old.has(n.n) ? old.get(n.n) : n));
  }
  /* ---- Design ▸ Document Classes: \documentclass selector. Empty body → class swapped in place (one undoable edit, options kept).
     Existing content → warning modal (classes aren't converted): Save the open file, then start a fresh doc with the new class. ---- */
  const DC_RE = /^([ \t]*\\documentclass(?:\[[^\]]*\])?\{)([^}]*)(\})/m;
  const docTemplate = (k) => '% !TEX program = ' + ctx.PREFS.compiler + '\n\\documentclass{' + k + '}\n\n\\begin{document}\n\n\\end{document}\n';
  /* New-document defaults (Preferences ▸ Default Compiler / Default Body Font). Only ever applied to the text of a document that is
     being created: the compiler replaces the template's own xelatex/lualatex `% !TEX program` line; the body font adds fontspec
     (ensurePackage) + \setmainfont in a Fonts block, and is skipped when the text sets its own \setmainfont, is a pdfLaTeX document,
     or the font isn't installed. Existing documents are never touched. */
  async function applyNewDocDefaults(tex) {
    tex = tex.replace(/^([ \t]*%\s*!TEX\s+(?:TS-)?program\s*=\s*)(?:xelatex|lualatex)\b/im, '$1' + ctx.PREFS.compiler);
    const f = ctx.PREFS.bodyFont, bd = tex.indexOf('\\begin{document}');
    if (!f || bd < 0 || /\\setmainfont\b/.test(tex) || needsXeTeX(tex)) return tex;
    if (!(await fontOK(f))) { if (fontSet) toast('Default body font “' + f + '” isn’t installed: the new document uses the standard font'); return tex; }
    const pk = ensurePackage(tex, 'fontspec'); if (pk === false) return tex;
    tex = tex.slice(0, bd) + '% ---- Fonts ----\n\\setmainfont{' + f + '}\n\n' + tex.slice(bd);
    return pk ? tex.slice(0, pk.pos) + pk.str + tex.slice(pk.pos) : tex;
  }
  function syncDocClass(c) {
    c = c || $('.rdoc-wrap') || $('.rdoc-cls'); if (!c) return;
    const m = DC_RE.exec(tocMask(ctx.SRC)), cur = m ? m[2].trim() : null;
    $$('.rdoc', c).forEach((b) => b.classList.toggle('is-on', b.dataset.cls === cur));
    const btn = $('.rdoc-dropdown-btn', c); if (btn) btn.title = 'Document Classes (' + (cur || 'article') + ')';
  }
  const DOC_INFO = { article: 'Papers, essays and short reports', report: 'Longer reports with chapters', book: 'Books with chapters, front and back matter', letter: 'Letters with address, date and signature' };
  const CLS_ICON = (k) => `<svg viewBox="0 0 34 44" width="34" height="44" aria-hidden="true"><rect width="34" height="44" rx="2" fill="#fff" stroke="#9aa0b8"/><text x="17" y="27" text-anchor="middle" font-size="15" font-family="sans-serif" fill="#5b5f7a">${esc(k.charAt(0).toUpperCase())}</text></svg>`;   // class with no thumbnail yet
  function docClassGallery() {
    const c = h('<div class="rdoc-wrap"><div class="rsty rdoc-cls"></div><button class="rbtn rbtn--lg rdoc-dropdown-btn" aria-haspopup="menu" aria-label="Document Classes" title="Document Classes"><span class="rbtn__ico">' + ic('layers') + '</span><span class="rbtn__label">Classes</span>' + ic('chevron-down', 'ic--chev') + '</button></div>');
    const gal = $('.rdoc-cls', c), btn = $('.rdoc-dropdown-btn', c), th = window.LP_CLASS_THUMBS || {};
    docClasses().forEach((k) => { const b = h(`<button class="rdoc" data-cls="${k}" title="\\documentclass{${k}}: ${esc(DOC_INFO[k] || (window.LP_CLASS_INFO || {})[k] || '')}" aria-label="Document class: ${k}">${th[k] || CLS_ICON(k)}<small>${k}</small></button>`); b.onclick = () => setDocClass(k); gal.append(b); });
    btn.onclick = (e) => {
      e.stopPropagation();
      const m = DC_RE.exec(tocMask(ctx.SRC)), cur = m ? m[2].trim() : 'article';
      menu(btn, [{ head: 'Document Classes' }, ...docClasses().map((k) => ({ l: k.charAt(0).toUpperCase() + k.slice(1), sub: '\\documentclass{' + k + '}', checked: cur === k, val: k }))], (k) => setDocClass(k));
    };
    syncDocClass(c); return c;
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function downloadFile(name, text) {
    downloadBlob(new Blob([text], { type: 'text/x-tex;charset=utf-8' }), name || 'Untitled.tex');
  }
  async function saveExport(data, suggested, typeInfo) {
    const mime = (typeInfo && typeInfo.accept && Object.keys(typeInfo.accept)[0]) || 'application/octet-stream';
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    if (typeof window.showSaveFilePicker === 'function') {
      let fh;
      try {
        fh = await window.showSaveFilePicker({ suggestedName: suggested, types: typeInfo ? [typeInfo] : [] });
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
      }
      if (fh) {
        try {
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
          return fh.name;
        } catch (e) {
          toast('Could not write “' + fh.name + '”');
          return null;
        }
      }
    }
    downloadBlob(blob, suggested);
    return suggested;
  }
  async function saveActiveFile(opts) {   // writes the open file back to the project folder or single-file handle → true on success (a toast explains any failure); opts.explicit: the user asked for this save
    if (RECOVERED.has(activePath) && !(opts && opts.explicit)) return false;   // restored text is written to disk only by an explicit Save, never by autosave
    const node = activePath && findNode(activePath), ta = $('#codeInput'), text = ta ? ta.value : ctx.SRC;
    if (!node || !node.handle) {
      if (typeof window.showSaveFilePicker !== 'function') {
        const name = (activePath && activePath.split('/').pop()) || 'Untitled.tex';
        downloadFile(name, text);
        scratchBase = text;
        idbDraftDel(activePath || '(scratch)');
        syncSaveState();
        toast('Downloaded “' + name + '”');
        return true;
      }
      return saveAs();
    }
    if (typeof node.handle.createWritable !== 'function') {
      downloadFile(node.n || 'document.tex', text);
      idbDraftDel(node.path);
      toast('Downloaded “' + (node.n || 'document.tex') + '”');
      return true;
    }
    let perm = false;
    try { perm = await ensureWrite(rootDirHandle || node.handle); } catch (e) { /* fall through */ }
    if (!perm) return false;
    try {
      const w = await node.handle.createWritable();
      await w.write(text);
      await w.close();
    } catch (e) {
      if (e && (e.name === 'NotFoundError' || e.name === 'InvalidStateError')) {
        toast('Could not save “' + node.n + '”: the file was deleted or moved');
      } else if (e && e.name === 'NotAllowedError') {
        toast('Write permission wasn’t granted: “' + node.n + '” was not saved');
      } else {
        toast('Could not save “' + node.n + '”');
      }
      return false;
    }
    fileCache.set(activePath, text);
    ctx.SRC = text;
    RECOVERED.delete(activePath);
    idbDraftDel(activePath || '(scratch)');
    syncSaveState();
    return true;
  }
  /* ---- Save / Save As. The title-bar indicator compares the editor with what is really on disk (docDirty); it only turns
     "saved" after a write succeeds. Save with no file behind the document falls back to Save As. ---- */
  let ssTimer = null, draftTimer = null, dirtyNow = false;   // dirtyNow: last known dirty state, readable synchronously by the beforeunload handler
  async function syncSaveState() {
    const el = $('.save-state'), t = $('#saveStateText'); if (!el || !t) return;
    const d = await docDirty(); dirtyNow = d; el.dataset.state = d ? 'dirty' : 'saved'; t.textContent = d ? 'Unsaved changes' : 'All changes saved';
    syncTitle();
    if (!d && !RECOVERED.has(activePath || '(scratch)')) idbDraftDel(activePath || '(scratch)');
  }
  function syncTitle() {   // window/tab title: always the plain app name (no unsaved-changes dot; the save-state pill shows that)
    document.title = APP_NAME;
  }
  function syncSaveSoon() {
    dirtyNow = true; clearTimeout(ssTimer); ssTimer = setTimeout(syncSaveState, 250);
    clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
      const p = activePath || '(scratch)', ta = $('#codeInput'), text = ta ? ta.value : ctx.SRC;
      if (await docDirty()) {
        const nm = ($('#srcName') && $('#srcName').textContent) || (p.split('/').pop() || 'Untitled.tex');
        idbDraftSet(p, text, nm);
      }
    }, 1000);
  }
  async function saveDoc(opts) {
    if (noDoc()) return;
    const node = activePath && findNode(activePath);
    if (!node || !node.handle) return saveAs();
    if (await saveActiveFile({ explicit: true })) {
      toast('Saved “' + node.n + '”');
      if (ctx.PREFS.cos && !(opts && opts.quiet) && !(window.RPE && RPE.pv && RPE.pv.compiling)) runCompile();   // Preferences ▸ Compile on save
    }
  }
  async function saveAs() {   // Save As: in project creates/swaps to file; scratch doc / outside project updates active state; unsupported falls back to download
    const old = activePath && findNode(activePath), ta = $('#codeInput'), text = ta ? ta.value : ctx.SRC;
    const ext = old ? extOf(old.n) : 'tex', exts = ['.tex'].concat(ext && ext !== 'tex' ? ['.' + ext] : []);
    const suggested = old ? old.n : 'Untitled.tex';
    if (typeof window.showSaveFilePicker !== 'function') {
      downloadFile(suggested, text);
      if (!old) scratchBase = text;
      idbDraftDel(activePath || '(scratch)');
      syncSaveState();
      toast('Downloaded “' + suggested + '”');
      return true;
    }
    let h;
    try {
      h = await window.showSaveFilePicker({ suggestedName: suggested, types: [{ description: 'LaTeX document', accept: { 'text/x-tex': exts } }] });
    } catch (e) {
      if (e && e.name === 'AbortError') { toast('Save cancelled'); return false; }
      if (e && e.name === 'NotAllowedError') { toast('Permission denied. Nothing was saved'); return false; }
      toast('Save cancelled');
      return false;
    }
    try {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    } catch (e) {
      if (e && (e.name === 'NotFoundError' || e.name === 'InvalidStateError')) {
        toast('Could not save “' + h.name + '”: the target was deleted or unavailable');
      } else if (e && e.name === 'NotAllowedError') {
        toast('Write permission wasn’t granted. Nothing was saved');
      } else {
        toast('Could not save “' + h.name + '”: nothing was changed');
      }
      return false;
    }
    cmtSync(true);
    let rel = null;
    if (rootDirHandle) {
      try { rel = await rootDirHandle.resolve(h); } catch (e) { /* treated as outside the project */ }
    }
    if (rootDirHandle && rel && rel.length) {   // inside the open project: refresh the explorer and make the new file the active one
      const path = PROJECT[0].path + '/' + rel.join('/'), par = path.slice(0, path.lastIndexOf('/')), pn = findNode(par);
      if (pn && pn.c === null) { try { pn.c = await listDir(pn.handle, pn.path); } catch (e) { /* refresh below fails softly */ } }
      if (pn) await refreshDir(par);
      const n = findNode(path);
      if (n) {
        if (old && old.path !== path) fileCache.delete(old.path);
        fileCache.set(path, text);
        activePath = path;
        ctx.SRC = text;
        $('#srcName').textContent = n.n;
        renderExplorer();
        if (old && old.path !== path) cmtMove(old.path, path, true);   // the copy keeps the comments; the original file keeps its own
        cmtSync(true);
        RECOVERED.delete(path);
        idbDraftDel(path);
        if (old) idbDraftDel(old.path);
        idbDraftDel('(scratch)');
        syncSaveState();
        toast('Saved a copy as “' + n.n + '”');
        return true;
      }
      renderExplorer();
      return toast('Saved “' + h.name + '”, but it isn’t shown in the project tree: the open document is unchanged');
    }
    if (rootDirHandle) {
      // outside project folder while a project is open: original project document remains untouched
      return toast('Saved a copy as “' + h.name + '” outside the project folder: the open document is unchanged');
    }
    // No project folder open (scratch doc or opened single file): new file becomes the active one-file project
    const node = { t: 'file', n: h.name, path: '(open file)/' + h.name, handle: h };
    PROJECT = [{ t: 'folder', n: 'Open file', path: '(open file)', open: true, c: [node], handle: null }];
    fileCache.clear();
    fileCache.set(node.path, text);
    activePath = node.path;
    histClear();
    ctx.SRC = text;
    mainPath = null;
    PROJ_NAME = h.name.replace(/\.[^.]+$/, '');
    $('#docFileName').textContent = PROJ_NAME;
    syncPdfName();
    $('#srcName').textContent = h.name;
    try { await idbSet(IDB_KEY, null); } catch (e) { /* best-effort */ }
    renderExplorer();
    cmtMove(old ? old.path : '(untitled)', node.path, !!old);   // an untitled doc's comments move to its new file
    cmtSync(true);
    idbDraftDel(node.path);
    if (old) idbDraftDel(old.path);
    idbDraftDel('(scratch)');
    syncSaveState();
    await recentAdd('file', h);
    toast('Saved as “' + h.name + '”');
    return true;
  }
  async function createDocFile(text, keepMain) {   // new untitled-N.tex in the project folder, opened in the editor → file name, or null (a toast explains)
    const root = PROJECT[0], old = activePath && findNode(activePath); let name = 'untitled.tex', i = 1;
    try {
      const taken = new Set(); for await (const [n] of root.handle.entries()) taken.add(n.toLowerCase());   // one listing instead of one existence probe per untitled-N
      while (taken.has(name)) name = 'untitled-' + (++i) + '.tex';
      const w = await (await root.handle.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close();
    } catch (e) { toast('Could not create the new document'); return null; }
    await refreshDir(root.path); renderExplorer();
    const n = findNode(root.path + '/' + name); if (!n) { toast('Could not open the new document'); return null; }
    const wasMain = old && mainPath === old.path; await openFileNode(n);
    if (keepMain ? !mainPath : wasMain) setMain(n);   // class-change replaces the main file; New / template never steals it
    syncDocClass(); return name;
  }
  async function startNewWithClass(k) {
    const old = activePath && findNode(activePath);
    if (!(await saveActiveFile({ explicit: true }))) return toast('Nothing was changed: the current document was not saved');
    const name = await createDocFile(await applyNewDocDefaults(docTemplate(k)));
    if (name) toast('Saved “' + old.n + '”: new ' + k + ' document: ' + name);
  }
  /* ---- File ▸ New / New from Template. A document is "dirty" when the editor text differs from the file on disk (or, with no
     file open, from the text the scratch document started with). Dirty → Save and Continue (or Discard and Continue when it
     can't be saved); a failed save aborts. Inside a project folder the new doc becomes a new file; otherwise it replaces the
     scratch text as one undoable edit. ---- */
  let scratchBase = ctx.SRC;
  async function docDirty() {
    const ta = $('#codeInput'), cur = ta ? ta.value : ctx.SRC, n = activePath && findNode(activePath);
    const wp = $('#welcomePanel'); if (!n && wp && !wp.hidden) return false;   // still on the welcome screen: nothing has been edited
    if (n) { try { return cur !== await (await n.handle.getFile()).text(); } catch (e) { return true; } }
    return cur !== scratchBase && cur.trim() !== '';
  }
  let guardDlg = null;   // the one open unsaved-changes dialog, so window close / Exit / New can never stack a second one
  async function guardDirty(go, closing) {   // closing: the app/window is about to close (File ▸ Exit, tab/window close), only changes the wording
    if (guardDlg && guardDlg.el.isConnected) return;
    if (!(await docDirty())) return go();
    const n = activePath && findNode(activePath), canSave = !!(n && n.handle && typeof n.handle.createWritable === 'function');
    const msg = canSave ? `“${esc(n.n)}” has unsaved changes. Do you want to save your changes before ${closing ? 'closing' : 'continuing'}?`
      : closing ? 'This document has unsaved changes and isn’t in a project folder, so changes cannot be saved back to a file. Do you want to close anyway?'
      : 'This document has unsaved changes and isn’t in a project folder, so changes cannot be saved back to a file. Continuing replaces it.';
    const btns = canSave ? ['Cancel', 'Don’t Save', 'Save'] : ['Cancel', 'Don’t Save'];
    guardDlg = dlg({ t: 'Unsaved changes', i: 'triangle-alert', w: 480, btns, b: `<p>${msg}</p>` });
    const bList = $$('.dlg__foot .btn', guardDlg.el);
    if (canSave) {
      bList[1].onclick = async () => {   // Don't Save
        guardDlg.close();
        if (closing) allowUnload = true;
        dirtyNow = false;
        try { await go(); } finally { if (closing) allowUnload = false; }
      };
      bList[2].onclick = async () => {   // Save
        if (!(await saveActiveFile({ explicit: true }))) return toast(closing ? 'The document was not saved: the window stays open' : 'Nothing was changed: the current document was not saved');
        guardDlg.close();
        if (closing) allowUnload = true;
        try { await go(); } finally { if (closing) allowUnload = false; }
      };
    } else {
      bList[1].onclick = async () => {   // Don't Save
        guardDlg.close();
        if (closing) allowUnload = true;
        dirtyNow = false;
        try { await go(); } finally { if (closing) allowUnload = false; }
      };
    }
  }
  /* Closing the window: File ▸ Exit and the browser's own tab/window close both end up in guardDirty above. */
  let allowUnload = false;
  function closeWindow() {
    allowUnload = true; try { window.close(); } catch (e) { /* handled below */ }
    setTimeout(() => { allowUnload = false; toast('Your browser won’t let this page close itself. Close the tab yourself (nothing is left unsaved)'); }, 400);
  }
  function exitApp(close) { guardDirty(close ? () => { dirtyNow = false; close(); } : closeWindow, true); }   // close: custom closer (the desktop shell's window bridge); runs only after Save/Don't Save/not dirty
  window.addEventListener('beforeunload', (e) => {
    if (allowUnload || !dirtyNow) return;
    e.preventDefault(); e.returnValue = '';
  });
  async function newDocFrom(text, label) {
    if (rootDirHandle && PROJECT[0] && PROJECT[0].handle) {
      if (activePath && !(await ensureWrite())) return;
      const name = await createDocFile(text, true); if (name) toast(label + ': ' + name);
      return name;
    }
    if (!rootDirHandle && activePath) { PROJECT = []; fileCache.clear(); activePath = null; histClear(); $('#srcName').textContent = 'Untitled.tex'; renderExplorer(); }   // leaving a single opened file: never let a later save overwrite it
    const ta = $('#codeInput'); if (!ta) return toast('Open a project folder first, then create a document');
    if (!activePath) { cmtLoad(); CMT.list = CMT.list.filter((c) => c.file !== '(untitled)'); cmtSave(); }   // the untitled text is replaced, so its comments go too
    hideWelcome(); fmtEdit(ta, 0, ta.value.length, text, 0, 0); ta.scrollTop = 0; scratchBase = text;
    const b = text.indexOf('\\begin{document}\n\n'); if (b >= 0) { const q = b + 18; ta.setSelectionRange(q, q); }
    hideWelcome(); syncDocClass(); toast(label);
  }
  function newDocument() {
    const m = DC_RE.exec(tocMask(ctx.SRC)), c = m && docClasses().includes(m[2].trim()) ? m[2].trim() : 'article';   // default: the open doc's class, else article; compiler is XeLaTeX (what the server runs)
    guardDirty(async () => newDocFrom(await applyNewDocDefaults(docTemplate(c)), 'New ' + c + ' document'));
  }
  function createFromTemplate(t) {   // shared by File ▸ New from Template and the Backstage ▸ Templates gallery; guardDirty = unsaved-changes safeguard
    guardDirty(async () => { const tex = await tplLoad(t); if (tex == null) return toast('Could not load “' + t.name + '”: run the app through server/server.js (or a local web server), not file://'); if (await newDocFrom(stampTpl(await applyNewDocDefaults(tex), t.id), 'New document from “' + t.name + '”')) await tplAssets(t); });
  }
  async function newFromTemplate() {
    const tpls = window.LP_TEMPLATES || []; if (!tpls.length) return toast('No templates found');
    let sel = tpls[0];
    const d = dlg({ t: 'New from Template', i: 'layout-template', w: 560, btns: ['Cancel', 'Create Document'],
      b: '<div class="rsty rtpl-gal ntpl-gal"></div><div class="prev ntpl-prev" style="margin-top:12px;display:flex;gap:14px;align-items:center;min-height:100px"></div>',
      ok: () => createFromTemplate(sel) });
    const gal = $('.ntpl-gal', d.el), pv = $('.ntpl-prev', d.el);
    const show = async (t) => {
      sel = t; $$('.rtpl', gal).forEach((b) => b.classList.toggle('is-on', b.dataset.id === t.id));
      pv.innerHTML = `<div>${t.thumb.replace('width="34" height="44"', 'width="78" height="101"')}</div><div><b>${esc(t.name)}</b><br><span class="muted">${esc(t.desc)}</span><br><small class="muted ntpl-cls">Loading…</small></div>`;
      const tex = await tplLoad(t); if (sel !== t) return;
      const m = tex && DC_RE.exec(tocMask(tex)); $('.ntpl-cls', pv).textContent = tex == null ? 'Source unavailable. Run via server/server.js' : 'Document class: ' + (m ? m[2].trim() : 'unknown');
    };
    tpls.forEach((t) => { const b = h(`<button class="rtpl" data-id="${esc(t.id)}" title="${esc(t.name)}" aria-label="Template: ${esc(t.name)}">${t.thumb}<small>${esc(t.name)}</small></button>`); b.onclick = () => show(t); gal.append(b); });
    show(sel);
  }
  function setDocClass(k) {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, mk = tocMask(t), m = DC_RE.exec(mk);
    if (!m) { if (t.trim()) return toast('No \\documentclass found. Open the main .tex file to change the document type'); fmtEdit(ta, 0, 0, docTemplate(k), 0, 0); return toast('Document class: ' + k); }
    const cur = m[2].trim(), bd = mk.indexOf('\\begin{document}'), ed = mk.indexOf('\\end{document}');
    if (cur === k) return toast('Already using the ' + k + ' class');
    if (bd < m.index) return toast('Could not find \\begin{document} after \\documentclass: document type left unchanged');
    if (mk.slice(bd + 16, ed < 0 ? undefined : ed).trim()) {   // has content → classes aren't converted
      dlg({ t: 'Change document type?', i: 'triangle-alert', w: 480, btns: ['Cancel', 'Save and Start New Document'],
        b: `<p>This document already has content. LaTeX classes aren’t converted automatically, so switching “${esc(cur)}” to “${k}” in place could break chapters, headings and layout.</p><p>You can save this document and start a new one using the “${k}” class instead.</p>`,
        ok: () => { startNewWithClass(k); } });
      return;
    }
    const a = m.index + m[1].length, b = a + m[2].length, d = k.length - m[2].length, mv = (p) => (p >= b ? p + d : p > a ? a + k.length : p);
    fmtEdit(ta, a, b, k, mv(ta.selectionStart), mv(ta.selectionEnd)); toast('Document class: ' + k);
  }
  /* ---- Design ▸ Templates: catalogue lives in templates/templates.js (window.LP_TEMPLATES); each entry's .tex is fetched on demand.
     Applying replaces the whole source in one undoable edit, after an explicit confirmation (and a save of the open file when possible). ---- */
  const TPL_CACHE = new Map();
  const TPL_SHOWN = 4;   // templates shown in the ribbon; the rest live in the drop-down
  function tplGallery() {
    const c = h('<div class="rsty rtpl-gal"></div>'), all = window.LP_TEMPLATES || [];
    all.slice(0, TPL_SHOWN).forEach((t) => {
      const b = h(`<button class="rtpl" data-id="${esc(t.id)}" title="${esc(t.name)}: ${esc(t.desc)}" aria-label="Template: ${esc(t.name)}">${t.thumb}<small>${esc(t.name)}</small></button>`);
      b.onclick = () => applyTemplate(t); c.append(b);
    });
    if (all.length > TPL_SHOWN) {   // the strip shows the first TPL_SHOWN; this opens the full catalogue
      const m = h(`<button class="rtpl-more" aria-haspopup="true" aria-expanded="false" aria-label="All templates" title="All templates">${ic('chevron-down')}</button>`); m.onclick = (e) => { e.stopPropagation(); tplMenu(m); }; c.append(m); }
    if (!c.children.length) c.append(h('<small style="color:var(--text-2)">No templates found</small>'));
    return c;
  }
  function tplMenu(anchor) {   // drop-down with every template: thumbnail in its own palette, colours, description, tags
    const el = h('<div class="popover popover--tpl is-open" role="dialog" aria-label="Templates"><div class="tplx__head"><h3>Templates</h3><p>Select a document template. Applying one replaces the current source in a single undoable edit.</p><div class="tplx__disc"><b>DISCLAIMER</b><span>All titles, names, institutional affiliations, data and figures in these templates are entirely fictional sample placeholders for layout demonstration. Any resemblance to real persons, living or deceased, or actual institutions is purely coincidental. Methodological content and references are illustrative.</span></div></div><div class="tplx__grid"></div></div>'), grid = $('.tplx__grid', el);
    (window.LP_TEMPLATES || []).forEach((t) => {
      const card = h(`<div class="tplx__card"><div class="tplx__thumb">${t.thumb}</div><div class="tplx__info"><div class="tplx__top"><b>${esc(t.name)}</b><span class="tplx__dots">${(t.colors || []).map((k) => `<i style="background:${k}"></i>`).join('')}</span></div><p>${esc(t.desc)}</p><em>${esc(t.tags || '')}</em><button class="btn btn--sm tplx__use">Use Template</button></div></div>`);
      $('.tplx__use', card).onclick = () => { closePop(); applyTemplate(t); };
      grid.append(card);
    });
    el.style.maxHeight = Math.max(280, innerHeight - anchor.getBoundingClientRect().bottom - 14) + 'px';
    openPop(anchor, el);
  }
  async function applyTemplate(t) {
    const ta = $('#codeInput'); if (!ta || ta.readOnly) return toast('Open or create a document first, then choose a template');
    const tex = await tplLoad(t);
    if (tex == null) return toast('Could not load “' + t.name + '”: run the app through server/server.js (or a local web server), not file://');
    const put = () => { const q = $('#codeInput'); if (!q) return; hideWelcome(); fmtEdit(q, 0, q.value.length, stampTpl(tex, t.id), 0, 0); q.scrollTop = 0; hideWelcome(); syncDocClass(); toast('Template applied: ' + t.name); tplAssets(t); };
    if (!ta.value.trim()) return put();                                  // nothing to lose
    guardDirty(() => put());
  }
  setTimeout(() => (window.LP_TEMPLATES || []).forEach((t) => tplLoad(t)), 1500);   // warm the cache so the first template click doesn't wait on a fetch
  async function tplAssets(t) {   // copy a template's figures / .bib (t.assets, relative to templates/) next to the document; never overwrites; needs an open project folder
    const root = PROJECT[0]; if (!(t.assets && t.assets.length && rootDirHandle && root && root.handle) || !(await ensureWrite())) return;
    try {
      const dirs = new Map();   // one create + one listing per target folder; the files themselves are copied in parallel
      const dirOf = (parts) => { const k = parts.join('/'); if (!dirs.has(k)) dirs.set(k, (async () => { let d = root.handle; for (const q of parts) d = await d.getDirectoryHandle(q, { create: true }); const have = new Set(); for await (const [n] of d.entries()) have.add(n.toLowerCase()); return { d, have }; })()); return dirs.get(k); };
      await Promise.all(t.assets.map(async (a) => {
        const parts = a.split('/'), fn = parts.pop(), { d, have } = await dirOf(parts); if (have.has(fn.toLowerCase())) return;
        const r = await fetch('templates/' + a); if (!r.ok) throw 0;
        const w = await (await d.getFileHandle(fn, { create: true })).createWritable(); await w.write(await r.arrayBuffer()); await w.close();
      }));
      await refreshDir(root.path); renderExplorer();
    } catch (e) { toast('Could not copy the figures and files for “' + t.name + '”'); }
  }
  async function tplLoad(t) {
    let tex = TPL_CACHE.get(t.file);
    if (tex == null) { try { const r = await fetch('templates/' + t.file); if (!r.ok) throw 0; tex = await r.text(); TPL_CACHE.set(t.file, tex); } catch (e) { return null; } }
    return tex;
  }
  /* Reset to Template. applyTemplate stamps "% lplum:template <id>" into the source, that marker is the only record of origin
     (missing / unknown id → refused plainly). Reset rewrites ONLY the preamble: role-based design (theme colors, fonts, the heading,
     header/footer and page-decoration blocks) is stripped, then the template's class line, geometry/fancyhdr/setspace/lineno and its
     page-style/spacing lines are put back. \begin{document} onwards is never touched. Title/author/date are content, not reset. */
  const TPL_MK = /^%[ \t]*lplum:template[ \t]+(\S+)[ \t]*$/m, TPL_PK = ['geometry', 'fancyhdr', 'setspace', 'lineno'];
  const TPL_DES = /^[ \t]*\\(?:pagestyle|fancyhf|fancyhead|fancyfoot|[lcr](?:head|foot)|geometry|doublespacing|onehalfspacing|singlespacing|linenumbers|setstretch|setlength\{\\headheight\})(?![a-zA-Z]).*\n?/gm;
  const stampTpl = (tex, id) => { const i = tex.indexOf('\n'), L = '% lplum:template ' + id; return /^%\s*!TEX/i.test(tex) && i > 0 ? tex.slice(0, i + 1) + L + '\n' + tex.slice(i + 1) : L + '\n' + tex; };
  function tplResetText(old, tex) {
    const bd = old.indexOf('\\begin{document}'), tb = tex.indexOf('\\begin{document}'), err = (e) => ({ err: e + ': nothing was changed' });
    if (bd < 0 || tb < 0) return err('Reset needs \\begin{document} in the document and the template');
    const body = old.slice(bd), tp = tex.slice(0, tb), items = [], notes = [], hit = (k) => { if (k && !items.includes(k)) items.push(k); };
    let pre = old.slice(0, bd), own = false;
    const rm = (re, k) => { const n = pre.replace(re, ''); if (n !== pre) { pre = n; hit(k); } };
    rm(HD_RE, 'heading styles'); rm(HF_RE, 'headers & footers'); rm(PD_RE, 'page borders, watermark & page color');
    if (/^[ \t]*%%% lplum:(?:hf|pd) (?:begin|end)/m.test(pre) || /% ---- Heading design ----/.test(pre) && !/% ---- end heading design ----/.test(pre)) return err('A managed design block has an unpaired marker. Fix or delete it first');
    rm(/^[^\n]*% lplum: [^\n]*\n?/gm, 'colors, fonts & heading wiring');   // every line the Design tab added carries this commentary marker (lines it only edited use "lplum edit:" and stay)
    for (const r of THEME_HEAD) { const fn = r + 'font'; let m; while ((m = sectRe(fn).exec(pre)) && sectOurs(m[1])) { pre = pre.replace(m[0], () => ''); hit('heading colors & fonts'); } }
    rm(/^[ \t]*\\hypersetup\{colorlinks=true,linkcolor=lpAccent,citecolor=lpAccent,urlcolor=lpAccent\}[ \t]*\n?/m, 'colors');
    rm(/^[ \t]*\\AtBeginDocument\{\\color\{lpBody\}\}[ \t]*\n?/m, 'colors');
    rm(/^[ \t]*\\setmainfont(?![a-zA-Z])(?:\[[^\]]*\])?\{[^{}]*\}[ \t]*\n?/m, 'fonts');
    rm(/^[ \t]*% ---- (?:Theme colors|Fonts) ----[ \t]*\n/gm, null);
    const kept = [];   // a definition still referenced elsewhere stays, otherwise the document would stop compiling
    const defs = [...Object.values(THEME_ROLES).map((n) => [new RegExp('^[ \\t]*\\\\definecolor\\{' + n + '\\}\\{[^}]*\\}\\{[^}]*\\}[ \\t]*\\n?', 'm'), new RegExp(n + '(?![a-zA-Z])'), n, 'colors']),
      ...['lpHeadingFont', 'lpDisplayFont'].map((n) => [new RegExp('^[ \\t]*\\\\newfontfamily\\\\' + n + '(?![a-zA-Z])(?:\\[[^\\]]*\\])?\\{[^{}]*\\}[ \\t]*\\n?', 'm'), new RegExp('\\\\' + n + '(?![a-zA-Z])'), '\\' + n, 'fonts'])];
    for (const [def, use, n, k] of defs) if (def.test(pre)) { if (use.test(pre.replace(def, '') + body)) kept.push(n); else { pre = pre.replace(def, ''); hit(k); } }
    if (kept.length) notes.push(kept.join(', ') + ' kept because other lines still use ' + (kept.length > 1 ? 'them' : 'it'));
    const tc = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}[ \t]*$/m.exec(tp), cc = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}[ \t]*$/m.exec(pre);
    if (!tc || !cc) return err('No \\documentclass found');
    if (cc[1] !== tc[1]) notes.push('document class stays “' + cc[1] + '” (template uses “' + tc[1] + '”) because your headings and structure depend on it');
    else if (cc[0].trim() !== tc[0].trim()) { pre = pre.replace(cc[0], () => tc[0]); hit('class options'); own = true; }
    const tdes = tp.match(TPL_DES) || [], gone = pre.match(TPL_DES) || [], tr = (a) => a.map((l) => l.trim()).join('\n');
    if (/\\fancypagestyle|\\newpagestyle/.test(pre)) { if (gone.length || tdes.length) notes.push('your own \\fancypagestyle block was left alone, so page-style lines were not reset'); }
    else if (tr(gone) !== tr(tdes)) {
      if (gone.some((l) => !tdes.some((x) => x.trim() === l.trim()))) own = true;
      pre = pre.replace(TPL_DES, ''); hit('margins, page style & spacing');
      if (tdes.length) pre = pre.replace(/\n*$/, '\n\n') + tdes.map((l) => l.replace(/\n$/, '')).join('\n') + '\n\n';
    }
    const want = [];
    for (const p of TPL_PK) {
      const re = new RegExp('^[ \\t]*\\\\usepackage(?:\\[([^\\]]*)\\])?\\{' + p + '\\}[ \\t]*(?:%.*)?\\n?', 'm'), tm = re.exec(tp); if (!tm) continue;
      const cm = re.exec(pre); if (cm && (cm[1] || '') !== (tm[1] || '')) { pre = pre.replace(re, ''); hit('margins, page style & spacing'); own = true; }
      want.push(tm[1] ? [p, tm[1]] : [p]);
    }
    if (items.length) pre = pre.replace(/\n{3,}/g, '\n\n');
    let nt = pre + body; const pk = ensurePackage(nt, ...want);
    if (pk === false) return err('Could not add the template’s packages. Check the \\documentclass / preamble');
    if (pk) { nt = nt.slice(0, pk.pos) + pk.str + nt.slice(pk.pos); hit('margins, page style & spacing'); }
    if (nt.slice(nt.indexOf('\\begin{document}')) !== body) return err('Safety check failed (document body would change)');
    return { nt, items, notes, own };
  }
  async function resetTemplate() {
    const ta = $('#codeInput'); if (!ta || !ta.value.trim()) return toast('Open a document first, then use Reset to Template');
    const m = TPL_MK.exec(ta.value), t = m && (window.LP_TEMPLATES || []).find((x) => x.id === m[1]);
    if (!t) return dlg({ t: 'Reset to Template', i: 'rotate-ccw', w: 460, btns: ['Close'], b: '<p>This document’s template is unknown' + (m ? ' (“' + esc(m[1]) + '” isn’t in the template list)' : ': it wasn’t created from a template in Laurevine Plum, or was started from scratch') + '.</p><p>Nothing was changed, and no default design was guessed. Choose a template under Design ▸ Templates if you want to start from one.</p>' });
    const tex = await tplLoad(t); if (tex == null) return toast('Could not load “' + t.name + '”: run the app through server/server.js (or a local web server), not file://');
    const r = tplResetText(ta.value, tex); if (r.err) return toast(r.err);
    if (r.nt === ta.value) return toast('Design already matches the “' + t.name + '” template');
    dlg({ t: 'Reset to template design?', i: 'triangle-alert', w: 500, btns: ['Cancel', 'Reset Design'],
      b: `<p>Restores the “${esc(t.name)}” design: <b>${esc(r.items.join(', ') || 'preamble settings')}</b>.</p><p>Your text, equations, tables, figures, labels, comments, title and author are not touched: only the preamble before <code>\\begin{document}</code> changes, as one undoable edit (Ctrl+Z).</p>`
        + (r.own ? '<p><b>Heads-up:</b> your own margins, class options, page-style or spacing lines in the preamble can’t be told apart from the template’s, so they are replaced by the template’s.</p>' : '')
        + (r.notes.length ? '<p class="muted">' + esc(r.notes.join('; ')) + '.</p>' : ''),
      ok: () => {
        const q = $('#codeInput'), r2 = q && tplResetText(q.value, tex);   // recomputed: the source may have changed while the dialog was open
        if (!r2 || r2.err) return toast(r2 ? r2.err : 'Nothing was changed');
        docDiffEdit(q, q.value, r2.nt); syncDocClass(); toast('Design reset to template: ' + t.name);
      } });
  }
  function clearEditor() {
    activePath = null; ctx.SRC = '';
    loadIntoEditor();
    FIND.matches = []; FIND.idx = -1; updateFindUI();
    renderCode(); renderOutline(); $('#srcName').textContent = 'No file open'; syncTitle();
  }
  function fileDialog(title, body, okLabel, onOk, focus) {
    const d = dlg({ t: title, i: 'file-code', w: 420, b: body, btns: ['Cancel', okLabel], focus });
    const ok = $('.dlg__foot .btn--primary', d.el);
    ok.onclick = () => onOk(d);                                       // replaces the mock "preview only" handler with the real action
    return d;
  }
  function renameFile(node) {
    const d = fileDialog('Rename file', F([['t', 'New name', node.n]]), 'Rename', async (dd) => {
      const name = $('input', d.el).value.trim();
      if (name === node.n) return dd.close();
      if (!name || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || name.startsWith('.')) return toast('That isn’t a valid file name');
      if (!(await ensureWrite())) return;
      const parent = findNode(parentOf(node.path));
      if (await existsIn(parent.handle, name)) return toast('“' + name + '” already exists in this folder');
      dd.close();
      const oldPath = node.path, newPath = parent.path + '/' + name;
      try {
        if (typeof node.handle.move === 'function') await node.handle.move(name);
        else {                                                        // browsers without handle.move(): copy, then remove the original
          const nh = await parent.handle.getFileHandle(name, { create: true }), w = await nh.createWritable();
          await w.write(await node.handle.getFile()); await w.close(); await parent.handle.removeEntry(node.n);
        }
      } catch (e) { return toast('Could not rename “' + node.n + '”'); }
      if (fileCache.has(oldPath)) { fileCache.set(newPath, fileCache.get(oldPath)); fileCache.delete(oldPath); }   // unsaved edits travel with the file
      if (viewPath === oldPath) closeViewer();                      // the viewed file's handle changed; return to the editor
      if (activePath === oldPath) { activePath = newPath; $('#srcName').textContent = name; syncTitle(); }
      idbDraftDel(oldPath); if (activePath === newPath) syncSaveSoon(); else if (fileCache.has(newPath)) draftSync(newPath, fileCache.get(newPath));   // the draft moves with the file
      cmtMove(oldPath, newPath); if (TRK.base.has(oldPath)) { TRK.base.set(newPath, TRK.base.get(oldPath)); TRK.base.delete(oldPath); }
      if (mainPath === oldPath) setMain({ path: newPath });
      await refreshDir(parent.path); renderExplorer(); toast('Renamed to “' + name + '”');
    }, 'input');
    $('input', d.el).select();
    $('input', d.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('.dlg__foot .btn--primary', d.el).click(); } });
  }
  async function duplicateFile(node) {
    if (!(await ensureWrite())) return;
    const parent = findNode(parentOf(node.path)), m = node.n.match(/^(.*?)(\.[^.]*)?$/);
    let name, i = 1;
    do { name = m[1] + '-copy' + (i > 1 ? '-' + i : '') + (m[2] || ''); i++; } while (await existsIn(parent.handle, name));
    try {
      const text = node.path === activePath ? ctx.SRC : fileCache.get(node.path);   // duplicate what's on screen, including unsaved edits
      const w = await (await parent.handle.getFileHandle(name, { create: true })).createWritable();
      await w.write(text !== undefined ? text : await node.handle.getFile()); await w.close();
    } catch (e) { return toast('Could not duplicate “' + node.n + '”'); }
    await refreshDir(parent.path); renderExplorer(); toast('Created “' + name + '”');
  }
  async function deleteFile(node) {
    const isActive = node.path === activePath, cur = isActive ? ctx.SRC : fileCache.get(node.path);
    let dirty = false;
    if (cur !== undefined) { try { dirty = cur !== await (await node.handle.getFile()).text(); } catch (e) { /* treat as clean */ } }
    fileDialog('Delete file', `<p>Delete “${esc(node.n)}” from the project folder? This can’t be undone.${dirty ? '<br><b>It has unsaved edits that will be lost.</b>' : ''}</p>`, 'Delete', async (dd) => {
      if (!(await ensureWrite())) return;
      dd.close();
      const parent = findNode(parentOf(node.path));
      try { await parent.handle.removeEntry(node.n); } catch (e) { return toast('Could not delete “' + node.n + '”'); }
      fileCache.delete(node.path); idbDraftDel(node.path); if (viewPath === node.path) closeViewer();
      await refreshDir(parent.path);
      if (mainPath === node.path) { mainPath = await defaultMain(PROJECT[0]); syncPdfName(); idbSet(mainKey(), mainPath).catch(() => {}); toast(mainPath ? 'Main file is now “' + mainPath.split('/').pop() + '”' : 'No main file: right-click a .tex file and choose Set as main file'); }
      if (isActive) {
        activePath = null;                                            // so the deleted file's text isn't cached back under its old path
        const next = mainPath && findNode(mainPath);
        if (next) await openFileNode(next); else clearEditor();
      }
      renderExplorer();
    });
  }
  $('#sbExplorerBody').addEventListener('contextmenu', (e) => {
    const b = e.target.closest('.sb-row[data-kind="file"]'); if (!b) return;
    const node = findNode(b.dataset.path); if (!node) return;
    e.preventDefault();
    const items = [];
    if (TEXT_EXTS.has(extOf(node.n)) || node.n.endsWith('.diagram.json')) items.push('Open');
    if (rootDirHandle && typeof node.handle.createWritable === 'function') items.push('Rename', 'Duplicate', 'Delete');
    if (rootDirHandle && extOf(node.n) === 'tex' && node.path !== mainPath) items.push('-', 'Set as main file');
    const at = { getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY - 2, bottom: e.clientY - 2 }), classList: { add() {}, remove() {}, contains() {} }, setAttribute() {} };
    menu(at, items, (l) => {
      if (l === 'Open') {
        if (node.path === activePath) openFileNode(node);
        else guardDirty(() => openFileNode(node));
      }
      else if (l === 'Rename') renameFile(node);
      else if (l === 'Duplicate') duplicateFile(node);
      else if (l === 'Delete') deleteFile(node);
      else if (l === 'Set as main file' || l === 'Set as Main') {
        setMain(node);
        toast('“' + node.n + '” is now the main file');
      }
    });
  });

  /* ---- compile bundle: the main file plus everything it (transitively) references, with unsaved edits ---- */
  const REF_RE = /\\(input|include|InputIfFileExists|includegraphics|bibliography|addbibresource|lstinputlisting|usepackage|documentclass)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  const IMG_EXTS = ['', '.pdf', '.png', '.jpg', '.jpeg'];
  function refCandidates(cmd, arg) {                                  // project-relative paths a reference could mean (TeX resolves against the project root)
    const out = [];
    const names = /^(bibliography|usepackage)$/.test(cmd) ? arg.split(',') : [arg];
    names.forEach((raw) => {
      const n = raw.trim().replace(/^"(.*)"$/, '$1').replace(/^\.\//, '');
      if (!n || /[\\#$~]|\.\.|^\/|:/.test(n)) return;
      if (/^(input|include|InputIfFileExists)$/.test(cmd)) out.push(n, n + '.tex');
      else if (cmd === 'includegraphics') IMG_EXTS.forEach((x) => out.push(n + x));
      else if (cmd === 'bibliography') out.push(n + '.bib', n);
      else if (cmd === 'usepackage') out.push(n + '.sty');
      else if (cmd === 'documentclass') out.push(n + '.cls');
      else out.push(n);
    });
    return out;
  }
  const toB64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  async function buildCompileBundle(mainRel) {
    const files = [], seen = new Set(), queue = [mainRel], LIMIT = 30 * 1024 * 1024;
    let bytes = 0;
    while (queue.length) {
      const rel = queue.pop(); if (seen.has(rel)) continue; seen.add(rel);
      const fh = await handleByRel(rel);
      if (!fh) { if (rel === mainRel) throw new Error('The main file “' + rel + '” could not be found on disk.'); continue; }
      const key = rootDirHandle.name + '/' + rel, ext = extOf(rel);
      if (TEXT_EXTS.has(ext)) {
        let text = key === activePath ? ctx.SRC : fileCache.get(key);     // unsaved edits win over what's on disk
        if (text === undefined) text = await (await fh.getFile()).text();
        bytes += text.length; files.push({ path: rel, text });
        if (ext === 'tex' || ext === 'sty' || ext === 'cls') {
          const clean = text.replace(/(^|[^\\])%.*$/gm, '$1');
          for (const m of clean.matchAll(REF_RE)) {
            for (const c of refCandidates(m[1], m[2])) { if (await handleByRel(c)) { queue.push(c); break; } }
          }
        }
      } else {
        const buf = await (await fh.getFile()).arrayBuffer();
        bytes += buf.byteLength; files.push({ path: rel, b64: toB64(buf) });
      }
      if (bytes > LIMIT) throw new Error('The referenced files are too large to send to the compiler (over 30 MB).');
    }
    return { main: mainRel, files };
  }
  async function compilePayload() {                                   // null = nothing to compile (a toast has been shown)
    let p;
    if (!rootDirHandle) p = { source: ctx.SRC };                          // no project folder open: compile the single document as before
    else if (!mainPath) { toast('No main file: right-click a .tex file and choose Set as Main'); return null; }
    else p = await buildCompileBundle(relPath(mainPath));
    if (p) p.compiler = ctx.PREFS.compiler;                               // Default Compiler: the server uses it only when the main file has no `% !TEX program` line
    return p;
  }
  function renderTree(nodes, depth, out) {
    nodes.forEach((n) => {
      if (n.t === 'folder') {
        out.push(`<button class="sb-row" data-kind="folder" data-path="${esc(n.path)}" aria-expanded="${!!n.open}" style="padding-left:${8 + depth * 14}px">${ic('chevron-right', 'ic--chev')}${ic('folder-open')}<span>${esc(n.n)}</span></button>`);
        if (n.open && n.c) renderTree(n.c, depth + 1, out);
      } else {
        const ext = (n.n.split('.').pop() || '').toLowerCase();
        const icon = n.n.endsWith('.diagram.json') ? 'braces' : (FILE_ICON[ext] || 'file-text');
        out.push(`<button class="sb-row${n.path === (viewPath || activePath) ? ' is-active' : ''}${n.path === mainPath ? ' is-main' : ''}" data-kind="file" data-path="${esc(n.path)}" style="padding-left:${8 + depth * 14 + 15}px">${ic(icon)}<span>${esc(n.n)}</span>${n.path === mainPath ? '<span class="sb-main" title="Main file: Compile builds this file">MAIN</span>' : ''}</button>`);
      }
    });
  }
  function renderExplorerEmpty() {
    if (!FS_SUPPORTED) return '<div class="sb-empty">Opening local folders isn’t supported in this browser.<br>Try Chrome or Edge.</div>';
    if (pendingHandleName) return `<div class="sb-empty">Previously opened <b>${esc(pendingHandleName)}</b>.<br><button class="btn btn--sm" id="sbReconnectBtn" style="margin-top:8px">${ic('plug-zap')}Reconnect</button></div>`;
    return `<div class="sb-empty">No project is open yet.<br><button class="btn btn--sm" id="sbOpenFolderBtn" style="margin-top:8px">${ic('folder-open')}Open Folder…</button></div>`;
  }
  function renderExplorer() {
    const out = []; if (PROJECT.length) renderTree(PROJECT, 0, out);
    $('#sbExplorerBody').innerHTML = out.length ? out.join('') : renderExplorerEmpty();
    paint($('#sbExplorerBody'));
  }
  $('#sbExplorerBody').addEventListener('click', (e) => {
    if (e.target.closest('#sbOpenFolderBtn')) return openProjectFolder();
    if (e.target.closest('#sbReconnectBtn')) return reconnectProject();
    const b = e.target.closest('.sb-row'); if (!b) return;
    const node = findNode(b.dataset.path);
    if (!node) return;
    if (b.dataset.kind === 'folder') toggleFolder(node);
    else openFileNode(node);
  });

  RPE.explorer = {
    syncPdfName, renameProjectFolder,
    get rootDirHandle() { return rootDirHandle; },
    set rootDirHandle(v) { rootDirHandle = v; },
    ensureWrite, existsIn, handleByRel,
    get PROJECT() { return PROJECT; },
    set PROJECT(v) { PROJECT = v; },
    refreshDir, findNode, renderExplorer, listDir,
    get fileCache() { return fileCache; },
    set fileCache(v) { fileCache = v; },
    get activePath() { return viewPath || activePath; },
    set activePath(v) { activePath = v; },
    get mainPath() { return mainPath; },
    set mainPath(v) { mainPath = v; },
    get PROJ_NAME() { return PROJ_NAME; },
    set PROJ_NAME(v) { PROJ_NAME = v; },
    saveActiveFile,
    compilePayload, openProjectFolder, openFile, saveDoc, saveAs, docDirty, guardDirty,
    syncSaveState, newDocument, newFromTemplate, createFromTemplate,
    openFileNode, openViewer, recentAdd, recentPanel, recentRemove, renderWelcomeRecents,
    showWelcome, hideWelcome, reopenRecent, restoreProject, checkDraftRecovery,
    checkExternalFsChanges, docClassGallery, syncDocClass, tplGallery, tplMenu, resetTemplate,
    exitApp, saveExport, scanAllTexNodes, toB64, extOf, relPath, TEXT_EXTS,
    syncTitle, syncSaveSoon, recentClick
  };
})(window.RPE = window.RPE || {});