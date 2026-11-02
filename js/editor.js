/* editor.js: Laurevine Plum character & paragraph formatting, dialogs, comments, track changes & find.
   Exposes window.RPE.editor. */
(function (RPE) {
  'use strict';

  const {
    $, $$, esc, ic, h, paint, toast, clearToasts, menu, closePop, dlg, str,
    F, G, texEsc, tocMask, setupCustomSelect, closeCustomMenu, colorPanel,
    HF_FMT, HF_POS, HF_TY, PD_COL, noDoc
  } = RPE.ui;

  const ctx = new Proxy({}, {
    get: (_, k) => (RPE.ctx || {})[k] || (RPE.explorer || {})[k] || window[k],
    set: (_, k, v) => { if (RPE.ctx) RPE.ctx[k] = v; return true; }
  });

  const close = (s, i) => { let d = 0; for (let j = i; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && !--d) return j; } return s.length; };
  const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const HAS_HL = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';

  // Live bridges to editor state in app.js
  const lineOf = (p) => ctx.lineOf(p);
  const indexSrc = () => ctx.indexSrc();
  const histKey = () => ctx.histKey();
  const historyRecord = (...a) => ctx.historyRecord(...a);
  const goToLine = (...a) => ctx.goToLine(...a);
  const setCurLine = (...a) => ctx.setCurLine(...a);
  const renderCode = () => ctx.renderCode();
  const ensureWindow = (f) => ctx.ensureWindow(f);
  const syncSaveSoon = () => ctx.syncSaveSoon();
  const runCompile = (...a) => ctx.runCompile(...a);
  const openFileNode = (...a) => ctx.openFileNode(...a);

  // Bridges to explorer
  const refreshDir = (...a) => ctx.refreshDir(...a);
  const findNode = (...a) => ctx.findNode(...a);
  const renderExplorer = (...a) => ctx.renderExplorer(...a);
  const ensureWrite = (...a) => ctx.ensureWrite(...a);
  const existsIn = (...a) => ctx.existsIn(...a);
  const scanAllTexNodes = (...a) => ctx.scanAllTexNodes(...a);

  // Bridges to ribbon/style constants
  const D = new Proxy({}, { get: (_, k) => (ctx.D || {})[k] });
  const COLORMAP = new Proxy({}, { get: (_, k) => (ctx.COLORMAP || {})[k] });
  const HD_STYLES = new Proxy({}, { get: (_, k) => (ctx.HD_STYLES || {})[k] });
  const HD_NUMS = new Proxy([], { get: (_, k) => (ctx.HD_NUMS || [])[k] });
  const HD_SPACE = new Proxy([], { get: (_, k) => (ctx.HD_SPACE || [])[k] });
  const SECM = new Proxy([], { get: (_, k) => (ctx.SECM || [])[k] });
  const STYLES = new Proxy([], { get: (_, k) => (ctx.STYLES || [])[k] });
  let curStyle = 'normal';

  /* ---------- character formatting engine: toggles \textbf / \textit / \textsubscript / \textsuperscript around the
     textarea selection. Edits go through execCommand('insertText') so the browser's native undo stack keeps working.
     (FMT above is only the syntax-highlight class map, so it is left alone.) ---------- */
  const balanced = (t) => { let d = 0; for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === '\\') i++; else if (c === '{') d++; else if (c === '}' && --d < 0) return false; } return d === 0; };
  /* One opening pattern for every wrapper the engine understands: \textbf{ \textit{ \emph{ \underline{ \sout{ \textsubscript{ \textsuperscript{
     \textcolor[HTML]{RRGGBB}{ (or \textcolor{Name}{)  and  {\sethlcolor{name}\hl{  (soul highlight, closes with "}}"). */
  const OPEN = String.raw`(?:\\(textbf|textit|emph|underline|sout|textsubscript|textsuperscript)\{|\\(textcolor)(?:\[HTML\])?\{([^{}]+)\}\{|(\{)\\sethlcolor\{(\w+)\}\\hl\{|(\{)\\fontspec\{([^{}]+)\})`;
  const OPEN_HEAD = new RegExp('^' + OPEN), OPEN_TAIL = new RegExp(OPEN + '$');
  const wrapInfo = (m) => ({ name: m[1] || (m[2] ? 'textcolor' : m[4] ? 'hl' : 'font'), val: m[3] || m[5] || m[7] || '', cl: m[4] ? 2 : 1, g: !!m[6] });   // g: font group, its brace is at the match start
  function fmtLayers(t, s, e) {   // -> { s, e: innermost range, L: enclosing format wrappers, innermost first }
    for (;;) {   // selection that is itself exactly one wrapper: step inside it
      const m = OPEN_HEAD.exec(t.slice(s, e)); if (!m) break;
      const w = wrapInfo(m), o = s + m[0].length;
      if (close(t, w.g ? s : o - 1) !== e - w.cl || (w.cl === 2 && t[e - 1] !== '}')) break;
      s = o; e -= w.cl;
    }
    const L = []; let a = s, b = e;
    for (;;) {   // wrappers directly around the range
      const m = OPEN_TAIL.exec(t.slice(Math.max(0, a - 80), a)); if (!m) break;
      const w = wrapInfo(m);
      if (t.slice(b, b + w.cl) !== '}'.repeat(w.cl)) break;
      L.push({ ...w, os: a - m[0].length, oe: a, ce: b + w.cl }); a -= m[0].length; b += w.cl;
    }
    return { s, e, L };
  }
  /* Shared preamble helper: ensures each package is loaded, adding only what is missing (after the last \usepackage line,
     before \begin{document}). Returns { pos, str } to insert, null if nothing is missing, or false if it can't be done safely. */
  function ensurePackage(t, ...specs) {   // scans only the preamble of the comment/verbatim-masked text, so a \usepackage after \begin{document} (a code sample, a stray line) can't make it fail
    const mk = tocMask(t), body = mk.indexOf('\\begin{document}'); if (body < 0) return false;
    const pre = mk.slice(0, body), have = new Set(); let last = -1, m; const re = /^[ \t]*\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/gm;
    while ((m = re.exec(pre))) { m[1].split(',').forEach((n) => have.add(n.trim())); last = m.index + m[0].length; }
    const add = specs.map((x) => [].concat(x)).filter(([n]) => !have.has(n)); if (!add.length) return null;
    if (last < 0) { const d = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/m.exec(pre); if (!d) return false; last = d.index + d[0].length; }
    return { pos: last, str: add.map(([n, o]) => '\n\\usepackage' + (o ? '[' + o + ']' : '') + '{' + n + '}').join('') };
  }
  function fmtEdit(ta, a, b, str, selA, selB) {
    if (noDoc()) return;
    if (str.length > 2000 && str.split('\n').length > 40) {   // big multi-line text: execCommand fires one input event per line (each re-rendering the editor and pushing an undo step), so replace the range once and fire a single input event
      ta.dispatchEvent(new Event('beforeinput')); ta.focus(); ta.setSelectionRange(a, b);
      ta.setRangeText(str, a, b, 'end'); ta.dispatchEvent(new Event('input'));
      ta.setSelectionRange(selA, selB); return;
    }
    historyRecord(ta.value, ta.selectionStart, ta.selectionEnd, false);
    ta.focus(); ta.setSelectionRange(a, b);
    if (!document.execCommand('insertText', false, str)) { ta.setRangeText(str, a, b, 'end'); ta.dispatchEvent(new Event('input')); }
    ta.setSelectionRange(selA, selB);
  }
  /* Theme colors (Design ▸ Colors). Role-based names in the preamble: lpAccent, lpBody, lpChapter, lpSection, lpSubsection,
     lpSubsubsection. A definition that already exists is updated in place; missing roles are added in one block before
     \begin{document} (xcolor/sectsty via ensurePackage). Other \definecolor names, \titleformat, TikZ and figure colors are left alone. */
  const THEME_ROLES = { accent: 'lpAccent', body: 'lpBody', chapter: 'lpChapter', section: 'lpSection', subsection: 'lpSubsection', subsubsection: 'lpSubsubsection' };
  const THEME_HEAD = ['chapter', 'section', 'subsection', 'subsubsection'];

  function hexToRgb(h) {
    if (!h || typeof h !== 'string') return [0, 0, 0];
    let s = h.trim().replace(/^#/, '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    if (s.length !== 6) return [0, 0, 0];
    const n = parseInt(s, 16);
    return isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    const toH = (c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0').toUpperCase();
    return '#' + toH(r) + toH(g) + toH(b);
  }
  function tintColor(hex, factor) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor);
  }
  function shadeColor(hex, factor) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r * (1 - factor), g * (1 - factor), b * (1 - factor));
  }
  function themeMatrix(pal) {
    pal = pal || getActivePalette();
    const neutrals = pal.neutrals || ['#FFFFFF', '#000000', '#EEECE1', '#3D353A'];
    const accents = pal.accents || ['#702D3B', '#2F6F8F', '#C28B3C', '#5E8C61', '#A65C68', '#6B5B95'];
    const baseCols = [
      { name: 'White, Background 1', color: neutrals[0] },
      { name: 'Black, Text 1', color: neutrals[1] },
      { name: 'Background 2', color: neutrals[2] },
      { name: 'Text 2', color: neutrals[3] },
      { name: 'Accent 1', color: accents[0] },
      { name: 'Accent 2', color: accents[1] },
      { name: 'Accent 3', color: accents[2] },
      { name: 'Accent 4', color: accents[3] },
      { name: 'Accent 5', color: accents[4] },
      { name: 'Accent 6', color: accents[5] }
    ];
    const shades = [];
    for (let r = 0; r < 5; r++) {
      const row = [];
      for (let c = 0; c < 10; c++) {
        const base = baseCols[c].color, colName = baseCols[c].name;
        let color = base, label = '';
        if (c === 0) {
          const f = [0.05, 0.15, 0.25, 0.35, 0.50][r], pct = [5, 15, 25, 35, 50][r];
          color = shadeColor(base, f); label = `${colName}, Darker ${pct}%`;
        } else if (c === 1) {
          const f = [0.50, 0.35, 0.25, 0.15, 0.05][r], pct = [50, 35, 25, 15, 5][r];
          color = tintColor(base, f); label = `${colName}, Lighter ${pct}%`;
        } else if (c === 2) {
          const f = [0.10, 0.25, 0.50, 0.75, 0.90][r], pct = [10, 25, 50, 75, 90][r];
          color = shadeColor(base, f); label = `${colName}, Darker ${pct}%`;
        } else {
          if (r === 0) { color = tintColor(base, 0.80); label = `${colName}, Lighter 80%`; }
          else if (r === 1) { color = tintColor(base, 0.60); label = `${colName}, Lighter 60%`; }
          else if (r === 2) { color = tintColor(base, 0.40); label = `${colName}, Lighter 40%`; }
          else if (r === 3) { color = shadeColor(base, 0.25); label = `${colName}, Darker 25%`; }
          else { color = shadeColor(base, 0.50); label = `${colName}, Darker 50%`; }
        }
        row.push({ name: label, color });
      }
      shades.push(row);
    }
    return { base: baseCols, shades };
  }

  const PALETTES = {
    // Built-in
    office: { id: 'office', name: 'Office', neutrals: ['#FFFFFF', '#000000', '#E7E6E6', '#44546A'], accents: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'], swatches: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'], latex: { accent: '4472C4', body: '262626', chapter: '255B98', section: '4472C4', subsection: '5B9BD5', subsubsection: '70AD47' } },
    burgundy: { id: 'burgundy', name: 'Burgundy Lab', neutrals: ['#FFFFFF', '#000000', '#EEECE1', '#3D353A'], accents: ['#702D3B', '#2F6F8F', '#C28B3C', '#5E8C61', '#A65C68', '#6B5B95'], swatches: ['#702D3B', '#2F6F8F', '#C28B3C', '#5E8C61', '#A65C68', '#6B5B95'], latex: { accent: '702D3B', body: '292A2D', chapter: '702D3B', section: '702D3B', subsection: 'A65C68', subsubsection: '6B5B95' } },
    okabe: { id: 'okabe', name: 'Okabe–Ito (colour-blind safe)', neutrals: ['#FFFFFF', '#000000', '#E7ECEF', '#1F3A4D'], accents: ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#56B4E9', '#CC79A7'], swatches: ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#56B4E9', '#CC79A7'], latex: { accent: '0072B2', body: '25303A', chapter: '0072B2', section: '0072B2', subsection: '56B4E9', subsubsection: 'CC79A7' } },
    viridis: { id: 'viridis', name: 'Viridis', neutrals: ['#FFFFFF', '#000000', '#EAEAEA', '#333333'], accents: ['#440154', '#414487', '#2A788E', '#22A884', '#7AD151', '#FDE725'], swatches: ['#440154', '#414487', '#2A788E', '#22A884', '#7AD151', '#FDE725'], latex: { accent: '440154', body: '222222', chapter: '440154', section: '414487', subsection: '2A788E', subsubsection: '22A884' } },
    grayscale: { id: 'grayscale', name: 'Print grayscale', neutrals: ['#FFFFFF', '#000000', '#E8E8E8', '#333333'], accents: ['#1A1A1A', '#3A3A3A', '#5A5A5A', '#7A7A7A', '#A0A0A0', '#C5C5C5'], swatches: ['#1A1A1A', '#3A3A3A', '#5A5A5A', '#7A7A7A', '#A0A0A0', '#C5C5C5'], latex: { accent: '333333', body: '222222', chapter: '111111', section: '333333', subsection: '5A5A5A', subsubsection: '7A7A7A' } },

    // Template palettes
    'clinical-blue': { id: 'clinical-blue', name: 'Clinical Blue', neutrals: ['#FFFFFF', '#152A43', '#EAF1F7', '#B5C3D0'], accents: ['#1D5FA7', '#147481', '#C05621', '#6C97C6', '#66A5AD', '#16477D'], swatches: ['#FFFFFF', '#EAF1F7', '#152A43', '#1D5FA7', '#147481', '#C05621'], latex: { accent: '1D5FA7', body: '152A43', chapter: '152A43', section: '1D5FA7', subsection: '147481', subsubsection: '6C97C6' } },
    'editorial-review': { id: 'editorial-review', name: 'Editorial Review', neutrals: ['#F7F3EB', '#2B241E', '#E8DFD0', '#D0C3B1'], accents: ['#8A3F2B', '#496357', '#B38275', '#899A92', '#682F20', '#374A41'], swatches: ['#F7F3EB', '#E8DFD0', '#2B241E', '#8A3F2B', '#496357', '#B38275'], latex: { accent: '8A3F2B', body: '2B241E', chapter: '8A3F2B', section: '8A3F2B', subsection: '496357', subsubsection: 'B38275' } },
    'field-biology': { id: 'field-biology', name: 'Field Biology', neutrals: ['#F4F6EF', '#1D2E23', '#D5E0D0', '#AAB9A5'], accents: ['#2C6849', '#8B611F', '#769D89', '#B4986D', '#214E37', '#684917'], swatches: ['#F4F6EF', '#D5E0D0', '#1D2E23', '#2C6849', '#8B611F', '#769D89'], latex: { accent: '2C6849', body: '1D2E23', chapter: '2C6849', section: '2C6849', subsection: '8B611F', subsubsection: '769D89' } },
    'molecular-translational': { id: 'molecular-translational', name: 'Molecular & Translational', neutrals: ['#F5FAFC', '#132A3A', '#DCEFF0', '#9BC6C9'], accents: ['#006C73', '#375AA6', '#C00000', '#599FA4', '#7D94C5', '#005156'], swatches: ['#F5FAFC', '#DCEFF0', '#132A3A', '#006C73', '#375AA6', '#C00000'], latex: { accent: '006C73', body: '132A3A', chapter: '006C73', section: '006C73', subsection: '375AA6', subsubsection: '599FA4' } },
    'hematology-oncology': { id: 'hematology-oncology', name: 'Hematology & Oncology', neutrals: ['#FCF5F6', '#321C25', '#F0DDE1', '#D8BAC2'], accents: ['#7A233A', '#9A4D5B', '#A9707F', '#BD8B94', '#5C1A2C', '#743A44'], swatches: ['#FCF5F6', '#F0DDE1', '#321C25', '#7A233A', '#9A4D5B', '#A9707F'], latex: { accent: '7A233A', body: '321C25', chapter: '7A233A', section: '7A233A', subsection: '9A4D5B', subsubsection: 'A9707F' } },
    'data-methods': { id: 'data-methods', name: 'Data & Methods', neutrals: ['#FFFFFF', '#222A30', '#EEF2F5', '#C8D1DA'], accents: ['#174C8C', '#B84A2B', '#688BB4', '#D18975', '#113969', '#8A3820'], swatches: ['#FFFFFF', '#EEF2F5', '#222A30', '#174C8C', '#B84A2B', '#688BB4'], latex: { accent: '174C8C', body: '222A30', chapter: '174C8C', section: '174C8C', subsection: 'B84A2B', subsubsection: '688BB4' } },
    'population-health': { id: 'population-health', name: 'Population Health', neutrals: ['#F4F8F8', '#1D3038', '#D8E6E5', '#BCCFCF'], accents: ['#00665E', '#92520A', '#599C96', '#B88F60', '#004D47', '#6E3E08'], swatches: ['#F4F8F8', '#D8E6E5', '#1D3038', '#00665E', '#92520A', '#599C96'], latex: { accent: '00665E', body: '1D3038', chapter: '00665E', section: '00665E', subsection: '92520A', subsubsection: '599C96' } },
    'computational-biology': { id: 'computational-biology', name: 'Computational Biology', neutrals: ['#F7F8FC', '#1D2345', '#E6E8F5', '#C8CDEA'], accents: ['#6258A4', '#007C91', '#9992C4', '#59AAB8', '#4A427B', '#005D6D'], swatches: ['#F7F8FC', '#E6E8F5', '#1D2345', '#6258A4', '#007C91', '#9992C4'], latex: { accent: '6258A4', body: '1D2345', chapter: '6258A4', section: '6258A4', subsection: '007C91', subsubsection: '9992C4' } },
    'dark-auditorium': { id: 'dark-auditorium', name: 'Dark Auditorium', neutrals: ['#142033', '#F5F7FA', '#25354D', '#50647D'], accents: ['#72D5C9', '#9BB9FF', '#0284C7', '#B45309', '#A3E4DC', '#BED2FF'], swatches: ['#142033', '#25354D', '#F5F7FA', '#72D5C9', '#9BB9FF', '#0284C7'], latex: { accent: '72D5C9', body: 'F5F7FA', chapter: '72D5C9', section: '72D5C9', subsection: '9BB9FF', subsubsection: '0284C7' } },
    'swiss-minimal': { id: 'swiss-minimal', name: 'Swiss Scientific Minimal', neutrals: ['#FFFFFF', '#171C22', '#E9EBEE', '#C6CBD1'], accents: ['#B33D2E', '#1D5FA7', '#CE8177', '#6C97C6', '#862E23', '#16477D'], swatches: ['#FFFFFF', '#E9EBEE', '#171C22', '#B33D2E', '#1D5FA7', '#CE8177'], latex: { accent: 'B33D2E', body: '171C22', chapter: 'B33D2E', section: 'B33D2E', subsection: '1D5FA7', subsubsection: 'CE8177' } }
  };
  PALETTES['Indigo Academic'] = PALETTES.burgundy;
  PALETTES['Charcoal'] = PALETTES.grayscale;
  PALETTES['Forest'] = PALETTES['field-biology'];

  let activePaletteId = 'burgundy';
  try { const sp = localStorage.getItem('lplum.activePalette'); if (sp && PALETTES[sp]) activePaletteId = sp; } catch (e) {}
  const getActivePalette = () => PALETTES[activePaletteId] || PALETTES.burgundy;
  const setActivePalette = (id) => {
    if (PALETTES[id]) {
      activePaletteId = id;
      try { localStorage.setItem('lplum.activePalette', id); } catch (e) {}
    }
  };

  const themeWant = (role, hex) => role === 'heading' ? Object.fromEntries(THEME_HEAD.map((r) => [r, hex])) : { [role]: hex };
  const themeMenu = (role) => (l) => {
    const nm = l.replace(/^●\s*/, '');
    if (role === 'theme') {
      const p = PALETTES[nm] || Object.values(PALETTES).find((x) => x.name === nm);
      if (p) { setActivePalette(p.id); return themeApply(p.latex || p); }
      return toast(l + ': no such palette');
    }
    if (COLORMAP[nm]) themeApply(themeWant(role, COLORMAP[nm].slice(1).toUpperCase()));
  };
  function themeApply(want) {
    const ta = $('#codeInput'); if (!ta) return;
    const old = ta.value, bd = old.indexOf('\\begin{document}'), cls = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/m.exec(old);
    if (bd < 0 || !cls) return toast('Theme colors need a \\documentclass and \\begin{document}. Nothing was changed');
    if (/^(letter|beamer)$/.test(cls[1])) return toast('Theme colors are not supported for the ' + cls[1] + ' class');
    const hasCh = /^(report|book|memoir|scrreprt|scrbook|ctexrep|ctexbook)$/.test(cls[1]), lines = [], pkgs = ['xcolor'], notes = [];
    let pre = old.slice(0, bd);
    for (const [role, hex] of Object.entries(want)) {
      const nm = THEME_ROLES[role]; if (role === 'chapter' && !hasCh) continue;   // no \chapter in this class
      const re = new RegExp('\\\\definecolor\\{' + nm + '\\}\\{[^}]*\\}\\{[^}]*\\}'), def = '\\definecolor{' + nm + '}{HTML}{' + hex + '}';
      if (re.test(pre)) { pre = pre.replace(re, () => def); continue; }
      lines.push(def);
      if (role === 'body') { if (!/\\AtBeginDocument\{\\color\{lpBody\}\}/.test(pre)) lines.push('\\AtBeginDocument{\\color{lpBody}}'); }
      else if (role === 'accent') { if (/\\usepackage(?:\[[^\]]*\])?\{[^}]*\bhyperref\b/.test(pre) && !/\\hypersetup\{[^}]*lpAccent/.test(pre)) lines.push('\\hypersetup{colorlinks=true,linkcolor=lpAccent,citecolor=lpAccent,urlcolor=lpAccent}'); }
      else {
        const fn = role + 'font';
        const sm = sectRe(fn).exec(pre);
        if (sm && sectOurs(sm[1])) { if (!/\\color/.test(sm[1])) pre = pre.replace(sm[0], () => '\\' + fn + '{' + sectBuild({ ...sectParse(sm[1]), c: '\\color{' + nm + '}' }) + '}'); }   // our heading-font line: add the colour to it
        else if (new RegExp('\\\\' + fn + '\\s*\\{').test(pre)) notes.push(role + ' already has your own \\' + fn);
        else { lines.push('\\' + fn + '{\\color{' + nm + '}}'); if (!pkgs.includes('sectsty')) pkgs.push('sectsty'); }
      }
    }
    if (lines.length) { if (!pre.endsWith('\n')) pre += '\n'; pre += (/% ---- Theme colors ----/.test(pre) ? '' : '% ---- Theme colors ----\n') + lines.join('\n') + '\n\n'; }
    let nt = pre + old.slice(bd);
    if (lines.length) { const pk = ensurePackage(nt, ...pkgs); if (pk === false) return toast('Could not add xcolor/sectsty. Check the \\documentclass / preamble'); if (pk) nt = nt.slice(0, pk.pos) + pk.str + nt.slice(pk.pos); }
    if (nt === old) return toast('Theme colors already up to date');
    let a = 0; const n = Math.min(old.length, nt.length); while (a < n && old[a] === nt[a]) a++;
    let e1 = old.length, e2 = nt.length; while (e1 > a && e2 > a && old[e1 - 1] === nt[e2 - 1]) { e1--; e2--; }
    const d = nt.length - old.length, mp = (q) => q <= a ? q : q >= e1 ? q + d : a;
    fmtEdit(ta, a, e1, nt.slice(a, e2), mp(ta.selectionStart), mp(ta.selectionEnd));   // one edit = one undo step, selection kept
    if (/\\definecolor\{(?!lp(?:Accent|Body|Chapter|Section|Subsection|Subsubsection)\})/.test(old.slice(0, bd))) notes.push('other color definitions left untouched');
    toast('Theme colors applied' + (notes.length ? ': ' + notes.join('; ') : ''));
  }
  /* Design ▸ Fonts: Body / Heading / Display roles (fontspec, XeLaTeX/LuaLaTeX only). Body = \setmainfont; Heading =
     \newfontfamily\lpHeadingFont, applied to \chapter…\subsubsection via sectsty (\sectionfont{\lpHeadingFont…}, shared with the
     Theme Colors line); Display = \newfontfamily\lpDisplayFont, a named command to use as {\lpDisplayFont …}. Existing definitions
     are updated in place, missing ones added once in a "Fonts" block before \begin{document}; fontspec/sectsty via ensurePackage.
     Names are checked against /api/fonts (fontOK, same registry as the Home font box). Other font commands are left alone. */
  const FONT_ROLES = { body: '\\setmainfont', heading: '\\newfontfamily\\lpHeadingFont', display: '\\newfontfamily\\lpDisplayFont' };
  const sectRe = (fn) => new RegExp('\\\\' + fn + '\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}');
  const sectOurs = (c) => /^\s*(?:\\lpHeadStyle)?\s*(?:\\lpHeadingFont)?\s*(?:\\color\{lp\w+\})?\s*(?:\\sectionrule\{[^{}]*\}\{[^{}]*\}\{[^{}]*\}\{[^{}]*\})?\s*$/.test(c);
  const needsXeTeX = (t) => (/^[ \t]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:inputenc|fontenc)\b/m.test(t) && !/fontspec/.test(t)) || /^%\s*!TEX\s+(?:TS-)?program\s*=\s*pdflatex/im.test(t);
  function docDiffEdit(ta, old, nt) {   // one edit = one undo step, selection kept
    let a = 0; const n = Math.min(old.length, nt.length); while (a < n && old[a] === nt[a]) a++;
    let e1 = old.length, e2 = nt.length; while (e1 > a && e2 > a && old[e1 - 1] === nt[e2 - 1]) { e1--; e2--; }
    const d = nt.length - old.length, mp = (q) => q <= a ? q : q >= e1 ? q + d : a;
    fmtEdit(ta, a, e1, nt.slice(a, e2), mp(ta.selectionStart), mp(ta.selectionEnd));
  }
  function toggleLineComment() {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const ls = t.lastIndexOf('\n', s - 1) + 1;
    let le = t.indexOf('\n', e); if (le < 0) le = t.length;
    const block = t.slice(ls, le), lines = block.split('\n');
    const allC = lines.every((l) => !l.trim() || /^\s*%/.test(l));
    const next = lines.map((l) => allC ? l.replace(/^(\s*)% ?/, '$1') : (/^\s*$/.test(l) ? l : '% ' + l)).join('\n');
    docDiffEdit(ta, t, t.slice(0, ls) + next + t.slice(le));
  }
  async function fontRole(role, name) {
    const ta = $('#codeInput'); name = (name || '').trim(); if (!ta || !name || name === '-' || name[0] === '@') return;
    if (!/^[\p{L}\p{N} .+-]+$/u.test(name)) return toast('Unsupported font name');
    const ok = await fontOK(name); if (ok === null) return;
    if (!ok) return toast('Font “' + name + '” isn’t available to XeLaTeX: not applied');
    const old = ta.value, bd = old.indexOf('\\begin{document}'), cls = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/m.exec(old);
    if (bd < 0 || !cls) return toast('Fonts need a \\documentclass and \\begin{document}. Nothing was changed');
    if (needsXeTeX(old)) return toast('Design fonts use fontspec, which needs XeLaTeX or LuaLaTeX. This document is set up for pdfLaTeX (inputenc/fontenc or a pdflatex program line). Nothing was changed');
    const hasCh = /^(report|book|memoir|scrreprt|scrbook|ctexrep|ctexbook)$/.test(cls[1]), lines = [], notes = [], pkgs = ['fontspec'], cmd = FONT_ROLES[role], R = role[0].toUpperCase() + role.slice(1);
    let pre = old.slice(0, bd);
    const re = new RegExp('^([ \\t]*)' + cmd.replace(/\\/g, '\\\\') + '(?![a-zA-Z])(\\[[^\\]]*\\])?\\{[^{}]*\\}', 'm');
    if (re.test(pre)) pre = pre.replace(re, (a, i, o) => i + cmd + (o || '') + '{' + name + '}'); else lines.push(cmd + '{' + name + '}');
    if (role === 'heading') {
      if (/^(letter|beamer)$/.test(cls[1])) notes.push('not applied to headings in the ' + cls[1] + ' class');
      else for (const r of THEME_HEAD) {
        if (r === 'chapter' && !hasCh) continue;
        const fn = r + 'font', m = sectRe(fn).exec(pre);
        if (!m) { lines.push('\\' + fn + '{\\lpHeadingFont}'); if (!pkgs.includes('sectsty')) pkgs.push('sectsty'); }
        else if (sectOurs(m[1])) pre = pre.replace(m[0], () => '\\' + fn + '{' + sectBuild({ ...sectParse(m[1]), f: true }) + '}');
        else notes.push(r + ' has your own \\' + fn + ' (left alone)');
      }
    }
    if (lines.length) { if (!pre.endsWith('\n')) pre += '\n'; pre += (/% ---- Fonts ----/.test(pre) ? '' : '% ---- Fonts ----\n') + lines.join('\n') + '\n\n'; }
    let nt = pre + old.slice(bd);
    if (lines.length) { const pk = ensurePackage(nt, ...pkgs); if (pk === false) return toast('Could not add fontspec/sectsty. Check the \\documentclass / preamble'); if (pk) nt = nt.slice(0, pk.pos) + pk.str + nt.slice(pk.pos); }
    if (nt === old) return toast(R + ' font already set to ' + name + (notes.length ? ': ' + notes.join('; ') : ''));
    docDiffEdit(ta, old, nt);
    if (role === 'display') notes.push('use {\\lpDisplayFont …} where you want it');
    syncFmtBtns();
    toast(R + ' font set to ' + name + (notes.length ? ': ' + notes.join('; ') : ''));
  }
  /* Design ▸ Heading Design (also reached by right-click ▸ Edit on a Home ▸ Styles heading). One managed block
     "% ---- Heading design ----" before \begin{document}, regenerated in place on every change (never appended twice):
     \lpHeadStyle (Small caps / Sans-serif; Classic = \relax), numbering (\the<level> or secnumdepth), and spacing
     (a scaling wrapper around \@startsection, standard article/report/book only). \lpHeadStyle and the Rule-below
     \sectionrule are put into the same sectsty \<level>font{…} lines the Fonts/Colors features own (sectParse/sectBuild),
     so there is one heading mechanism. Heading color reuses themeApply. Sans-serif yields to a chosen Heading font. */
  const HD_LEVELS = ['chapter', 'section', 'subsection', 'subsubsection'], HD_CHAP = /^(report|book|memoir|scrreprt|scrbook|ctexrep|ctexbook)$/;
  const HD_RULE = '\\sectionrule{0pt}{0pt}{-5pt}{0.5pt}', HD_RE = /% ---- Heading design ----\n[\s\S]*?% ---- end heading design ----\n/, HD_SP = { Compact: '7/10', Open: '3/2' };
  function sectParse(c) { const f = (r) => (r.exec(c) || [''])[0]; return { s: /\\lpHeadStyle/.test(c), f: /\\lpHeadingFont/.test(c), c: f(/\\color\{lp\w+\}/), r: f(/\\sectionrule\{[^{}]*\}\{[^{}]*\}\{[^{}]*\}\{[^{}]*\}/) }; }
  const sectBuild = (p) => (p.s ? '\\lpHeadStyle' : '') + (p.f ? '\\lpHeadingFont' : '') + (p.c || '') + (p.r || '');
  function headState(t) {   // current design read back from the source
    const bd = t.indexOf('\\begin{document}'), pre = bd < 0 ? t : t.slice(0, bd), b = (HD_RE.exec(pre) || [''])[0], mac = (/\\newcommand\{\\lpHeadStyle\}\{([^}]*)\}/.exec(b) || [, ''])[1], sp = /\\glueexpr\(#4\)\*(\d+)\/(\d+)/.exec(b), col = {};
    const ruled = ['sectionfont', 'subsectionfont'].some((fn) => { const m = sectRe(fn).exec(pre); return m && /\\lpHeadStyle/.test(m[1]) && /\\sectionrule/.test(m[1]); });
    for (const n of HD_LEVELS) { const m = new RegExp('\\\\definecolor\\{' + THEME_ROLES[n] + '\\}\\{HTML\\}\\{([0-9A-Fa-f]{6})\\}').exec(pre); if (m) col[n] = m[1]; }
    return { style: ruled ? 'Rule below' : /scshape/.test(mac) ? 'Small caps' : /sffamily/.test(mac) ? 'Sans-serif' : 'Classic', num: /secnumdepth\}\{-1\}/.test(b) ? HD_NUMS[2] : /\\Roman\{/.test(b) ? HD_NUMS[1] : HD_NUMS[0],
      space: sp ? (+sp[1] < +sp[2] ? 'Compact' : 'Open') : 'Normal', col };
  }
  function styleCss(s, hs) {   // Home ▸ Styles preview follows the real heading design
    if (!hs || !HD_LEVELS.includes(s.id)) return s.css;
    return s.css + (hs.style === 'Small caps' ? ';font-variant:small-caps' : '') + (hs.style === 'Sans-serif' ? ';font-family:var(--font)' : '') + (hs.style === 'Rule below' ? ';border-bottom:1px solid currentColor' : '') + (hs.col[s.id] ? ';color:#' + hs.col[s.id] : '');
  }
  function headingApply(want) {
    const ta = $('#codeInput'); if (!ta) return false;
    const old = ta.value, bd = old.indexOf('\\begin{document}'), cls = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/m.exec(old);
    if (bd < 0 || !cls) return toast('Heading design needs a \\documentclass and \\begin{document}. Nothing was changed'), false;
    const c = cls[1]; if (/^(letter|beamer)$/.test(c)) return toast('Heading design isn’t supported for the ' + c + ' class'), false;
    const hasCh = HD_CHAP.test(c), lv = hasCh ? HD_LEVELS : HD_LEVELS.slice(1), notes = [], s = { ...headState(old), ...want };
    let pre = old.slice(0, bd);
    if (!HD_RE.test(pre) && s.style === 'Classic' && s.num === HD_NUMS[0] && s.space === 'Normal') return toast('Heading design is already the default'), true;
    if (s.space !== 'Normal' && !/^(article|report|book)$/.test(c)) { if (want.space) notes.push('spacing needs the article/report/book class: left unchanged'); s.space = 'Normal'; }
    if (want.num && new RegExp('^(?!\\s*%).*\\\\renewcommand\\{\\\\the(?:' + lv.join('|') + ')\\}', 'm').test(pre.replace(HD_RE, ''))) notes.push('your own \\the… numbering outside the managed block may conflict');
    const rule = s.style === 'Rule below' ? HD_RULE : '', add = [];
    for (const n of lv) {   // one \<level>font line per level, updated in place when it's ours
      const fn = n + 'font', m = sectRe(fn).exec(pre);
      if (!m) add.push('\\' + fn + '{' + sectBuild({ s: true, r: rule }) + '}');
      else if (sectOurs(m[1])) pre = pre.replace(m[0], () => '\\' + fn + '{' + sectBuild({ ...sectParse(m[1]), s: true, r: rule }) + '}');
      else notes.push(n + ' has your own \\' + fn + ' (left alone)');
    }
    if (s.style === 'Sans-serif' && /\\lpHeadingFont/.test(pre)) notes.push('your Heading font takes precedence over sans-serif');
    const B = ['% ---- Heading design ----', '\\newcommand{\\lpHeadStyle}{' + HD_STYLES[s.style] + '}'];
    if (s.num === HD_NUMS[2]) B.push('\\setcounter{secnumdepth}{-1}');
    else if (s.num === HD_NUMS[1]) { const f = ['Roman', 'Alph', 'arabic', 'alph']; lv.forEach((n, i) => B.push('\\renewcommand{\\the' + n + '}{\\' + f[i] + '{' + n + '}}')); }
    if (s.space !== 'Normal') { const r = HD_SP[s.space]; B.push('\\makeatletter', '\\let\\lp@startsection\\@startsection', '\\renewcommand{\\@startsection}[6]{\\lp@startsection{#1}{#2}{#3}{\\glueexpr(#4)*' + r + '\\relax}{\\glueexpr(#5)*' + r + '\\relax}{#6}}', '\\makeatother'); }
    B.push('% ---- end heading design ----');
    const blk = B.join('\n') + '\n' + add.map((l) => l + '\n').join('');
    if (HD_RE.test(pre)) pre = pre.replace(HD_RE, () => blk); else pre += (pre.endsWith('\n') ? '' : '\n') + blk + '\n';
    let nt = pre + old.slice(bd); const pk = ensurePackage(nt, 'sectsty');
    if (pk === false) return toast('Could not add sectsty. Check the \\documentclass / preamble'), false;
    if (pk) nt = nt.slice(0, pk.pos) + pk.str + nt.slice(pk.pos);
    if (nt === old) return toast('Heading design already up to date' + (notes.length ? ': ' + notes.join('; ') : '')), true;
    docDiffEdit(ta, old, nt);
    const pv = $('.rsty-btn__preview'), cur = STYLES.find((x) => x.id === curStyle); if (pv && cur) pv.setAttribute('style', styleCss(cur, headState(nt)));
    toast('Heading design applied' + (notes.length ? ': ' + notes.join('; ') : '')); return true;
  }
  function headingDialog(level) {
    const ta = $('#codeInput'), cls = ta && /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/m.exec(ta.value);
    if (!cls || /^(letter|beamer)$/.test(cls[1])) return toast('Heading design needs a \\documentclass other than letter/beamer');
    const cap = (x) => x[0].toUpperCase() + x.slice(1), lv = (HD_CHAP.test(cls[1]) ? ['Chapter'] : []).concat(['Section', 'Subsection', 'Subsubsection']), cur = headState(ta.value);   // no Chapter option without chapters
    const r = dlg({ t: 'Heading Design', i: 'captions', w: 420, btns: ['Cancel', 'Apply'], b: F([['s', 'Heading style', Object.keys(HD_STYLES).join('|')], ['s', 'Numbering', HD_NUMS.join('|')], ['s', 'Spacing', HD_SPACE.join('|')], ['s', 'Color applies to', ['All headings'].concat(lv).join('|')], ['t', 'Color (HTML value, blank = unchanged)', '']]), ok: (el) => {
      const v = $$('select', el).map((x) => x.value), hex = $('input', el).value.trim().replace(/^#/, ''), now = headState(ta.value), want = {};
      if (hex && !/^[0-9a-f]{6}$/i.test(hex)) return toast('Enter a 6-digit HTML color such as 1F3A7A. Nothing was changed');
      if (v[0] !== now.style) want.style = v[0]; if (v[1] !== now.num) want.num = v[1]; if (v[2] !== now.space) want.space = v[2];
      if (Object.keys(want).length) headingApply(want);
      if (hex) themeApply(themeWant(v[3] === 'All headings' ? 'heading' : v[3].toLowerCase(), hex.toUpperCase()));
      else if (!Object.keys(want).length) toast('Heading design unchanged');
    } });
    const sel = $$('select', r.el); sel[0].value = cur.style; sel[1].value = cur.num; sel[2].value = cur.space;
    if (level && lv.includes(cap(level))) sel[3].value = cap(level);
  }
  /* Pages & Breaks (Insert + Layout tabs share BRK()). Inserts on its own line at the cursor (selection end, so a
     selection is never replaced). \columnbreak only inside a multicols environment; section break = a small menu. */
  function insertBreak(cmd, caretBack) {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, pos = ta.selectionEnd, bs = t.indexOf('\\begin{document}'), be = t.indexOf('\\end{document}');
    if (bs < 0 || pos < bs + 16 || (be >= 0 && pos > be)) return toast('Place the cursor inside the document body to insert a break');
    const pre = pos > 0 && t[pos - 1] !== '\n' ? '\n' : '', post = pos < t.length && t[pos] !== '\n' ? '\n' : '';
    const c = pos + pre.length + cmd.length - (caretBack || 0);
    fmtEdit(ta, pos, pos, pre + cmd + post, c, c); return true;
  }
  function fmtBreak(kind, el) {
    const ta = $('#codeInput'); if (!ta) return;
    if (kind === 'page') return insertBreak('\\newpage');
    if (kind === 'col') {
      const t = ta.value, pos = ta.selectionEnd, re = /\\(begin|end)\{multicols\*?\}/g; let m, d = 0;
      while ((m = re.exec(t.slice(0, pos)))) d += m[1] === 'begin' ? 1 : -1;
      if (d <= 0) return toast('Column breaks only work inside a multicols environment. Wrap the text in \\begin{multicols}{2} … \\end{multicols} first');
      if (ensurePackage(t, 'multicol') !== null) return toast('Add \\usepackage{multicol} to the preamble to use column breaks');
      return insertBreak('\\columnbreak');
    }
    menu(el, SECM, (l) => {
      if (/^[ \t]*\\documentclass(?:\[[^\]]*\])?\{letter\}/m.test(ta.value)) return toast('The letter class has no sectioning commands');
      if (l === SECM[0]) insertBreak('\\section{}', 1);
      else if (l === SECM[1]) insertBreak('\\clearpage\n\\section{}', 1);
      else insertBreak('\\clearpage');
    });
  }
  /* Insert ▸ Equations ▸ Equation dropdown: wraps the selection (or just places the caret) in \( \), \begin{equation}
     or \begin{align}. amsmath is added for align via ensurePackage(). Refuses if the selection already contains math,
     or the cursor/selection sits inside an existing math span, so equations never end up nested. */
  const MATH_ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'math']);
  const MATH_RE = /\$|\\\(|\\\)|\\\[|\\\]|\\begin\{(?:equation|align|gather|multline|eqnarray|displaymath|math)\*?\}/;
  function inMath(t, pos) {
    const re = /\\\$|\\\(|\\\)|\\\[|\\\]|\\begin\{([a-zA-Z*]+)\}|\\end\{([a-zA-Z*]+)\}|\$/g;
    let stack = [], dollar = false, m;
    while ((m = re.exec(t.slice(0, pos)))) {
      const tok = m[0];
      if (tok === '\\$') continue;
      else if (tok === '\\(') stack.push('(');
      else if (tok === '\\)') { if (stack[stack.length - 1] === '(') stack.pop(); }
      else if (tok === '\\[') stack.push('[');
      else if (tok === '\\]') { if (stack[stack.length - 1] === '[') stack.pop(); }
      else if (m[1]) { if (MATH_ENVS.has(m[1])) stack.push(m[1]); }
      else if (m[2]) { if (stack[stack.length - 1] === m[2]) stack.pop(); }
      else if (tok === '$') dollar = !dollar;
    }
    return stack.length > 0 || dollar;
  }
  let eqMode = 'Display Equation';
  function eqInsert(label, content) {
    const kind = label === 'Inline Equation' ? 'inline' : label === 'Display Equation' ? 'display' : label === 'Align Block' ? 'align' : null;
    if (!kind) return;
    eqMode = label;
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const bs = t.indexOf('\\begin{document}'), be = t.lastIndexOf('\\end{document}');
    if (bs < 0 || s < bs + 16 || (be >= 0 && e > be)) return toast('Place the cursor inside the document body to insert an equation');
    const sel = content == null ? t.slice(s, e) : content;
    if (!balanced(sel)) return toast(content == null ? 'Selection has unmatched braces. Adjust it and try again' : 'The equation has unmatched braces. Fix it and try again');
    if (MATH_RE.test(sel)) return toast('Selection already contains math. Remove it first to avoid a nested equation');
    if (inMath(t, s) || (e !== s && inMath(t, e))) return toast('Place the cursor outside existing math to insert an equation');
    let pk = null;
    if (kind === 'align' || /\\begin\{[pbvVB]?matrix\}|\\(?:dfrac|tfrac|binom|text|substack|operatorname)(?![a-zA-Z])/.test(sel)) { pk = ensurePackage(t, 'amsmath'); if (pk === false) return toast('Could not add amsmath. Check the \\documentclass / preamble'); }
    let open, close;
    if (kind === 'inline') { open = '\\('; close = '\\)'; }
    else { const env = kind === 'display' ? 'equation' : 'align'; open = '\\begin{' + env + '}\n'; close = '\n\\end{' + env + '}'; }
    const selA = s + open.length, selB = selA + sel.length;
    fmtEdit(ta, s, e, open + sel + close, selA, selB);
    if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, selA + pk.str.length, selB + pk.str.length);
    return true;
  }
  const EQ_CATS = [
    { id: 'Fractions', items: [
      ['a/b', '\\frac{▢}{▢}'],          ['a/b big', '\\dfrac{▢}{▢}'],
      ['(n k)', '\\binom{▢}{▢}'],        ['√x', '\\sqrt{▢}'],
      ['ⁿ√x', '\\sqrt[▢]{▢}'],           ['dy/dx', '\\frac{d▢}{d▢}'],
      ['∂y/∂x', '\\frac{\\partial ▢}{\\partial ▢}'],
      ['δy/δx', '\\frac{\\delta ▢}{\\delta ▢}'],
    ]},
    { id: 'Scripts', items: [
      ['xⁿ', '▢^{▢}'],        ['xₙ', '▢_{▢}'],       ['xₙᵐ', '▢_{▢}^{▢}'],
      ['x̂', '\\hat{▢}'],      ['x̄', '\\bar{▢}'],     ['x⃗', '\\vec{▢}'],
      ['ẋ', '\\dot{▢}'],      ['ẍ', '\\ddot{▢}'],     ['x̃', '\\tilde{▢}'],
      ['x̌', '\\check{▢}'],   ['x̆', '\\breve{▢}'],    ['x̊', '\\mathring{▢}'],
      ['x͂', '\\widetilde{▢}'], ['x̂w', '\\widehat{▢}'],
      ['overline', '\\overline{▢}'],     ['underline', '\\underline{▢}'],
      ['underbrace', '\\underbrace{▢}_{▢}'], ['overbrace', '\\overbrace{▢}^{▢}'],
      ['\\text{x}', '\\text{▢}'],        ['\\mathbf{x}', '\\mathbf{▢}'],
      ['\\mathit{x}', '\\mathit{▢}'],    ['\\mathrm{x}', '\\mathrm{▢}'],
      ['\\mathcal{X}', '\\mathcal{▢}'],  ['\\mathfrak{x}', '\\mathfrak{▢}'],
    ]},
    { id: 'Brackets', items: [
      ['( )', '\\left( ▢ \\right)'],     ['[ ]', '\\left[ ▢ \\right]'],
      ['{ }', '\\left\\{ ▢ \\right\\}'], ['| |', '\\left| ▢ \\right|'],
      ['‖ ‖', '\\left\\| ▢ \\right\\|'], ['⟨ ⟩', '\\left\\langle ▢ \\right\\rangle'],
      ['⌊ ⌋', '\\left\\lfloor ▢ \\right\\rfloor'],
      ['⌈ ⌉', '\\left\\lceil ▢ \\right\\rceil'],
      ['⌊ ⌉', '\\left\\lfloor ▢ \\right\\rceil'],
      ['(  )', '\\bigl( ▢ \\bigr)'],     ['[  ]', '\\bigl[ ▢ \\bigr]'],
      ['. |', '\\left. ▢ \\right|'],
    ]},
    { id: 'Sums & ∫', items: [
      ['∑', '\\sum_{▢}^{▢} ▢'],          ['∑ i=1..n', '\\sum_{i=1}^{n} ▢'],
      ['∏', '\\prod_{▢}^{▢} ▢'],          ['∐', '\\coprod_{▢}^{▢} ▢'],
      ['∫', '\\int ▢\\,d▢'],              ['∫ₐᵇ', '\\int_{▢}^{▢} ▢\\,d▢'],
      ['∬', '\\iint_{▢} ▢\\,d▢'],         ['∭', '\\iiint_{▢} ▢\\,d▢'],
      ['∮', '\\oint_{▢} ▢\\,d▢'],
      ['⋃', '\\bigcup_{▢}^{▢} ▢'],       ['⋂', '\\bigcap_{▢}^{▢} ▢'],
      ['⊕', '\\bigoplus_{▢}^{▢} ▢'],     ['⊗', '\\bigotimes_{▢}^{▢} ▢'],
      ['⊙', '\\bigodot_{▢}^{▢} ▢'],
      ['∨', '\\bigvee_{▢}^{▢} ▢'],       ['∧', '\\bigwedge_{▢}^{▢} ▢'],
    ]},
    { id: 'Limits', items: [
      ['lim', '\\lim_{▢ \\to ▢} ▢'],     ['lim→∞', '\\lim_{n \\to \\infty} ▢'],
      ['lim→0', '\\lim_{▢ \\to 0} ▢'],   ['limsup', '\\limsup_{▢ \\to ▢} ▢'],
      ['liminf', '\\liminf_{▢ \\to ▢} ▢'],
      ['sup', '\\sup_{▢} ▢'],             ['inf', '\\inf_{▢} ▢'],
      ['max', '\\max_{▢} ▢'],             ['min', '\\min_{▢} ▢'],
      ['argmax', '\\arg\\max_{▢} ▢'],     ['argmin', '\\arg\\min_{▢} ▢'],
      ['∞', '\\infty'],                   ['−∞', '-\\infty'],
    ]},
    { id: 'Operators', items: [
      ['+', '+'],         ['−', '-'],          ['±', '\\pm'],        ['∓', '\\mp'],
      ['×', '\\times'],   ['÷', '\\div'],      ['·', '\\cdot'],      ['∗', '\\ast'],
      ['∘', '\\circ'],    ['∙', '\\bullet'],
      ['⊕', '\\oplus'],   ['⊗', '\\otimes'],   ['⊖', '\\ominus'],
      ['⊙', '\\odot'],    ['⊘', '\\oslash'],   ['⊞', '\\boxplus'],
      ['⊟', '\\boxminus'],['⊠', '\\boxtimes'],
      ['∧', '\\wedge'],   ['∨', '\\vee'],
      ['∩', '\\cap'],     ['∪', '\\cup'],      ['∖', '\\setminus'],
      ['≀', '\\wr'],      ['†', '\\dagger'],   ['‡', '\\ddagger'],
      ['⋆', '\\star'],    ['⋄', '\\diamond'],
      ['◻', '\\square'],  ['■', '\\blacksquare'],
      ['▷', '\\triangleright'], ['◁', '\\triangleleft'],
    ]},
    { id: 'Relations', items: [
      ['=', '='],          ['≠', '\\neq'],       ['≡', '\\equiv'],     ['≢', '\\not\\equiv'],
      ['≈', '\\approx'],   ['≃', '\\simeq'],     ['≅', '\\cong'],      ['≇', '\\ncong'],
      ['∼', '\\sim'],      ['∝', '\\propto'],    ['≐', '\\doteq'],
      ['≤', '\\leq'],      ['≥', '\\geq'],       ['≰', '\\nleq'],      ['≱', '\\ngeq'],
      ['<', '<'],          ['>','>'],
      ['≪', '\\ll'],       ['≫', '\\gg'],        ['≦', '\\leqq'],      ['≧', '\\geqq'],
      ['≺', '\\prec'],     ['≻', '\\succ'],      ['⪯', '\\preceq'],    ['⪰', '\\succeq'],
      ['⊂', '\\subset'],   ['⊃', '\\supset'],    ['⊆', '\\subseteq'],  ['⊇', '\\supseteq'],
      ['⊄', '\\not\\subset'], ['⊅', '\\not\\supset'],
      ['∈', '\\in'],       ['∉', '\\notin'],     ['∋', '\\ni'],
      ['⊥', '\\perp'],     ['∥', '\\parallel'],  ['∦', '\\nparallel'],
      ['∣', '\\mid'],      ['∤', '\\nmid'],
    ]},
    { id: 'Arrows', items: [
      ['→', '\\to'],               ['←', '\\leftarrow'],
      ['↔', '\\leftrightarrow'],   ['↦', '\\mapsto'],
      ['⇒', '\\Rightarrow'],       ['⇐', '\\Leftarrow'],
      ['⇔', '\\Leftrightarrow'],   ['⟹', '\\Longrightarrow'],
      ['⟸', '\\Longleftarrow'],    ['⟺', '\\Longleftrightarrow'],
      ['↑', '\\uparrow'],          ['↓', '\\downarrow'],   ['↕', '\\updownarrow'],
      ['⇑', '\\Uparrow'],          ['⇓', '\\Downarrow'],   ['⇕', '\\Updownarrow'],
      ['↗', '\\nearrow'],          ['↘', '\\searrow'],
      ['↙', '\\swarrow'],          ['↖', '\\nwarrow'],
      ['⟶', '\\longrightarrow'],   ['⟵', '\\longleftarrow'],
      ['↠', '\\twoheadrightarrow'],['↣', '\\rightarrowtail'],
      ['⇝', '\\rightsquigarrow'],  ['↬', '\\looparrowright'],
      ['⇢', '\\dashrightarrow'],   ['⇠', '\\dashleftarrow'],
      ['⇏', '\\nRightarrow'],      ['⇍', '\\nLeftarrow'],
      ['↼', '\\leftharpoonup'],    ['⇀', '\\rightharpoonup'],
      ['\\xleftarrow', '\\xleftarrow{▢}'],
      ['\\xrightarrow', '\\xrightarrow{▢}'],
    ]},
    { id: 'Greek', items: [
      ['α','\\alpha'],    ['β','\\beta'],     ['γ','\\gamma'],    ['δ','\\delta'],
      ['ε','\\epsilon'],  ['ε̃','\\varepsilon'],['ζ','\\zeta'],    ['η','\\eta'],
      ['θ','\\theta'],    ['ϑ','\\vartheta'], ['ι','\\iota'],     ['κ','\\kappa'],
      ['ϰ','\\varkappa'], ['λ','\\lambda'],   ['μ','\\mu'],       ['ν','\\nu'],
      ['ξ','\\xi'],       ['π','\\pi'],       ['ϖ','\\varpi'],    ['ρ','\\rho'],
      ['ϱ','\\varrho'],   ['σ','\\sigma'],    ['ς','\\varsigma'], ['τ','\\tau'],
      ['υ','\\upsilon'],  ['φ','\\phi'],      ['φ̃','\\varphi'],  ['χ','\\chi'],
      ['ψ','\\psi'],      ['ω','\\omega'],
      ['Γ','\\Gamma'],    ['Δ','\\Delta'],    ['Θ','\\Theta'],    ['Λ','\\Lambda'],
      ['Ξ','\\Xi'],       ['Π','\\Pi'],       ['Σ','\\Sigma'],    ['Υ','\\Upsilon'],
      ['Φ','\\Phi'],      ['Ψ','\\Psi'],      ['Ω','\\Omega'],
    ]},
    { id: 'Sets & Logic', items: [
      ['∀', '\\forall'],    ['∃', '\\exists'],    ['∄', '\\nexists'],
      ['¬', '\\neg'],       ['∧', '\\land'],      ['∨', '\\lor'],
      ['⊤', '\\top'],       ['⊥', '\\bot'],       ['∅', '\\emptyset'],
      ['∈', '\\in'],        ['∉', '\\notin'],     ['∋', '\\ni'],
      ['⊂', '\\subset'],    ['⊃', '\\supset'],
      ['⊆', '\\subseteq'],  ['⊇', '\\supseteq'],
      ['∪', '\\cup'],       ['∩', '\\cap'],       ['∖', '\\setminus'],
      ['℘', '\\wp'],        ['ℵ', '\\aleph'],     ['ℶ', '\\beth'],
      ['⊢', '\\vdash'],     ['⊣', '\\dashv'],     ['⊨', '\\models'],
      ['⊩', '\\Vdash'],     ['□', '\\Box'],       ['◇', '\\Diamond'],
    ]},
    { id: 'Number Sets', items: [
      ['ℕ', '\\mathbb{N}'], ['ℤ', '\\mathbb{Z}'], ['ℚ', '\\mathbb{Q}'],
      ['ℝ', '\\mathbb{R}'], ['ℂ', '\\mathbb{C}'], ['𝔽', '\\mathbb{F}'],
      ['𝔸', '\\mathbb{A}'], ['𝕂', '\\mathbb{K}'], ['𝕊', '\\mathbb{S}'],
      ['𝕋', '\\mathbb{T}'], ['𝕎', '\\mathbb{W}'], ['ℍ', '\\mathbb{H}'],
      ['𝔼', '\\mathbb{E}'], ['𝕆', '\\mathbb{O}'], ['𝕁', '\\mathbb{J}'],
    ]},
    { id: 'Functions', items: [
      ['sin', '\\sin ▢'],      ['cos', '\\cos ▢'],      ['tan', '\\tan ▢'],
      ['cot', '\\cot ▢'],      ['sec', '\\sec ▢'],      ['csc', '\\csc ▢'],
      ['arcsin', '\\arcsin ▢'],['arccos', '\\arccos ▢'],['arctan', '\\arctan ▢'],
      ['sinh', '\\sinh ▢'],    ['cosh', '\\cosh ▢'],    ['tanh', '\\tanh ▢'],
      ['ln', '\\ln ▢'],        ['log', '\\log ▢'],       ['logₐ', '\\log_{▢} ▢'],
      ['exp', '\\exp(▢)'],     ['eˣ', 'e^{▢}'],
      ['|x|', '\\lvert ▢ \\rvert'],
      ['sgn', '\\operatorname{sgn}(▢)'],
      ['Re', '\\operatorname{Re}(▢)'],    ['Im', '\\operatorname{Im}(▢)'],
      ['gcd', '\\gcd(▢,▢)'],  ['lcm', '\\operatorname{lcm}(▢,▢)'],
      ['ker', '\\ker ▢'],      ['rank', '\\operatorname{rank} ▢'],
      ['tr', '\\operatorname{tr}(▢)'],    ['det', '\\det(▢)'],
      ['deg', '\\deg ▢'],      ['dim', '\\dim ▢'],       ['Pr', '\\Pr(▢)'],
    ]},
    { id: 'Geometry', items: [
      ['∂', '\\partial'],    ['∇', '\\nabla'],
      ['△', '\\triangle'],   ['∠', '\\angle'],
      ['∥', '\\parallel'],   ['⊥', '\\perp'],
      ['⌢', '\\frown'],      ['⌣', '\\smile'],
      ['°', '^{\\circ}'],    ['vec', '\\vec{▢}'],
      ['|v|', '\\|▢\\|'],    ['v·w', '▢ \\cdot ▢'],
      ['v×w', '▢ \\times ▢'],
      ['div', '\\operatorname{div} ▢'],
      ['curl', '\\operatorname{curl} ▢'],
      ['grad', '\\nabla ▢'],  ['∇²', '\\nabla^2 ▢'],
    ]},
    { id: 'Misc', items: [
      ['…', '\\ldots'],     ['⋯', '\\cdots'],   ['⋮', '\\vdots'],    ['⋱', '\\ddots'],
      ['ℏ', '\\hbar'],      ['ℓ', '\\ell'],      ['ℑ', '\\Im'],       ['ℜ', '\\Re'],
      ['∞', '\\infty'],     ['□', '\\Box'],
      ['♯', '\\sharp'],     ['♭', '\\flat'],     ['♮', '\\natural'],
      ['†', '\\dagger'],    ['‡', '\\ddagger'],
      ['′', '^{\\prime}'],  ['″', '^{\\prime\\prime}'],
      ['op', '\\operatorname{▢}'],
      ['stackrel', '\\stackrel{▢}{▢}'],
      ['underset', '\\underset{▢}{▢}'],
      ['overset', '\\overset{▢}{▢}'],
      ['substack', '\\substack{▢ \\\\ ▢}'],
      ['phantom', '\\phantom{▢}'],
      ['not', '\\not ▢'],
      ['cancel', '\\cancel{▢}'],
      ['cancelto', '\\cancelto{▢}{▢}'],
      ['xleftarrow', '\\xleftarrow{▢}'],
      ['xrightarrow', '\\xrightarrow{▢}'],
    ]},
    { id: 'Matrix', items: [
      ['( 2×2 )', '\\begin{pmatrix} ▢ & ▢ \\\\ ▢ & ▢ \\end{pmatrix}'],
      ['[ 2×2 ]', '\\begin{bmatrix} ▢ & ▢ \\\\ ▢ & ▢ \\end{bmatrix}'],
      ['| 2×2 |', '\\begin{vmatrix} ▢ & ▢ \\\\ ▢ & ▢ \\end{vmatrix}'],
      ['‖ 2×2 ‖', '\\begin{Vmatrix} ▢ & ▢ \\\\ ▢ & ▢ \\end{Vmatrix}'],
      ['( 3×3 )', '\\begin{pmatrix} ▢ & ▢ & ▢ \\\\ ▢ & ▢ & ▢ \\\\ ▢ & ▢ & ▢ \\end{pmatrix}'],
      ['[ 3×3 ]', '\\begin{bmatrix} ▢ & ▢ & ▢ \\\\ ▢ & ▢ & ▢ \\\\ ▢ & ▢ & ▢ \\end{bmatrix}'],
      ['cases', '\\begin{cases} ▢ & \\text{if } ▢ \\\\ ▢ & \\text{otherwise} \\end{cases}'],
      ['cases 3', '\\begin{cases} ▢ & \\text{if } ▢ \\\\ ▢ & \\text{if } ▢ \\\\ ▢ & \\text{otherwise} \\end{cases}'],
      ['aligned', '\\begin{aligned} ▢ &= ▢ \\\\ ▢ &= ▢ \\end{aligned}'],
      ['aligned 3', '\\begin{aligned} ▢ &= ▢ \\\\ ▢ &= ▢ \\\\ ▢ &= ▢ \\end{aligned}'],
      ['align*', '\\begin{align*} ▢ &= ▢ \\\\ ▢ &= ▢ \\end{align*}'],
      ['array', '\\begin{array}{cc} ▢ & ▢ \\\\ ▢ & ▢ \\end{array}'],
    ]},
  ];

  /* Insert ▸ Equations ▸ Equation Editor: custom WYSIWYG-feel editor with live KaTeX preview,
     category tabs, symbol keyboard, and a raw LaTeX textarea that syncs both ways. */
  function eqDialog() {
    const ta = $('#codeInput'); if (!ta) return;
    const a = ta.selectionStart, z = ta.selectionEnd, sel = ta.value.slice(a, z);
    const d = dlg(D.equation());
    const pills = $('#eqModePills', d.el), prev = $('#eqPrev', d.el);
    const tabs = $('#eqTabs', d.el), grid = $('#eqGrid', d.el), src = $('#eqSrc', d.el);

    // --- live preview ---
    const render = () => {
      const v = src.value.trim();
      if (!v) { prev.innerHTML = '<span class="eq-prev__hint">Start typing below…</span>'; return; }
      if (!window.katex) { prev.textContent = v; return; }
      try {
        const display = activePill().dataset.m !== 'Inline Equation';
        katex.render(v, prev, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
      } catch (_) { prev.innerHTML = `<span class="eq-prev__err">${esc(src.value)}</span>`; }
    };
    src.addEventListener('input', render);

    // --- mode pills ---
    const activePill = () => pills.querySelector('.is-on');
    pills.addEventListener('click', (e) => {
      const p = e.target.closest('.eq-mode__pill'); if (!p) return;
      pills.querySelectorAll('.eq-mode__pill').forEach((x) => x.classList.toggle('is-on', x === p));
      render();
    });

    // --- symbol keyboard preview & tabs ---
    const keyCache = new Map();
    const makeKeyPreview = (tex, label) => {
      if (keyCache.has(tex)) return keyCache.get(tex);
      if (!window.katex) return esc(label);
      let pTex = tex.replace(/▢/g, '\\Box');
      if (tex.startsWith('\\text{')) pTex = '\\text{Abc}';
      else if (tex.includes('\\cancelto')) pTex = '\\cancel{\\Box}';
      else if (tex.startsWith('\\begin{align')) pTex = pTex.replace(/\\begin\{align\*?\}/g, '\\begin{aligned}').replace(/\\end\{align\*?\}/g, '\\end{aligned}');
      try {
        const h = katex.renderToString(pTex, { throwOnError: true, displayMode: false });
        const res = h.replace(/<span class="mord amsrm(?:\s+mtight)?">□<\/span>/g, '<span class="eq-ph"></span>');
        keyCache.set(tex, res);
        return res;
      } catch (_) {
        keyCache.set(tex, esc(label));
        return esc(label);
      }
    };

    let curCat = 0;
    const showCat = (i) => {
      curCat = i;
      tabs.querySelectorAll('.eq-tab').forEach((t, ti) => {
        const on = ti === i;
        t.classList.toggle('is-on', on);
        if (on) t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      });
      const cat = EQ_CATS[i];
      grid.innerHTML = cat.items.map(([label, tex]) =>
        `<button class="eq-key" type="button" title="${esc(tex)}" data-t="${esc(tex)}">${makeKeyPreview(tex, label)}</button>`
      ).join('');
    };
    tabs.innerHTML = EQ_CATS.map((c, i) =>
      `<button class="eq-tab${i === 0 ? ' is-on' : ''}" type="button" data-i="${i}">${esc(c.id)}</button>`
    ).join('');
    tabs.addEventListener('click', (e) => { const t = e.target.closest('.eq-tab'); if (t) showCat(+t.dataset.i); });
    tabs.addEventListener('wheel', (e) => {
      if (e.deltaY) { e.preventDefault(); tabs.scrollLeft += e.deltaY; }
    }, { passive: false });
    const tabL = $('#eqTabsL', d.el), tabR = $('#eqTabsR', d.el);
    if (tabL) tabL.onclick = () => tabs.scrollBy({ left: -140, behavior: 'smooth' });
    if (tabR) tabR.onclick = () => tabs.scrollBy({ left: 140, behavior: 'smooth' });
    showCat(0);

    // --- insert symbol at cursor ---
    const put = (tex) => {
      const s = src.selectionStart, e = src.selectionEnd;
      const cur = src.value.slice(s, e);
      const str = cur && tex.includes('▢') ? tex.replace('▢', cur) : tex;
      src.setRangeText(str, s, e, 'end');
      const n = src.value.indexOf('▢', s);
      if (n >= 0) src.setSelectionRange(n, n + 1);
      src.focus(); render();
    };
    grid.addEventListener('click', (e) => { const b = e.target.closest('.eq-key'); if (b) put(b.dataset.t); });

    // Tab = jump to next placeholder
    src.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || e.shiftKey) return;
      const n = src.value.indexOf('▢', src.selectionEnd); if (n < 0) return;
      e.preventDefault(); e.stopPropagation(); src.setSelectionRange(n, n + 1);
    });

    // seed with selection
    src.value = sel; render(); src.focus(); src.select();

    // --- Insert ---
    $('.dlg__foot .btn--primary', d.el).onclick = () => {
      const c = src.value.trim();
      if (!c) return toast('Type or build an equation first');
      if (c.includes('▢')) return toast('Fill in the ▢ placeholders first');
      if (ta.value.slice(a, z) !== sel) return toast('The source changed. Close and reopen the editor');
      ta.setSelectionRange(a, z);
      if (!eqInsert(activePill().dataset.m, c)) return;
      const ss = ta.selectionStart, se = ta.selectionEnd; d.close(); ta.focus(); ta.setSelectionRange(ss, se);
    };
  }


  /* Symbol dialog: catalogue + search come from js/symbols.js (RPE.symbols, migrated from the old app). Inserts the character
     at the end of the current selection via execCommand (native undo), caret lands after it. Double-click inserts and keeps the dialog open.
     In text the glyph is inserted as-is (XeLaTeX/LuaLaTeX read Unicode); inside math (inMath) it becomes the real command (\alpha, \leq, \mathbb{R}…),
     with amssymb/amsmath added once via ensurePackage; a symbol with no math command is refused instead of breaking the build. */
  const SYM_TEX = {};
  ('α alpha β beta γ gamma δ delta ε epsilon ζ zeta η eta θ theta ι iota κ kappa λ lambda μ mu ν nu ξ xi π pi ρ rho σ sigma ς varsigma τ tau υ upsilon φ phi χ chi ψ psi ω omega Γ Gamma Δ Delta Θ Theta Λ Lambda Ξ Xi Π Pi Σ Sigma Υ Upsilon Φ Phi Ψ Psi Ω Omega ' +
    '± pm ∓ mp × times ÷ div · cdot ∗ ast ∘ circ ∙ bullet ∩ cap ∪ cup ∧ wedge ∨ vee ⊕ oplus ⊗ otimes ⊖ ominus ⊙ odot ∖ setminus ≤ leq ≥ geq ≠ neq ≈ approx ≡ equiv ∼ sim ≃ simeq ≅ cong ∝ propto ≪ ll ≫ gg ∈ in ∉ notin ∋ ni ⊂ subset ⊃ supset ⊆ subseteq ⊇ supseteq ⊥ perp ∥ parallel ∣ mid ' +
    '∞ infty ∂ partial ∇ nabla ∫ int ∮ oint ∑ sum ∏ prod ∀ forall ∃ exists ¬ neg ∅ emptyset ℏ hbar ℓ ell ∠ angle △ triangle ′ prime … ldots ⋯ cdots → rightarrow ← leftarrow ↔ leftrightarrow ⇒ Rightarrow ⇐ Leftarrow ⇔ Leftrightarrow ↦ mapsto ↑ uparrow ↓ downarrow ⟶ longrightarrow ⟹ Longrightarrow')
    .split(' ').forEach((w, i, a) => { if (i % 2 === 0) SYM_TEX[w] = { c: '\\' + a[i + 1] }; });
  'ℕ N ℤ Z ℚ Q ℝ R ℂ C'.split(' ').forEach((w, i, a) => { if (i % 2 === 0) SYM_TEX[w] = { c: '\\mathbb{' + a[i + 1] + '}', pk: 'amssymb' }; });
  SYM_TEX['∬'] = { c: '\\iint', pk: 'amsmath' }; SYM_TEX['∭'] = { c: '\\iiint', pk: 'amsmath' };
  function symbolDialog() {
    const ta = $('#codeInput'), S = window.RPE && window.RPE.symbols;
    if (!ta) return; if (!S) return toast('Symbol catalogue failed to load (js/symbols.js)');
    const d = dlg(D.symbols());
    const grid = $('#symGrid', d.el), gridWrap = $('#symGridWrap', d.el);
    const qi = $('#symQ', d.el), cats = $('#symCats', d.el);
    const prevBox = $('#symPrevBox', d.el), prevName = $('#symPrevName', d.el), prevCode = $('#symPrevCode', d.el);
    let cat = S.CATEGORIES[0].id, rows = [], cur = null;

    cats.innerHTML = S.CATEGORIES.map((c) => `<div class="sym-cat ${c.id === cat ? 'is-on' : ''}" data-c="${c.id}" role="button" tabindex="0"><span class="sym-cat-icon">${esc(c.icon)}</span><span class="sym-cat-label">${esc(c.label)}</span><span class="sym-cat-count">${c.symbols.length}</span></div>`).join('');

    const setPreview = (s) => {
      if (!s) { prevBox.textContent = ''; prevName.textContent = 'No symbol selected'; prevCode.textContent = ''; return; }
      cur = s; prevBox.textContent = S.label(s); prevName.textContent = s.n;
      const tags = (s.k || '').trim().split(/\s+/).filter(Boolean).join(', ');
      prevCode.textContent = S.hex(s.c) + (tags ? ' · ' + tags : '');
    };

    const show = () => {
      const q = qi.value.trim();
      rows = q ? S.search(q, cat) : (S.get(cat) || { symbols: [] }).symbols;
      if (q && !rows.length) rows = S.search(q);
      if (!rows.length) { grid.innerHTML = '<div class="sym-empty">No symbols match</div>'; setPreview(null); return; }
      grid.innerHTML = rows.map((s, i) => `<button type="button" class="sym-btn" data-i="${i}" aria-label="${esc(s.n)}">${esc(S.label(s))}</button>`).join('');
      setPreview(cur && rows.includes(cur) ? cur : rows[0]);
    };

    const put = (ch) => {
      const t = ta.value, p = ta.selectionEnd, q = d.el.contains(document.activeElement) ? document.activeElement : null; let str = ch, pk = null;
      if (inMath(t, p)) {
        const x = SYM_TEX[ch]; if (!x) return toast('“' + ch + '” has no math command. Insert it in text, or type its LaTeX by hand');
        pk = x.pk ? ensurePackage(t, x.pk) : null; if (pk === false) return toast('Could not add ' + x.pk + '. Check the \\documentclass / preamble');
        str = x.c + (/[A-Za-z]$/.test(x.c) && /[A-Za-z]/.test(t[p] || '') ? ' ' : '');
      }
      const end = p + str.length; fmtEdit(ta, p, p, str, end, end);
      if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, end + pk.str.length, end + pk.str.length);
      if (q) q.focus();
    };

    cats.addEventListener('click', (e) => {
      const c = e.target.closest('.sym-cat'); if (!c) return;
      cat = c.dataset.c; $$('.sym-cat', cats).forEach((x) => x.classList.toggle('is-on', x === c));
      qi.value = ''; show(); gridWrap.scrollTop = 0;
    });
    cats.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); }
    });

    qi.addEventListener('input', () => { show(); gridWrap.scrollTop = 0; });

    grid.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.sym-btn'); if (!b) return;
      const s = rows[b.dataset.i]; if (!s) return;
      setPreview(s);
    });

    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.sym-btn'); if (!b) return;
      const s = rows[b.dataset.i]; if (!s) return;
      setPreview(s);
      put(s.c);
    });

    show();
  }
  function fmtRange(ta) {   // validated selection -> { t, r } or null (with a toast)
    const t = ta.value; let s = ta.selectionStart, e = ta.selectionEnd;
    while (s < e && /\s/.test(t[s])) s++;
    while (e > s && /\s/.test(t[e - 1])) e--;
    if (s === e && ta.selectionStart !== ta.selectionEnd) return toast('Select some text to format'), null;
    const sel = t.slice(s, e);
    if (!balanced(sel)) return toast('Selection has unmatched braces. Adjust it and try again'), null;
    if (/\n[ \t]*\n/.test(sel)) return toast('Formatting cannot span a paragraph break. Select within one paragraph'), null;
    return { t, r: fmtLayers(t, s, e) };
  }
  function fmtToggle(cmd) {
    const ta = $('#codeInput'); if (!ta) return;
    const x = fmtRange(ta); if (!x) return;
    const { t, r } = x, hit = r.L.find((l) => l.name === cmd);
    if (hit) {   // already applied: drop just that wrapper
      const n = hit.oe - hit.os;
      fmtEdit(ta, hit.os, hit.ce, t.slice(hit.oe, hit.ce - hit.cl), r.s - n, r.e - n);
    } else {     // wrap (empty selection -> \cmd{} with the caret inside)
      const pk = cmd === 'sout' ? ensurePackage(t, ['ulem', 'normalem']) : null;
      if (pk === false) return toast('Could not add ulem. Check the \\documentclass / preamble');
      const open = '\\' + cmd + '{';
      fmtEdit(ta, r.s, r.e, open + t.slice(r.s, r.e) + '}', r.s + open.length, r.e + open.length);
      if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, r.s + open.length + pk.str.length, r.e + open.length + pk.str.length);
    }
    syncFmtBtns();
  }
  /* Font color (\textcolor, xcolor) and Text highlight ({\sethlcolor{c}\hl{…}}, soul). Same colour again removes it,
     a different colour replaces the existing wrapper's colour, otherwise the selection is wrapped (nesting with bold/italic). */
  function fmtColor(kind, val) {
    const ta = $('#codeInput'); if (!ta) return;
    const x = fmtRange(ta); if (!x) return;
    const { t, r } = x, hit = r.L.find((l) => l.name === kind), hl = kind === 'hl';
    const body = t.indexOf('\\begin{document}');
    if (body < 0 || r.s < body) return toast('Select text inside the document body to apply color');
    if (!val) {
      if (hit) {
        const n = hit.oe - hit.os;
        fmtEdit(ta, hit.os, hit.ce, t.slice(hit.oe, hit.ce - hit.cl), r.s - n, r.e - n);
        syncFmtBtns();
        toast('Color removed');
      } else toast('Already automatic (no custom color)');
      return;
    }
    const pk = ensurePackage(t, ...(hl ? ['xcolor', 'soul'] : ['xcolor']));
    if (pk === false) return toast('Could not add the needed package. Check the \\documentclass / preamble');
    const open = hl ? '{\\sethlcolor{' + val + '}\\hl{' : '\\textcolor[HTML]{' + val + '}{', cl = hl ? '}}' : '}';
    let ed;
    if (hit && hit.val.toUpperCase() === val.toUpperCase()) { const n = hit.oe - hit.os; ed = [hit.os, hit.ce, t.slice(hit.oe, hit.ce - hit.cl), r.s - n, r.e - n]; }
    else if (hit) { const d = open.length - (hit.oe - hit.os); ed = [hit.os, hit.oe, open, r.s + d, r.e + d]; }
    else ed = [r.s, r.e, open + t.slice(r.s, r.e) + cl, r.s + open.length, r.e + open.length];
    fmtEdit(ta, ...ed);
    if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, ed[3] + pk.str.length, ed[4] + pk.str.length);   // preamble is before the body, so the selection just shifts
    syncFmtBtns();
  }
  /* Font family for the selection: a local group {\fontspec{Name}…} (XeLaTeX), so only the selection changes and it nests with
     bold/italic/colour like the other wrappers. Same font again removes it, a different one replaces it. The family must be
     resolvable by the compiler (bundled in fonts/ or installed), the server checks that via fontconfig; if it can't be
     confirmed nothing is written. */
  let fontSet = null, fontRaw = [], fontBundled = new Set();
  async function fontLoad() {   // /api/fonts registry (bundled + fontconfig), loaded once; shared by the font boxes, Design ▸ Fonts and Preferences
    if (!fontSet) { const r = await (await fetch('/api/fonts')).json(); if (!r.ok) throw 0; fontRaw = r.fonts.slice().sort((a, b) => a.localeCompare(b)); fontSet = new Set(r.fonts.map((f) => f.toLowerCase())); if (r.bundled) fontBundled = new Set(r.bundled.map((f) => f.toLowerCase())); }
    return fontSet;
  }
  async function fontOK(name) {
    try {
      return (await fontLoad()).has(name.toLowerCase());
    } catch (e) { toast('Can’t verify fonts. Run the compile server (node server/server.js) and open the editor from it'); return null; }
  }
  async function fmtFont(name) {
    name = (name || '').trim(); const ta = $('#codeInput'); if (!ta) return;
    if (ta.selectionStart === ta.selectionEnd) return fontRole('body', name);
    if (!/^[\p{L}\p{N} .+-]+$/u.test(name)) return toast('Unsupported font name');
    const ok = await fontOK(name); if (ok === null) return;
    if (!ok) return toast('Font “' + name + '” isn’t available to XeLaTeX: not applied');
    const x = fmtRange(ta); if (!x) return;
    const { t, r } = x, hit = r.L.find((l) => l.name === 'font'), body = t.indexOf('\\begin{document}');
    if (body < 0 || r.s < body) return toast('Select text inside the document body to change its font');
    if (/^[ \t]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:inputenc|fontenc)\b/m.test(t) && !/fontspec/.test(t)) return toast('This document is set up for pdfLaTeX (inputenc/fontenc): a font change needs XeLaTeX/fontspec');
    const pk = ensurePackage(t, 'fontspec');
    if (pk === false) return toast('Could not add the needed package. Check the \\documentclass / preamble');
    const open = '{\\fontspec{' + name + '}'; let ed;
    if (hit && hit.val.toLowerCase() === name.toLowerCase()) { const n = hit.oe - hit.os; ed = [hit.os, hit.ce, t.slice(hit.oe, hit.ce - hit.cl), r.s - n, r.e - n]; }
    else if (hit) { const d = open.length - (hit.oe - hit.os); ed = [hit.os, hit.oe, open, r.s + d, r.e + d]; }
    else ed = [r.s, r.e, open + t.slice(r.s, r.e) + '}', r.s + open.length, r.e + open.length];
    fmtEdit(ta, ...ed);
    if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, ed[3] + pk.str.length, ed[4] + pk.str.length);
    syncFmtBtns();
  }

  /* ---------- Format Painter (Home ▸ Clipboard): captures the wrappers around the source selection (bold/italic/sub/sup/
     colour/highlight/font), then the next non-empty selection in the editor gets them via the same fmtToggle/fmtColor/fmtFont
     helpers (so existing wrappers are kept, identical ones aren't duplicated, a different colour/font replaces the old one). One-shot;
     Esc or clicking the button again cancels. ---------- */
  let FP = null;
  const FP_INNER = new RegExp(OPEN);   // a recognised wrapper *inside* a selection = mixed formatting -> too ambiguous
  function fpSet(on) { FP = on || null; document.body.classList.toggle('fp-armed', !!FP); $$('[data-fp]').forEach((b) => b.classList.toggle('is-on', !!FP)); }
  function fpToggle() {
    if (FP) { fpSet(null); return toast('Format Painter cancelled'); }
    const ta = $('#codeInput'); if (!ta) return;
    const x = fmtRange(ta); if (!x) return;
    if (FP_INNER.test(x.t.slice(x.r.s, x.r.e))) return toast('Format Painter: the selection has mixed formatting. Select a single uniformly formatted run');
    if (!x.r.L.length) return toast('Format Painter: no bold, italic, underline, strikethrough, sub/superscript, color, highlight or font formatting at the selection');
    fpSet(x.r.L.slice().reverse().map((l) => ({ name: l.name, val: l.val })));   // outermost first, so nesting is preserved
    toast('Format Painter on. Select the text to paint (Esc cancels)');
  }
  async function fpApply() {
    const ta = $('#codeInput'); if (!FP || !ta || ta.selectionStart === ta.selectionEnd) return;   // caret click only: stay armed
    const x = fmtRange(ta); if (!x) return;
    const body = x.t.indexOf('\\begin{document}');
    if (body < 0 || x.r.s < body) return toast('Select text inside the document body to paint formatting');
    if (FP_INNER.test(x.t.slice(x.r.s, x.r.e))) return toast('Target has mixed formatting. Select a plain or uniformly formatted run');
    const layers = FP; fpSet(null); let skipped = 0;
    for (const l of layers) {
      const cur = fmtRange(ta); if (!cur) return;   // selection is re-validated after every edit
      const hit = cur.r.L.find((o) => o.name === l.name);
      if (hit && (!l.val || hit.val.toLowerCase() === l.val.toLowerCase())) continue;   // already identical: don't duplicate
      if (l.name === 'textcolor' && !/^[0-9a-f]{6}$/i.test(l.val)) { skipped++; continue; }   // named colour: fmtColor only writes [HTML] hex
      if (l.name === 'textcolor' || l.name === 'hl') fmtColor(l.name, l.name === 'hl' ? l.val : l.val.toUpperCase());
      else if (l.name === 'font') await fmtFont(l.val);
      else fmtToggle(l.name);
    }
    if (skipped) toast('Painted: skipped ' + skipped + ' named-colour wrapper(s) that couldn’t be copied safely');
    syncFmtBtns();
  }

  /* Home ▸ Font ▸ Size & Size +/- : \tiny ... \Huge steps. */
  const TEX_SIZES = ['tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge'];
  const SIZES_MAP = { '8': 'tiny', '9': 'scriptsize', '10': 'footnotesize', '10.5': 'small', '11': 'small', '12': 'normalsize', '14': 'large', '16': 'Large', '18': 'LARGE', '24': 'huge' };
  const SIZES_REV = { tiny: '8', scriptsize: '9', footnotesize: '10', small: '11', normalsize: '12', large: '14', Large: '16', LARGE: '18', huge: '24', Huge: '24' };
  function curSizeCmd(t, pos) {
    for (let i = pos - 1; i >= 0; i--) {
      const c = t[i];
      if (c === '}') {
        let depth = 1; i--;
        while (i >= 0 && depth > 0) {
          if (t[i] === '}' && t[i - 1] !== '\\') depth++;
          else if (t[i] === '{' && t[i - 1] !== '\\') depth--;
          i--;
        }
        i++;
      } else if (c === '\\') {
        const m = /^\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b/.exec(t.slice(i));
        if (m) return m[1];
      }
    }
    return 'normalsize';
  }
  function fmtSize(stepOrVal) {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    let targetCmd;
    if (typeof stepOrVal === 'number') {
      const cur = curSizeCmd(t, s);
      let idx = TEX_SIZES.indexOf(cur); if (idx < 0) idx = 4;
      targetCmd = TEX_SIZES[Math.max(0, Math.min(TEX_SIZES.length - 1, idx + stepOrVal))];
    } else {
      targetCmd = SIZES_MAP[stepOrVal] || (TEX_SIZES.includes(stepOrVal) ? stepOrVal : 'normalsize');
    }
    if (s !== e) {
      let sel = t.slice(s, e);
      sel = sel.replace(/^\{\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\s+([\s\S]*)\}$/, '$2');
      const open = '{\\' + targetCmd + ' ';
      fmtEdit(ta, s, e, open + sel + '}', s + open.length, s + open.length + sel.length);
    } else {
      const cmd = '\\' + targetCmd + ' ';
      fmtEdit(ta, s, s, cmd, s + cmd.length, s + cmd.length);
    }
    const si = $('.combo__in[aria-label="Size"]');
    if (si) si.value = SIZES_REV[targetCmd] || '12';
    syncFmtBtns();
  }

  /* Home ▸ Font ▸ Change case: Sentence case / lowercase / UPPERCASE */
  function fmtCase(mode) {
    const ta = $('#codeInput'); if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, t = ta.value;
    if (s === e) return toast('Select text to change case');
    const sel = t.slice(s, e);
    const transform = (str) => {
      if (mode === 'lowercase') return str.toLowerCase();
      if (mode === 'UPPERCASE') return str.toUpperCase();
      if (mode === 'Sentence case') {
        const lower = str.toLowerCase();
        return lower.replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase());
      }
      return str;
    };
    let out = '', i = 0;
    while (i < sel.length) {
      if (sel[i] === '\\') {
        const m = /^\\([a-zA-Z]+|.)/.exec(sel.slice(i));
        if (m) { out += m[0]; i += m[0].length; continue; }
      }
      if (sel[i] === '$') {
        const j = sel.indexOf('$', i + 1);
        const end = j < 0 ? sel.length : j + 1;
        out += sel.slice(i, end); i = end; continue;
      }
      let j = i;
      while (j < sel.length && sel[j] !== '\\' && sel[j] !== '$') j++;
      out += transform(sel.slice(i, j)); i = j;
    }
    fmtEdit(ta, s, e, out, s, s + out.length);
  }

  /* Home ▸ Font ▸ Clear formatting: strips formatting wrappers */
  function stripFormatting(str) {
    let prev;
    do {
      prev = str;
      str = str.replace(/\\(textbf|textit|emph|underline|sout|textsubscript|textsuperscript)\{([^{}]*)\}/g, '$2')
               .replace(/\\textcolor(?:\[HTML\])?\{[^{}]*\}\{([^{}]*)\}/g, '$1')
               .replace(/\{\\sethlcolor\{[^{}]*\}\s*\\hl\{([^{}]*)\}\}/g, '$1')
               .replace(/\{\\fontspec\{[^{}]*\}\s*([^{}]*)\}/g, '$1')
               .replace(/\{\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\s+([^{}]*)\}/g, '$2');
    } while (str !== prev);
    return str;
  }
  function fmtClear() {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) return toast('Select text to clear formatting');
    const r = fmtLayers(t, s, e);
    let outerS = s, outerE = e;
    if (r.L.length) {
      outerS = r.s; outerE = r.e;
      for (const w of r.L) {
        outerS = Math.min(outerS, w.os);
        outerE = Math.max(outerE, w.ce);
      }
    }
    const innerText = t.slice(r.s, r.e);
    const stripped = stripFormatting(innerText);
    if (outerS !== r.s || outerE !== r.e || stripped !== t.slice(s, e)) {
      fmtEdit(ta, outerS, outerE, stripped, outerS, outerS + stripped.length);
    } else {
      toast('No formatting wrappers found on selection');
    }
    syncFmtBtns();
  }

  /* Home ▸ Clipboard ▸ Paste: paste / paste plain text / paste escaped LaTeX */
  async function clipPaste(mode) {
    const ta = $('#codeInput'); if (!ta) return;
    let text = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch (e) { /* fallback below */ }
    if (!text && mode === 'paste') {
      ta.focus();
      if (document.execCommand('paste')) return;
    }
    if (!text) {
      return toast('Could not read clipboard. Use ' + (MAC ? '⌘V' : 'Ctrl+V'));
    }
    if (mode === 'plain') {
      text = stripFormatting(text);
    } else if (mode === 'esc') {
      text = texEsc(text);
    }
    fmtEdit(ta, ta.selectionStart, ta.selectionEnd, text, ta.selectionStart + text.length, ta.selectionStart + text.length);
    syncFmtBtns();
  }

  /* ---------- paragraph formatting engine (Home ▸ Paragraph; Layout ▸ Paragraph should call fmtPara(change) too).
     A formatted paragraph is rewritten as ONE self-describing block, so repeat clicks re-parse and update it in place:
         \vspace{6pt}%lp            (only if spacing before)
         {\centering\setlength{\leftskip}{1cm}%lp
         ...paragraph text...
         \par}%lp                   (the \par inside the group scopes every setting to this paragraph)
         \vspace{6pt}%lp            (only if spacing after)
     A paragraph whose settings all return to default is unwrapped again. change keys: al ('l'|'c'|'r'|'j'), dIndent (±1 step),
     first / hang (cm), noind, ind {L,H,F,z} (dialog), right (cm), bef / aft (pt), ls (stretch factor; 1 removes it). ---------- */
  const PA_AL = { c: '\\centering', l: '\\raggedright', r: '\\raggedleft' }, PA_STEP = 1;   // indent step in cm
  const paEmpty = () => ({ al: null, noind: false, ind: null, left: 0, right: 0, ls: null, bef: 0, aft: 0, ktg: false, kwn: false, pbb: false });
  const paNum = (x) => String(+(+x).toFixed(2));
  function paParse(p) {   // paragraph text -> { st, body, ob (body offset) } | null if it holds %lp markup that was edited by hand
    const st = paEmpty(); if (!p.includes('%lp')) return { st, body: p, ob: 0 };
    const m = /^((?:\\newpage%lp\n)?(?:\\vspace\{(-?[\d.]+)pt\}%lp\n)?\{([^\n]*?)%lp\n)([\s\S]*)\n\\par\}%lp(\n\\nopagebreak\[4\]%lp)?(?:\n\\vspace\{(-?[\d.]+)pt\}%lp)?$/.exec(p); if (!m) return null;
    st.bef = +m[2] || 0; st.aft = +m[6] || 0; st.pbb = m[1].startsWith('\\newpage%lp'); st.kwn = !!m[5];
    const rest = m[3].replace(/\\(centering|raggedright|raggedleft)(?![a-zA-Z])/, (_, k) => { st.al = { centering: 'c', raggedright: 'l', raggedleft: 'r' }[k]; return ''; })
      .replace(/\\noindent(?![a-zA-Z])/, () => { st.noind = true; return ''; })
      .replace(/\\setlength\{\\(parindent|leftskip|rightskip)\}\{(-?[\d.]+)cm\}/g, (_, k, v) => { st[{ parindent: 'ind', leftskip: 'left', rightskip: 'right' }[k]] = +v; return ''; })
      .replace(/\\setstretch\{([\d.]+)\}/, (_, v) => { st.ls = +v; return ''; })
      .replace(/\\interlinepenalty=10000/, () => { st.ktg = true; return ''; });
    return rest.trim() ? null : { st, body: m[4], ob: m[1].length };
  }
  function paBuild(st, body) {
    const d = [st.al && PA_AL[st.al], st.noind && '\\noindent', st.ind != null && '\\setlength{\\parindent}{' + paNum(st.ind) + 'cm}', st.left && '\\setlength{\\leftskip}{' + paNum(st.left) + 'cm}',
      st.right && '\\setlength{\\rightskip}{' + paNum(st.right) + 'cm}', st.ls && '\\setstretch{' + paNum(st.ls) + '}', st.ktg && '\\interlinepenalty=10000'].filter(Boolean).join('');
    if (!d && !st.bef && !st.aft && !st.kwn && !st.pbb) return body;
    return (st.pbb ? '\\newpage%lp\n' : '') + (st.bef ? '\\vspace{' + paNum(st.bef) + 'pt}%lp\n' : '') + '{' + d + '%lp\n' + body + '\n\\par}%lp' + (st.kwn ? '\n\\nopagebreak[4]%lp' : '') + (st.aft ? '\n\\vspace{' + paNum(st.aft) + 'pt}%lp' : '');
  }
  function paApply(st, c) {
    const unhang = () => { if (st.ind < 0) { st.left = Math.max(0, st.left + st.ind); st.ind = null; } };   // hanging = parindent -H with leftskip +H
    if ('al' in c) st.al = c.al === 'j' ? null : c.al;
    if (c.dIndent) st.left = Math.max(st.ind < 0 ? -st.ind : 0, st.left + c.dIndent * PA_STEP);
    if ('first' in c) { unhang(); st.ind = c.first; st.noind = false; }
    if ('hang' in c) { unhang(); st.left += c.hang; st.ind = -c.hang; st.noind = false; }
    if (c.noind) { unhang(); st.ind = null; st.noind = true; }
    if (c.ind) {
      const { L, H, F, z } = c.ind, hk = z ? H : (st.ind < 0 ? -st.ind : 0); st.left = L + hk;
      if (z) { if (H > 0) { st.ind = -H; st.noind = false; } else if (F > 0) { st.ind = F; st.noind = false; } else { st.ind = null; st.noind = true; } }
    }
    ['right', 'bef', 'aft'].forEach((k) => { if (k in c) st[k] = c[k] || 0; });
    if ('ls' in c) st.ls = c.ls === 1 ? null : c.ls;
    ['ktg', 'kwn', 'pbb'].forEach((k) => { if (k in c) st[k] = !!c[k]; });
    st.left = +paNum(st.left);
  }
  /* Layout ▸ Pagination. Keep with Next (\nopagebreak[4] after the paragraph), Keep Together (\interlinepenalty=10000 scoped to the paragraph's
     group) and Page break before (\newpage) are per-paragraph flags in the %lp block above. Avoid break inside = Keep Together on every
     selected paragraph + Keep with Next between them (refused for large selections). Widow/Orphan Control is document-wide: one managed
     `\clubpenalty=10000 \widowpenalty=10000 % lplum-widow` line before \begin{document}. Clear page inserts \clearpage. */
  const WO_RE = /^[ \t]*\\clubpenalty=10000[ \t]*\\widowpenalty=10000[ \t]*% lplum-widow[ \t]*\n?/m, WO_MANUAL = /\\(?:widow|club)penalty\s*=?\s*\d+/;
  const widowOn = (t) => { const bd = t.indexOf('\\begin{document}'), pre = bd < 0 ? t : tocMask(t).slice(0, bd); return WO_RE.test(bd < 0 ? t : t.slice(0, bd)) || (/\\widowpenalty\s*=?\s*10000/.test(pre) && /\\clubpenalty\s*=?\s*10000/.test(pre)); };
  function pagWidow(ta) {
    const t = ta.value, bd = t.indexOf('\\begin{document}'), s0 = ta.selectionStart, e0 = ta.selectionEnd;
    if (bd < 0) return toast('Open the main .tex file (with \\begin{document}) to change widow/orphan control');
    const m = WO_RE.exec(t.slice(0, bd));
    if (m) { fmtEdit(ta, m.index, m.index + m[0].length, '', Math.max(s0 - m[0].length, m.index), Math.max(e0 - m[0].length, m.index)); toast('Widow/orphan control off (LaTeX default penalties)'); }
    else {
      if (WO_MANUAL.test(tocMask(t).slice(0, bd))) return toast('The preamble already sets \\widowpenalty/\\clubpenalty by hand. Edit it there so the settings don’t conflict');
      const str = (t[bd - 1] === '\n' || bd === 0 ? '' : '\n') + '\\clubpenalty=10000 \\widowpenalty=10000 % lplum-widow\n';
      fmtEdit(ta, bd, bd, str, s0 + str.length, e0 + str.length); toast('Widow/orphan control on. No single first/last lines stranded across pages');
    }
    syncFmtBtns();
  }
  function pagAct(kind, el) {
    const ta = $('#codeInput'); if (!ta) return;
    if (kind === 'wo') return pagWidow(ta);
    const ps = paStateAt(ta);
    if (kind === 'kwn' || kind === 'ktg') return fmtPara({ [kind]: !(ps && ps[kind]) });
    menu(el, ['Page break before', 'Avoid break inside', 'Clear page'], (l) => {
      if (l === 'Page break before') return fmtPara({ pbb: !(ps && ps.pbb) });
      if (l === 'Avoid break inside') {
        const b = paBounds(ta.value, ta.selectionStart, ta.selectionEnd); if (b.err) return toast(b.err);
        const multi = ta.value.slice(b.A, b.B).split(/\n[ \t]*\n/).length > 1, on = !(ps && ps.ktg && (ps.kwn || !multi));   // already applied → toggle off
        if (on && (b.B - b.A > 2500 || ta.value.slice(b.A, b.B).split(/\n[ \t]*\n/).length > 8)) return toast('That selection is too long to keep on one page. Select a smaller block');
        return fmtPara({ abi: on });
      }
      const t = ta.value, last = t.slice(0, ta.selectionEnd).trimEnd().split('\n').pop().trim();
      if (/^\\(?:clearpage|newpage|cleardoublepage)$/.test(last)) return toast('A page break is already here');
      if (insertBreak('\\clearpage')) toast('\\clearpage inserted. Unlike \\newpage it also flushes pending figures/tables before starting the new page');
    });
  }
  function paBounds(t, s, e) {   // paragraph block(s) touched by the selection -> { A, B } or { err }
    const bd = t.indexOf('\\begin{document}'), ed = t.lastIndexOf('\\end{document}');
    if (bd < 0) return { err: 'Paragraph formatting needs a \\begin{document} body' };
    const lo = bd + 16, hi = ed < 0 ? t.length : ed;
    if (s < lo || e > hi) return { err: 'Place the cursor inside the document body to format a paragraph' };
    while (e > s && /\s/.test(t[e - 1])) e--;
    const pre = /[\s\S]*\n[ \t]*\n/.exec(t.slice(0, s)), post = /\n[ \t]*\n/.exec(t.slice(e));
    let A = Math.max(pre ? pre[0].length : 0, lo), B = Math.min(post ? e + post.index : t.length, hi);
    while (A < B && /\s/.test(t[A])) A++;
    while (B > A && /\s/.test(t[B - 1])) B--;
    return A >= B ? { err: 'Place the cursor inside a paragraph' } : { A, B };
  }
  function paStateAt(ta) {   // formatting of the first selected paragraph (button highlight + dialog prefill)
    const t = ta.value, b = paBounds(t, ta.selectionStart, ta.selectionEnd); if (b.err) return null;
    const x = paParse(t.slice(b.A, b.B).split(/\n[ \t]*\n/)[0]); return x && x.st;
  }
  function fmtPara(c) {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, s0 = ta.selectionStart, e0 = ta.selectionEnd, b = paBounds(t, s0, e0); if (b.err) return toast(b.err);
    const { A, B } = b, region = t.slice(A, B), parts = region.split(/(\n[ \t]*\n\s*)/), recs = []; let out = '', needLs = false;
    const isT = (p, i) => i % 2 === 0 && !p.split('\n').every((l) => /^\s*(%.*)?$/.test(l)), lastT = parts.reduce((a, p, i) => (isT(p, i) ? i : a), -1);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], rec = { os: out.length, oe: 0, ob: 0, bl: p.length, nb: 0 }; let o = p;
      rec.os = parts.slice(0, i).join('').length; rec.ns = out.length;
      if (isT(p, i)) {
        const x = paParse(p);
        if (!x) return toast('This paragraph has hand-edited %lp formatting. Fix or remove it first');
        if (!balanced(x.body) || !envOK(x.body)) return toast('Paragraph has unmatched braces or \\begin/\\end. Adjust the selection and try again');
        if (/\\begin\{(?:verbatim|Verbatim|lstlisting|minted|comment)\*?\}/.test(x.body)) return toast('Can’t format a verbatim/code block as a paragraph');
        paApply(x.st, 'abi' in c ? { ktg: c.abi, kwn: c.abi && i < lastT } : c); o = paBuild(x.st, x.body); rec.ob = rec.os + x.ob; rec.bl = x.body.length; rec.nb = rec.ns + (o === x.body ? 0 : o.lastIndexOf('\n\\par}%lp') - x.body.length);
        if (/\\setstretch\{/.test(o)) needLs = true;
      } else { rec.ob = rec.os; rec.nb = rec.ns; }
      rec.oe = rec.os + p.length; out += o; recs.push(rec);
    }
    if (out === region) return toast('Paragraph is already formatted that way');
    const pk = needLs ? ensurePackage(t, 'setspace') : null;
    if (pk === false) return toast('Could not add the needed package. Check the \\documentclass / preamble');
    const map = (p) => {   // old absolute offset -> new absolute offset
      const r = p - A;
      for (const q of recs) if (r <= q.oe) return A + (r >= q.os ? q.nb + Math.min(Math.max(r - q.ob, 0), q.bl) : q.ns - (q.os - r));
      return A + out.length - (region.length - r);
    };
    const a = map(s0), z = map(e0);
    fmtEdit(ta, A, B, out, a, z);
    if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, a + pk.str.length, z + pk.str.length);   // preamble precedes the body: selection just shifts
    syncFmtBtns();
  }
  const envOK = (b) => { let d = 0; for (const m of b.matchAll(/\\(begin|end)\{[^}]*\}/g)) { d += m[1] === 'begin' ? 1 : -1; if (d < 0) return false; } return d === 0; };
  /* Insert ▸ Header & Footer / Page Number (D.hf): one managed fancyhdr block right before \begin{document}, delimited by
     %%% lplum:hf markers and carrying its settings as a JSON comment, so every later edit rewrites that same block (never a
     second one). fancyhdr (+ lastpage for "Page X of N") come in via ensurePackage. Refuses classes/preambles it can't safely touch. */
  const HF_RE = /^[ \t]*%%% lplum:hf begin[^\n]*\n[\s\S]*?^[ \t]*%%% lplum:hf end[^\n]*(?:\n|$)/m, HF_DEF = { s: ['', '', '', '', '', ''], pos: 5, st: 0, fm: 0, hr: false, fr: false, ty: 0, fp: false };
  const HF_TYC = ['', '\\itshape ', '\\scshape ', '\\small '];
  function hfSlots(c) {   // six slot strings (header L/C/R, footer L/C/R) with the page number merged into its slot
    const pn = c.st === 2 ? 'Page \\thepage{} of \\pageref{LastPage}' : c.st === 1 ? 'Page \\thepage{}' : '\\thepage{}';
    return c.s.map((v, i) => (c.pos === i + 1 && !/\\thepage(?![a-zA-Z])/.test(v) ? (v ? v + '\\quad ' : '') + pn : v)).map((v) => (v && c.ty ? HF_TYC[c.ty] + v : v));
  }
  function hfBuild(c) {
    const sl = hfSlots(c), st = ['\\fancyhf{}'];
    sl.forEach((v, i) => { if (v) st.push('\\fancy' + (i < 3 ? 'head' : 'foot') + '[' + 'LCR'[i % 3] + ']{' + v + '}'); });
    st.push('\\renewcommand{\\headrulewidth}{' + (c.hr ? '0.4pt' : '0pt') + '}', '\\renewcommand{\\footrulewidth}{' + (c.fr ? '0.4pt' : '0pt') + '}');
    const j = { ...c }; if (!j.ty) delete j.ty; if (!j.fp) delete j.fp;   // legacy blocks stay byte-identical (no false "edited by hand")
    const pl = c.fp ? ['\\fancyhf{}', '\\renewcommand{\\headrulewidth}{0pt}', '\\renewcommand{\\footrulewidth}{0pt}'] : st;
    return ['%%% lplum:hf begin: managed by the Header & Footer dialog (edit it there, or delete this whole block)', '%lphf ' + JSON.stringify(j),
      '\\pagestyle{fancy}', '\\setlength{\\headheight}{15pt}', ...(c.fm ? ['\\renewcommand{\\thepage}{' + HF_FMT[c.fm][1] + '}'] : []), ...st,
      '\\fancypagestyle{plain}{', ...pl, '}', ...(c.fp ? ['\\AtBeginDocument{\\thispagestyle{plain}}'] : []), '%%% lplum:hf end'].join('\n') + '\n';
  }
  function hfRead(t) {
    const m = HF_RE.exec(t), c = { ...HF_DEF, s: HF_DEF.s.slice() }; if (!m) return { c, m: null, hand: false };
    try {
      const j = JSON.parse(/^%lphf (.*)$/m.exec(m[0])[1]);
      if (Array.isArray(j.s) && j.s.length === 6) c.s = j.s.map((x) => String(x));
      c.pos = Math.min(6, Math.max(0, j.pos | 0)); c.st = Math.min(2, Math.max(0, j.st | 0)); c.fm = Math.min(3, Math.max(0, j.fm | 0)); c.hr = !!j.hr; c.fr = !!j.fr; c.ty = Math.min(3, Math.max(0, j.ty | 0)); c.fp = !!j.fp;
    } catch (e) { return { c: { ...HF_DEF, s: HF_DEF.s.slice() }, m, hand: true }; }
    return { c, m, hand: hfBuild(c) !== m[0].replace(/^[ \t]+/, '') };
  }
  /* returns true when applied, false (with a toast) when refused. c === null removes the managed block. */
  function hfApply(c) {
    const ta = $('#codeInput'); if (!ta) return false;
    const t = ta.value, mk = tocMask(t), bd = mk.indexOf('\\begin{document}'), dc = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/m.exec(mk);
    if (!dc || bd < 0) { toast('Open the main .tex file (with \\documentclass and \\begin{document}) to set headers and footers'); return false; }
    if (/^(letter|beamer|memoir|scrlttr2|standalone)$/.test(dc[1].trim())) { toast('The ' + dc[1].trim() + ' class has its own page-style system: fancyhdr headers/footers are not supported here'); return false; }
    const old = HF_RE.exec(t); if (!old && /^[ \t]*%%% lplum:hf (begin|end)/m.test(t)) { toast('A lplum:hf marker is unpaired. Fix or delete it before editing headers and footers'); return false; }
    const rest = old ? mk.slice(0, old.index) + mk.slice(old.index + old[0].length) : mk, pre = rest.slice(0, rest.indexOf('\\begin{document}'));
    if (/\\pagestyle\s*\{|\\(?:fancy(?:head|foot|hf)|[lcr](?:head|foot)|[io](?:head|foot))\b|\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:scrlayer-scrpage|scrpage2|titleps|fancyheadings)\b/.test(pre)) { toast('The preamble already sets a page style outside the managed block. Remove it first so the two don’t conflict'); return false; }
    const edits = [];
    if (c) {
      const pk = ensurePackage(t, 'fancyhdr', ...(hfSlots(c).some((v) => /LastPage/.test(v)) ? ['lastpage'] : [])); if (pk === false) { toast('Could not add fancyhdr. Check the \\documentclass / preamble'); return false; }
      if (pk) edits.push({ a: pk.pos, b: pk.pos, str: pk.str });
      const blk = hfBuild(c);
      if (old) { const a = old.index + (old[0].length - old[0].replace(/^[ \t]+/, '').length); if (old[0].slice(a - old.index) !== blk) edits.push({ a, b: old.index + old[0].length, str: blk + (old[0].endsWith('\n') ? '' : '\n') }); }
      else { const ls = t.lastIndexOf('\n', bd - 1) + 1, own = !t.slice(ls, bd).trim(); edits.push({ a: own ? ls : bd, b: own ? ls : bd, str: (own ? '' : '\n') + blk + '\n' }); }
    } else if (old) edits.push({ a: old.index, b: old.index + old[0].length, str: '' });
    if (!edits.length) { toast(c ? 'Header & footer are already set that way' : 'No header/footer settings to reset'); return true; }
    edits.sort((x, y) => y.a - x.a);
    const mp = (p) => edits.reduce((n, e) => (p >= e.b ? n + e.str.length - (e.b - e.a) : p > e.a ? n - (p - e.a) : n), p), s0 = mp(ta.selectionStart), e0 = mp(ta.selectionEnd);
    edits.forEach((e) => fmtEdit(ta, e.a, e.b, e.str, s0, e0));
    return true;
  }
  function hfQuick(l) {   // Page Number menu: Top = header right, Bottom = footer center; "Page X of Y" keeps the current position
    const ta = $('#codeInput'); if (!ta) return;
    const { c } = hfRead(ta.value);
    if (l === 'Top of Page') c.pos = 3; else if (l === 'Bottom of Page') c.pos = 5; else if (l === 'Page X of Y') { c.st = 2; if (!c.pos) c.pos = 5; } else return;
    if (hfApply(c)) toast('Page number set: ' + HF_POS[c.pos].toLowerCase());
  }
  const hfEsc = (x) => (x.includes('$') ? x : x.replace(/\\.|[&%#_]/g, (m) => (m.length > 1 ? m : '\\' + m)));   // plain text in the fields: & % # _ are escaped for you
  const hfUnesc = (x) => (x.includes('$') ? x : x.replace(/\\([&%#_])/g, '$1'));
  function hfPrev(x, pg, c) {   // LaTeX slot → what the compiled page shows (sample marks, real number format, real page total when a PDF exists)
    let n = 'N'; try { const k = ctx.PV && ctx.PV.doc && ctx.PV.doc.numPages; if (k && !c.fm) n = String(k); } catch (e) { /* no PDF yet */ }
    const lbl = [String(pg), ['', 'i', 'ii'][pg], ['', 'I', 'II'][pg], ['', 'a', 'b'][pg]][c.fm] || String(pg), date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const t = String(x).replace(/\\\\/g, ' ')
      .replace(/\\(q?)quad(?![a-zA-Z])\s?/g, (m, q) => (q ? '\u2003\u2003' : '\u2003'))
      .replace(/\\nouppercase\s*\{\s*\\leftmark\s*\}/g, '1 Introduction').replace(/\\nouppercase\s*\{\s*\\rightmark\s*\}/g, '1.1 Background')
      .replace(/\\leftmark(?![a-zA-Z])\s?/g, '1 INTRODUCTION').replace(/\\rightmark(?![a-zA-Z])\s?/g, '1.1 BACKGROUND')
      .replace(/\\thepage(?![a-zA-Z])(\{\})?/g, lbl).replace(/\\pageref\{LastPage\}/g, n).replace(/\\today(?![a-zA-Z])(\{\})?/g, date)
      .replace(/\\(?:textbf)\{([^{}]*)\}/g, '\uE001$1\uE002').replace(/\\(?:textit|emph)\{([^{}]*)\}/g, '\uE003$1\uE004').replace(/\\textsc\{([^{}]*)\}/g, '\uE005$1\uE006')
      .replace(/\\([&%#_$])/g, '$1').replace(/\\[a-zA-Z]+\*?\s?/g, '').replace(/[{}]/g, '');
    return esc(t).replace(/\uE001/g, '<b>').replace(/\uE002/g, '</b>').replace(/\uE003/g, '<i>').replace(/\uE004/g, '</i>').replace(/\uE005/g, '<span class="sc">').replace(/\uE006/g, '</span>');
  }
  function hfDialog(focus) {
    const ta = $('#codeInput'); if (!ta) return;
    const { c, hand } = hfRead(ta.value); if (hand) toast('The header/footer block was edited by hand: applying will replace it');
    const d = dlg(D.hf(focus)), ins = $$('[data-s]', d.el), pv = $$('[data-p]', d.el), btns = $$('.dlg__foot .btn', d.el), sheet = $('.hfp__sheet', d.el);
    // option controls, in markup order: selects = position, style, numbering, text style; checkboxes = header line, footer line, blank first page
    const sels = $$('select', d.el), cks = $$('input[type=checkbox]', d.el);
    ins.forEach((n, i) => { n.value = hfUnesc(c.s[i]); }); sels[0].selectedIndex = c.pos; sels[1].selectedIndex = c.st; sels[2].selectedIndex = c.fm; sels[3].selectedIndex = c.ty;
    cks[0].checked = c.hr; cks[1].checked = c.fr; cks[2].checked = c.fp;
    let pg = c.fp ? 1 : 2, last = ins[focus === 'f' ? 4 : 1];
    const read = () => ({ s: ins.map((n) => hfEsc(n.value.trim())), pos: sels[0].selectedIndex, st: sels[1].selectedIndex, fm: sels[2].selectedIndex, ty: sels[3].selectedIndex, hr: cks[0].checked, fr: cks[1].checked, fp: cks[2].checked });
    const paint2 = () => {
      const v = read(), sl = hfSlots(v), blank = v.fp && pg === 1;
      sheet.classList.toggle('has-hr', v.hr && !blank); sheet.classList.toggle('has-fr', v.fr && !blank); sheet.classList.toggle('is-blank', blank); sheet.dataset.ty = v.ty;
      pv.forEach((n) => { n.innerHTML = blank ? '' : hfPrev(sl[n.dataset.p], pg, v); n.classList.toggle('is-f', document.activeElement === ins[n.dataset.p]); });
      $$('.hfp__seg button', d.el).forEach((b) => b.classList.toggle('is-on', +b.dataset.pg === pg));
    };
    d.el.addEventListener('input', paint2); d.el.addEventListener('change', paint2);
    d.el.addEventListener('focusin', (e) => { if (ins.includes(e.target)) last = e.target; paint2(); });
    d.el.addEventListener('focusout', () => setTimeout(paint2, 0));
    d.el.addEventListener('mousedown', (e) => { if (e.target.closest('[data-ins]')) e.preventDefault(); });   // keep the caret in the field
    d.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pg]'), i = e.target.closest('[data-ins]'), p = e.target.closest('[data-p]');
      if (b) { pg = +b.dataset.pg; paint2(); }
      else if (p) ins[p.dataset.p].focus();
      else if (i) { const n = last, a = n.selectionStart, z = n.selectionEnd; n.setRangeText(i.dataset.ins, a, z, 'end'); n.focus(); n.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    cks[2].addEventListener('change', () => { if (cks[2].checked) { pg = 1; paint2(); } });
    d.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ins.includes(e.target)) { e.preventDefault(); btns[2].click(); } });
    paint2();
    btns[1].onclick = () => { if (hfApply(null)) { d.close(); ta.focus(); } };
    btns[2].onclick = () => {
      const v = read(); let bad = null;
      v.s.forEach((x, i) => { if (!bad && !balanced(x)) bad = ins[i]; });
      if (bad) { toast('Check the highlighted field: every { needs a matching }'); bad.focus(); return; }
      if (hfApply(v)) { d.close(); ta.focus(); toast('Header & footer updated'); }   // on a refusal the dialog stays open, so nothing typed is lost
    };
  }
  /* Design ▸ Page Decoration (D.decor). Page Borders, Page Color and Watermark on the ribbon all open this one dialog: ONE managed block
     before \begin{document}, delimited by %%% lplum:pd markers and carrying its settings as a JSON comment (%lppd), so every later
     change rewrites that block (never a second one).
     Model: { v: 2, w: watermark, bg: 'RRGGBB' | '', bd: border, ov: [{ r: 'pages', bg?: 'RRGGBB', bd?: border }] }.
     A border is { d: distance from the page edge in pt, s: [top, right, bottom, left] }; a side is { on, t: solid|dashed|dotted|double,
     w: pt, c: 'RRGGBB' }, and a switched-off side keeps its settings. A rule in ov overrides the document-wide background and/or
     border on the PDF pages it names ("1, 3-5, 8-", counted as pages of the compiled PDF); later rules win and a property a rule
     does not carry is inherited. Background and borders are drawn in one eso-pic layer from the very shapes the dialog preview
     draws (bdShapes), so the preview cannot drift from the output. eso-pic + xcolor + tikz (+ fontspec for a watermark font) come in
     via ensurePackage. Headers, footers and margins are untouched. Blocks written by the older dialog (v1: b, c, hex) are read and upgraded.
     Watermark: w is the text; wo (written only with a text) is its style { f: font family ('' = the document font, needs XeLaTeX/LuaLaTeX),
     z: size in pt (0 = auto), b, i, c: 'RRGGBB', o: opacity 0-100, a: angle in degrees, counterclockwise (TikZ rotate; 0, 45, 90, 180 are the presets),
     x, y: centre as % of the page from its left / top edge }. It is drawn as one TikZ node in the same eso-pic layer, behind the text and above the
     page color and border, on every page (page sets do not apply). A block with a text and no wo was drawn by draftwatermark: it is read with the
     default style, and applying replaces it (and removes the \usepackage{draftwatermark} line the older dialog added). */
  const PD_RE = /^[ \t]*%%% lplum:pd begin[^\n]*\n[\s\S]*?^[ \t]*%%% lplum:pd end[^\n]*(?:\n|$)/m;
  const PD_STY = ['solid', 'dashed', 'dotted', 'double'], PD_MAXR = 12, PD_NB = [[3, 1], [2, 0], [3, 1], [2, 0]];   // PD_NB: the sides at the start and end of each side's run (top, right, bottom, left)
  const PD_PRE = { none: [0, 0, 0, 0], all: [1, 1, 1, 1], tb: [1, 0, 1, 0], lr: [0, 1, 0, 1] };
  const pdSide = () => ({ on: 0, t: 'solid', w: 1, c: '000000' });
  const pdBd = () => ({ d: 28, s: [pdSide(), pdSide(), pdSide(), pdSide()] });
  const PD_DEF = () => ({ v: 2, w: '', bg: '', bd: pdBd(), ov: [] });
  const pdWm = () => ({ f: '', z: 0, b: 0, i: 0, c: '808080', o: 30, a: 45, x: 50, y: 50 });   // watermark style defaults (see the model above)
  const pdClone = (o) => JSON.parse(JSON.stringify(o));
  const pdQ = (n) => String(Math.round(n * 1000) / 1000);
  const pdOn = (b) => !!b && b.s.some((s) => s.on);
  const pdHex = (x) => (/^#?[0-9a-f]{6}$/i.test(String(x || '').trim()) ? String(x).trim().replace('#', '').toUpperCase() : '');
  const pdNum = (x, a, b, f) => { x = parseFloat(x); return isFinite(x) ? Math.min(b, Math.max(a, Math.round(x * 100) / 100)) : f; };
  function pdNormBd(j) {
    const b = pdBd(); if (!j || typeof j !== 'object') return b;
    b.d = pdNum(j.d, 0, 72, 28);
    b.s.forEach((s, i) => { const x = (Array.isArray(j.s) && j.s[i]) || {}; s.on = x.on ? 1 : 0; s.t = PD_STY.includes(x.t) ? x.t : 'solid'; s.w = pdNum(x.w, 0.25, 12, 1); s.c = pdHex(x.c) || '000000'; });
    return b;
  }
  function pdWmNorm(j) {
    const o = pdWm(); if (!j || typeof j !== 'object') return o;
    const f = typeof j.f === 'string' ? j.f.trim() : ''; o.f = /^[\p{L}\p{N} .+-]{1,64}$/u.test(f) ? f : '';
    o.z = parseFloat(j.z) > 0 ? pdNum(j.z, 6, 400, 0) : 0; o.b = j.b ? 1 : 0; o.i = j.i ? 1 : 0; o.c = pdHex(j.c) || o.c;
    o.o = Math.round(pdNum(j.o, 0, 100, o.o)); o.a = Math.round(pdNum(j.a, -180, 180, o.a)); if (o.a === -180) o.a = 180;
    o.x = Math.round(pdNum(j.x, 0, 100, o.x)); o.y = Math.round(pdNum(j.y, 0, 100, o.y));
    return o;
  }
  function pdNorm(j) {
    if (!j || typeof j !== 'object') return PD_DEF();
    const c = PD_DEF(); c.w = String(j.w || '');
    if (j.v >= 2) {
      c.bg = pdHex(j.bg); c.bd = pdNormBd(j.bd); if (j.wo && typeof j.wo === 'object') c.wo = pdWmNorm(j.wo);
      c.ov = (Array.isArray(j.ov) ? j.ov : []).slice(0, PD_MAXR).map((o) => { const r = { r: String((o && o.r) || '') }; if (o && pdHex(o.bg)) r.bg = pdHex(o.bg); if (o && o.bd) r.bd = pdNormBd(o.bd); return r; });
    } else {   // v1: b = 0 none / 1 single / 2 double line, c = 0 none or a PD_COL index (1 with hex = custom color)
      const b = Math.min(2, Math.max(0, j.b | 0)), k = Math.min(2, Math.max(0, j.c | 0));
      if (k) c.bg = pdHex(j.hex) || PD_COL[k][1];
      if (b) c.bd.s.forEach((s) => { s.on = 1; s.t = b === 2 ? 'double' : 'solid'; s.w = b === 2 ? 3 : 0.8; });
    }
    return c;
  }
  function pdPages(s) {   // "1, 3-5, 8-" → [[1,1],[3,5],[8,99999]]; null when empty or invalid
    const out = [];
    for (const x of String(s).split(',').map((v) => v.trim()).filter(Boolean)) {
      const m = /^(\d{1,4})(?:\s*(-)\s*(\d{1,4})?)?$/.exec(x); if (!m) return null;
      const a = +m[1], b = m[2] ? (m[3] ? +m[3] : 99999) : a; if (a < 1 || b < a) return null; out.push([a, b]);
    }
    return out.length ? out : null;
  }
  const pdPgStr = (rg) => rg.map(([a, b]) => (a === b ? '' + a : b >= 99999 ? a + '-' : a + '-' + b)).join(', ');
  const pdPgHas = (rg, p) => rg.some(([a, b]) => p >= a && p <= b);
  function pdClean(c, legacy) {   // what is stored: a document border with no side on is dropped, a rule that sets nothing (or names no valid pages) is dropped, the watermark style is kept only with a text (legacy: the older draftwatermark block, which has none)
    const o = { v: 2, w: c.w, bg: c.bg, bd: pdOn(c.bd) ? c.bd : pdBd(), ov: [] };
    c.ov.forEach((r) => { const rg = pdPages(r.r); if (rg && (r.bg || r.bd)) { const x = { r: pdPgStr(rg) }; if (r.bg) x.bg = r.bg; if (r.bd) x.bd = r.bd; o.ov.push(x); } });
    if (c.w && !legacy) o.wo = pdWmNorm(c.wo);
    return o;
  }
  const pdEff = (c, p) => {   // what PDF page p gets: the document values, then every rule naming p (later rules win)
    let bg = c.bg, bd = c.bd;
    c.ov.forEach((r) => { const rg = pdPages(r.r); if (rg && pdPgHas(rg, p)) { if (r.bg) bg = r.bg; if (r.bd) bd = r.bd; } });
    return { bg, bd: pdOn(bd) ? bd : null };
  };
  /* The border as plain shapes: { r: [x1, y1, x2, y2], c } filled rectangles and { l: [x1, y1, x2, y2], c, w, cap, da } dashed strokes.
     A coordinate is [pt, 1 when measured from the far page edge], x from the left / right and y from the bottom / top. minW widens
     hairlines for the small preview. Double = two strips of a third of the thickness; the inner strip stops at an adjacent side's inner edge. */
  function bdShapes(b, minW) {
    const S = b.s, d = b.d, out = [];
    const band = (i, o0, o1, a0, a1) => {   // strip from o0 to o1 inside the border's outer edge, a0 / a1 short of its two ends
      if (i === 0 || i === 2) return [[d + a0, 0], i === 0 ? [d + o1, 1] : [d + o0, 0], [d + a1, 1], i === 0 ? [d + o0, 1] : [d + o1, 0]];
      return [i === 3 ? [d + o0, 0] : [d + o1, 1], [d + a0, 0], i === 3 ? [d + o1, 0] : [d + o0, 1], [d + a1, 1]];
    };
    const inset = (n) => { const s = S[n]; if (!s.on) return 0; const w = Math.max(s.w, minW); return s.t === 'double' ? 2 * w / 3 : s.t === 'solid' ? w : 0; };
    S.forEach((s, i) => {
      if (!s.on) return;
      const w = Math.max(s.w, minW), g = w / 3;
      if (s.t === 'solid') out.push({ r: band(i, 0, w, 0, 0), c: s.c });
      else if (s.t === 'double') out.push({ r: band(i, 0, g, 0, 0), c: s.c }, { r: band(i, 2 * g, w, inset(PD_NB[i][0]), inset(PD_NB[i][1])), c: s.c });
      else { const dot = s.t === 'dotted'; out.push({ l: band(i, w / 2, w / 2, 0, 0), c: s.c, w, cap: dot ? 'round' : 'butt', da: dot ? [0, Math.max(2 * w, w + 1.5)] : [Math.max(3 * w, 3), Math.max(2 * w, 2)] }); }
    });
    return out;
  }
  function pdGen(c0, legacy) {   // → { txt: the managed block, pk: packages it needs }; legacy: the older draftwatermark rendering, used only to recognise blocks that dialog wrote
    const c = pdClean(c0, legacy), cols = new Set(), defs = [], pick = [], cn = (x) => { cols.add(x); return 'lpC' + x; };
    let tik = false;
    const X = ([n, far]) => (far ? '\\paperwidth-' : '') + pdQ(n) + 'pt', Y = ([n, far]) => (far ? '\\paperheight-' : '') + pdQ(n) + 'pt';
    const border = (b) => {
      const sh = bdShapes(b, 0); if (!sh.length) return ''; tik = true;
      return '\\begin{tikzpicture}[overlay]%\n' + sh.map((p) => (p.r
        ? '\\fill[color=' + cn(p.c) + '] (' + X(p.r[0]) + ',' + Y(p.r[1]) + ') rectangle (' + X(p.r[2]) + ',' + Y(p.r[3]) + ');%'
        : '\\draw[color=' + cn(p.c) + ', line width=' + pdQ(p.w) + 'pt, line cap=' + p.cap + ', dash pattern=on ' + pdQ(p.da[0]) + 'pt off ' + pdQ(p.da[1]) + 'pt] (' + X(p.l[0]) + ',' + Y(p.l[1]) + ') -- (' + X(p.l[2]) + ',' + Y(p.l[3]) + ');%')).join('\n') + '\n\\end{tikzpicture}';
    };
    const mk = (id, o) => {   // defines \lpFill<id> / \lpBd<id> for what o carries and returns the \def lines that select them
      let s = '';
      if (o.bg) { defs.push('\\newcommand{\\lpFill' + id + '}{\\hbox to 0pt{\\color{' + cn(o.bg) + '}\\rule{\\paperwidth}{\\paperheight}\\hss}}'); s += '\\def\\lpBgc{\\lpFill' + id + '}'; }
      if (o.bd) { const t = border(o.bd); if (t) defs.push('\\newcommand{\\lpBd' + id + '}{' + t + '}'); s += '\\def\\lpBdc{' + (t ? '\\lpBd' + id : '') + '}'; }
      return s;
    };
    const base = mk('Base', { bg: c.bg, bd: pdOn(c.bd) ? c.bd : null });
    c.ov.forEach((r, i) => { const s = mk(String.fromCharCode(65 + i), r); if (s) pick.push('\\lpmfalse' + pdPages(r.r).map(([a, b]) => '\\lpRng{' + a + '}{' + b + '}').join('') + '\\iflpm' + s + '\\fi%'); });
    const wmOn = !!c.w && !legacy, wmNode = () => {   // the watermark: one rotated node, centred on (x, y) of the page; auto size repeats pdWmFit with \paperwidth
      const o = c.wo, n = Math.max(1, c.w.replace(/\\([&%$#_])/g, '$1').trim().length), z = o.z ? pdQ(o.z) : '\\lpWmZ'; tik = true;
      return '\\begin{tikzpicture}[overlay]%\n' + (o.z ? '' : '\\pgfmathsetmacro{\\lpWmZ}{min(110,max(14,0.7*\\paperwidth/(0.62*' + n + ')))}%\n')
        + '\\node[inner sep=0pt, anchor=center' + (o.a ? ', rotate=' + o.a : '') + ', text=' + cn(o.c) + (o.o < 100 ? ', text opacity=' + pdQ(o.o / 100) : '') + '] at (' + pdQ(o.x / 100) + '*\\paperwidth,' + pdQ(1 - o.y / 100) + '*\\paperheight) {\\normalfont'
        + (o.f ? '\\fontspec{' + o.f + '}' : '') + '\\fontsize{' + z + '}{' + z + '}\\selectfont' + (o.b ? '\\bfseries' : '') + (o.i ? '\\itshape' : '') + ' ' + c.w + '};%\n\\end{tikzpicture}';
    };
    if (wmOn) defs.push('\\newcommand{\\lpWm}{' + wmNode() + '}');
    const out = ['%%% lplum:pd begin: managed by Page Decoration (edit it there, or delete this whole block)', '%lppd ' + JSON.stringify(c)], pk = [];
    if (defs.length) {
      pk.push('xcolor', 'eso-pic'); if (tik) pk.push('tikz'); if (wmOn && c.wo.f) pk.push('fontspec');
      [...cols].forEach((x) => out.push('\\definecolor{lpC' + x + '}{HTML}{' + x + '}'));
      if (pick.length) out.push('\\newcounter{lpphys}\\newif\\iflpm', '\\newcommand{\\lpRng}[2]{\\ifnum\\value{lpphys}<#1\\relax\\else\\ifnum\\value{lpphys}>#2\\relax\\else\\lpmtrue\\fi\\fi}');
      out.push(...defs, '\\newcommand{\\lpDecoration}{%', (pick.length ? '\\stepcounter{lpphys}%\n' : '') + '\\def\\lpBgc{}\\def\\lpBdc{}' + base + '%', ...pick, '\\AtPageLowerLeft{\\lpBgc}%', '\\AtPageLowerLeft{\\lpBdc}%', ...(wmOn ? ['\\AtPageLowerLeft{\\lpWm}%'] : []), '}', '\\AddToShipoutPictureBG{\\lpDecoration}');
    }
    if (c.w && legacy) { pk.push('draftwatermark'); out.push('\\SetWatermarkText{' + c.w + '}', '\\SetWatermarkScale{1}', '\\SetWatermarkColor[gray]{0.85}'); }
    out.push('%%% lplum:pd end'); return { txt: out.join('\n') + '\n', pk };
  }
  const pdBuild = (c, legacy) => pdGen(c, legacy).txt;
  function pdRead(t) {
    const m = PD_RE.exec(t); if (!m) return { c: PD_DEF(), hand: false };
    let j; try { j = JSON.parse(/^%lppd (.*)$/m.exec(m[0])[1]); } catch (e) { return { c: PD_DEF(), hand: true }; }
    const c = pdNorm(j);
    const blk = m[0].replace(/^[ \t]+/, '');
    return { c, hand: j.v >= 2 && pdBuild(c) !== blk && !(c.w && !c.wo && pdBuild(c, true) === blk) };   // a block the older (draftwatermark) dialog wrote is not a hand edit
  }
  /* true when applied, false (with a toast) when refused; c with nothing set (or null) removes the managed block. */
  function pdApply(c) {
    const ta = $('#codeInput'); if (!ta) return false;
    const t = ta.value, mk = tocMask(t), bd = mk.indexOf('\\begin{document}'), dc = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/m.exec(mk);
    if (!dc || bd < 0) { toast('Open the main .tex file (with \\documentclass and \\begin{document}) to set page decoration'); return false; }
    const old = PD_RE.exec(t); if (!old && /^[ \t]*%%% lplum:pd (begin|end)/m.test(t)) { toast('A lplum:pd marker is unpaired. Fix or delete it before editing page decoration'); return false; }
    const lg = old && /\\SetWatermarkText\b/.test(old[0]) ? /^[ \t]*\\usepackage\{draftwatermark\}[ \t]*$/m.exec(mk.slice(0, bd)) : null;   // the older dialog's own package line (without it the package prints DRAFT)
    const rest = old ? mk.slice(0, old.index) + mk.slice(old.index + old[0].length) : mk, pre0 = rest.slice(0, rest.indexOf('\\begin{document}')), pre = lg ? pre0.replace(/^[ \t]*\\usepackage\{draftwatermark\}[ \t]*$/m, '') : pre0;
    if (/\\(?:pagecolor|SetWatermarkText|AddToShipoutPicture\w*)\b|\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:draftwatermark|background|pagecolor|fancybox)\b/.test(pre)) { toast('The preamble already sets a page color, watermark or border outside the managed block. Remove it first so the two don’t conflict'); return false; }
    const cl = c && pdClean(c), on = cl && (cl.w || cl.bg || pdOn(cl.bd) || cl.ov.length), edits = [];
    if (cl && cl.w && cl.wo.f && needsXeTeX(t)) { toast('A watermark font uses fontspec, which needs XeLaTeX or LuaLaTeX. This document is set up for pdfLaTeX. Use “Document font” or switch the engine. Nothing was changed'); return false; }
    if (lg) edits.push({ a: lg.index > 0 ? lg.index - 1 : lg.index, b: lg.index + lg[0].length, str: '' });
    if (on) {
      const g = pdGen(cl), pk = ensurePackage(t, ...g.pk); if (pk === false) { toast('Could not add the page-decoration packages. Check the \\documentclass / preamble'); return false; }
      if (pk) edits.push({ a: pk.pos, b: pk.pos, str: pk.str });
      const blk = g.txt;
      if (old) { const a = old.index + (old[0].length - old[0].replace(/^[ \t]+/, '').length); if (old[0].slice(a - old.index) !== blk) edits.push({ a, b: old.index + old[0].length, str: blk + (old[0].endsWith('\n') ? '' : '\n') }); }
      else { const ls = t.lastIndexOf('\n', bd - 1) + 1, own = !t.slice(ls, bd).trim(); edits.push({ a: own ? ls : bd, b: own ? ls : bd, str: (own ? '' : '\n') + blk + '\n' }); }
    } else if (old) edits.push({ a: old.index, b: old.index + old[0].length, str: '' });
    if (!edits.length) { toast(on ? 'Page decoration is already set that way' : 'No page decoration to remove'); return true; }
    edits.sort((x, y) => y.a - x.a);
    const mp = (p) => edits.reduce((n, e) => (p >= e.b ? n + e.str.length - (e.b - e.a) : p > e.a ? n - (p - e.a) : n), p), s0 = mp(ta.selectionStart), e0 = mp(ta.selectionEnd);
    edits.forEach((e) => fmtEdit(ta, e.a, e.b, e.str, s0, e0));
    return true;
  }
  function pdPaper(t) {   // [width, height] in pt of the paper the preamble asks for (letter when it names none)
    const mk = tocMask(t), i = mk.indexOf('\\begin{document}'), p = i < 0 ? mk : mk.slice(0, i);
    const bm = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{beamer\}/.exec(p);   // beamer: a slide, 128 x 96 mm unless aspectratio= says otherwise
    if (bm) { const mm = { 43: [128, 96], 169: [160, 90], 1610: [160, 100], 149: [140, 90], 141: [148.5, 105], 54: [125, 100], 32: [135, 90] }[(/aspectratio\s*=\s*(\d+)/.exec(bm[1] || '') || [])[1]] || [128, 96]; return mm.map((v) => Math.round(v * 2.8346)); }
    return /\ba4paper\b|\bpaper\s*=\s*a4\b/.test(p) ? [595, 842] : /\ba5paper\b|\bpaper\s*=\s*a5\b/.test(p) ? [420, 595] : /\blegalpaper\b|\bpaper\s*=\s*legal\b/.test(p) ? [612, 1008] : [612, 792];
  }
  const pdWmFit = (n, W) => Math.min(110, Math.max(14, 0.7 * W / (0.62 * Math.max(1, n))));   // auto watermark size in pt; pdGen repeats it in TeX with \paperwidth
  const pdFam = (n) => (n ? "'" + n.replace(/[^\p{L}\p{N} .+-]/gu, '') + "', " + (/mono|code|cursor/i.test(n) ? 'monospace' : /sans|heros/i.test(n) ? 'sans-serif' : /caveat|pacifico/i.test(n) ? 'cursive, sans-serif' : 'serif') : 'serif');
  function pdWmShape(c, W, H, mf) {   // the watermark as the preview draws it, in page points (null without a text); the same style pdGen writes
    const t = c.w.trim(); if (!t) return null; const o = pdWmNorm(c.wo);
    return { t, z: o.z || pdWmFit(t.length, W), f: o.f || mf || '', b: o.b, i: o.i, c: o.c, o: o.o, a: o.a, x: W * o.x / 100, y: H * o.y / 100 };
  }
  function pdSvg(W, H, bg, bd, minW, wm) {   // one page of the preview, in page points; wm: a pdWmShape or null
    const x = ([n, far]) => (far ? W - n : n), y = ([n, far]) => (far ? n : H - n);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><rect width="' + W + '" height="' + H + '" fill="#' + (bg || 'FFFFFF') + '"/>';
    (bd ? bdShapes(bd, minW) : []).forEach((p) => {
      if (p.r) { const x0 = x(p.r[0]), x1 = x(p.r[2]), y0 = y(p.r[3]), y1 = y(p.r[1]); s += '<rect x="' + pdQ(Math.min(x0, x1)) + '" y="' + pdQ(Math.min(y0, y1)) + '" width="' + pdQ(Math.abs(x1 - x0)) + '" height="' + pdQ(Math.abs(y1 - y0)) + '" fill="#' + p.c + '"/>'; }
      else s += '<line x1="' + pdQ(x(p.l[0])) + '" y1="' + pdQ(y(p.l[1])) + '" x2="' + pdQ(x(p.l[2])) + '" y2="' + pdQ(y(p.l[3])) + '" stroke="#' + p.c + '" stroke-width="' + pdQ(p.w) + '" stroke-linecap="' + p.cap + '" stroke-dasharray="' + pdQ(p.da[0]) + ' ' + pdQ(p.da[1]) + '"/>';
    });
    for (let ty = 110, k = 0; ty < H - 110; ty += 22, k++) s += '<rect x="90" y="' + ty + '" width="' + (W - 180 - (k % 6 === 5 ? 140 : 0)) + '" height="6" fill="#8A9099" opacity=".3"/>';
    if (wm) s += '<text x="' + pdQ(wm.x) + '" y="' + pdQ(wm.y) + '" text-anchor="middle" dominant-baseline="central" font-family="' + esc(pdFam(wm.f)) + '" font-size="' + pdQ(wm.z) + '"' + (wm.b ? ' font-weight="700"' : '') + (wm.i ? ' font-style="italic"' : '') + ' style="font-synthesis:none" fill="#' + wm.c + '" fill-opacity="' + pdQ(wm.o / 100) + '" transform="rotate(' + pdQ(-wm.a) + ' ' + pdQ(wm.x) + ' ' + pdQ(wm.y) + ')">' + esc(wm.t) + '</text>';
    return s + '</svg>';
  }
  function pdDialog(focus) {
    const ta = $('#codeInput'); if (!ta) return;
    const { c, hand } = pdRead(ta.value); if (hand) toast('The page-decoration block was edited by hand: applying will replace it');
    const st = pdClone(c), [PW, PH] = pdPaper(ta.value), ui = { tab: ['bg', 'bd', 'wm'].includes(focus) ? focus : 'bg', sc: -1, tg: 'all' };
    st.w = st.w.replace(/\\([&%$#_])/g, '$1');   // the dialog edits plain text; it is escaped again on Apply
    const d = dlg(D.decor(ui.tab)), el = d.el, q = (s) => $(s, el), btns = $$('.dlg__foot .btn', el);
    const scopeSel = q('[data-k="scope"]'), pgIn = q('[data-k="pages"]'), bgHex = q('[data-k="bghex"]'), bdHex = q('[data-k="bdhex"]'), styleSel = q('[data-k="style"]');
    const wIn = q('[data-k="w"]'), dIn = q('[data-k="d"]'), wmIn = q('[data-k="wm"]'), swBg = q('[data-w="bg"] i'), swBd = q('[data-w="bd"] i'), sheet = q('[data-r="sheet"]');
    sheet.style.aspectRatio = PW + ' / ' + PH;
    st.wo = pdWmNorm(st.wo);
    const xe = !needsXeTeX(ta.value), mf = ((/\\setmainfont(?:\[[^\]]*\])?\{([^{}]+)\}/.exec(tocMask(ta.value)) || [])[1] || '').trim();   // xe: fontspec is usable; mf: the document font, shown in the preview when the watermark has none of its own
    const wmz = q('[data-k="wmz"]'), wmHex = q('[data-k="wmhex"]'), wmO = q('[data-k="wmo"]'), wmOn = q('[data-k="wmon"]'), wmA = q('[data-k="wma"]'), wmX = q('[data-k="wmx"]'), wmY = q('[data-k="wmy"]');
    const swWm = q('[data-w="wm"] i'), fontBtn = q('[data-a="wmfont"]'), fontTxt = q('[data-r="wmfont"]');
    const setWm = (p, v) => { st.wo[p] = v; sync(); };
    const pickFont = async (v) => {   // only a family the compile server reports is accepted, so the dialog never offers one XeLaTeX cannot load
      if (!v) return setWm('f', '');
      if (!/^[\p{L}\p{N} .+-]+$/u.test(v)) return toast('Unsupported font name');
      const ok = await fontOK(v); if (ok === null) return;
      if (!ok) return toast('Font “' + v + '” isn’t available to XeLaTeX: not applied');
      setWm('f', v);
    };
    const rule = () => (ui.sc >= 0 ? st.ov[ui.sc] : null);
    const bdView = () => { const r = rule(); return (r && r.bd) || st.bd; };   // the border the Borders tab shows (a page set without its own shows the document's)
    const bdEdit = () => { const r = rule(); return r ? (r.bd || (r.bd = pdClone(st.bd))) : st.bd; };   // the first edit inside a page set gives it its own copy
    const ids = () => (ui.tg === 'all' ? [0, 1, 2, 3] : [ui.tg]);
    const setIf = (n, v) => { if (document.activeElement !== n) n.value = v; };
    const setProp = (p, v) => { const b = bdEdit(); ids().forEach((i) => { b.s[i][p] = v; }); sync(); };
    const setBg = (x) => { const r = rule(); if (r) { if (x) r.bg = x; else delete r.bg; } else st.bg = x || ''; sync(); };
    const hexOf = (v) => { v = v.trim().replace(/^#/, ''); return pdHex(/^[0-9a-f]{3}$/i.test(v) ? v.replace(/./g, '$&$&') : v); };
    function sync() {
      const r = rule(), b = bdView(), on = b.s.map((s) => s.on), wmTab = ui.tab === 'wm', wm = st.w.trim();
      if (ui.tg !== 'all' && !on[ui.tg]) ui.tg = 'all';
      // scope bar
      const labels = ['Entire document'].concat(st.ov.map((x) => 'Pages ' + (x.r.trim() || '(set pages)')));
      if (labels.length !== scopeSel.options.length || labels.some((t, i) => scopeSel.options[i].text !== t)) scopeSel.innerHTML = labels.map((t) => '<option>' + esc(t) + '</option>').join('');
      scopeSel.selectedIndex = ui.sc + 1; scopeSel.disabled = wmTab; q('[data-r="scope"]').classList.toggle('is-off', wmTab);
      q('[data-r="pgrow"]').hidden = !r; q('[data-a="rmrule"]').hidden = !r; q('[data-a="addrule"]').disabled = wmTab || st.ov.length >= PD_MAXR;
      if (r) { setIf(pgIn, r.r); pgIn.classList.toggle('is-bad', !!r.r.trim() && !pdPages(r.r)); }
      $$('.dtab', el).forEach((t) => { const a = t.dataset.t === ui.tab; t.classList.toggle('is-active', a); t.setAttribute('aria-selected', a); });
      $$('[data-p]', el).forEach((p) => { p.hidden = p.dataset.p !== ui.tab; });
      // background
      const own = r ? r.bg : st.bg, hex = (r && r.bg) || st.bg;
      swBg.style.background = hex ? '#' + hex : ''; swBg.classList.toggle('is-none', !hex);
      setIf(bgHex, hex ? '#' + hex : ''); bgHex.placeholder = r ? 'Same as document' : 'Default (none)'; if (document.activeElement !== bgHex) bgHex.classList.remove('is-bad');
      q('[data-a="bgreset"]').textContent = r ? 'Same as document' : 'Default'; q('[data-a="bgreset"]').disabled = !own;
      q('[data-r="bgstate"]').textContent = r ? (r.bg ? 'These pages have their own color.' : 'Same as the document' + (st.bg ? ' (#' + st.bg + ').' : ' (no page color).')) : (st.bg ? 'Custom page color.' : 'Default: no page color.');
      $$('.dec__q', el).forEach((x) => x.classList.toggle('is-on', x.dataset.hex === own));
      // borders
      $$('[data-a="pre"]', el).forEach((x) => x.classList.toggle('is-on', PD_PRE[x.dataset.v].join() === on.join()));
      $$('[data-a="side"]', el).forEach((x) => { const v = !!on[x.dataset.i]; x.classList.toggle('is-on', v); x.setAttribute('aria-pressed', v); });
      $$('[data-a="tg"]', el).forEach((x) => { const v = x.dataset.v; x.classList.toggle('is-on', String(ui.tg) === v); x.disabled = v !== 'all' && !on[v]; });
      const t = ids().map((i) => b.s[i]), act = t.filter((s) => s.on), src = act.length ? act : t, mix = (p) => src.some((s) => s[p] !== src[0][p]), dis = !act.length;
      styleSel.selectedIndex = act.length ? 1 + PD_STY.indexOf(src[0].t) : 0;
      setIf(wIn, mix('w') ? '' : src[0].w); wIn.placeholder = 'Mixed';
      setIf(bdHex, mix('c') ? '' : '#' + src[0].c); bdHex.placeholder = 'Mixed'; if (document.activeElement !== bdHex) bdHex.classList.remove('is-bad');
      swBd.style.background = '#' + src[0].c; setIf(dIn, b.d);
      [wIn, bdHex, dIn, q('[data-w="bd"]')].forEach((n) => { n.disabled = dis; if (n.closest('.field')) n.closest('.field').classList.toggle('is-off', dis); });
      q('[data-r="bdstate"]').textContent = r ? (r.bd ? 'Border set for these pages only.' : 'Using the document border. Changing anything here gives these pages their own.') : '';
      q('[data-a="bdreset"]').textContent = r ? 'Use document border' : 'Reset borders'; q('[data-a="bdreset"]').disabled = !!r && !r.bd;
      setIf(wmIn, st.w);
      const o = st.wo, ws = pdWmShape(st, PW, PH, mf), dflt = JSON.stringify(o) === JSON.stringify(pdWm());
      fontTxt.textContent = o.f || 'Document font'; fontTxt.style.fontFamily = o.f ? pdFam(o.f) : ''; fontBtn.disabled = !xe; fontBtn.title = xe ? '' : 'Fonts need XeLaTeX or LuaLaTeX; this document uses pdfLaTeX';
      setIf(wmz, o.z || ''); wmz.placeholder = wm ? 'Auto (' + Math.round(pdWmFit(wm.length, PW)) + ')' : 'Auto';
      [['wmb', o.b], ['wmi', o.i]].forEach(([k, v]) => { const x = q('[data-a="' + k + '"]'); x.classList.toggle('is-on', !!v); x.setAttribute('aria-pressed', !!v); });
      setIf(wmHex, '#' + o.c); swWm.style.background = '#' + o.c; if (document.activeElement !== wmHex) wmHex.classList.remove('is-bad');
      setIf(wmO, o.o); setIf(wmOn, o.o); wmO.style.setProperty('--fill', o.o + '%');
      $$('[data-a="wmrot"]', el).forEach((x) => x.classList.toggle('is-on', +x.dataset.v === o.a)); setIf(wmA, o.a);
      setIf(wmX, o.x); setIf(wmY, o.y); q('[data-a="wmcen"]').disabled = o.x === 50 && o.y === 50; q('[data-a="wmreset"]').disabled = dflt;
      q('[data-r="wmstate"]').textContent = 'Drawn behind the text on every page. Page sets do not apply to it.' + (xe ? ' Bold and italic use the font’s own faces.' : ' This document uses pdfLaTeX, so the watermark uses the document font.');
      // preview: the scope being edited, then what the first pages (and the first page of every page set) actually get
      const eff = r ? { bg: r.bg || st.bg, bd: bdView() } : { bg: st.bg, bd: st.bd }, rg = r && pdPages(r.r);
      q('[data-r="cap"]').textContent = r ? 'Pages ' + (rg ? pdPgStr(rg) : '(set pages)') : 'Document';
      sheet.innerHTML = pdSvg(PW, PH, eff.bg, pdOn(eff.bd) ? eff.bd : null, 0.8 * PW / 150, ws);
      const pgs = [1, 2, 3, 4]; st.ov.forEach((x) => { const g = pdPages(x.r); if (g && !pgs.includes(g[0][0])) pgs.push(g[0][0]); });
      q('[data-r="strip"]').innerHTML = pgs.sort((x, y) => x - y).slice(0, 6).map((p) => { const e = pdEff(st, p); return '<figure class="dec__th' + (rg && pdPgHas(rg, p) ? ' is-sel' : '') + '"><div class="dec__tp" style="aspect-ratio:' + PW + ' / ' + PH + '">' + pdSvg(PW, PH, e.bg, e.bd, Math.min(6, 0.6 * PW / 30), ws) + '</div><figcaption>' + p + '</figcaption></figure>'; }).join('');
    }
    el.addEventListener('click', (e) => {
      const tb = e.target.closest('.dtab'); if (tb) { ui.tab = tb.dataset.t; sync(); return; }
      const bt = e.target.closest('[data-a]'); if (!bt || bt.disabled) return;
      const a = bt.dataset.a, v = bt.dataset.v, r = rule();
      if (a === 'pick' && bt.dataset.w === 'bg') { const cur = (r && r.bg) || st.bg; colorPanel(bt, { none: r ? 'Same as document' : 'Default (no color)', current: cur ? '#' + cur : undefined, onPick: (x) => { if (!x) setBg(''); else if (pdHex(x)) setBg(pdHex(x)); } }); }
      else if (a === 'pick' && bt.dataset.w === 'wm') colorPanel(bt, { none: false, current: '#' + st.wo.c, onPick: (x) => { if (pdHex(x)) setWm('c', pdHex(x)); } });
      else if (a === 'pick') { const b = bdView(), i = ids().find((j) => b.s[j].on); colorPanel(bt, { none: false, current: '#' + b.s[i === undefined ? 0 : i].c, onPick: (x) => { if (pdHex(x)) setProp('c', pdHex(x)); } }); }
      else if (a === 'wmfont') fontLoad().catch(() => {}).finally(() => menu(bt, RPE.fonts.menuItems({ selected: st.wo.f, includeNone: true, noneLabel: 'Document font' }), pickFont));
      else if (a === 'wmb') setWm('b', st.wo.b ^ 1);
      else if (a === 'wmi') setWm('i', st.wo.i ^ 1);
      else if (a === 'wmrot') setWm('a', +v);
      else if (a === 'wmcen') { st.wo.x = 50; st.wo.y = 50; sync(); }
      else if (a === 'wmreset') { st.wo = pdWm(); sync(); }
      else if (a === 'bgq') setBg(bt.dataset.hex);
      else if (a === 'bgreset') setBg('');
      else if (a === 'pre') { const b = bdEdit(); b.s.forEach((s, i) => { s.on = PD_PRE[v][i]; }); sync(); }
      else if (a === 'side') { const b = bdEdit(); b.s[+bt.dataset.i].on ^= 1; sync(); }
      else if (a === 'tg') { ui.tg = v === 'all' ? 'all' : +v; sync(); }
      else if (a === 'bdreset') { if (r) delete r.bd; else st.bd = pdBd(); ui.tg = 'all'; sync(); }
      else if (a === 'addrule') { if (st.ov.length < PD_MAXR) { st.ov.push({ r: '' }); ui.sc = st.ov.length - 1; ui.tg = 'all'; sync(); pgIn.focus(); } }
      else if (a === 'rmrule') { st.ov.splice(ui.sc, 1); ui.sc = -1; ui.tg = 'all'; sync(); }
    });
    const onEdit = (e) => {   // text and number fields act on every keystroke; the two dropdowns on their change
      const n = e.target, k = n.dataset && n.dataset.k; if (!k || e.type !== (n.tagName === 'SELECT' ? 'change' : 'input')) return;
      const r = rule();
      if (k === 'scope') { ui.sc = n.selectedIndex - 1; ui.tg = 'all'; sync(); }
      else if (k === 'pages') { if (r) { r.r = n.value; sync(); } }
      else if (k === 'bghex') { const x = hexOf(n.value); n.classList.toggle('is-bad', !x && !!n.value.trim()); if (x) setBg(x); else if (!n.value.trim()) setBg(''); }
      else if (k === 'bdhex') { const x = hexOf(n.value); n.classList.toggle('is-bad', !x && !!n.value.trim()); if (x) setProp('c', x); }
      else if (k === 'style') {
        const b = bdEdit(), i = n.selectedIndex, any = b.s.some((s) => s.on);
        if (!i) ids().forEach((j) => { b.s[j].on = 0; });
        else ids().forEach((j) => { b.s[j].t = PD_STY[i - 1]; if (ui.tg !== 'all' || !any) b.s[j].on = 1; });   // picking a style with no side on shows the whole border
        sync();
      }
      else if (k === 'w') { if (isFinite(parseFloat(n.value))) setProp('w', pdNum(n.value, 0.25, 12, 1)); }
      else if (k === 'd') { if (isFinite(parseFloat(n.value))) { bdEdit().d = pdNum(n.value, 0, 72, 28); sync(); } }
      else if (k === 'wm') { st.w = n.value; sync(); }
      else if (k === 'wmhex') { const x = hexOf(n.value); n.classList.toggle('is-bad', !x && !!n.value.trim()); if (x) setWm('c', x); }
      else if (k === 'wmz') { const f = parseFloat(n.value); if (!n.value.trim()) setWm('z', 0); else if (isFinite(f)) setWm('z', pdNum(f, 6, 400, 0)); }
      else if (['wmo', 'wmon', 'wma', 'wmx', 'wmy'].includes(k)) {
        const f = parseFloat(n.value); if (!isFinite(f)) return;
        if (k === 'wma') { const a = Math.round(pdNum(f, -180, 180, 45)); setWm('a', a === -180 ? 180 : a); }
        else setWm(k === 'wmx' ? 'x' : k === 'wmy' ? 'y' : 'o', Math.round(pdNum(f, 0, 100, 50)));
      }
    };
    el.addEventListener('input', onEdit); el.addEventListener('change', onEdit);
    el.addEventListener('focusout', () => setTimeout(sync, 0));   // a half-typed value snaps back to the stored one
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); btns[2].click(); } });
    btns[1].onclick = () => { if (pdApply(null)) { d.close(); ta.focus(); } };
    btns[2].onclick = async () => {
      const bad = st.ov.findIndex((x) => (x.bg || x.bd) && !pdPages(x.r));
      if (bad >= 0) { ui.sc = bad; if (ui.tab === 'wm') ui.tab = 'bg'; sync(); toast('Enter the PDF pages for this page set, such as 1, 3-5, 8-'); pgIn.focus(); return; }
      const w = st.w.trim();
      if (/[\\{}~^]/.test(w)) { ui.tab = 'wm'; sync(); toast('Watermark text can’t contain \\ { } ~ ^. Use plain words'); wmIn.focus(); return; }
      if (w && st.wo.f && xe) { const ok = await fontOK(st.wo.f); if (ok === null) return; if (!ok) { ui.tab = 'wm'; sync(); toast('Font “' + st.wo.f + '” isn’t available to XeLaTeX: not applied'); return; } }
      if (pdApply({ ...pdClone(st), w: w.replace(/[&%$#_]/g, '\\$&') })) { d.close(); ta.focus(); toast('Page decoration updated'); }   // on a refusal the dialog stays open, so nothing set is lost
    };
    sync();
  }
  /* Design ▸ Document Identity ▸ Title Block (D.titleblock): edits the real \title / \subtitle / \author / \affil / \date / \maketitle.
     Existing commands are updated in place (only the fields the user changed), missing ones are added once before \begin{document}.
     Subtitle: \subtitle on KOMA classes (or where it already exists), otherwise folded into \title as "\\[0.5em]{\large …}".
     Affiliation: \affil via authblk. letter/beamer/standalone and classes with no title mechanism are refused. */
  const TB_STD = /^(article|report|book|memoir|extarticle|extreport|extbook|scrartcl|scrreprt|scrbook)$/, TB_KOMA = /^(scrartcl|scrreprt|scrbook)$/, TB_SUB = /^([\s\S]*?)\s*\\\\\[0\.5em\]\s*\{\\large\s+([\s\S]*)\}$/;
  const tbEsc = (s) => s.replace(/[\\&%$#_{}~^]/g, (c) => (c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : '\\' + c));
  const TB_UN = /\\(textbackslash|textasciitilde|textasciicircum)\{\}|\\([&%$#_{}])/g;
  const tbUnesc = (s) => { s = s.trim(); return /[\\{}$%~^&#_]/.test(s.replace(TB_UN, '')) ? s.replace(/\s*\n\s*/g, ' ') : s.replace(TB_UN, (m, a, b) => b || (a === 'textbackslash' ? '\\' : a === 'textasciitilde' ? '~' : '^')); };
  function tbCmd(mk, name) {   // every \name[opt]{arg} in comment-masked text → [{ s, a, b, e }] (a..b = argument, e = end after "}")
    const re = new RegExp('\\\\' + name + '(?![a-zA-Z@])\\s*(?:\\[[^\\]]*\\])?\\s*\\{', 'g'), out = []; let m;
    while ((m = re.exec(mk))) {
      let d = 1, i = re.lastIndex; for (; i < mk.length && d; i++) { const c = mk[i]; if (c === '\\') i++; else if (c === '{') d++; else if (c === '}') d--; }
      if (d) { out.bad = true; break; }
      out.push({ s: m.index, a: re.lastIndex, b: i - 1, e: i }); re.lastIndex = i;
    }
    return out;
  }
  function tbRead(t) {
    const mk = tocMask(t), dc = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/m.exec(mk), bd = mk.indexOf('\\begin{document}');
    if (!dc || bd < 0) return { err: 'Open the main .tex file (with \\documentclass and \\begin{document}) to edit the title block' };
    const cls = dc[1].trim(), C = {}; ['title', 'subtitle', 'author', 'affil', 'date'].forEach((n) => { C[n] = tbCmd(mk, n); });
    if (/^(letter|beamer|standalone)$/.test(cls)) return { err: 'The ' + cls + ' class has no standard title block. Nothing was changed' };
    if (Object.values(C).some((c) => c.bad)) return { err: 'A title-block command has unbalanced braces. Fix it in the source first' };
    if (!TB_STD.test(cls) && !C.title.length && !/\\maketitle(?![a-zA-Z@])/.test(mk)) return { err: 'The ' + cls + ' class has no standard title mechanism. Nothing was changed' };
    const arg = (c) => (c.length ? t.slice(c[c.length - 1].a, c[c.length - 1].b) : null), ti = arg(C.title), sm = ti !== null && TB_SUB.exec(ti), su = arg(C.subtitle), da = arg(C.date), au = arg(C.author), af = arg(C.affil);
    const rawTitle = ti === null ? '' : sm ? sm[1].trim() : ti.trim(), rawSub = su !== null ? su.trim() : sm ? sm[2].trim() : '', rawAuthor = au === null ? '' : au.trim();
    const dd = da === null || da.trim() === '\\today' ? 0 : da.trim() === '' ? 2 : 1;
    return { t, mk, bd, cls, C, rawTitle, rawSub, rawAuthor, hadSm: !!sm, f: { title: tbUnesc(rawTitle), sub: tbUnesc(rawSub), author: tbUnesc(rawAuthor), affil: af === null ? '' : tbUnesc(af), dsel: dd, dtxt: dd === 1 ? tbUnesc(da) : '' } };
  }
  function tbApply(f0, f1) {
    const ta = $('#codeInput'); if (!ta) return false;
    const R = tbRead(ta.value); if (R.err) { toast(R.err); return false; }
    const { t, mk, bd, cls, C } = R, ch = (k) => f1[k] !== f0[k], ed = [], blk = [], last = (c) => c[c.length - 1];
    const refuse = (m) => (toast(m), false);
    if (!f1.title.trim()) return refuse('Enter a title. Nothing was changed');
    if (f1.dsel === 1 && !f1.dtxt.trim()) return refuse('Enter the fixed date text, or pick \\today / None. Nothing was changed');
    // title (+ subtitle folded in when the class has no \subtitle)
    const useSub = C.subtitle.length || TB_KOMA.test(cls), subCh = ch('sub'), tiCh = ch('title');
    const tPart = tiCh ? tbEsc(f1.title.trim()) : R.rawTitle, sPart = subCh ? tbEsc(f1.sub.trim()) : R.rawSub;
    const tArg = !useSub && sPart ? tPart + ' \\\\[0.5em] {\\large ' + sPart + '}' : tPart;
    if (C.title.length) { const c = last(C.title); if ((tiCh || subCh) && t.slice(c.a, c.b) !== tArg) ed.push({ a: c.a, b: c.b, str: tArg }); } else blk.push('\\title{' + tArg + '}');
    if (useSub && subCh) {
      if (C.subtitle.length) { const c = last(C.subtitle); if (!f1.sub.trim()) { const ls = t.lastIndexOf('\n', c.s - 1) + 1, own = !t.slice(ls, c.s).trim() && !t.slice(c.e, t.indexOf('\n', c.e) < 0 ? t.length : t.indexOf('\n', c.e)).trim(); ed.push({ a: own ? ls : c.s, b: own ? Math.min(t.length, t.indexOf('\n', c.e) < 0 ? t.length : t.indexOf('\n', c.e) + 1) : c.e, str: '' }); } else ed.push({ a: c.a, b: c.b, str: sPart }); }
      else if (f1.sub.trim()) blk.push('\\subtitle{' + sPart + '}');
    }
    // author / affiliation
    const auCh = ch('author'), afCh = ch('affil'), auNew = auCh ? tbEsc(f1.author.trim()) : R.rawAuthor;
    if ((auCh || afCh) && (C.author.length > 1 || C.affil.length > 1)) return refuse('There are several \\author or \\affil commands. Edit them in the source (nothing was changed)');
    if (auCh) { if (C.author.length) ed.push({ a: C.author[0].a, b: C.author[0].b, str: auNew }); else if (f1.author.trim()) blk.push('\\author{' + auNew + '}'); }
    let pk = null;
    if (afCh) {
      if (f1.affil.trim()) {
        if (!C.author.length && !f1.author.trim()) return refuse('Add an author before an affiliation. Nothing was changed');
        if (/\\\\|\\(?:and|thanks)(?![a-zA-Z])/.test(auNew)) return refuse('The author uses \\and, \\\\ or \\thanks, so an affiliation can’t be added safely. Edit the author block in the source');
        pk = ensurePackage(t, 'authblk'); if (pk === false) return refuse('Could not add authblk. Check the \\documentclass / preamble');
        const aArg = tbEsc(f1.affil.trim());
        if (C.affil.length) ed.push({ a: C.affil[0].a, b: C.affil[0].b, str: aArg });
        else if (C.author.length) ed.push({ a: C.author[0].e, b: C.author[0].e, str: '\n\\affil{' + aArg + '}' });
        else blk.push('\\affil{' + aArg + '}');
      } else if (C.affil.length) {
        const c = C.affil[0], ls = t.lastIndexOf('\n', c.s - 1) + 1, nl = t.indexOf('\n', c.e), own = !t.slice(ls, c.s).trim() && !t.slice(c.e, nl < 0 ? t.length : nl).trim();
        ed.push({ a: own ? ls : c.s, b: own ? (nl < 0 ? t.length : nl + 1) : c.e, str: '' });
      }
    }
    // date
    if (ch('dsel') || (f1.dsel === 1 && ch('dtxt'))) {
      const dArg = f1.dsel === 0 ? '\\today' : f1.dsel === 2 ? '' : tbEsc(f1.dtxt.trim());
      if (C.date.length) { const c = last(C.date); if (t.slice(c.a, c.b).trim() !== dArg) ed.push({ a: c.a, b: c.b, str: dArg }); } else if (dArg !== '\\today') blk.push('\\date{' + dArg + '}');
    }
    // new commands go once before \begin{document}; \maketitle once at the start of the body
    if (blk.length) { const ls = t.lastIndexOf('\n', bd - 1) + 1, own = !t.slice(ls, bd).trim(), s = blk.join('\n') + '\n'; ed.push({ a: own ? ls : bd, b: own ? ls : bd, str: (own ? '' : '\n') + s + (own ? '' : '\n') }); }
    if (!/\\maketitle(?![a-zA-Z@])/.test(mk.slice(bd))) {
      const nl = t.indexOf('\n', bd); if (nl < 0) return refuse('Could not find a place for \\maketitle after \\begin{document}');
      let at = nl + 1; const m2 = /^\s*\\frontmatter[^\n]*(?:\n|$)/.exec(mk.slice(nl + 1)); if (m2) at += m2[0].length;   // book: after \frontmatter
      ed.push({ a: at, b: at, str: '\\maketitle\n' });
    }
    if (!ed.length) { toast('Title block is already set that way'); return null; }
    if (pk) ed.push({ a: pk.pos, b: pk.pos, str: pk.str });
    ed.sort((x, y) => y.a - x.a);
    const mp = (p) => ed.reduce((n, e) => (p >= e.b ? n + e.str.length - (e.b - e.a) : p > e.a ? n - (p - e.a) : n), p), s0 = mp(ta.selectionStart), e0 = mp(ta.selectionEnd);
    ed.forEach((e) => fmtEdit(ta, e.a, e.b, e.str, s0, e0));
    return true;
  }
  function tbDialog() {
    const ta = $('#codeInput'); if (!ta) return; const R = tbRead(ta.value); if (R.err) return toast(R.err);
    const f0 = R.f, d = dlg(D.titleblock()), ins = $$('input', d.el), sel = $('select', d.el), btns = $$('.dlg__foot .btn', d.el);
    [f0.title, f0.sub, f0.author, f0.affil].forEach((v, i) => { ins[i].value = v; }); ins[4].value = f0.dtxt; sel.selectedIndex = f0.dsel;
    const sync = () => { ins[4].disabled = sel.selectedIndex !== 1; }; sel.onchange = sync; sync();
    btns[1].onclick = () => {
      const f1 = { title: ins[0].value, sub: ins[1].value, author: ins[2].value, affil: ins[3].value, dsel: sel.selectedIndex, dtxt: sel.selectedIndex === 1 ? ins[4].value : '' };
      d.close(); const r = tbApply(f0, f1); if (r !== false) ta.focus(); if (r) toast('Title block updated');
    };
  }
  /* Layout ▸ Page Setup (Margins / Orientation / Size + D.margins): everything lives in ONE \usepackage[...]{geometry} line.
     Its option list is edited token by token (unknown options are kept), so repeated changes update that same declaration.
     Orientation with a selection wraps it in pdflscape's landscape environment instead. */
  const PG_PAPER = { A4: 'a4paper', Letter: 'letterpaper', Legal: 'legalpaper', A5: 'a5paper' }, PG_MARG = /^(margin|hmargin|vmargin|top|bottom|left|right|inner|outer|lmargin|rmargin|tmargin|bmargin)(=|$)/;
  const PG_PRESET = { 'Normal (2.5 cm)': 2.5, 'Narrow (1.27 cm)': 1.27, 'Wide (3.8 cm)': 3.8 }, PG_CM = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72.27, bp: 2.54 / 72 };
  function pgRead(t) {   // -> { m (the geometry line match), opts[], paper, land, mg{top,bottom,left,right in cm|null} } | { err }
    const mk = tocMask(t), re = /^[ \t]*\\usepackage(?:\[([^\]]*)\])?\{([^}]*)\}/gm; let m, g = null;
    while ((m = re.exec(mk))) if (m[2].split(',').map((x) => x.trim()).includes('geometry')) { g = m; break; }
    if (/\\geometry\s*\{/.test(mk)) return { err: 'Page setup is set through \\geometry{…} here. Edit that command by hand' };
    if (g && g[2].trim() !== 'geometry') return { err: 'geometry is loaded together with other packages. Split it onto its own \\usepackage line first' };
    const opts = []; let d = 0, cur = '';
    for (const c of g && g[1] ? g[1] : '') { if (c === '{') d++; if (c === '}') d--; if (c === ',' && !d) { opts.push(cur.trim()); cur = ''; } else cur += c; }
    if (cur.trim()) opts.push(cur.trim());
    const o = opts.filter(Boolean), mg = { top: null, bottom: null, left: null, right: null }, cm = (v) => { const x = /^\s*([\d.]+)\s*(cm|mm|in|pt|bp)\s*$/.exec(v || ''); return x ? Math.round(parseFloat(x[1]) * PG_CM[x[2]] * 100) / 100 : null; };
    let paper = null, land = false;
    o.forEach((k) => {
      const [a, ...r] = k.split('='), v = r.join('='), n = a.trim();
      if (/^(a[0-6]|b[0-6]|letter|legal|executive)paper$/.test(n) || n === 'paper') paper = n === 'paper' ? v.trim() : n;
      else if (n === 'landscape') land = v.trim() !== 'false';
      else if (n === 'margin') ['top', 'bottom', 'left', 'right'].forEach((q) => (mg[q] = cm(v)));
      else if (n === 'hmargin') mg.left = mg.right = cm(v);
      else if (n === 'vmargin') mg.top = mg.bottom = cm(v);
      else if (/^[tblr]margin$/.test(n)) mg[{ t: 'top', b: 'bottom', l: 'left', r: 'right' }[n[0]]] = cm(v);
      else if (mg[n] !== undefined) mg[n] = cm(v);
    });
    return { m: g, opts: o, paper, land, mg };
  }
  /* patch = { paper?, land? (bool), mg? {top,bottom,left,right in cm} }; edits/creates the geometry declaration. Returns true on success. */
  function pgApply(ta, patch) {
    const t = ta.value, r = pgRead(t); if (r.err) { toast(r.err); return false; }
    if (/^[ \t]*\\documentclass(?:\[[^\]]*\])?\{(beamer|letter)\}/m.test(tocMask(t))) { toast('Page setup isn’t supported for this document class'); return false; }
    let o = r.opts.slice();
    if (patch.paper) o = o.filter((k) => !/^((a[0-6]|b[0-6]|letter|legal|executive)paper|paper=.*)$/.test(k)).concat(patch.paper);
    if (patch.land !== undefined) { o = o.filter((k) => !/^landscape(=|$)/.test(k)); if (patch.land) o.push('landscape'); }
    if (patch.mg) {
      const v = patch.mg, f = (x) => +x.toFixed(2) + 'cm'; o = o.filter((k) => !PG_MARG.test(k));
      o.push(v.top === v.bottom && v.top === v.left && v.top === v.right ? 'margin=' + f(v.top) : `top=${f(v.top)},bottom=${f(v.bottom)},left=${f(v.left)},right=${f(v.right)}`);
    }
    const sA = ta.selectionStart, sB = ta.selectionEnd; let a, b, str;
    if (r.m) {   // rewrite just the [options] of the existing line
      const i = r.m.index + r.m[0].indexOf('\\usepackage') + 11, j = r.m[1] !== undefined ? r.m[0].indexOf('[', 11) : -1;
      a = r.m.index + (j < 0 ? i - r.m.index : j); b = j < 0 ? a : r.m.index + r.m[0].indexOf(']', j) + 1; str = '[' + o.join(',') + ']';
      if (t.slice(a, b) === str) { toast('Already set that way'); return false; }
    } else {   // geometry not loaded yet: add it (with explicit margins so loading it doesn't silently change them)
      if (!patch.mg) o.push('margin=2.5cm');
      const pk = ensurePackage(t, ['geometry', o.join(',')]); if (pk === false) { toast('Could not add geometry. Check the \\documentclass / preamble'); return false; }
      a = b = pk.pos; str = pk.str;
    }
    const mp = (x) => (x >= b ? x + str.length - (b - a) : Math.min(x, a + str.length));
    fmtEdit(ta, a, b, str, mp(sA), mp(sB)); return true;
  }
  /* Orientation: no selection → geometry option; selection → \begin{landscape}…\end{landscape} (pdflscape) when the selection sits
     at the top level of the body, otherwise explain why not. */
  function pgOrient(land) {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, sA = ta.selectionStart, sB = ta.selectionEnd;
    if (sA === sB) { const r = pgRead(t); if (!r.err && !!r.land === land && (r.m || !land)) return toast('Already ' + (land ? 'landscape' : 'portrait')); if (pgApply(ta, { land })) toast(land ? 'Page orientation: landscape' : 'Page orientation: portrait'); return; }
    const mk = tocMask(t), bs = t.indexOf('\\begin{document}') + 16, be = t.indexOf('\\end{document}');
    if (bs < 16 || sA < bs || (be >= 0 && sB > be)) return toast('Select content inside the document body, or clear the selection to change the whole document');
    let A = t.lastIndexOf('\n', sA - 1) + 1, B = sB; if (B > A && t[B - 1] === '\n') B--; const e2 = t.indexOf('\n', B); B = e2 < 0 ? t.length : e2; if (be >= 0 && B > be) B = t.lastIndexOf('\n', be - 1);
    const body = t.slice(A, B), ex = /^\s*\\begin\{landscape\}\n([\s\S]*)\n\\end\{landscape\}\s*$/.exec(body);
    if (!land) {   // Portrait on a selected landscape block: unwrap it
      if (!ex) return toast('Clear the selection to set the whole document to portrait');
      fmtEdit(ta, A, B, ex[1], A, A + ex[1].length); return toast('Landscape section removed');
    }
    if (/\\documentclass(?:\[[^\]]*\])?\{(beamer|letter)\}/.test(mk)) return toast('Landscape sections aren’t supported for this document class');
    if (!body.trim() || ex || /\\(?:begin|end)\{landscape\}/.test(mk.slice(A, B))) return toast(!body.trim() ? 'Nothing to wrap' : 'That content is already in a landscape section');
    const pre = mk.slice(bs, A).replace(/\\[{}]/g, ''); let env = 0, dep = (pre.match(/\{/g) || []).length - (pre.match(/\}/g) || []).length;
    for (const m of pre.matchAll(/\\(begin|end)\{[^}]*\}/g)) env += m[1] === 'begin' ? 1 : -1;
    if (env !== 0 || dep !== 0 || !envOK(mk.slice(A, B)) || !balanced(mk.slice(A, B))) return toast('Can’t tell where a page can safely break around this selection. Select whole top-level paragraphs/sections, or clear the selection for whole-document landscape');
    const out = '\\begin{landscape}\n' + body + '\n\\end{landscape}', pk = ensurePackage(t, 'pdflscape');
    if (pk === false) return toast('Could not add pdflscape. Check the \\documentclass / preamble');
    fmtEdit(ta, A, B, out, A, A + out.length);
    if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, A + pk.str.length, A + out.length + pk.str.length);
    toast('Selection wrapped in a landscape section');
  }
  /* Layout ▸ Columns. No selection → document-wide: Two = the `twocolumn` class option on standard classes, otherwise (and for Three)
     a managed `\begin{multicols}{n} % lplum-columns` block around the body (after \maketitle). Selection → local multicols around
     whole paragraphs (selection widened to blank-line boundaries). multicol comes in via ensurePackage(). Refuses rather than guessing. */
  const COL_MK = '% lplum-columns', COL_CLS = /^(article|report|book|scrartcl|scrreprt|scrbook|amsart|amsbook|memoir|extarticle|extreport|extbook)$/;
  function colsApply(label) {
    const ta = $('#codeInput'); if (!ta) return; const n = { One: 1, Two: 2, Three: 3 }[label]; if (!n) return;
    const t = ta.value, mk = tocMask(t), bs = mk.indexOf('\\begin{document}') + 16, be = mk.indexOf('\\end{document}');
    const dc = /^[ \t]*\\documentclass(?:\[([^\]]*)\])?\{([^}]*)\}/m.exec(mk);
    if (!dc || bs < 16 || be < bs) return toast('Open the main .tex file (with \\documentclass and a document body) to set columns');
    const cls = dc[2].trim(); if (cls === 'beamer') return toast('Columns aren’t supported for the beamer class');
    const sA = ta.selectionStart, sB = ta.selectionEnd, mcs = (k) => '\\begin{multicols}{' + k + '}';
    if (sA !== sB) {   // ---- local columns
      if (sA < bs || sB > be) return toast('Select content inside the document body, or clear the selection to set columns for the whole document');
      const lo = bs + (t[bs] === '\n' ? 1 : 0), hi = t.lastIndexOf('\n', be - 1), eol = (i) => { const e = t.indexOf('\n', i); return e < 0 ? t.length : e; };
      const bl = (i) => /^\s*$/.test(t.slice(i, eol(i))), ls = (i) => t.lastIndexOf('\n', i - 1) + 1;
      let A = Math.max(ls(sA), lo), B = sB; if (B > A && t[B - 1] === '\n') B--; B = Math.min(eol(B), hi);
      while (A < B && bl(A)) A = eol(A) + 1;                       // trim blank edges
      while (B > A && bl(ls(B))) B = t.lastIndexOf('\n', B - 1);
      if (A >= B) return toast('Nothing to put in columns');
      const A0 = A, B0 = B;
      while (A > lo && !bl(ls(A - 1))) A = ls(A - 1);               // widen to whole paragraphs
      while (B < hi && !bl(B + 1)) B = eol(B + 1);
      const body = t.slice(A, B), ex = /^\\begin\{multicols\}\{(\d)\}\n([\s\S]*)\n\\end\{multicols\}$/.exec(body);
      if (ex) {
        if (n === 1) { fmtEdit(ta, A, B, ex[2], A, A + ex[2].length); return toast('Columns removed'); }
        if (+ex[1] === n) return toast('Already ' + n + ' columns');
        fmtEdit(ta, A + 18, A + 19, String(n), sA, sB); return toast('Selection set to ' + n + ' columns');
      }
      if (n === 1) return toast('The selection isn’t a multicols block. Nothing to remove');
      const m2 = mk.slice(A, B);
      if (/\\(?:begin|end)\{(?:multicols\*?|landscape|longtable\*?|figure\*|table\*)\}/.test(m2)) return toast('That content already has columns or contains an environment that can’t sit inside columns (multicols, landscape, longtable, figure*, table*)');
      const pre = mk.slice(bs, A).replace(/\\[{}]/g, ''); let env = 0, dep = (pre.match(/\{/g) || []).length - (pre.match(/\}/g) || []).length;
      for (const m of pre.matchAll(/\\(begin|end)\{[^}]*\}/g)) env += m[1] === 'begin' ? 1 : -1;
      if (env !== 0 || dep !== 0 || !envOK(m2) || !balanced(m2)) return toast('Can’t tell where columns can safely start and end here. Select whole top-level paragraphs/sections (not inside another environment), or clear the selection for whole-document columns');
      const pk = ensurePackage(t, 'multicol'); if (pk === false) return toast('Could not add multicol. Check the \\documentclass / preamble');
      const out = mcs(n) + '\n' + body + '\n\\end{multicols}';
      fmtEdit(ta, A, B, out, A, A + out.length);
      if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, A + pk.str.length, A + out.length + pk.str.length);
      return toast('Selection set in ' + n + ' columns' + (A !== A0 || B !== B0 ? ' (widened to whole paragraphs)' : ''));
    }
    // ---- document-wide
    if (cls === 'letter') return toast('Whole-document columns aren’t supported for the letter class. Select paragraphs instead');
    const eds = [], body = t.slice(bs, be), mb = /^\\begin\{multicols\}\{(\d)\}[ \t]*% lplum-columns[ \t]*\n/m.exec(body), me = /^\\end\{multicols\}[ \t]*% lplum-columns[ \t]*\n?/m.exec(body);
    const had = mb && me && me.index > mb.index ? +mb[1] : 0, tc = COL_CLS.test(cls), want = n === 3 || (n === 2 && !tc) ? n : 0;
    if (had && !want) { eds.push({ a: bs + me.index, b: bs + me.index + me[0].length, str: '' }, { a: bs + mb.index, b: bs + mb.index + mb[0].length, str: '' }); }
    else if (had && had !== want) eds.push({ a: bs + mb.index + 18, b: bs + mb.index + 19, str: String(want) });
    else if (!had && want) {
      const mi = mk.indexOf('\\maketitle', bs), st = mi >= 0 && mi < be ? Math.min(eol0(mk, mi) + 1, be) : bs + (t[bs] === '\n' ? 1 : 0), seg = mk.slice(st, be);
      if (!seg.trim()) return toast('Nothing in the document body to put in columns');
      if (/\\(?:begin|end)\{multicols\*?\}/.test(seg)) return toast('The body already has its own multicols blocks. Remove them first so the columns don’t nest');
      if (!envOK(seg) || !balanced(seg)) return toast('Can’t safely wrap the document body in columns (unbalanced environments or braces)');
      eds.push({ a: be, b: be, str: (t[be - 1] === '\n' ? '' : '\n') + '\\end{multicols} ' + COL_MK + '\n' }, { a: st, b: st, str: (t[st - 1] === '\n' ? '' : '\n') + mcs(want) + ' ' + COL_MK + '\n' });
    }
    if (want) { const pk = ensurePackage(t, 'multicol'); if (pk === false) return toast('Could not add multicol. Check the \\documentclass / preamble'); if (pk) eds.push({ a: pk.pos, b: pk.pos, str: pk.str }); }
    const opts = (dc[1] || '').split(',').map((x) => x.trim()).filter(Boolean), no = opts.filter((x) => x !== 'twocolumn' && x !== 'onecolumn'); if (n === 2 && tc) no.push('twocolumn');
    if (no.join() !== opts.join()) {
      const str = no.length ? '[' + no.join(',') + ']' : '';
      if (dc[1] !== undefined) { const i = dc.index + dc[0].indexOf('['); eds.push({ a: i, b: i + dc[1].length + 2, str }); } else { const i = dc.index + dc[0].indexOf('{'); eds.push({ a: i, b: i, str }); }
    }
    if (!eds.length) return toast('Already ' + (n === 1 ? 'one column' : n + ' columns'));
    let a0 = sA; eds.sort((x, y) => y.a - x.a || y.b - x.b).forEach((e) => { const c = a0 >= e.b ? a0 + e.str.length - (e.b - e.a) : Math.min(a0, e.a + e.str.length); fmtEdit(ta, e.a, e.b, e.str, c, c); a0 = c; });
    toast('Document set to ' + (n === 1 ? 'one column' : n + ' columns'));
  }
  const eol0 = (t, i) => { const e = t.indexOf('\n', i); return e < 0 ? t.length : e; };
  function pageQuick(kind, l) {
    const ta = $('#codeInput'); if (!ta) return;
    if (kind === 'o') return pgOrient(l === 'Landscape');
    if (kind === 's') { if (pgApply(ta, { paper: PG_PAPER[l] })) toast('Paper size: ' + l); return; }
    const c = PG_PRESET[l]; if (c && pgApply(ta, { mg: { top: c, bottom: c, left: c, right: c } })) toast('Margins: ' + l);
  }
  function pageDialog() {
    const ta = $('#codeInput'); if (!ta) return; const r = pgRead(ta.value); if (r.err) return toast(r.err);
    const d = dlg(D.margins()), ins = $$('input', d.el), sels = $$('select', d.el), chips = $$('.chip', d.el), keys = ['top', 'bottom', 'left', 'right'];
    $('.demo-note', d.el)?.remove();
    const cur = keys.map((k) => (r.mg[k] == null ? 2.5 : r.mg[k])), pr = Object.entries(PG_PAPER).find(([, v]) => v === r.paper);
    ins.forEach((n, i) => { n.value = cur[i]; n.type = 'number'; n.step = '0.01'; n.min = '0'; });
    const sync = () => { const v = ins.map((n) => parseFloat(n.value)), k = Object.keys(PG_PRESET).find((x) => v.every((y) => y === PG_PRESET[x])); sels[0].value = k || 'Custom'; };
    sync(); if (pr) sels[1].value = pr[0];
    chips.forEach((c, i) => c.classList.toggle('is-on', i === (r.land ? 1 : 0)));
    sels[0].onchange = () => { const c = PG_PRESET[sels[0].value]; if (c) ins.forEach((n) => (n.value = c)); };
    ins.forEach((n) => n.addEventListener('input', sync));
    $$('.dlg__foot .btn', d.el)[1].onclick = () => {
      const v = ins.map((n) => parseFloat(n.value)); if (v.some((x) => !(x >= 0 && x < 30))) return toast('Margins must be numbers between 0 and 30 cm');
      const patch = {}, land = chips[1].classList.contains('is-on');
      if (v.some((x, i) => x !== cur[i])) patch.mg = { top: v[0], bottom: v[1], left: v[2], right: v[3] };
      if (sels[1].value !== (pr ? pr[0] : sels[1].value) || (!pr && sels[1].value !== 'A4')) patch.paper = PG_PAPER[sels[1].value];
      if (land !== r.land) patch.land = land;
      d.close(); if (!Object.keys(patch).length) return toast('No page setup changes');
      if (pgApply(ta, patch)) { ta.focus(); toast('Page setup updated'); }
    };
  }
  /* Insert ▸ Table of Contents (also References ▸ Table of Contents): Classic/Compact insert \tableofcontents on its own line at a
     top-level body position (never inside a group or environment); an existing one is navigated to instead of duplicated.
     Custom = the D.toc dialog → \setcounter{tocdepth}{n} and an optional \renewcommand{\contentsname}{…} right before it. */
  const TOC_DEPTH = { Chapters: 0, Sections: 1, Subsections: 2, Subsubsections: 3 };   // \setcounter{tocdepth} values (book-like classes; article starts at sections = 1)
  const TOC_BOOKISH = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{(book|report|memoir|scrbook|scrreprt)\}/m;
  /* References ▸ Table of Contents ▸ Update Table / Configure Depth. Both need an existing \tableofcontents (inserting one is
     tocInsert's job). Update = normal compile (the server runs two passes; the .toc file is only complete after a pass). Depth edits
     the \setcounter{tocdepth} that already applies to the TOC in place, or adds one right before \tableofcontents; selection is kept. */
  function tocFind(ta) {
    const mk = tocMask(ta.value);
    if (/^[ \t]*\\documentclass(?:\[[^\]]*\])?\{(letter|beamer)\}/m.test(mk)) { toast('This document class has no automatic table of contents'); return null; }
    const ex = /\\tableofcontents(?![a-zA-Z])/.exec(mk);
    if (!ex) { toast('No table of contents in this document. Use Table of Contents ▸ Automatic to insert one first'); return null; }
    return { mk, ex };
  }
  function tocUpdate() {
    const ta = $('#codeInput'); if (!ta || !tocFind(ta)) return;
    toast('Updating the table of contents: it lists headings from the last compile, so after adding or renaming headings you may need to compile more than once');
    runCompile();
  }
  function tocDepth(label) {
    const ta = $('#codeInput'); if (!ta) return;
    const f = tocFind(ta); if (!f) return;
    const n = label === 'Chapters only' ? 0 : label === 'To sections' ? 1 : 2;
    if (n === 0 && !TOC_BOOKISH.test(f.mk)) return toast('“Chapters only” needs a class with \\chapter (book, report…): this class starts at sections');
    const t = ta.value, re = /\\setcounter\{tocdepth\}\{\s*-?\d+\s*\}/g; let m, cur = null;
    while ((m = re.exec(f.mk)) && m.index < f.ex.index) cur = m;
    const str = '\\setcounter{tocdepth}{' + n + '}';
    if (cur && cur[0] === str) return toast('Table of contents depth is already set to ' + label.toLowerCase());
    const a = cur ? cur.index : f.ex.index, b = cur ? cur.index + cur[0].length : a, ins = cur ? str : str + '\n';
    const s0 = ta.selectionStart, s1 = ta.selectionEnd, dl = ins.length - (b - a), mv = (x) => (x >= b ? x + dl : x);
    fmtEdit(ta, a, b, ins, mv(s0), mv(s1));
    toast('Table of contents depth: ' + label.toLowerCase() + '. Press Update Table to rebuild it');
  }
  function tocGo(ta, i) {
    const n = ta.value.slice(0, i).split('\n').length - 1, e = ta.value.indexOf('\n', i);
    ta.focus(); ta.setSelectionRange(i, e < 0 ? ta.value.length : e); goToLine(n);
  }
  function tocInsert(custom) {
    const ta = $('#codeInput'); if (!ta) return;
    const kind = custom === true ? 'custom' : /Compact/.test(custom) ? 'compact' : 'classic';
    const t = ta.value, mk = tocMask(t), pos = ta.selectionEnd, bs = t.indexOf('\\begin{document}') + 16, be = t.indexOf('\\end{document}');
    if (bs < 16 || pos < bs || (be >= 0 && pos > be)) return toast('Place the cursor inside the document body to insert a table of contents');
    if (/^[ \t]*\\documentclass(?:\[[^\]]*\])?\{(letter|beamer)\}/m.test(mk)) return toast('This document class has no automatic table of contents');
    const ex = /\\tableofcontents(?![a-zA-Z])/.exec(mk);
    if (ex) {
      const d = dlg({ t: 'Table of Contents', i: 'list', w: 420, btns: ['Cancel', 'Go to Table of Contents'], b: '<p>This document already has a <code>\\tableofcontents</code>. Inserting another would duplicate it.</p>' });
      $('.dlg__foot .btn--primary', d.el).onclick = () => { d.close(); tocGo(ta, ex.index); };
      return;
    }
    const sl = mk.slice(bs, pos).replace(/\\[{}]/g, ''), dep = (sl.match(/\{/g) || []).length - (sl.match(/\}/g) || []).length;
    let env = 0; for (const m of sl.matchAll(/\\(begin|end)\{[^}]*\}/g)) env += m[1] === 'begin' ? 1 : -1;
    if (dep !== 0 || env !== 0) return toast('Move the cursor outside any command or environment to insert a table of contents');
    const put = (str) => insertBreak(str);
    if (kind === 'classic') return put('\\tableofcontents');
    if (kind === 'compact') return put('\\setcounter{tocdepth}{1}\n\\tableofcontents');
    const d = dlg(D.toc()), sel = $('select', d.el), inp = $('input', d.el); $('.demo-note', d.el)?.remove();
    if (/^[ \t]*\\documentclass(?:\[[^\]]*\])?\{(book|report|memoir|scrbook|scrreprt)\}/m.test(mk)) { sel.prepend(new Option('Chapters', 'Chapters')); sel.value = 'Sections'; }
    const depthOf = TOC_DEPTH;
    $('.dlg__foot .btn--primary', d.el).onclick = () => {
      if (ta.value !== t || ta.selectionEnd !== pos) { d.close(); return toast('The source changed. Place the cursor and try again'); }
      const title = inp.value.trim().replace(/\s+/g, ' ');
      const str = '\\setcounter{tocdepth}{' + depthOf[sel.value] + '}\n' + (title ? '\\renewcommand{\\contentsname}{' + texEsc(title) + '}\n' : '') + '\\tableofcontents';
      d.close(); put(str);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.dlg__foot .btn--primary', d.el).click(); });
  }
  /* Lists of Figures / Tables (References ▸ Lists): insert \listoffigures / \listoftables at a top-level body position (existing one →
     navigate instead of duplicating); Update Lists = normal compile (the server's multiple passes fill the .lof/.lot files). */
  function listInsert(kind) {
    const ta = $('#codeInput'); if (!ta) return;
    const cmd = kind === 'figures' ? '\\listoffigures' : '\\listoftables', t = ta.value, mk = tocMask(t), pos = ta.selectionEnd;
    const bs = t.indexOf('\\begin{document}') + 16, be = t.indexOf('\\end{document}');
    if (bs < 16 || pos < bs || (be >= 0 && pos > be)) return toast('Place the cursor inside the document body to insert a list of ' + kind);
    if (/^[ \t]*\\documentclass(?:\[[^\]]*\])?\{(letter|beamer)\}/m.test(mk)) return toast('This document class has no automatic list of ' + kind);
    const ex = new RegExp('\\\\' + cmd.slice(1) + '(?![a-zA-Z])').exec(mk);
    if (ex) {
      const d = dlg({ t: 'List of ' + kind[0].toUpperCase() + kind.slice(1), i: 'list', w: 420, btns: ['Cancel', 'Go to List'], b: '<p>This document already has a <code>' + cmd + '</code>. Inserting another would duplicate it.</p>' });
      $('.dlg__foot .btn--primary', d.el).onclick = () => { d.close(); tocGo(ta, ex.index); };
      return;
    }
    const sl = mk.slice(bs, pos).replace(/\\[{}]/g, ''), dep = (sl.match(/\{/g) || []).length - (sl.match(/\}/g) || []).length;
    let env = 0; for (const m of sl.matchAll(/\\(begin|end)\{[^}]*\}/g)) env += m[1] === 'begin' ? 1 : -1;
    if (dep !== 0 || env !== 0) return toast('Move the cursor outside any command or environment to insert a list of ' + kind);
    if (insertBreak(cmd) && !new RegExp('\\\\begin\\{' + (kind === 'figures' ? 'figure' : 'table') + '\\*?\\}').test(mk)) toast('No ' + kind.slice(0, -1) + ' environments with captions yet: the list will be empty until you add some');
  }
  function listUpdate() {
    const ta = $('#codeInput'); if (!ta) return;
    if (!/\\list(offigures|oftables)(?![a-zA-Z])/.test(tocMask(ta.value))) return toast('No list of figures or tables in this document. Use Insert List of Figures / Tables first');
    toast('Updating lists: they show captions from the last compile, so after adding or renaming captions you may need to compile more than once');
    runCompile();
  }
  /* Footnotes: fnParse() reads \footnote[opt]{…} from the (comment/verbatim-masked) source with real brace matching; \footnotemark and
     \footnotetext never match. The panel is non-modal (like Find), refreshes on every source change and click-selects the footnote. */
  function fnParse(t) {
    const mk = tocMask(t), out = [], re = /\\footnote(?![a-zA-Z@])/g; let m;
    while ((m = re.exec(mk))) {
      let b = 0, q = m.index - 1; while (q >= 0 && mk[q] === '\\') { b++; q--; }
      if (b % 2) continue;                                                  // "\\footnote" is a line break followed by text
      let i = m.index + m[0].length; while (/\s/.test(mk[i] || '')) i++;
      if (mk[i] === '[') { const e = mk.indexOf(']', i); if (e < 0) continue; i = e + 1; while (/\s/.test(mk[i] || '')) i++; }
      if (mk[i] !== '{') continue;
      let d = 0, j = i;
      for (; j < mk.length; j++) {
        if (mk[j] === '\\') { j++; continue; }
        if (mk[j] === '{') d++; else if (mk[j] === '}' && --d === 0) break;
      }
      if (d !== 0) continue;                                                // unbalanced: skip rather than guess
      out.push({ a: m.index, b: j + 1, ia: i + 1, ib: j, text: t.slice(i + 1, j).replace(/\s+/g, ' ').trim() });
    }
    return out;
  }
  function fnInsert() {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, mk = tocMask(t), s0 = ta.selectionStart, s1 = ta.selectionEnd, bs = t.indexOf('\\begin{document}') + 16, be = t.indexOf('\\end{document}');
    if (bs < 16 || s0 < bs || (be >= 0 && s1 > be)) return toast('Place the cursor inside the document body to insert a footnote');
    if ((s0 > 0 && mk[s0 - 1] !== t[s0 - 1]) || mk.slice(s0, s1) !== t.slice(s0, s1)) return toast('Move the cursor out of the comment or verbatim text to insert a footnote');
    if (fnParse(t).some((f) => s1 > f.a && s0 < f.b)) return toast('A footnote can’t be placed inside another footnote');
    const sel = t.slice(s0, s1), sm = mk.slice(s0, s1).replace(/\\[{}]/g, '');
    let dp = 0, ok = true; for (const ch of sm) { if (ch === '{') dp++; else if (ch === '}' && --dp < 0) ok = false; }
    const wrap = sel && ok && dp === 0 && sm.indexOf('%') < 0 && !/\n[ \t]*\n/.test(sel) && !/\\(begin|end)\{/.test(sm);
    if (wrap) { const a = s0 + 10; fmtEdit(ta, s0, s1, '\\footnote{' + sel + '}', a, a + sel.length); return; }
    const c = s1 + 10; fmtEdit(ta, s1, s1, '\\footnote{}', c, c);
    if (sel) toast('Selection left in place: footnote inserted after it');
  }
  /* References ▸ Cross-references ▸ Insert Label: the D.label dialog wired to a real \label{…}. The name is suggested from context
     (fig:/tab: from the caption, eq:, sec:/chap: from the heading) and checked against every \label already in the source (comments
     ignored), duplicates are refused and existing labels are never renamed or touched. Floats get it right after \caption, headings
     right after the title, equations at the cursor inside the environment; if the spot is ambiguous the dialog says so and inserts
     at the cursor. A float/heading that already has a label right after it, or an unnumbered (starred) one, is refused. */
  function lblDialog() {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, mk = tocMask(t), a = ta.selectionStart, z = ta.selectionEnd, bs = t.indexOf('\\begin{document}') + 16, be = t.indexOf('\\end{document}');
    if (bs < 16 || a < bs || (be >= 0 && z > be)) return toast('Place the cursor inside the document body to insert a label');
    if (z > 0 && mk[z - 1] !== t[z - 1]) return toast('Move the cursor out of the comment or verbatim text to insert a label');
    const braceEnd = (i) => { let d = 0; for (; i < mk.length; i++) { const c = mk[i]; if (c === '\\') i++; else if (c === '{') d++; else if (c === '}' && !--d) return i + 1; } return -1; };
    const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), after = (p) => /^\s*\\label\s*\{/.test(mk.slice(p, p + 200));
    const slug = (s) => s.replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[^A-Za-z0-9]+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean).slice(0, 3).join('_');
    // innermost open environment around the cursor that can carry a label
    const st = [], er = /\\(begin|end)\{([^}]+)\}/g; let m;
    while ((m = er.exec(mk)) && m.index < z) {
      if (m[1] === 'begin') st.push({ n: m[2], a: m.index, e: m.index + m[0].length });
      else for (let i = st.length - 1; i >= 0; i--) if (st[i].n === m[2]) { st.length = i; break; }
    }
    const env = st.reverse().find((x) => /^(figure|table|subfigure|subtable|wrapfigure|wraptable|sidewaysfigure|sidewaystable)\*?$|^(equation|align|alignat|gather|multline|flalign|eqnarray)\*?$/.test(x.n));
    let prefix = '', text = '', opts = [], note = '', hpos = -1, hdr = null;
    const HD = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{/g, hpre = { part: 'part', chapter: 'chap' };
    if (env) {
      const base = env.n.replace(/\*$/, ''), isEq = /^(equation|align|alignat|gather|multline|flalign|eqnarray)$/.test(base);
      if (isEq && env.n.endsWith('*')) return toast('This equation environment is unnumbered. Use the non-starred form to give it a label');
      let end = -1; { const r = new RegExp('\\\\(begin|end)\\{' + rx(env.n) + '\\}', 'g'); r.lastIndex = env.e; let d = 1, x; while ((x = r.exec(mk))) { d += x[1] === 'begin' ? 1 : -1; if (!d) { end = x.index; break; } } }
      if (end < 0) return toast('The “' + env.n + '” environment isn’t closed. Fix that before inserting a label');
      if (isEq) {
        if (/^(equation|multline)$/.test(base) && /\\label\s*\{/.test(mk.slice(env.e, end))) return toast('This equation already has a label. Existing labels are never renamed');
        prefix = 'eq:'; opts = ['At the cursor (inside the equation)'];
      } else {
        prefix = /table/.test(base) ? 'tab:' : 'fig:';
        const caps = [], cr = /\\caption(?:\s*\[[^\]]*\])?\s*\{/g; cr.lastIndex = env.e;
        while ((m = cr.exec(mk)) && m.index < end) { const ce = braceEnd(m.index + m[0].length - 1); if (ce > 0) caps.push({ a: m.index, o: m.index + m[0].length, e: ce }); }
        if (caps.length === 1) {
          if (after(caps[0].e)) return toast('This ' + (prefix === 'tab:' ? 'table' : 'figure') + ' already has a label right after its caption. Existing labels are never renamed');
          hpos = caps[0].e; text = t.slice(caps[0].o, caps[0].e - 1); opts = ['After the caption (recommended)', 'At the cursor'];
        } else {
          opts = ['At the cursor'];
          note = caps.length ? 'This environment has several captions, so the right spot is ambiguous: the label will go at the cursor.' : 'No \\caption here yet. A label must come after \\caption to get the right number. Add the caption first, or place it at the cursor.';
        }
      }
    } else {
      // headings: label goes right after the title; otherwise it refers to the nearest section above
      const ls = t.lastIndexOf('\n', z - 1) + 1, le = (t.indexOf('\n', z) + 1 || t.length + 1) - 1, line = mk.slice(ls, le); HD.lastIndex = 0;
      while ((m = HD.exec(line))) { const e = braceEnd(ls + m.index + m[0].length - 1); if (e > 0 && z >= ls + m.index && z <= e) { hdr = { cmd: m[1], star: m[2], o: ls + m.index + m[0].length, e }; break; } }
      if (!hdr) { let last = null; HD.lastIndex = 0; const pre = mk.slice(0, z); while ((m = HD.exec(pre))) if (!m[2]) { const e = braceEnd(m.index + m[0].length - 1); if (e > 0) last = { cmd: m[1], o: m.index + m[0].length, e }; } if (last) { prefix = (hpre[last.cmd] || 'sec') + ':'; text = t.slice(last.o, last.e - 1); note = 'The label will refer to the section above (“' + text.slice(0, 40) + '”).'; } opts = ['At the cursor']; }
      else {
        if (hdr.star) return toast('A starred heading is unnumbered: it can’t carry a meaningful label');
        if (after(hdr.e)) return toast('This heading already has a label. Existing labels are never renamed');
        prefix = (hpre[hdr.cmd] || 'sec') + ':'; text = t.slice(hdr.o, hdr.e - 1); hpos = hdr.e; opts = ['After the heading (recommended)', 'At the cursor'];
      }
    }
    // suggest a unique name
    const have = new Set(), lr = /\\label\s*\{([^}]*)\}/g; while ((m = lr.exec(mk))) have.add(m[1].trim());
    let base = prefix + (slug(text) || (prefix ? String([...have].filter((x) => x.startsWith(prefix)).length + 1) : '')), nm = base, n = 2; while (nm && have.has(nm)) nm = base + '_' + n++;
    const d = dlg(G('Insert Label', 'tags', [['t', 'Label name', nm], ['s', 'Placement', opts.join('|')], ['h', '<p class="muted" id="lblNote" style="margin:0;font-size:12px"></p>']], ['Cancel', 'Insert Label'], 440));
    $('.demo-note', d.el)?.remove(); const inp = $('input', d.el), sel = $('select', d.el);
    sel.disabled = opts.length < 2; $('#lblNote', d.el).textContent = note || (opts.length > 1 ? 'Labels are case-sensitive; use them with \\ref{…}.' : '');
    inp.focus(); inp.select();
    const go = () => {
      const name = inp.value.trim();
      if (!/^[A-Za-z0-9:_.\-]+$/.test(name)) return toast('Use only letters, digits and : _ . - in a label name');
      if (have.has(name)) return toast('A label named “' + name + '” already exists. Choose a different name');
      if (ta.value !== t) { d.close(); return toast('The source changed. Place the cursor and try again'); }
      const lab = '\\label{' + name + '}', atCap = sel.selectedIndex === 0 && hpos >= 0;
      d.close();
      if (!atCap) { const c = z + lab.length; return fmtEdit(ta, z, z, lab, c, c), syncFmtBtns(); }
      const ln = t.lastIndexOf('\n', hpos - 1) + 1, ind = (/^[ \t]*/.exec(t.slice(ln))[0]), str = hdr ? lab : '\n' + ind + lab;
      fmtEdit(ta, hpos, hpos, str, a + (hpos <= a ? str.length : 0), z + (hpos <= a ? str.length : 0)); syncFmtBtns();
    };
    $('.dlg__foot .btn--primary', d.el).onclick = go;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  /* References ▸ Cross-references ▸ Cross-reference / Reference Figures / Tables / Equations: a searchable picker over every real
     \label{…} in the source (comments and verbatim blanked via tocMask, nested braces handled). Each entry shows its type (from the
     enclosing float/equation/heading) and context (caption, equation body, section title). Selecting an entry scrolls the editor to its
     declaration; Insert adds baseline \ref{label} at the cursor. Duplicate labels and undefined \ref targets are flagged; undefined-ref
     detection is skipped when the source pulls in other files (\input/\include) since their labels can't be seen. Never adds labels itself,
     "Add label…" just opens the existing, safety-checked Insert Label dialog. The scan runs fresh each time the picker opens/inserts. */
  const XR_FLOAT = /^(figure|table|subfigure|subtable|wrapfigure|wraptable|sidewaysfigure|sidewaystable)\*?$/, XR_EQ = /^(equation|align|alignat|gather|multline|flalign|eqnarray)\*?$/;
  function xrScan(t) {
    const mk = tocMask(t), clean = (s, n) => { s = (s || '').replace(/\\label\s*\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim(); return s.length > (n || 90) ? s.slice(0, n || 90) + '…' : s; };
    const braceEnd = (i) => { let d = 0; for (; i < mk.length; i++) { const c = mk[i]; if (c === '\\') i++; else if (c === '{') d++; else if (c === '}' && !--d) return i + 1; } return -1; };
    const re = /\\(begin|end)\{([^}]+)\}|\\label\s*\{|\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{|\\caption(?:\s*\[[^\]]*\])?\s*\{/g;
    const st = [], labels = []; let m, head = '';
    while ((m = re.exec(mk))) {
      const open = m.index + m[0].length - 1;
      if (m[1] === 'begin') st.push({ n: m[2], e: m.index + m[0].length });
      else if (m[1] === 'end') { for (let i = st.length - 1; i >= 0; i--) if (st[i].n === m[2]) { st[i].body = mk.slice(st[i].e, m.index); st.length = i; break; } }
      else if (m[3]) { if (!m[4]) { const e = braceEnd(open); if (e > 0) head = clean(mk.slice(open + 1, e - 1)); } }
      else if (/^\\caption/.test(m[0])) { const e = braceEnd(open), fl = [...st].reverse().find((x) => XR_FLOAT.test(x.n)); if (fl && e > 0 && fl.cap == null) fl.cap = mk.slice(open + 1, e - 1); }
      else {
        const e = braceEnd(open), name = e > 0 ? mk.slice(open + 1, e - 1).trim() : ''; if (!name) continue;
        const env = [...st].reverse().find((x) => XR_FLOAT.test(x.n) || XR_EQ.test(x.n)), inner = st.filter((x) => x.n !== 'document').pop();
        const L = { name, pos: m.index, len: e - m.index, line: lineOf(m.index) + 1, env };
        if (env && XR_FLOAT.test(env.n)) L.type = /table/.test(env.n) ? 'Table' : 'Figure';
        else if (env) L.type = 'Equation';
        else if (inner) { L.type = /^(itemize|enumerate|description)$/.test(inner.n) ? 'Item' : 'Other'; L.ctx = inner.n; }
        else if (head) { L.type = 'Section'; L.ctx = head; } else L.type = 'Other';
        labels.push(L);
      }
    }
    labels.forEach((L) => { if (L.env) L.ctx = clean(L.type === 'Equation' ? L.env.body : L.env.cap, L.type === 'Equation' ? 70 : 90); });
    const cnt = {}; labels.forEach((L) => { cnt[L.name] = (cnt[L.name] || 0) + 1; }); labels.forEach((L) => { L.dup = cnt[L.name] > 1; });
    let dang = null;
    if (!/\\(?:input|include|subfile|externaldocument)\b/.test(mk)) {
      dang = []; const rr = /\\(?:ref|eqref|autoref|pageref|cref|Cref|nameref|vref)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
      while ((m = rr.exec(mk))) { let off = m.index + m[0].length - 1 - m[1].length; m[1].split(',').forEach((s) => { const n = s.trim(); if (n && !cnt[n]) dang.push({ name: n, pos: off + s.indexOf(n), line: lineOf(m.index) + 1 }); off += s.length + 1; }); }
    }
    return { labels, dang };
  }
  function xrDialog(kind) {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, mk = tocMask(t), z = ta.selectionEnd, bs = t.indexOf('\\begin{document}') + 16, be = t.indexOf('\\end{document}');
    if (bs < 16 || ta.selectionStart < bs || (be >= 0 && z > be)) return toast('Place the cursor inside the document body to insert a reference');
    if (z > 0 && mk[z - 1] !== t[z - 1]) return toast('Move the cursor out of the comment or verbatim text to insert a reference');
    const { labels, dang } = xrScan(t), tx = (s) => esc(s || ''), TYPES = ['All types', 'Figures', 'Tables', 'Equations', 'Sections', 'Other'], TM = { Figures: ['Figure'], Tables: ['Table'], Equations: ['Equation'], Sections: ['Section'], Other: ['Item', 'Other'] };
    const dupN = new Set(labels.filter((l) => l.dup).map((l) => l.name));
    let sel = -1, rows = [];
    const d = dlg({ t: 'Insert Cross-reference', i: 'link', w: 620, btns: ['Cancel', 'Insert reference'], focus: '#xrQ', b: `<div style="display:flex;gap:8px"><div class="field" style="flex:1"><label class="field__label">Search<input id="xrQ" placeholder="Label, caption or section text" autocomplete="off"></label></div><div class="field" style="margin-top:0"><label class="field__label">Type<select id="xrT">${TYPES.map((x) => `<option>${x}</option>`).join('')}</select></label></div></div>
      <div id="xrCount" class="muted" style="margin:6px 0 4px"></div><div id="xrList" role="listbox" style="max-height:230px;overflow:auto;border:1px solid var(--border,#8884);border-radius:6px"></div>
      <div id="xrProb" style="margin-top:8px;font-size:12px"></div>
      <div style="display:flex;gap:6px;margin-top:10px"><button class="btn btn--sm" id="xrGo">Go to declaration</button><button class="btn btn--sm" id="xrAdd" title="Opens Insert Label, which only adds a label where the spot is unambiguous">Add label…</button></div>` });
    const $d = (s) => $(s, d.el), sty = (el, on) => { el.style.background = on ? 'var(--panel-2,#8882)' : ''; };
    $d('#xrT').selectedIndex = Math.max(0, ['all', 'fig', 'tab', 'eq'].indexOf(kind));
    function list() {
      const q = $d('#xrQ').value.trim().toLowerCase().split(/\s+/).filter(Boolean), ty = TM[$d('#xrT').value];
      rows = labels.filter((l) => (!ty || ty.includes(l.type)) && q.every((w) => (l.name + ' ' + l.type + ' ' + (l.ctx || '')).toLowerCase().includes(w)));
      sel = rows.length ? 0 : -1;
      $d('#xrCount').textContent = labels.length ? rows.length + ' of ' + labels.length + ' labels' : '';
      $d('#xrList').innerHTML = rows.map((l, i) => `<div role="option" data-i="${i}" tabindex="-1" style="padding:6px 8px;cursor:pointer"><b>${tx(l.name)}</b> <span class="muted">· ${l.type} · line ${l.line}</span>${l.dup ? ' <span style="color:#c0392b">⚠ duplicate</span>' : ''}${l.ctx ? '<br><span class="muted">' + tx(l.ctx) + '</span>' : ''}</div>`).join('')
        || `<div class="muted" style="padding:8px">${labels.length ? 'No match' : 'No \\label{…} in this document yet. Use Add label… (or Insert Label) first.'}</div>`;
      mark(false);
    }
    function mark(scroll) { $$('#xrList [data-i]', d.el).forEach((el) => sty(el, +el.dataset.i === sel)); const el = $d('#xrList [data-i="' + sel + '"]'); if (el && scroll) el.scrollIntoView({ block: 'nearest' }); }
    function jump(pos, len) { d.close(); ta.focus(); ta.setSelectionRange(pos, pos + len); goToLine(lineOf(pos)); }
    function preview() { const l = rows[sel]; if (l) goToLine(lineOf(l.pos)); }   // scroll only, cursor/selection untouched until Insert
    function problems() {
      const p = [];
      [...dupN].forEach((n) => p.push(`<a href="#" data-p="${labels.find((l) => l.name === n && l.dup).pos}" data-n="${n.length + 8}">⚠ Duplicate label <b>${tx(n)}</b> (lines ${labels.filter((l) => l.name === n).map((l) => l.line).join(', ')})</a>`));
      (dang || []).forEach((r) => p.push(`<a href="#" data-p="${r.pos}" data-n="${r.name.length}">⚠ Undefined reference <b>${tx(r.name)}</b> (line ${r.line})</a>`));
      $d('#xrProb').innerHTML = (p.length ? p.slice(0, 8).join('<br>') + (p.length > 8 ? '<br>…and ' + (p.length - 8) + ' more' : '') : '') + (dang === null ? '<div class="muted">Undefined-reference check skipped: this document includes other files whose labels can’t be seen.</div>' : '');
    }
    $d('#xrQ').addEventListener('input', () => { list(); preview(); }); $d('#xrT').addEventListener('change', () => { list(); preview(); });
    $d('#xrList').addEventListener('click', (e) => { const r = e.target.closest('[data-i]'); if (r) { sel = +r.dataset.i; mark(); preview(); } });
    $d('#xrList').addEventListener('dblclick', (e) => { if (e.target.closest('[data-i]')) go(); });
    $d('#xrProb').addEventListener('click', (e) => { const a = e.target.closest('a[data-p]'); if (a) { e.preventDefault(); const l = labels.find((x) => x.pos === +a.dataset.p); jump(+a.dataset.p, l ? l.len : +a.dataset.n); } });
    $d('#xrQ').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (rows.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length; mark(true); preview(); } }
      else if (e.key === 'Enter') { e.preventDefault(); go(); }
    });
    $d('#xrGo').onclick = () => { const l = rows[sel]; if (!l) return toast('Select a label first'); jump(l.pos, l.len); };
    $d('#xrAdd').onclick = () => { d.close(); lblDialog(); };
    function go() {
      const l = rows[sel]; if (!l) return toast('Select a label to reference');
      if (ta.value !== t) { d.close(); return toast('The source changed. Reopen Cross-reference to rescan'); }
      const str = '\\ref{' + l.name + '}'; d.close(); ta.focus(); fmtEdit(ta, z, z, str, z + str.length, z + str.length); syncFmtBtns();
      if (l.dup) toast('Note: “' + l.name + '” is declared more than once: LaTeX will warn and the reference may be wrong');
    }
    $('.dlg__foot .btn--primary', d.el).onclick = go;
    list(); problems();
  }
  const FN = { on: false, last: null, timer: 0 };
  function fnRender() {
    const ta = $('#codeInput'), p = $('#fnPanel'); if (!ta || !p || p.hidden) return;
    FN.last = ta.value; const list = fnParse(ta.value), box = $('#fnList');
    $('#fnCount').textContent = list.length ? list.length + (list.length === 1 ? ' footnote' : ' footnotes') : '';
    box.innerHTML = list.length ? '<table class="tbl"><thead><tr><th>#</th><th>Footnote</th><th>Line</th></tr></thead><tbody>' + list.map((f, i) =>
      `<tr data-i="${f.a}" tabindex="0"><td>${i + 1}</td><td>${f.text ? esc(f.text.length > 120 ? f.text.slice(0, 120) + '…' : f.text) : '<span class="muted">(empty)</span>'}</td><td>${lineOf(f.a) + 1}</td></tr>`).join('') + '</tbody></table>'
      : '<p class="muted" style="margin:6px 4px">No footnotes in this source. Use Insert Footnote to add one.</p>';
  }
  function fnSchedule() {   // called from renderCode(); only does work while the panel is open and the text really changed
    const ta = $('#codeInput'); if (!ta || !$('#fnPanel') || $('#fnPanel').hidden || ta.value === FN.last) return;
    clearTimeout(FN.timer); FN.timer = setTimeout(fnRender, 150);
  }
  function fnGo(a) {
    const ta = $('#codeInput'), f = fnParse(ta.value).find((x) => x.a === a); if (!f) return fnRender();
    ta.focus(); ta.setSelectionRange(f.ia, f.ib); goToLine(lineOf(f.a));
  }
  function fnToggle() {
    let p = $('#fnPanel');
    if (!p) {
      p = h('<div id="fnPanel" class="findpanel fnpanel" hidden role="complementary" aria-label="Footnotes"><div class="findpanel__row"><b>Footnotes</b><span class="sp"></span><span id="fnCount" class="findpanel__count"></span><button class="ftbtn" id="fnClose" aria-label="Close footnotes" title="Close">' + ic('x') + '</button></div><div id="fnList" class="fnlist"></div></div>');
      $('#findPanel').parentNode.appendChild(p);
      $('#fnClose', p).onclick = () => { p.hidden = true; };
      $('#fnList', p).addEventListener('click', (e) => { const r = e.target.closest('tr[data-i]'); if (r) fnGo(+r.dataset.i); });
      $('#fnList', p).addEventListener('keydown', (e) => { const r = e.target.closest('tr[data-i]'); if (r && e.key === 'Enter') fnGo(+r.dataset.i); });
    }
    p.hidden = !p.hidden; if (!p.hidden) fnRender();
  }
  /* Insert ▸ Link: the existing D.link dialog, wired to \href{URL}{text}. Selection (if any) prefills the text; it's kept as raw
     source when untouched (it's already LaTeX), otherwise the typed text is escaped. hyperref is added via ensurePackage. */
  function cleanUrl(u) {   // -> normalized URL string, or null if malformed
    u = u.trim(); if (!u || /[\s\\{}<>"^`|\u0000-\u001f]/.test(u)) return null;
    if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(u)) return u;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u) && /^[^\s/@]+\.[a-z]{2,}([/?#:]|$)/i.test(u)) u = 'https://' + u;
    if (!/^(https?|ftp):\/\/[^\s/]+/i.test(u)) return null;
    try { const p = new URL(u); if (!p.hostname || !/^[\w.-]+$/.test(p.hostname.replace(/^\[.*\]$/, 'x'))) return null; } catch (e) { return null; }
    return u;
  }
  function linkDialog() {
    const ta = $('#codeInput'); if (!ta) return;
    const t0 = ta.value, a = ta.selectionStart, z = ta.selectionEnd, sel = t0.slice(a, z), bs = t0.indexOf('\\begin{document}'), be = t0.indexOf('\\end{document}');
    if (bs < 0 || a < bs + 16 || (be >= 0 && z > be)) return toast('Place the cursor inside the document body to insert a link');
    if (sel && (/\n/.test(sel) || !balanced(sel))) return toast('Select text within one line, with matched braces, to turn it into a link');
    const d = dlg(D.link()), ins = $$('input', d.el); $('.demo-note', d.el)?.remove();
    ins[1].value = sel;
    const go = () => {
      const url = cleanUrl(ins[0].value); if (!url) return toast('Enter a valid web address, e.g. https://example.com');
      const raw = ins[1].value === sel && sel !== '', label = raw ? sel : texEsc(ins[1].value.trim() || url);
      const cur = ta.value; if (cur.slice(a, z) !== sel) { d.close(); return toast('The source changed. Place the cursor and try again'); }
      const pk = ensurePackage(cur, 'hyperref');
      if (pk === false) return toast('Could not add hyperref. Check the \\documentclass / preamble');
      const str = '\\href{' + url.replace(/%/g, '\\%') + '}{' + label + '}', end = a + str.length;
      d.close(); fmtEdit(ta, a, z, str, end, end);
      if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, end + pk.str.length, end + pk.str.length);   // preamble precedes the body: cursor just shifts
      syncFmtBtns();
    };
    $('.dlg__foot .btn--primary', d.el).onclick = go;
    ins.forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
  }
  /* Insert ▸ Picture / Figure: the existing D.picture dialog (fig=true → Figure) listing the images that are really in the open
     project folder, wired to \includegraphics[width=…]{project-relative/path} (graphicx via ensurePackage). Figure wraps it in a
     figure float with optional caption/label and alignment, and refuses to nest inside an existing figure. Import… copies files
     from the computer into figures/ first. */
  const WIDTH_RE = /^(?:(?:\d+\.?\d*|\.\d+)(?:pt|cm|mm|in|em|ex|bp)|(?:\d+\.?\d*|\.\d+)?\\(?:linewidth|textwidth|columnwidth))$/;
  async function projectImages(dir, pre, out, depth) {
    for await (const [name, hd] of dir.entries()) {
      if (name.startsWith('.') || out.length >= 500) continue;
      if (hd.kind === 'directory') { if (depth < 6) await projectImages(hd, pre + name + '/', out, depth + 1); }
      else if (/\.(png|jpe?g|pdf)$/i.test(name)) out.push(pre + name);
    }
    return out;
  }
  async function pictureDialog(fig) {
    const ta = $('#codeInput'); if (!ta) return;
    if (!ctx.rootDirHandle) return toast('Open a project folder first: pictures are chosen from the project’s files');
    const t0 = ta.value, pos = ta.selectionEnd, bs = t0.indexOf('\\begin{document}'), be = t0.indexOf('\\end{document}'), what = fig ? 'a figure' : 'a picture';
    if (bs < 0 || pos < bs + 16 || (be >= 0 && pos > be)) return toast('Place the cursor inside the document body to insert ' + what);
    if (fig) {
      let depth = 0, m; const re = /\\(begin|end)\{(?:figure|wrapfigure|sidewaysfigure)\*?\}/g, before = t0.slice(0, pos);
      while ((m = re.exec(before))) depth += m[1] === 'begin' ? 1 : -1;
      if (depth > 0) return toast('The cursor is already inside a figure: figures can’t be nested');
    }
    const list = async () => (await projectImages(ctx.rootDirHandle, '', [], 0)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let imgs; try { imgs = await list(); } catch (e) { return toast('Could not read the project folder'); }
    const d = dlg(D.picture(fig)); $('.demo-note', d.el)?.remove();
    const [sel, wm, al, pl] = $$('select', d.el), ins = $$('input', d.el), wv = ins[0], cap = ins[1], lab = ins[2];
    const fill = (pick) => { sel.replaceChildren(...imgs.map((p) => new Option(p, p))); if (pick) sel.value = pick; };
    fill();
    /* Import: copies chosen PNG/JPG/PDF files from the computer into the project's figures/ folder (created if missing; a name
       clash gets -1, -2… so nothing is overwritten), refreshes the sidebar, and selects the first imported file. */
    $('#picImp', d.el).onclick = async () => {
      if (!(await ensureWrite())) return;   // permission prompts need a fresh click, so ask here, not after the file chooser
      if (navigator.userActivation && !navigator.userActivation.isActive) return toast('Write access granted. Click Import again');
      const inp = window.RPE.fsBridge.fileInput('.png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf', true, 'Choose Images');
      inp.onchange = async () => {
        const files = [], bad = [];
        for (const f of inp.files) {   // type by extension AND file signature (PNG / JPEG / PDF), 1 byte–25 MB
          const b = new Uint8Array(await f.slice(0, 1024).arrayBuffer()), x = (f.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
          const ok = (x === 'png' && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || ((x === 'jpg' || x === 'jpeg') && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (x === 'pdf' && String.fromCharCode(...b).includes('%PDF-'));
          if (!ok) bad.push(f.name + ' isn’t a valid PNG, JPG or PDF'); else if (!f.size || f.size > 25 << 20) bad.push(f.name + (f.size ? ' is over 25 MB' : ' is empty')); else files.push(f);
        }
        if (bad.length) toast(bad[0] + (bad.length > 1 ? ' (+' + (bad.length - 1) + ' more skipped)' : '') + ': skipped');
        if (!files.length) return bad.length ? 0 : toast('Choose PNG, JPG or PDF files');
        try {
          const dir = await ctx.rootDirHandle.getDirectoryHandle('figures', { create: true }); let first = null, reused = 0;
          const same = async (hd, f) => { const o = await hd.getFile(); if (o.size !== f.size) return false; const a = new Uint8Array(await o.arrayBuffer()), c = new Uint8Array(await f.arrayBuffer()); return a.every((v, i) => v === c[i]); };
          for (const f of files) {
            const m = f.name.replace(/[%#{}\\~^$&"\u0000-\u001f\/:*?<>|]/g, '_').replace(/^\.+/, '_').match(/^(.*?)(\.[^.]*)$/); let name = m[1] + m[2], k = 0, dup = false;
            while (await existsIn(dir, name)) { if ((dup = await same(await dir.getFileHandle(name), f))) break; name = m[1] + '-' + (++k) + m[2]; }   // identical file already there → reuse it
            if (dup) reused++; else { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(f); await w.close(); }
            first = first || 'figures/' + name;
          }
          const root = ctx.PROJECT[0]; if (root) { await refreshDir(root.path); const fd = findNode(root.path + '/figures'); if (fd) await refreshDir(fd.path); renderExplorer(); }
          imgs = await list(); fill(first); toast(reused === files.length ? (files.length > 1 ? 'Already in figures/. Nothing copied' : first + ' is already in the project: reusing it') : files.length > 1 ? files.length + ' files ready in figures/' + (reused ? ' (' + reused + ' already there)' : '') : 'Imported into ' + first);
        } catch (e) { toast('Could not import: the project folder may be read-only'); }
      };
      inp.click();
    };
    const setW = () => { wv.disabled = wm.selectedIndex === 0; wv.value = ['', '0.8', '6cm'][wm.selectedIndex]; };
    wm.onchange = setW; setW();
    $('.dlg__foot .btn--primary', d.el).onclick = () => {
      const p = sel.value, v = wv.value.trim(), m = wm.selectedIndex, c = cap ? cap.value.trim() : '', l = lab ? lab.value.trim() : '';
      if (!p) return toast('Import or choose an image first');
      if (/[%#{}\\~^$&"]/.test(p)) return toast('That file name has characters LaTeX can’t take in a path (% # { } \\ ~ ^ $ & "). Rename it first');
      let w;
      if (m === 0) w = '\\linewidth';
      else if (m === 1) { const f = parseFloat(v); if (!/^\d*\.?\d+$/.test(v) || !(f > 0 && f <= 1)) return toast('Enter a fraction above 0 and up to 1, e.g. 0.8'); w = (f === 1 ? '' : f) + '\\linewidth'; }
      else if (!WIDTH_RE.test(v)) return toast('Enter a width like 6cm, 3in or 0.5\\linewidth'); else w = v;
      if (l && !c) return toast('A label needs a caption. Add a caption or clear the label');
      if (l && !/^[\w:.-]+$/.test(l)) return toast('Labels may only contain letters, digits and : . _ -');
      const cur = ta.value, q = ta.selectionEnd; if (cur !== t0 || q !== pos) { d.close(); return toast('The source changed. Place the cursor and try again'); }
      if (l && cur.includes('\\label{' + l + '}')) return toast('The label “' + l + '” is already used in this document');
      const pk = ensurePackage(cur, 'graphicx');
      if (pk === false) return toast('Could not add graphicx. Check the \\documentclass / preamble');
      const inc = '\\includegraphics[width=' + w + ']{' + (/\s/.test(p) ? '"' + p + '"' : p) + '}';
      const out = fig ? ['\\begin{figure}[' + ['htbp', '!ht', 't', 'b', 'p'][pl.selectedIndex] + ']', '  ' + ['\\centering', '\\raggedright', '\\raggedleft'][al.selectedIndex], '  ' + inc].concat(c ? ['  \\caption{' + texEsc(c) + '}'] : [], l ? ['  \\label{' + l + '}'] : [], ['\\end{figure}']) : [inc];
      const pre = q > 0 && cur[q - 1] !== '\n' ? '\n' : '', post = q < cur.length && cur[q] !== '\n' ? '\n' : '', body = out.join('\n'), end = q + pre.length + body.length;
      d.close(); fmtEdit(ta, q, q, pre + body + post, end, end);
      if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, end + pk.str.length, end + pk.str.length);   // preamble precedes the body: cursor just shifts
      syncFmtBtns();
    };
  }
  /* Insert ▸ Chart: the existing D.chart dialog as a Preview / Spreadsheet / Code / Export editor. Data lives in a small
     in-memory grid (first column X, the rest series); the Preview is a PNG rendered by POST /api/chart (Matplotlib via
     server/chart.py), refreshed on every change. Export downloads, saves into the project's figures/, or inserts a figure. */
  function chartCheck(s) {   // first problem that stops this data from being drawn, or '' (the server re-checks the same rules)
    const t = s.type, raw = CH_RAW.includes(t), txt = (v) => String(v == null ? '' : v).trim(), NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
    const rows = s.rows.map((r, n) => [n + 1, r]).filter(([, r]) => r.some((c) => txt(c)));
    if (!rows.length) return 'There is no data to chart yet. Add values in the Spreadsheet tab.';
    if (s.columns.length < (raw ? 1 : 2)) return 'Add at least two columns: X and one series.';
    const xnum = t === 'line' || t === 'scatter';
    for (let j = raw || xnum ? 0 : 1; j < s.columns.length; j++) {
      const name = txt(s.columns[j]) || 'column ' + (j + 1); let n = 0;
      for (const [k, r] of rows) {
        const v = txt(r[j]);
        if (!v) { if (xnum && j === 0) return 'Row ' + k + ': the X value is empty.'; continue; }
        if (!NUM.test(v)) return 'Row ' + k + ', column “' + name + '”: “' + v + '” is not a number.' + (v.includes(',') ? ' Use a dot as the decimal separator.' : '');
        n++;
      }
      if (!n && t !== 'heatmap') return 'Column “' + name + '” has no numeric values.';
      if (t === 'box' && s.variant === 'notch' && n < 10) return 'Notched boxes need at least 10 values in every column; “' + name + '” has ' + n + '. Turn notches off or add data.';
    }
    if (t === 'heatmap' && s.columns.length < 2) return 'Add at least one matrix column after the row labels.';
    for (const [k, n] of [['xlim', 'X range'], ['ylim', 'Y range']]) {
      const v = txt(s[k]); if (!v) continue; const p = v.replace(/,/g, ' ').split(/\s+/);
      if (p.length !== 2 || !p.every((x) => NUM.test(x) && isFinite(x))) return n + ' must be two numbers, like 0, 10.';
      if (+p[0] >= +p[1]) return n + ': the minimum must be smaller than the maximum.';
    }
    return '';
  }
  async function chartRender(spec, format, dpi) {
    const bad = chartCheck(spec); if (bad) throw new Error(bad);
    let j;
    try { j = await (await fetch('/api/chart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec, format, dpi }) })).json(); }
    catch (e) { throw new Error('Could not reach the chart server. Start it with “node server/server.js” and open the app from that address.'); }
    if (!j || !j.ok) throw Object.assign(new Error((j && j.error) || 'The chart could not be drawn.'), { setup: !!(j && j.setup) });
    return j;
  }
  const CH_PAL = {
    default: ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#000000', '#7F7F7F'],
    colorblind: ['#000000', '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'],
    muted: ['#332288', '#88CCEE', '#44AA99', '#117733', '#999933', '#DDCC77', '#CC6677', '#882255', '#AA4499'],
    grayscale: ['#000000', '#555555', '#8C8C8C', '#B3B3B3'],
    viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
    plasma: [], inferno: [], magma: [], coolwarm: [], bwr: [], RdBu: [], seismic: []
  };
  const CH_VAR = { line: ['Line style', ['', 'Straight, with markers'], ['step', 'Step']], scatter: ['Trend line', ['', 'None'], ['linear', 'Linear fit'], ['linear_ci', 'Linear fit + 95% band'], ['quadratic', 'Quadratic fit']], bar: ['Bar layout', ['', 'Grouped'], ['stacked', 'Stacked']],
    histogram: ['Overlay', ['', 'None'], ['kde', 'Density curve (KDE)']], box: ['Box shape', ['', 'Standard'], ['notch', 'Notched']], heatmap: ['Cell labels', ['', 'None'], ['values', 'Show values']] };   // [label, [value, text]…] per chart type; values = chart.py "variant"
  const CH_SAMPLE = (() => {   // default spreadsheet per chart type (docs: default-spreadsheets.md); rows are strings, scatter/box are laid out one column per group
    const S = (a) => a.map((r) => r.map(String)), by = (cols, a) => ({ cols, rows: S(a) });
    const wt = [[18.4, 14.57], [41.1, 26.52], [21.5, 16.14], [30.4, 20.38], [24.4, 18.28], [21.4, 15.56], [39.3, 25.87], [41.8, 27.43], [27.2, 17.73], [35.6, 23.85], [26.7, 18.16], [28.2, 18.34], [27.0, 18.86], [26.9, 17.81], [26.7, 19.89], [32.6, 22.79], [42.0, 26.6], [19.2, 12.81], [26.0, 17.18], [31.4, 20.45], [18.8, 14.98], [28.1, 19.05], [24.4, 17.59], [33.2, 21.62], [26.9, 19.03], [31.0, 23.59], [32.4, 20.29], [41.3, 26.22], [39.2, 24.83], [19.2, 14.06]],
      ko = [[23.1, 14.43], [32.1, 18.99], [25.6, 16.64], [37.9, 18.5], [28.9, 18.24], [38.2, 22.29], [38.4, 20.87], [32.1, 17.08], [26.8, 16.1], [25.7, 15.1], [29.7, 17.13], [38.9, 21.66], [32.2, 17.66], [29.8, 17.99], [27.6, 17.46], [39.9, 23.67], [24.8, 17.57], [24.9, 15.84], [28.2, 18.18], [29.6, 17.21], [33.4, 20.06], [20.9, 13.51], [35.2, 20.67], [40.0, 21.11], [41.2, 20.92], [34.3, 20.35], [31.1, 18.13], [27.0, 15.96], [24.9, 14.8], [18.9, 13.44]],
      box = [[48.3, 50.2, 47.8, 86.8, 51.0, 63.2, 40.5, 43.7, 46.6, 58.0, 41.0, 16.4, 60.1, 55.1, 41.5, 51.9, 40.8, 49.5, 54.0, 64.8, 52.2, 41.7, 57.6, 55.9, 36.5],
        [60.5, 67.8, 71.0, 97.4, 43.7, 64.1, 54.8, 39.0, 48.6, 50.4, 45.5, 73.5, 63.5, 68.3, 67.2, 47.2, 62.5, 66.2, 48.9, 57.3, 62.4, 63.4, 57.5, 63.8, 56.2],
        [70.0, 84.9, 72.6, 116.6, 87.5, 64.0, 48.9, 67.5, 74.9, 89.7, 56.4, 19.8, 58.9, 62.9, 59.2, 48.4, 66.6, 58.4, 71.2, 81.7, 60.0, 52.2, 70.0, 69.1, 45.7],
        [73.3, 70.5, 61.3, 104.2, 77.1, 57.0, 61.7, 65.9, 80.3, 65.1, 79.6, 69.7, 75.9, 75.2, 86.5, 68.2, 76.4, 61.2, 78.6, 72.4, 69.3, 73.6, 62.6, 71.8, 62.8]],
      hist = [1.442, -1.873, 1.281, 1.358, 2.592, 1.449, 2.202, -1.437, -2.619, -1.012, 0.452, -0.61, -1.394, 1.175, -0.724, -1.541, 0.892, -1.122, -0.308, 1.722, 1.442, 1.944, 1.846, 1.251, -2.014, 0.805, 0.521, 1.668, -0.531, -0.81, 0.526, -1.976, 1.366, -1.454, -1.13, 1.392, -1.245, -1.077, -1.445, 1.208, 1.661, 0.553, -1.662, -1.694, 0.124, 1.708, -0.734, -0.844, -1.181, 1.366, -0.999, -1.121, 1.393, 2.343, -0.93, 0.594, -0.331, -0.782, -1.629, 0.956, -0.693, -0.17, -1.249, 1.663, 1.371, 0.312, 2.119, 1.548, 1.787, 0.394, 0.673, 1.41, 1.688, 2.076, -0.93, 2.699, -1.496, 0.17, -0.456, 0.336, 1.32, -2.201, -1.24, 1.95, -0.918, -0.888, -0.926, -0.599, -1.417, -0.196, 1.396, -0.591, -0.373, -1.184, -1.509, -1.936, -1.962, 1.142, 2.209, 1.103, 2.365, -1.009, -0.988, -1.587, -1.15, -1.046, -1.355, 1.469, -1.357, -0.832, -2.152, -1.316, -1.304, -1.008, 0.655, -1.509, 1.559, -1.161, -2.164, 1.683, 1.805, -0.62, -1.623, 2.325, -0.224, 1.099, -1.065, -0.195, -0.536, 1.705, -0.134, -0.334, 2.506, -1.297, 1.332, 0.824, -1.194, -0.679, -1.627, 1.047, 1.227, -0.802, 0.469, 1.662, 0.975, 1.761, 2.886, 0.656, 1.458, 0.737, -1.548, 1.101, -0.804, -1.454, -0.935, -0.9, -1.37, 0.057, -0.409, 0.536, 0.464, -1.16, -1.029, 0.71, -1.234, -0.671, 2.239, -2.34, 1.614, -1.162, -1.458, -1.528, 1.52, -2.304, 0.91, 0.03, -0.824, -1.366, 1.154, 2.296, 1.877, 2.32, 1.449, -0.584, -1.333, 0.9, -0.674, -1.699, -1.224, -1.701, 1.277, -0.366, 1.77, -0.622, 0.778, -0.931, 3.341, 1.847, -0.28, -0.766, -0.321, 0.85, -1.452, 2.157, -0.067, -1.728, 1.497, 0.781, 2.232, -1.855, 2.064, -1.128, -1.043, -1.741, -0.98, -1.113, -1.26, 1.092, -1.201, 1.051, -1.228, -1.122, 2.403, 1.686, 1.442, 2.048, -0.89, -0.595, -0.07, -0.238, -2.133, 1.482, -0.434, -1.682, -0.499, 1.555, -0.045, -1.718, -1.985, 1.261, 1.878, 0.965, 0.193, 1.706, -1.148, -1.873, 0.403, 0.875, -0.835, -1.421];
    return {
      line: by(['Dose (uM)', 'Compound A', 'Compound A SD', 'Compound B', 'Compound B SD', 'Compound C', 'Compound C SD'], [[0.01, 0.0, 2.6, 3.6, 2.3, 1.8, 2.2], [0.03, 1.8, 3.6, 0.0, 2.3, 0.0, 2.2], [0.1, 6.9, 3.3, 0.0, 2.8, 1.3, 2.5], [0.3, 14.6, 3.4, 3.0, 2.6, 2.4, 2.2], [1, 36.9, 4.4, 5.6, 2.7, 9.6, 3.4], [3, 59.6, 6.0, 22.3, 4.1, 13.1, 3.7], [10, 79.5, 7.4, 57.7, 6.1, 29.6, 3.8], [30, 92.5, 8.6, 84.1, 7.9, 50.8, 5.4], [100, 96.7, 9.0, 97.5, 8.5, 71.3, 6.5]]),
      scatter: { cols: ['Body mass (g)', 'Wild type', 'Knockout'], rows: S(wt.map(([m, r]) => [m, r, '']).concat(ko.map(([m, r]) => [m, '', r]))) },
      bar: by(['Time point', 'Vehicle', 'Vehicle SEM', 'Drug A', 'Drug A SEM', 'Drug B', 'Drug B SEM'], [['Day 1', 10.18, 1.3, 15.23, 1.79, 12.99, 1.51], ['Day 3', 10.84, 1.27, 18.37, 1.93, 19.32, 2.0], ['Day 7', 10.98, 1.38, 22.45, 2.33, 25.22, 2.43], ['Day 14', 11.38, 1.31, 24.85, 2.39, 32.36, 2.97]]),
      histogram: { cols: ['Residual (mmol/L)'], rows: S(hist.map((v) => [v])) },
      box: { cols: ['Control', 'Low dose', 'High dose', 'Combination'], rows: S(box[0].map((_, i) => box.map((c) => c[i]))) },
      heatmap: by(['Gene', 'Control 1', 'Control 2', 'Treated 1', 'Treated 2', 'Treated 3', 'Recovery'], [['GENE1', 0.28, 0.61, -1.43, -1.49, -1.62, -0.33], ['GENE2', -0.06, -1.0, -1.39, -1.75, -1.33, -0.37], ['GENE3', -0.03, -0.4, -1.55, -1.16, -1.62, -1.1], ['GENE4', 0.01, -0.21, 0.26, 0.31, -0.45, -1.03], ['GENE5', 0.31, 0.07, 1.36, 1.76, 1.67, 1.06], ['GENE6', -0.02, -0.19, -1.83, -2.29, -1.57, -0.48], ['GENE7', 0.03, -0.85, -0.9, -1.25, -0.61, -0.52], ['GENE8', -0.39, -0.37, -2.02, -1.73, -2.04, -0.72]])
    };
  })();
  const CH_RAW = ['histogram', 'box'], CH_NOTES = {
    line: 'First column is X (numbers). Every other column is a series.', scatter: 'First column is X (numbers). Every other column is a series.', bar: 'First column holds the category labels. Every other column is a series.',
    histogram: 'Every column is one dataset of raw values; Bins sets the bin count.', box: 'Every column is one dataset of raw values (one box each).', heatmap: 'First column holds the row labels; the other columns form the matrix (header = column label).' };
  function chartCode(s) {   // standalone script mirroring server/chart.py for this spec
    const rows = s.rows.filter((r) => r.some((c) => String(c).trim())), q = JSON.stringify, t = s.type, raw = CH_RAW.includes(t), vr = s.variant || '', pal = CH_PAL[s.palette];
    const num = (v) => { v = String(v == null ? '' : v).trim(); return v === '' || isNaN(Number(v)) ? null : Number(v); }, val = (v) => { const n = num(v); return n === null ? 'float("nan")' : String(n); };
    const lim = (v) => { const p = String(v || '').replace(/,/g, ' ').split(/\s+/).filter(Boolean).map(Number); return p.length === 2 && p.every((x) => isFinite(x)) && p[0] < p[1] ? p.join(', ') : ''; };
    const L = ['import matplotlib.pyplot as plt'];
    if (t === 'heatmap' || ['kde', 'stacked', 'linear', 'linear_ci', 'quadratic'].includes(vr)) L.push('import numpy as np');
    L.push('');
    if (vr === 'kde') L.push('def kde(v, g):  # Gaussian kernel density, Silverman bandwidth', '    v = np.asarray(v, float); h = 1.06 * (v.std(ddof=1) if len(v) > 1 else 1) * len(v) ** -0.2 or 1.0', '    return np.exp(-0.5 * ((g[:, None] - v) / h) ** 2).sum(1) / (len(v) * h * np.sqrt(2 * np.pi))', '');
    if (t === 'scatter' && vr) L.push('def fit(ax, x, y, deg, ci, color):  # polynomial trend line, optionally with the 95% confidence band of the mean', '    ok = ~(np.isnan(x) | np.isnan(y)); x, y = x[ok], y[ok]',
      '    c = np.polyfit(x, y, deg); g = np.linspace(x.min(), x.max(), 100); f = np.polyval(c, g); ax.plot(g, f, color=color, lw=1.5)', '    if ci:',
      '        s = np.sqrt(((y - np.polyval(c, x)) ** 2).sum() / (len(x) - 2)); se = s * np.sqrt(1 / len(x) + (g - x.mean()) ** 2 / ((x - x.mean()) ** 2).sum())', '        try: from scipy.stats import t; k = t.ppf(0.975, len(x) - 2)', '        except ImportError: k = 1.96',
      '        ax.fill_between(g, f - k * se, f + k * se, color=color, alpha=0.15, lw=0)', '');
    if (s.style) L.push('plt.style.use(' + q(s.style) + ')');
    if (pal && pal.length) L.push('plt.rcParams["axes.prop_cycle"] = plt.cycler(color=' + q(pal) + ')');
    if (s.fontFamily) L.push('plt.rcParams["font.family"] = ' + q({ sans: 'sans-serif', serif: 'serif', mono: 'monospace' }[s.fontFamily] || 'sans-serif'));
    if (s.fontSize) L.push('plt.rcParams["font.size"] = ' + Number(s.fontSize));
    if (s.style || (pal && pal.length) || s.fontFamily || s.fontSize) L.push('');
    const win = Number(s.wIn) || 6.4, hin = Number(s.hIn) || 4.2;
    if (raw) {
      L.push('data = {'); s.columns.forEach((c, i) => L.push('    ' + q(c || 'Data ' + (i + 1)) + ': [' + rows.map((r) => num(r[i])).filter((n) => n !== null).join(', ') + '],')); L.push('}', '', 'fig, ax = plt.subplots(figsize=(' + win + ', ' + hin + '))');
      if (t === 'histogram') { const bins = Math.min(200, Math.max(1, parseInt(s.bins, 10) || 10)); L.push('for i, (name, v) in enumerate(data.items()):', '    _, e, _ = ax.hist(v, bins=' + bins + (vr === 'kde' ? ', density=True' : '') + ', alpha=' + (s.columns.length > 1 ? '0.6' : '0.85') + ', label=name, color="C%d" % i, edgecolor="white")'); if (vr === 'kde') L.push('    g = np.linspace(e[0], e[-1], 200); ax.plot(g, kde(v, g), color="C%d" % i, lw=1.5)'); }
      else L.push('ax.boxplot(list(data.values())' + (vr === 'notch' ? ', notch=True' : '') + ')', 'ax.set_xticks(range(1, len(data) + 1), list(data))');
    } else if (t === 'heatmap') {
      const cmap = s.palette || 'viridis';
      L.push('labels = [' + rows.map((r) => q(String(r[0] || '').trim())).join(', ') + ']', 'matrix = np.array([', ...rows.map((r) => '    [' + s.columns.slice(1).map((_, i) => val(r[i + 1])).join(', ') + '],'), '], dtype=float)', '', 'fig, ax = plt.subplots(figsize=(' + win + ', ' + hin + '))',
        'im = ax.imshow(np.ma.masked_invalid(matrix), aspect="auto", cmap=' + q(cmap) + ')', 'fig.colorbar(im, ax=ax)', 'ax.set_xticks(range(' + (s.columns.length - 1) + '), ' + q(s.columns.slice(1)) + ')', 'ax.set_yticks(range(len(labels)), labels)');
      if (vr === 'values') L.push('lo, hi = np.nanmin(matrix), np.nanmax(matrix)', 'for (i, j), v in np.ndenumerate(matrix):', '    if not np.isnan(v): ax.text(j, i, "%.3g" % v, ha="center", va="center", fontsize=8, color="white" if (v - lo) / ((hi - lo) or 1) < 0.5 else "black")');
    } else {
      const bar = t === 'bar';
      L.push('x = [' + rows.map((r) => bar ? q(String(r[0] || '').trim()) : val(r[0])).join(', ') + ']', 'series = {');
      s.columns.slice(1).forEach((c, i) => L.push('    ' + q(c || 'Series ' + (i + 1)) + ': [' + rows.map((r) => val(r[i + 1])).join(', ') + '],'));
      L.push('}', '', 'fig, ax = plt.subplots(figsize=(' + win + ', ' + hin + '))');
      if (t === 'line') L.push('for name, y in series.items():', vr === 'step' ? '    ax.step(x, y, where="mid", label=name)' : '    ax.plot(x, y, marker="o", markersize=4, label=name)');
      else if (t === 'scatter') { L.push('for i, (name, y) in enumerate(series.items()):', '    ax.scatter(x, y, s=22, label=name, color="C%d" % i)'); if (vr) L.push('    fit(ax, np.array(x, float), np.array(y, float), ' + (vr === 'quadratic' ? 2 : 1) + ', ' + (vr === 'linear_ci' ? 'True' : 'False') + ', "C%d" % i)'); }
      else if (vr === 'stacked') L.push('base = np.zeros(len(x))', 'for name, y in series.items():', '    y = np.nan_to_num(np.array(y, float)); ax.bar(range(len(x)), y, 0.6, bottom=base, label=name); base = base + y', 'ax.set_xticks(range(len(x)), x)');
      else L.push('n = len(series); w = 0.8 / n', 'for j, (name, y) in enumerate(series.items()):', '    ax.bar([i + (j - (n - 1) / 2) * w for i in range(len(x))], y, w, label=name)', 'ax.set_xticks(range(len(x)), x)');
    }
    if (s.despine) L.push('ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)');
    if (s.tickDirection && s.tickDirection !== 'out') L.push('ax.tick_params(direction=' + q(s.tickDirection) + ')');
    if (s.xTickRotation) L.push('ax.tick_params(axis="x", labelrotation=' + Number(s.xTickRotation) + ')');
    if (s.yTickRotation) L.push('ax.tick_params(axis="y", labelrotation=' + Number(s.yTickRotation) + ')');
    if (s.xScale === 'log' && t !== 'bar' && t !== 'heatmap') L.push('ax.set_xscale("log")');
    if (s.yScale === 'log' && t !== 'heatmap') L.push('ax.set_yscale("log")');
    if (s.title) L.push('ax.set_title(' + q(s.title) + (s.titleSize ? ', fontsize=' + s.titleSize : '') + ')');
    if (s.subtitle) L.push('ax.text(0.5, 1.01, ' + q(s.subtitle) + ', transform=ax.transAxes, ha="center", va="bottom", fontsize=' + (s.labelSize || 10) + ', color="#555555")');
    if (s.xlabel) L.push('ax.set_xlabel(' + q(s.xlabel) + (s.labelSize ? ', fontsize=' + s.labelSize : '') + ')');
    if (s.ylabel) L.push('ax.set_ylabel(' + q(s.ylabel) + (s.labelSize ? ', fontsize=' + s.labelSize : '') + ')');
    if (lim(s.xlim)) L.push('ax.set_xlim(' + lim(s.xlim) + ')');
    if (lim(s.ylim)) L.push('ax.set_ylim(' + lim(s.ylim) + ')');
    if (t !== 'heatmap') {
      const gs = { solid: '-', dashed: '--', dotted: ':', dashdot: '-.' }[s.gridStyle] || '-';
      const ga = s.gridAlpha !== undefined ? Number(s.gridAlpha) : 0.3;
      L.push(s.grid ? 'ax.grid(True, linestyle=' + q(gs) + ', alpha=' + ga + ')' : 'ax.grid(False)');
      if (s.gridMinor) L.push('ax.minorticks_on(); ax.grid(True, which="minor", linestyle=' + q(gs) + ', alpha=' + (ga * 0.7).toFixed(2) + ', lw=0.5)');
    }
    if (s.legend && t !== 'box' && t !== 'heatmap') {
      const pos = s.legendPos || 'best', frame = s.legendFrame !== false;
      L.push(pos === 'outside' ? 'ax.legend(bbox_to_anchor=(1.02, 1), loc="upper left", frameon=' + (frame ? 'True' : 'False') + ')' : 'ax.legend(loc=' + q(pos) + ', frameon=' + (frame ? 'True' : 'False') + ')');
    }
    L.push('fig.tight_layout()', 'fig.savefig("chart.png", dpi=300)  # or "chart.pdf" / "chart.svg" for vector output');
    return L.join('\n');
  }
  function chartRef(t, pos) {   // \includegraphics{figures/x.png|pdf} at (or in the figure around) pos → { path, a, b } with a..b the path text; else null
    const mk = tocMask(t), fig = [], fr = /\\(begin|end)\{figure\*?\}/g, ir = /\\includegraphics\s*(?:\[[^\]]*\])?\{(figures\/[^\/{}]+\.(?:png|pdf))\}/g; let m, d = 0, s0 = 0;
    while ((m = fr.exec(mk))) { if (m[1] === 'begin') { if (!d++) s0 = m.index; } else if (d && !--d) fig.push([s0, m.index + m[0].length]); }
    while ((m = ir.exec(mk))) {
      const e = m.index + m[0].length, f = fig.find(([a, b]) => a <= m.index && e <= b), [a, b] = f || [m.index, e];
      if (a <= pos && pos <= b) return { path: m[1], a: e - 1 - m[1].length, b: e - 1 };
    }
    return null;
  }
  function chartCfg(s) {   // the exact JSON the server's chart.py renders (rows one per line)
    const q = JSON.stringify, f = ['type', 'variant', 'style', 'palette', 'xlim', 'ylim', 'title', 'subtitle', 'xlabel', 'ylabel', 'legend', 'legendPos', 'legendFrame', 'grid', 'gridMinor', 'gridStyle', 'gridAlpha', 'despine', 'tickDirection', 'xTickRotation', 'yTickRotation', 'xScale', 'yScale', 'wIn', 'hIn', 'fontFamily', 'fontSize', 'titleSize', 'labelSize', 'tickSize', 'bins'].filter((k) => s[k] !== undefined && s[k] !== '').map((k) => '  ' + q(k) + ': ' + q(s[k]));
    return '{\n' + f.concat('  "columns": ' + q(s.columns), '  "rows": [\n' + s.rows.map((r) => '    ' + q(r)).join(',\n') + '\n  ]').join(',\n') + '\n}';
  }
  function csvParse(t) {   // CSV/TSV text → { head, rows } or null: delimiter (; tab | ,) detected, quotes honoured, decimal comma → dot, header row detected
    const split = (d, x) => {
      const R = []; let r = [], c = '', q = false;
      for (let i = 0; i < x.length; i++) {
        const ch = x[i];
        if (q) { if (ch !== '"') c += ch; else if (x[i + 1] === '"') { c += '"'; i++; } else q = false; }
        else if (ch === '"' && !c.trim()) { q = true; c = ''; }
        else if (ch === d) { r.push(c); c = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && x[i + 1] === '\n') i++; r.push(c); R.push(r); r = []; c = ''; }
        else c += ch;
      }
      if (c || r.length) { r.push(c); R.push(r); }
      return R.filter((a) => a.some((v) => v.trim()));
    };
    t = t.replace(/^\uFEFF/, ''); const big = t.length > 20000; let best = null;
    for (const d of [';', '\t', '|', ',']) {   // the delimiter giving the most consistent column count (≥ 2) wins; ties keep the earlier one
      const R = split(d, t.slice(0, 20000)); if (big) R.pop(); const n = R.map((r) => r.length), m = n.reduce((a, v) => (n.filter((x) => x === v).length > n.filter((x) => x === a).length ? v : a), n[0]), f = R.length ? n.filter((v) => v === m).length / R.length : 0;
      if (m > 1 && (!best || f > best.f)) best = { d, f };
    }
    const d = best ? best.d : ',', NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/, DC = /^[-+]?(\d+|\d{1,3}(\.\d{3})+),\d+([eE][-+]?\d+)?$/;
    let rows = split(d, t); if (!rows.length) return null;
    const w = Math.max(...rows.map((r) => r.length));
    rows = rows.map((r) => Array.from({ length: w }, (_, j) => { const c = (r[j] || '').trim(); return d !== ',' && DC.test(c) ? c.replace(/\./g, '').replace(',', '.') : c; }));
    const col = (j) => rows.slice(1).map((r) => r[j]).filter(Boolean), head = rows.length > 1 && rows[0].some((c, j) => c && !NUM.test(c) && col(j).length && col(j).every((v) => NUM.test(v)));   // a text cell on top of an all-numeric column
    return { head: head ? rows[0] : null, rows: head ? rows.slice(1) : rows };
  }
  function chartDialog() {
    const ta = $('#codeInput'); if (!ta) return;
    const d = dlg(D.chart()), el = d.el, $e = (s) => $(s, el), MAXR = 250, MAXC = 12;
    $$('select', el).forEach(setupCustomSelect);
    const smp = (t) => ({ cols: CH_SAMPLE[t].cols.slice(), rows: CH_SAMPLE[t].rows.map((r) => r.slice()) });
    let cols = smp('line').cols, rows = smp('line').rows, pt = 'line', tab = 'preview', dirty = true, seq = 0, timer = null;
    const spec = () => ({
      type: $e('#chType').value, bins: Math.min(200, Math.max(1, parseInt($e('#chBins').value, 10) || 10)),
      variant: $e('#chVar').value, style: $e('#chStyle').value, palette: $e('#chPal').value,
      xlim: $e('#chXlim').value.trim(), ylim: $e('#chYlim').value.trim(),
      title: $e('#chTitle').value, subtitle: $e('#chSubtitle').value,
      xlabel: $e('#chX').value, ylabel: $e('#chY').value,
      legend: $e('#chLeg').checked, legendPos: $e('#chLegPos').value, legendFrame: $e('#chLegFrame').checked,
      grid: $e('#chGrid').checked, gridMinor: $e('#chGridMin').checked, gridStyle: $e('#chGridSty').value, gridAlpha: parseFloat($e('#chGridSub').value) || 0.3,
      despine: $e('#chDespine').checked, tickDirection: $e('#chTickDir').value,
      xScale: $e('#chXscale').value, yScale: $e('#chYscale').value,
      xTickRotation: parseFloat($e('#chXrot').value) || 0, yTickRotation: parseFloat($e('#chYrot').value) || 0,
      wIn: Math.min(30, Math.max(0.5, parseFloat($e('#chWin').value) || 6.4)),
      hIn: Math.min(30, Math.max(0.5, parseFloat($e('#chHin').value) || 4.2)),
      fontFamily: $e('#chFam').value, fontSize: parseFloat($e('#chFsz').value) || 10,
      titleSize: parseFloat($e('#chFszT').value) || null, labelSize: parseFloat($e('#chFszL').value) || null, tickSize: parseFloat($e('#chFszTk').value) || null,
      columns: cols.slice(), rows: rows.map((r) => r.slice())
    });
    const setWH = (w, h) => { $e('#chWin').value = Math.round(w * 10) / 10; $e('#chHin').value = Math.round(h * 10) / 10; change(); };
    $e('#chWin').addEventListener('input', () => { if ($e('#chLock').checked) { const w = parseFloat($e('#chWin').value); if (w > 0) $e('#chHin').value = Math.round(w * 0.656 * 10) / 10; } change(); });
    $e('#chHin').addEventListener('input', () => { if ($e('#chLock').checked) { const h = parseFloat($e('#chHin').value); if (h > 0) $e('#chWin').value = Math.round(h * 1.524 * 10) / 10; } change(); });
    $e('#chRatios').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const curW = parseFloat($e('#chWin').value) || 6.4, r = parseFloat(b.dataset.r), w = parseFloat(b.dataset.w);
      if (r) setWH(curW, curW / r);
      else if (w) setWH(w, w * 0.65);
    };
    $e('#chPubPreset').onclick = () => {
      $e('#chFsz').value = 8; $e('#chFszT').value = 9; $e('#chFszL').value = 8; $e('#chFszTk').value = 7;
      $e('#chDespine').checked = true; $e('#chGrid').checked = false; $e('#chGridMin').checked = false;
      $e('#chWin').value = 3.4; $e('#chHin').value = 2.4;
      change();
      toast('Applied Publication Style (8 pt text, open axes, no grid, 3.4" width)');
    };
    const setupWarn = (e) => {   // Python / Matplotlib missing: a plain explanation in the preview instead of an error toast
      if (!e || !e.setup) return false;
      stat(''); $e('#chCanvas').innerHTML = `<div class="md" style="max-width:460px"><h4>Charts need Python 3 with Matplotlib</h4><p>${esc(e.message)}</p><p class="muted">The rest of Plum works without it. You can still copy the Python script from the Code tab and run it yourself.</p></div>`;
      $e('.dtab[data-t="preview"]').click(); return true;
    };
    const stat = (m, bad) => { const n = $e('#chStat'); n.textContent = m || ''; n.classList.toggle('is-pending', !!m); n.style.display = m ? '' : 'none'; n.dataset.bad = bad ? '1' : ''; };
    let editing = false, vt = '';
    const minC = () => (CH_RAW.includes($e('#chType').value) ? 1 : 2), cm = () => $e('#chCodeMode').value;
    const refreshCode = () => { if (editing) return; const c = $e('#chCode'), py = cm() === 'py'; c.readOnly = py; c.value = py ? chartCode(spec()) : chartCfg(spec()); $e('#chCodeNote').textContent = py ? 'Standalone script equivalent to this chart.' : 'Exactly what the server draws. Edit it; the chart, controls and spreadsheet follow.'; $e('#chCodeNote').dataset.bad = ''; };
    const setType = () => { const t = $e('#chType').value; $e('#chNote').textContent = CH_NOTES[t]; $e('#chBinsF').style.display = t === 'histogram' ? '' : 'none';
      if (vt !== t) { vt = t; const [lab, ...o] = CH_VAR[t]; $e('#chVarL').textContent = lab; $e('#chVar').replaceChildren(...o.map(([v, x]) => new Option(x, v))); $e('#chVar')._cs?.sync(); }   // choices follow the chart type
    };
    async function render() {
      dirty = false; const my = ++seq; stat('Rendering…');
      try { const r = await chartRender(spec(), 'png', 100); if (my !== seq) return; const img = new Image(); img.alt = 'Chart preview'; img.style.cssText = 'max-width:100%;height:auto'; img.src = 'data:image/png;base64,' + r.b64; $e('#chCanvas').replaceChildren(img); stat(''); }
      catch (e) { if (my !== seq) return; $e('#chCanvas').replaceChildren(); if (!setupWarn(e)) stat(e.message, true); }
    }
    const change = () => { dirty = true; setType(); refreshCode(); if (tab === 'preview') { clearTimeout(timer); timer = setTimeout(render, 350); } };
    /* spreadsheet grid */
    const grid = $e('#chGridT');
    function drawGrid() {
      grid.replaceChildren(); const head = grid.insertRow();
      cols.forEach((c, j) => { const th = document.createElement('th'), i = h('<input aria-label="Column name">'); i.value = c; i.dataset.r = -1; i.dataset.c = j; th.append(i); head.append(th); });
      rows.forEach((r, k) => { const tr = grid.insertRow(); cols.forEach((_, j) => { const td = tr.insertCell(), i = h('<input aria-label="Cell">'); i.value = r[j] || ''; i.dataset.r = k; i.dataset.c = j; td.append(i); }); });
    }
    grid.addEventListener('input', (e) => { const i = e.target, r = +i.dataset.r, c = +i.dataset.c; if (r < 0) cols[c] = i.value; else rows[r][c] = i.value; change(); });
    grid.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; const i = e.target, nx = $(`input[data-r="${+i.dataset.r + 1}"][data-c="${i.dataset.c}"]`, grid); if (nx) { e.preventDefault(); nx.focus(); } });
    grid.addEventListener('paste', (e) => {
      const txt = (e.clipboardData || window.clipboardData).getData('text'); if (!/[\t\n]/.test(txt.trim())) return;   // a plain value pastes normally
      e.preventDefault(); const i = e.target, r0 = +i.dataset.r, c0 = +i.dataset.c, m = txt.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
      m.forEach((line, a) => { const r = r0 + a; line.forEach((v, b) => { const c = c0 + b; if (c >= MAXC) return; while (cols.length <= c) { cols.push('y' + cols.length); rows.forEach((x) => x.push('')); } if (r < 0) cols[c] = v.trim(); else if (r < MAXR) { while (rows.length <= r) rows.push(cols.map(() => '')); rows[r][c] = v.trim(); } }); });
      drawGrid(); change();
    });
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'), t = e.target.closest('.dtab'); if (!a && !t) return;
      if (t) {
        tab = t.dataset.t; $$('.dtab', el).forEach((x) => x.classList.toggle('is-active', x === t)); $$('.pd__pane', el).forEach((x) => { x.style.display = x.dataset.p === tab ? 'flex' : 'none'; });
        if (tab === 'preview' && dirty) render(); return;
      }
      const k = a.dataset.a;
      if (k === 'csv') {   // replaces the sheet with a CSV/TSV file, clipped to MAXR × MAXC
        const inp = window.RPE.fsBridge.fileInput('.csv,.tsv,.txt,text/csv,text/plain', false, 'Choose a Data File');
        inp.onchange = async () => {
          const f = inp.files[0]; if (!f) return; let txt; try { txt = await f.text(); } catch (e) { return toast('Could not read that file'); }
          const r = csvParse(txt); if (!r) return toast('That file has no data to import');
          const R = r.rows.length, C = r.rows[0].length, n = Math.min(MAXR, R), w = Math.min(MAXC, C);
          cols = Array.from({ length: w }, (_, j) => (r.head && r.head[j]) || (j ? 'y' + j : 'x')); rows = r.rows.slice(0, n).map((x) => x.slice(0, w)); drawGrid(); change();
          toast(n < R || w < C ? 'Imported ' + n + ' of ' + R + ' rows and ' + w + ' of ' + C + ' columns: the editor holds up to ' + MAXR + ' rows × ' + MAXC + ' columns.' : 'Imported ' + n + ' rows × ' + w + ' columns.');
        };
        return inp.click();
      }
      if (k === 'ar') { if (rows.length >= MAXR) return toast('Up to ' + MAXR + ' rows'); rows.push(cols.map(() => '')); }
      else if (k === 'dr') { if (rows.length <= 1) return toast('Keep at least one row'); rows.pop(); }
      else if (k === 'ac') { if (cols.length >= MAXC) return toast('Up to ' + MAXC + ' columns'); cols.push('y' + cols.length); rows.forEach((r) => r.push('')); }
      else if (k === 'dc') { if (cols.length <= minC()) return toast(minC() === 1 ? 'Keep at least one column' : 'Keep X and at least one series'); cols.pop(); rows.forEach((r) => r.pop()); }
      drawGrid(); change();
    });
    $e('#chType').addEventListener('input', () => {   // an untouched default sheet follows the chart type; the user's own data is kept
      const t = $e('#chType').value, same = JSON.stringify([cols, rows]) === JSON.stringify([CH_SAMPLE[pt].cols, CH_SAMPLE[pt].rows]); pt = t;
      if (same) { ({ cols, rows } = smp(t)); setType(); if (t === 'heatmap') { $e('#chVar').value = 'values'; $e('#chVar')._cs?.sync(); } drawGrid(); change(); }
    });
    $$('#chType,#chVar,#chStyle,#chPal,#chXlim,#chYlim,#chTitle,#chSubtitle,#chX,#chY,#chLeg,#chLegPos,#chLegFrame,#chGrid,#chGridMin,#chGridSty,#chGridSub,#chDespine,#chTickDir,#chXscale,#chYscale,#chXrot,#chYrot,#chFam,#chFsz,#chFszT,#chFszL,#chFszTk,#chBins', el).forEach((n) => n.addEventListener('input', change));
    const specErr = (o) => {
      const types = [...$e('#chType').options].map((x) => x.value);
      if (!o || !types.includes(o.type)) return '"type" must be one of: ' + types.join(', ');
      if (!Array.isArray(o.columns) || !o.columns.length || o.columns.length > MAXC || !Array.isArray(o.rows) || !o.rows.length || o.rows.length > MAXR || !o.rows.every(Array.isArray)) return '"columns" and "rows" must be arrays (up to ' + MAXC + ' columns, ' + MAXR + ' rows).';
      const pick = (k, l) => (o[k] && !l.includes(o[k]) ? '"' + k + '" must be one of: ' + l.filter(Boolean).join(', ') + '.' : '');
      return pick('variant', CH_VAR[o.type].slice(1).map((x) => x[0])) || pick('palette', Object.keys(CH_PAL)) || pick('style', [...$e('#chStyle').options].map((x) => x.value));
    };
    const applySpec = (o) => {   // a validated spec → controls + grid + preview
      cols = o.columns.map(String); rows = o.rows.map((r) => cols.map((_, j) => (r[j] == null ? '' : String(r[j]))));
      pt = o.type;
      $e('#chType').value = o.type; setType();
      $e('#chVar').value = o.variant || ''; $e('#chStyle').value = o.style || ''; $e('#chPal').value = o.palette || 'default';
      $e('#chXlim').value = o.xlim || ''; $e('#chYlim').value = o.ylim || '';
      $e('#chTitle').value = o.title || ''; $e('#chSubtitle').value = o.subtitle || '';
      $e('#chX').value = o.xlabel || ''; $e('#chY').value = o.ylabel || '';
      $e('#chLeg').checked = o.legend !== false; $e('#chLegPos').value = o.legendPos || 'best'; $e('#chLegFrame').checked = o.legendFrame !== false;
      $e('#chGrid').checked = o.grid !== false; $e('#chGridMin').checked = !!o.gridMinor; $e('#chGridSty').value = o.gridStyle || 'solid';
      if (o.gridAlpha !== undefined) $e('#chGridSub').value = String(o.gridAlpha);
      $e('#chDespine').checked = !!o.despine; $e('#chTickDir').value = o.tickDirection || 'out';
      $e('#chXscale').value = o.xScale || 'linear'; $e('#chYscale').value = o.yScale || 'linear';
      $e('#chXrot').value = o.xTickRotation || ''; $e('#chYrot').value = o.yTickRotation || '';
      if (o.wIn) $e('#chWin').value = o.wIn; if (o.hIn) $e('#chHin').value = o.hIn;
      if (o.fontFamily) $e('#chFam').value = o.fontFamily;
      if (o.fontSize) $e('#chFsz').value = o.fontSize;
      $e('#chFszT').value = o.titleSize || ''; $e('#chFszL').value = o.labelSize || ''; $e('#chFszTk').value = o.tickSize || '';
      if (o.bins) $e('#chBins').value = o.bins;
      $$('select', el).forEach((s) => s._cs && s._cs.sync());
      drawGrid(); change();
    };
    $e('#chCodeMode').onchange = refreshCode;
    $e('#chCode').addEventListener('input', () => {   // edited configuration → controls + grid + preview (only when it is valid)
      if (cm() !== 'cfg') return; const note = $e('#chCodeNote'), bad = (m) => { note.textContent = m; note.dataset.bad = '1'; };
      let o; try { o = JSON.parse($e('#chCode').value); } catch (e) { return bad('Invalid JSON: ' + e.message); }
      const m = specErr(o); if (m) return bad(m);
      editing = true; applySpec(o); editing = false; note.textContent = 'Applied.'; note.dataset.bad = '';
    });
    $e('#chCopy').onclick = async () => { try { await navigator.clipboard.writeText($e('#chCode').value); toast('Code copied'); } catch (e) { $e('#chCode').select(); toast('Press Ctrl+C to copy'); } };
    /* export */
    const fmt = () => $e('#chFmt').value.toLowerCase(), baseName = () => ($e('#chName').value.trim().replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'chart');
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    async function exportRender() { const f = fmt(), r = await chartRender(spec(), f, +$e('#chDpi').value || 300); return { f, data: bytes(r.b64) }; }
    $e('#chDl').onclick = async () => {
      try {
        const { f, data } = await exportRender(), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data])); a.download = baseName() + '.' + f; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (e) { setupWarn(e) || toast(e.message); }
    };
    async function saveToProject() {   // → 'figures/<name>.<ext>' or null
      if (!ctx.rootDirHandle) { toast('Open a project folder first: charts are saved into its figures/ folder'); return null; }
      if (!(await ensureWrite())) return null;   // permission prompt needs the click, so ask before the (slow) render
      const { f, data } = await exportRender(), dir = await ctx.rootDirHandle.getDirectoryHandle('figures', { create: true }), base = baseName(); let stem = base, k = 0;
      const put = async (n, b) => { const w = await (await dir.getFileHandle(n, { create: true })).createWritable(); await w.write(b); await w.close(); };
      while (!(await existsIn(dir, stem + '.chart.json')) && await existsIn(dir, stem + '.' + f)) stem = base + '-' + (++k);   // our own chart → same path is overwritten; a foreign file is never replaced
      const name = stem + '.' + f;
      await put(name, data); await put(stem + '.chart.json', JSON.stringify({ spec: spec(), fmt: f, dpi: +$e('#chDpi').value || 300 }, null, 1));   // the sidecar makes the chart re-editable
      const root = ctx.PROJECT[0]; if (root) { await refreshDir(root.path); const fd = findNode(root.path + '/figures'); if (fd) await refreshDir(fd.path); renderExplorer(); }
      return 'figures/' + name;
    }
    $e('#chSave').onclick = async () => { try { const p = await saveToProject(); if (p) toast('Saved to ' + p); } catch (e) { setupWarn(e) || toast(e.message || 'Could not save: the project folder may be read-only'); } };
    $e('#chIns').onclick = async () => {
      const t0 = ta.value, q0 = ta.selectionEnd, bs = t0.indexOf('\\begin{document}'), be = t0.indexOf('\\end{document}');
      if (fmt() === 'svg') return toast('XeLaTeX can’t include SVG. Choose PNG or PDF to insert');
      if (ref) {   // re-edit: rewrite the same figures/ file; only the path in the source changes (when the name or format changed)
        try {
          const p = await saveToProject(); if (!p) return;
          if (ta.value !== src0) { d.close(); return toast('Saved to ' + p + ': the source changed, so the document was left as is'); }
          d.close(); if (p !== ref.path) fmtEdit(ta, ref.a, ref.b, p, ref.a + p.length, ref.a + p.length);
          return toast('Chart updated: ' + p);
        } catch (e) { return setupWarn(e) || toast(e.message || 'Could not update the chart'); }
      }
      if (bs < 0 || q0 < bs + 16 || (be >= 0 && q0 > be)) return toast('Place the cursor inside the document body to insert the chart');
      let depth = 0, m; const re = /\\(begin|end)\{(?:figure|wrapfigure|sidewaysfigure)\*?\}/g, before = t0.slice(0, q0);
      while ((m = re.exec(before))) depth += m[1] === 'begin' ? 1 : -1;
      if (depth > 0) return toast('The cursor is already inside a figure: figures can’t be nested');
      try {
        const p = await saveToProject(); if (!p) return;
        const cur = ta.value, q = ta.selectionEnd, cap = $e('#chCap').value.trim(), pk = ensurePackage(cur, 'graphicx');
        if (cur !== t0 || q !== q0) { d.close(); return toast('Saved to ' + p + ': the source changed, so nothing was inserted'); }
        if (pk === false) return toast('Saved to ' + p + ', but could not add graphicx. Check the \\documentclass / preamble');
        const body = ['\\begin{figure}[htbp]', '  \\centering', '  \\includegraphics[width=0.8\\linewidth]{' + p + '}'].concat(cap ? ['  \\caption{' + texEsc(cap) + '}'] : [], ['\\end{figure}']).join('\n');
        const pre = q > 0 && cur[q - 1] !== '\n' ? '\n' : '', post = q < cur.length && cur[q] !== '\n' ? '\n' : '', end = q + pre.length + body.length;
        d.close(); fmtEdit(ta, q, q, pre + body + post, end, end);
        if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, end + pk.str.length, end + pk.str.length);   // preamble precedes the body: cursor just shifts
        syncFmtBtns(); toast('Chart inserted');
      } catch (e) { setupWarn(e) || toast(e.message || 'Could not insert the chart'); }
    };
    let ref = null; const src0 = ta.value;   // set when the cursor is on a figure this dialog made (its figures/<name>.chart.json sidecar exists) → re-edit it
    const r0 = ctx.rootDirHandle && chartRef(src0, ta.selectionStart);
    if (r0) (async () => {
      try {
        const stem = r0.path.slice(8, r0.path.lastIndexOf('.')), o = JSON.parse(await (await (await (await ctx.rootDirHandle.getDirectoryHandle('figures')).getFileHandle(stem + '.chart.json')).getFile()).text());
        if (!o || specErr(o.spec)) return;
        ref = r0; applySpec(o.spec); $e('#chName').value = stem; $e('#chFmt').value = String(o.fmt || 'png').toUpperCase(); if ([...$e('#chDpi').options].some((x) => x.value == o.dpi)) $e('#chDpi').value = o.dpi;
        $e('#chCap').disabled = true; $e('#chCap').placeholder = 'The figure’s existing caption is kept'; $e('#chIns').textContent = 'Update in document'; toast('Editing the chart at the cursor');
      } catch (e) { /* not a chart made here (or its data file is gone): the dialog opens as a new chart */ }
    })();
    drawGrid(); setType(); refreshCode(); render();
    $e('.pd__ctrl').addEventListener('scroll', closeCustomMenu, { passive: true });
  }
  /* ---------- Insert ▸ Table: a table-building instrument ----------
     Model: cells[r][c] = {t text, f font, z size key (SIZES_MAP), b/i/u, c font colour, bg fill, al per-cell alignment override, rs/cs span, cov [r,c] of the merging cell};
     al[c] = column alignment. tbGen writes a real tabular/longtable (cell formats → \textbf/\textit/\underline, \textcolor, {\fontspec{}…}, size groups, \cellcolor,
     \multicolumn/\multirow), tabParse reads those same wrappers back so Update round-trips; anything else it cannot write back unchanged is refused. */
  const TB_MAXR = 30, TB_MAXC = 12;
  const TB_PL = ['Automatic (floats only if captioned, [ht])', 'No float (plain tabular)', 'Here (h)', 'Top (t)', 'Here or top (ht)', 'Page of floats (p)', 'Anywhere (htbp)'];
  const TB_BD = ['Horizontal rules', 'Booktabs', 'Full grid', 'None'];
  const tbCell = (t) => ({ t: t || '', f: '', z: '', b: false, i: false, u: false, c: '', bg: '', al: '', rs: 1, cs: 1, cov: null });
  const tbClose = (s, i) => { let d = 0; for (let j = i; j < s.length; j++) { const ch = s[j]; if (ch === '\\') j++; else if (ch === '{') d++; else if (ch === '}' && !--d) return j; } return -1; };
  function tbRecalc(cells) {   // cov marks are derived from the spanning cells; spans are clamped to the grid and never overlap
    const R = cells.length, C = cells[0].length;
    cells.forEach((row) => row.forEach((x) => { x.cov = null; }));
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const x = cells[r][c]; if (x.cov) { x.rs = x.cs = 1; continue; }
      x.rs = Math.max(1, Math.min(x.rs, R - r)); x.cs = Math.max(1, Math.min(x.cs, C - c));
      if (x.rs * x.cs === 1) continue;
      let ok = true;
      for (let i = r; i < r + x.rs && ok; i++) for (let j = c; j < c + x.cs; j++) if ((i !== r || j !== c) && (cells[i][j].cov || cells[i][j].rs * cells[i][j].cs > 1)) { ok = false; break; }
      if (!ok) { x.rs = x.cs = 1; continue; }
      for (let i = r; i < r + x.rs; i++) for (let j = c; j < c + x.cs; j++) if (i !== r || j !== c) cells[i][j].cov = [r, c];
    }
  }
  function tbPeel(x) {   // outer → inner: \cellcolor, \multirow, font group, size group, \textcolor, \textbf, \textit, \underline (the order tbFmt writes them)
    x = x.trim(); const o = { t: '', f: '', z: '', b: false, i: false, u: false, c: '', bg: '', rs: 1 };
    const m = /^\\cellcolor\[HTML\]\{([0-9A-Fa-f]{6})\}\s*/.exec(x); if (m) { o.bg = m[1].toUpperCase(); x = x.slice(m[0].length); }
    const cmd = (re) => { const k = re.exec(x); if (!k) return null; const e = k[0].length - 1; return tbClose(x, e) === x.length - 1 ? [k, x.slice(e + 1, -1)] : null; };
    const grp = (re) => { const k = re.exec(x); return k && tbClose(x, 0) === x.length - 1 ? [k, x.slice(k[0].length, -1)] : null; };
    let r;
    if ((r = cmd(/^\\multirow\{(\d+)\}\{\*\}\{/))) { o.rs = +r[0][1]; x = r[1].trim(); }
    if ((r = grp(/^\{\\fontspec\{([^{}]+)\}/))) { o.f = r[0][1]; x = r[1]; }
    if ((r = grp(/^\{\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge) /))) { o.z = SIZES_REV[r[0][1]] || ''; x = r[1]; }
    if ((r = cmd(/^\\textcolor\[HTML\]\{([0-9A-Fa-f]{6})\}\{/))) { o.c = r[0][1].toUpperCase(); x = r[1]; }
    if ((r = cmd(/^\\textbf\{/))) { o.b = true; x = r[1]; }
    if ((r = cmd(/^\\textit\{/))) { o.i = true; x = r[1]; }
    if ((r = cmd(/^\\underline\{/))) { o.u = true; x = r[1]; }
    o.t = x; return o;
  }
  function tbFmt(x, cv) {   // the cell's text with its character formats; empty cells carry none
    if (!x.t.trim()) return '';
    let s = cv(x.t);
    if (x.u) s = '\\underline{' + s + '}';
    if (x.i) s = '\\textit{' + s + '}';
    if (x.b) s = '\\textbf{' + s + '}';
    if (x.c) s = '\\textcolor[HTML]{' + x.c + '}{' + s + '}';
    const z = SIZES_MAP[x.z]; if (z && z !== 'normalsize') s = '{\\' + z + ' ' + s + '}';
    if (x.f) s = '{\\fontspec{' + x.f + '}' + s + '}';
    return s;
  }
  /* Table under the cursor (table float, tabular or longtable) → dialog state {a,b,cells,al,border,hd,cap,lab,pl,long,raw}; {err} when it holds anything
     the grid cannot write back unchanged (comments, p{} columns, extra commands, spans it cannot place) so Update never drops content; null outside any table. */
  function tabParse(t, pos, MAXR, MAXC) {
    const mk = tocMask(t), re = /\\(begin|end)\{(?:table|longtable|tabular)\}/g; let m, depth = 0, s = 0, hit = null;
    while (!hit && (m = re.exec(mk))) { if (m[1] === 'begin') { if (!depth++) s = m.index; } else if (depth && !--depth && s <= pos && pos <= m.index + m[0].length) hit = [s, m.index + m[0].length]; }
    if (!hit) return null;
    const bad = { err: 'This table uses LaTeX the dialog can’t edit without losing content (comments, fixed-width columns, unrecognised merges or extra commands). Edit it in the source' };
    let body = t.slice(hit[0], hit[1]), cap = '', lab = '', pl = 1;
    if (mk.slice(hit[0], hit[1]) !== body) return bad;
    const grab = (cmd) => { const i = body.indexOf('\\' + cmd + '{'); if (i < 0) return ''; let d = 0, j = i + cmd.length + 1; for (; j < body.length; j++) { if (body[j] === '\\') j++; else if (body[j] === '{') d++; else if (body[j] === '}' && !--d) break; } const v = body.slice(i + cmd.length + 2, j); body = body.slice(0, i) + body.slice(j + 1); return v; };
    const split = (x, rows) => { const out = []; let d = 0, k = 0; for (let i = 0; i < x.length; i++) { const c = x[i]; if (c === '\\') { if (rows && x[i + 1] === '\\' && !d) { out.push(x.slice(k, i)); k = i + 2; } i++; } else if (c === '{') d++; else if (c === '}') d--; else if (!rows && c === '&' && !d) { out.push(x.slice(k, i)); k = i + 1; } } out.push(x.slice(k)); return out; };
    const fm = /^\\begin\{table\}(?:\[([^\]]*)\])?([\s\S]*)\\end\{table\}$/.exec(body);
    if (fm) { pl = fm[1] === undefined ? 4 : ['h', 't', 'ht', 'p', 'htbp'].indexOf(fm[1]) + 2; if (pl === 1) return bad; body = fm[2].replace(/\\centering(?![a-zA-Z])/, ''); }
    if (fm || /^\\begin\{longtable\}/.test(body)) { cap = grab('caption'); lab = grab('label'); }
    const em = /^\s*\\begin\{(tabular|longtable)\}\{([^{}]*)\}([\s\S]*?)\\end\{\1\}\s*$/.exec(body);
    if (!em || /\\(?:begin|end|endfirsthead|endfoot|endlastfoot|noalign)(?![a-zA-Z])|\\cmidrule\s*\(|\\\\\s*\[/.test(em[3])) return bad;
    const long = em[1] === 'longtable', al = em[2].replace(/\|/g, '').split('');
    if (!/^[lcr]+$/.test(al.join('')) || al.length > MAXC) return bad;
    const inner = long && cap ? em[3].replace(/^\s*\\\\/, '') : em[3], rows = split(inner, true);
    const strip = (x) => x.replace(/\\(?:hline|toprule|midrule|bottomrule|endhead)(?![a-zA-Z])|\\c(?:line|midrule)\{[^{}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
    const txt = rows.map((r) => split(strip(r), false).map((x) => x.trim()));
    const last = txt[txt.length - 1]; if (last.length === 1 && !last[0]) txt.pop();
    if (!txt.length || txt.length > MAXR) return bad;
    const C = al.length, R = txt.length, cells = Array.from({ length: R }, () => Array.from({ length: C }, () => tbCell('')));
    const raws = [cap];
    for (let r = 0; r < R; r++) {
      let c = 0;
      for (const x of txt[r]) {
        if (c >= C) return bad;
        const mc = /^\\multicolumn\{(\d+)\}\{([^{}]*)\}\{/.exec(x); let cs = 1, sp = '', inb = x;
        if (mc) { const o = mc[0].length - 1; if (tbClose(x, o) !== x.length - 1) return bad; cs = +mc[1]; sp = mc[2].replace(/\|/g, ''); if (!/^[lcr]$/.test(sp)) return bad; inb = x.slice(o + 1, -1); }
        if (cs < 1 || c + cs > C) return bad;
        const p = tbPeel(inb), cell = cells[r][c];
        if (/\\(?:multicolumn|multirow)(?![a-zA-Z])/.test(p.t)) return bad;
        if (cell.cov) {   // the empty cell under a row-spanning cell
          if (cell.cov[1] !== c || cells[cell.cov[0]][cell.cov[1]].cs !== cs || p.t || p.rs > 1) return bad;
          c += cs; continue;
        }
        if (r + p.rs > R) return bad;
        for (let i = r; i < r + p.rs; i++) for (let j = c; j < c + cs; j++) if ((i !== r || j !== c) && cells[i][j].cov) return bad;
        Object.assign(cell, { t: p.t, f: p.f, z: p.z, b: p.b, i: p.i, u: p.u, c: p.c, bg: p.bg, rs: p.rs, cs, al: sp && sp !== al[c] ? sp : '' });
        raws.push(p.t);
        for (let i = r; i < r + p.rs; i++) for (let j = c; j < c + cs; j++) if (i !== r || j !== c) cells[i][j].cov = [r, c];
        c += cs;
      }
    }
    tbRecalc(cells);
    const KN = /\\(?:[&%$#_{}]|text(?:backslash|asciitilde|asciicircum)\{\})/g, lead = (x) => x.replace(/^\{\[\}/, '[');   // the escapes texEsc writes (and its "{[}" guard)
    const raw = raws.some((x) => /[\\{}$%#_^~]/.test(lead(x).replace(KN, ''))), border = /\\(?:top|mid|bottom)rule|\\cmidrule/.test(inner) ? 'Booktabs' : em[2].includes('|') ? 'Full grid' : /\\hline|\\cline/.test(inner) ? 'Horizontal rules' : 'None';
    const dec = (x) => raw ? x : lead(x).replace(KN, (k) => ({ '\\textbackslash{}': '\\', '\\textasciitilde{}': '~', '\\textasciicircum{}': '^' }[k] || k[1]));
    cells.forEach((row) => row.forEach((x) => { x.t = dec(x.t); }));
    const h0 = cells[0].filter((x) => !x.cov && x.t), bold = R > 1 && h0.length > 0 && h0.every((x) => x.b);
    return { a: hit[0], b: hit[1], cells, al, cap: dec(cap.trim()), lab: lab.trim(), pl, long, raw, border,
      hd: bold || (long ? /\\endhead/.test(inner) : border !== 'Full grid' && rows.length > 1 && /^\s*\\(?:hline|midrule)(?![a-zA-Z])/.test(rows[1])) };
  }
  /* S = {cells, al, P:{raw,border,hd,long,pl,cap,lab}}, X = {t0, rng}. → {err} or {out: lines, need: packages}. */
  function tbGen(S, X) {
    const { cells, al, P } = S, R = cells.length, C = al.length, raw = P.raw, border = P.border, cap = P.cap.trim(), lab = P.lab.trim(), all = cells.flat().filter((x) => !x.cov);
    const ce = (v) => raw ? v.trim() : texEsc(v.trim()), cv = (v) => ce(v).replace(/^\[/, raw ? '[' : '{[}');   // a leading "[" would be read as the optional argument of the preceding \\
    if (raw && (all.some((x) => !balanced(x.t)) || !balanced(cap))) return { err: 'Raw LaTeX cells and caption need matched braces' };
    if (!raw && all.some((x) => /[\n\r]/.test(x.t))) return { err: 'Cell text must be on a single line' };
    if (lab && !cap) return { err: 'A label needs a caption. Add a caption or clear the label' };
    if (lab && !/^[\w:.-]+$/.test(lab)) return { err: 'Label may only contain letters, digits and : . - _' };
    if (lab && (X.t0.slice(0, X.rng[0]) + X.t0.slice(X.rng[1])).includes('\\label{' + lab + '}')) return { err: 'The label “' + lab + '” is already used in this document. Choose a different one' };
    const long = P.long, pl = P.pl, plOpt = [null, null, 'h', 't', 'ht', 'p', 'htbp'][pl];
    if (!long && pl === 1 && cap) return { err: 'A caption needs a floating table. Choose a placement or clear the caption' };
    if (long) {   // a longtable must never end up inside a floating environment
      let depth = 0, fm; const fre = /\\(begin|end)\{(?:table|figure|wrapfigure|sidewaystable)\*?\}/g, before = X.t0.slice(0, X.rng[0]);
      while ((fm = fre.exec(before))) depth += fm[1] === 'begin' ? 1 : -1;
      if (depth > 0) return { err: 'The cursor is inside a floating table/figure: a long table cannot be nested in one' };
    }
    const full = border === 'Full grid', bk = border === 'Booktabs', hl = border !== 'None', hd = P.hd && R > 1;
    const BR = bk ? ['\\toprule', '\\midrule', '\\bottomrule'] : ['\\hline', '\\hline', '\\hline'], RL = (k) => '  ' + BR[k], cs = full ? '|' + al.join('|') + '|' : al.join('');
    const spec = (c, a) => (full && c === 0 ? '|' : '') + a + (full ? '|' : '');
    const ruleAfter = (r) => {   // the rule below row r, drawn only across columns no row-spanning cell passes through
      if (r === R - 1) return RL(1);
      const free = cells[r + 1].map((x) => !(x.cov && x.cov[0] <= r));
      if (free.every(Boolean)) return RL(1);
      const seg = []; for (let c = 0; c < C; c++) { if (!free[c]) continue; let e = c; while (e + 1 < C && free[e + 1]) e++; seg.push((bk ? '\\cmidrule{' : '\\cline{') + (c + 1) + '-' + (e + 1) + '}'); c = e; }
      return seg.length ? '  ' + seg.join(' ') : '';
    };
    const rowTex = (row, i) => {
      const out = [];
      for (let c = 0; c < C; c++) {
        const x = row[c];
        if (x.cov) {
          if (x.cov[1] !== c) continue;   // consumed by the \multicolumn written at the span's first column
          const m = cells[x.cov[0]][x.cov[1]], g = m.bg ? '\\cellcolor[HTML]{' + m.bg + '}' : '';
          out.push(m.cs > 1 ? '\\multicolumn{' + m.cs + '}{' + spec(c, m.al || al[c]) + '}{' + g + '}' : g); continue;
        }
        const g = x.bg ? '\\cellcolor[HTML]{' + x.bg + '}' : '';
        let inn = tbFmt(x, cv); if (x.rs > 1) inn = '\\multirow{' + x.rs + '}{*}{' + inn + '}';
        if (x.cs > 1 || (x.al && x.al !== al[c])) out.push('\\multicolumn{' + x.cs + '}{' + spec(c, x.al || al[c]) + '}{' + g + inn + '}');
        else out.push(g && inn ? g + ' ' + inn : g + inn);
      }
      return out.join(' & ');
    };
    const rows = cells.map((row, i) => { const ra = hl && (full || (hd && i === 0)) ? ruleAfter(i) : ''; return '  ' + rowTex(row, i) + ' \\\\' + (ra ? '\n' + ra : ''); });
    const tab = ['\\begin{tabular}{' + cs + '}'].concat(hl ? [RL(0)] : [], rows, hl && !full ? [RL(2)] : [], ['\\end{tabular}']);
    let out = !long && pl !== 1 && (cap || plOpt) ? ['\\begin{table}[' + (plOpt || 'ht') + ']', '  \\centering'].concat(cap ? ['  \\caption{' + ce(cap) + '}'] : [], lab ? ['  \\label{' + lab + '}'] : [], tab.map((l) => '  ' + l.replace(/\n/g, '\n  ')), ['\\end{table}']) : tab;
    if (long) {
      const head = hd ? rows.slice(0, 1).concat('  \\endhead', rows.slice(1)) : rows;
      out = ['\\begin{longtable}{' + cs + '}'].concat(cap ? ['  \\caption{' + ce(cap) + '}' + (lab ? '\\label{' + lab + '}' : '') + ' \\\\'] : [], hl ? [RL(0)] : [], head, hl && !full ? [RL(2)] : [], ['\\end{longtable}']);
    }
    const need = [], add = (...n) => n.forEach((k) => { if (!need.includes(k)) need.push(k); });
    if (long) add('longtable'); if (bk) add('booktabs');
    if (all.some((x) => x.rs > 1)) add('multirow');
    if (all.some((x) => x.c && x.t.trim()) || all.some((x) => x.bg)) add('xcolor');
    if (all.some((x) => x.bg)) add('colortbl');
    if (all.some((x) => x.f && x.t.trim())) add('fontspec');
    return { out, need };
  }
  /* Insert ▸ Table (also edits the table under the cursor): the D.table dialog is a spreadsheet-style table builder with its own ribbon. Cells are selected by click,
     drag, Shift+click/arrows, row/column headers or the corner handle; the ribbon mirrors the active cell (font, size, B/I/U, colours, fill, alignment) and edits
     every selected cell. Home ▸ Font's font menu/validation and size list are reused. Cursor inside a table → it is parsed (tabParse) and replaced on Update;
     selected tab-separated text is converted; otherwise inserted at the selection end, never replacing prose. longtable/booktabs/multirow/xcolor/colortbl/fontspec
     are added once via ensurePackage. */
  function tableDialog() {
    const ta = $('#codeInput'); if (!ta) return;
    const t0 = ta.value, pos = ta.selectionEnd, bs = t0.indexOf('\\begin{document}'), be = t0.indexOf('\\end{document}');
    if (bs < 0 || pos < bs + 16 || (be >= 0 && pos > be)) return toast('Place the cursor inside the document body to insert a table');
    const s0 = ta.selectionStart, ex = tabParse(t0, pos, TB_MAXR, TB_MAXC);
    if (ex && ex.err) return toast(ex.err);
    const sel = !ex && s0 < pos ? t0.slice(s0, pos).replace(/\s+$/, '') : '', ls = sel.split(/\r?\n/).filter((l) => l.trim()), grid = ls.length && ls.every((l) => l.includes('\t')) ? ls.map((l) => l.split('\t')) : null;
    const nc = grid ? Math.max(...grid.map((r) => r.length)) : 3, conv = !!grid && grid.length <= TB_MAXR && nc <= TB_MAXC, rng = ex ? [ex.a, ex.b] : conv ? [s0, s0 + sel.length] : [pos, pos];
    const d = dlg(D.table()), el = d.el, lbl = ex ? ['Edit Table', 'Update'] : conv ? ['Convert Text to Table', 'Convert'] : null;
    if (lbl) { $('.dlg__title', el).textContent = lbl[0]; $('.dlg__foot .btn--primary', el).textContent = lbl[1]; }
    let cells = ex ? ex.cells : conv ? grid.map((r) => Array.from({ length: nc }, (_, c) => tbCell(r[c] || ''))) : Array.from({ length: 3 }, () => [tbCell(), tbCell(), tbCell()]);
    let al = ex ? ex.al.slice() : Array(conv ? nc : 3).fill('l');
    const P = { raw: ex ? ex.raw : false, border: ex ? ex.border : TB_BD[0], hd: ex ? ex.hd : true, long: ex ? ex.long : false, pl: ex ? ex.pl : 0, cap: ex ? ex.cap : '', lab: ex ? ex.lab : '' };
    if (!ex && P.hd) cells[0].forEach((x) => { x.b = true; });
    const tabs = $('.tbd__tabs', el), rib = $('.tbd__rib', el), sheet = $('.tbd__sheet', el), host = $('.tbd__host', el), box = $('.tbd__box', el), hnd = $('.tbd__hnd', el), pv = $('.tbd__pv', el), stat = $('.tbd__sel', el);
    const R = () => cells.length, C = () => al.length, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const docFont = () => { const m = /\\setmainfont(?:\[[^\]]*\])?\{([^{}]+)\}/.exec(t0); return m ? m[1] : 'Latin Modern Roman'; };
    const docSize = () => { const m = /\\documentclass\[[^\]]*?(\d+)pt/.exec(t0); return m ? m[1] : '12'; };
    let A = [0, 0], Fo = [0, 0], editing = null, drag = null, tab = 'home';   // A: selection anchor (active cell), Fo: focus corner
    const hist = [], fut = [], snap = () => JSON.stringify({ cells, al, hd: P.hd });
    const push = () => { hist.push(snap()); if (hist.length > 80) hist.shift(); fut.length = 0; };
    const master = (r, c) => { const x = cells[r][c]; return x.cov ? [x.cov[0], x.cov[1]] : [r, c]; };
    const tdAt = (r, c) => { const [mr, mc] = master(r, c); return $(`td[data-r="${mr}"][data-c="${mc}"]`, host); };
    const rect = () => {   // the selection, grown until it holds every merged cell it touches whole
      let r0 = Math.min(A[0], Fo[0]), r1 = Math.max(A[0], Fo[0]), c0 = Math.min(A[1], Fo[1]), c1 = Math.max(A[1], Fo[1]);
      for (let go = true; go;) {
        go = false;
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const [mr, mc] = master(r, c), m = cells[mr][mc], er = mr + m.rs - 1, ec = mc + m.cs - 1;
          if (mr < r0) { r0 = mr; go = true; } if (mc < c0) { c0 = mc; go = true; } if (er > r1) { r1 = er; go = true; } if (ec > c1) { c1 = ec; go = true; }
        }
      }
      return { r0, c0, r1, c1 };
    };
    const each = (fn, masters) => { const q = rect(); for (let r = q.r0; r <= q.r1; r++) for (let c = q.c0; c <= q.c1; c++) { const x = cells[r][c]; if (!masters || !x.cov) fn(x, r, c); } };
    const px = (z) => Math.max(9, 13 * (parseFloat(z) || 12) / 12);
    const effAl = (x, c) => x.al || al[c];
    const colName = (c) => String.fromCharCode(65 + c);
    /* ---- rendering ---- */
    const paintTbl = () => {
      const t = $('table', host); if (!t) return;
      t.className = 'tbd__grid bd-' + ({ 'Horizontal rules': 'rules', Booktabs: 'book', 'Full grid': 'full', None: 'none' }[P.border]) + (P.hd && R() > 1 ? ' has-hd' : '');
    };
    const paintAll = () => {
      $$('td[data-r]', host).forEach((td) => {
        const r = +td.dataset.r, c = +td.dataset.c, x = cells[r][c], i = td.firstChild;
        td.style.background = x.bg ? '#' + x.bg : '';
        if (i.value !== x.t) i.value = x.t;
        i.style.cssText = `font-family:${x.f ? `'${x.f.replace(/[^\p{L}\p{N} .+-]/gu, '')}', serif` : 'var(--font)'};font-size:${px(x.z)}px;font-weight:${x.b ? 700 : 400};font-style:${x.i ? 'italic' : 'normal'};text-decoration:${x.u ? 'underline' : 'none'};color:${x.c ? '#' + x.c : '#111'};text-align:${{ l: 'left', c: 'center', r: 'right' }[effAl(x, c)]}`;
      });
      paintTbl();
    };
    const place = () => {
      if (!document.body.contains(el)) return window.removeEventListener('resize', place);
      const q = rect(), a = tdAt(q.r0, q.c0), z = tdAt(q.r1, q.c1), t = $('table', host); if (!a || !z || !t) { box.hidden = hnd.hidden = true; return; }
      const L = t.offsetLeft + a.offsetLeft, T = t.offsetTop + a.offsetTop, W = z.offsetLeft + z.offsetWidth - a.offsetLeft, H = z.offsetTop + z.offsetHeight - a.offsetTop;
      Object.assign(box.style, { left: L - 1 + 'px', top: T - 1 + 'px', width: W + 2 + 'px', height: H + 2 + 'px' }); box.hidden = false;
      Object.assign(hnd.style, { left: L + W - 5 + 'px', top: T + H - 5 + 'px' }); hnd.hidden = false;
    };
    const paintSel = () => {
      const q = rect(), [ar, ac] = master(A[0], A[1]);
      $$('td[data-r]', host).forEach((td) => {
        const r = +td.dataset.r, c = +td.dataset.c, x = cells[r][c];
        td.classList.toggle('is-sel', r >= q.r0 && r + x.rs - 1 <= q.r1 && c >= q.c0 && c + x.cs - 1 <= q.c1);
        td.classList.toggle('is-act', r === ar && c === ac);
      });
      $$('[data-rh]', host).forEach((n) => n.classList.toggle('is-in', +n.dataset.rh >= q.r0 && +n.dataset.rh <= q.r1));
      $$('[data-ch]', host).forEach((n) => n.classList.toggle('is-in', +n.dataset.ch >= q.c0 && +n.dataset.ch <= q.c1));
      place();
      const n = (q.r1 - q.r0 + 1) * (q.c1 - q.c0 + 1);
      stat.textContent = (n > 1 ? (q.r1 - q.r0 + 1) + ' × ' + (q.c1 - q.c0 + 1) + ' cells selected' : 'Cell ' + colName(ac) + (ar + 1)) + '  ·  ' + R() + ' rows × ' + C() + ' columns';
    };
    const draw = () => {
      const nr = R(), nc2 = C(), had = !!editing; editing = null;
      A = [clamp(A[0], 0, nr - 1), clamp(A[1], 0, nc2 - 1)]; Fo = [clamp(Fo[0], 0, nr - 1), clamp(Fo[1], 0, nc2 - 1)];
      host.innerHTML = `<table class="tbd__grid"><colgroup><col class="tbd__gr">${al.map(() => '<col class="tbd__gc">').join('')}</colgroup><thead><tr><th class="tbd__corner" data-all title="Select all"></th>${al.map((_, c) => `<th class="tbd__ch" data-ch="${c}" title="Select column ${colName(c)}">${colName(c)}</th>`).join('')}</tr></thead><tbody>${cells.map((row, r) => `<tr class="${r === 0 ? 'is-first ' : ''}${r === nr - 1 ? 'is-last' : ''}"><th class="tbd__rh" data-rh="${r}" title="Select row ${r + 1}">${r + 1}</th>${row.map((x, c) => x.cov ? '' : `<td data-r="${r}" data-c="${c}"${x.rs > 1 ? ` rowspan="${x.rs}"` : ''}${x.cs > 1 ? ` colspan="${x.cs}"` : ''}><input value="${esc(x.t)}" readonly tabindex="-1" spellcheck="false" autocomplete="off" aria-label="Row ${r + 1}, column ${colName(c)}"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
      paintAll(); sync(); if (had) sheet.focus({ preventScroll: true });
    };
    const gen = () => tbGen({ cells, al, P }, { t0, rng });
    const preview = () => {
      if (pv.hidden) return;
      const g = gen(); pv.textContent = g.err ? '% ' + g.err : (g.need.length ? '% needs: ' + g.need.join(', ') + '\n' : '') + g.out.join('\n');
    };
    /* ---- ribbon ---- */
    const RB = (id, label, icon, o) => {
      o = o || {}; const k = o.k || 'i';
      return `<button type="button" class="rbtn rbtn--${k === 'i' ? 'icon' : k === 'l' ? 'lg' : 'sm'}${o.m && k === 'i' ? ' rbtn--icon-menu' : ''}" data-tb="${id}" aria-label="${esc(label)}" title="${esc(o.tip || label)}"${o.m ? ' aria-haspopup="menu" aria-expanded="false"' : ''}><span class="rbtn__ico"${icon ? '' : ' style="font:600 13px var(--font);min-width:16px;justify-content:center"'}>${icon ? ic(icon) : esc(o.x || '')}${o.sw ? `<i class="rbtn__sw" style="--sw:${o.sw}"></i>` : ''}</span>${k === 'i' ? '' : `<span class="rbtn__label">${esc(label)}</span>`}${o.m ? ic('chevron-down', 'ic--chev') : ''}</button>`;
    };
    const CB = (id, label, w, ro) => `<div class="combo" style="width:${w}px"><input class="combo__in" data-tb="${id}" aria-label="${esc(label)}"${ro ? ' readonly' : ''}><button type="button" class="combo__btn" data-tb="${id}-m" aria-label="${esc(label)} options" aria-haspopup="menu">${ic('chevron-down')}</button></div>`;
    const TX = (id, label) => `<label class="rnum"><span class="rnum__lbl">${label}</span><input class="rnum__in" data-tb="${id}" style="width:150px" spellcheck="false" autocomplete="off"></label>`;
    const GP = (label, ...a) => `<div class="rgroup"><div class="rgroup__content">${a.join('')}</div><div class="rgroup__label">${label}</div></div>`;
    const ST = (...a) => `<div class="rstack">${a.join('')}</div>`, RW = (...a) => `<div class="rrow">${a.join('')}</div>`, SP = '<span class="rvsep"></span>';
    const RIB = {
      home: () => [
        GP('Undo', RB('undo', 'Undo', 'undo-2', { k: 'l' }), RB('redo', 'Redo', 'redo-2', { k: 'l' })),
        GP('Font', ST(RW(CB('font', 'Font', 150), CB('size', 'Size', 54), RB('szu', 'Increase font size', 'a-arrow-up'), RB('szd', 'Decrease font size', 'a-arrow-down')),
          RW(RB('b', 'Bold', 'bold'), RB('i', 'Italic', 'italic'), RB('u', 'Underline', 'underline'), SP, RB('fc', 'Font color', null, { x: 'A', m: 1, sw: '#313A75' }), RB('bg', 'Cell fill', 'paint-bucket', { m: 1, sw: '#F2E04B' }), RB('clr', 'Clear formatting', 'ban')))),
        GP('Alignment', ST(RW(RB('al-l', 'Align left', 'align-left'), RB('al-c', 'Center', 'align-center'), RB('al-r', 'Align right', 'align-right')))),
        GP('Merge', RB('mg', 'Merge cells', 'group', { k: 'l' }), RB('sp', 'Split cells', 'ungroup', { k: 'l' })),
        GP('Rows & Columns', ST(RB('ra', 'Row above', 'plus', { k: 's' }), RB('rb', 'Row below', 'plus', { k: 's' }), RB('rd', 'Delete row', 'trash-2', { k: 's' })), ST(RB('ca', 'Column left', 'plus', { k: 's' }), RB('cb', 'Column right', 'plus', { k: 's' }), RB('cd', 'Delete column', 'trash-2', { k: 's' })))
      ].join(''),
      table: () => [
        GP('Size', RB('tsz', 'Table size', 'grid-3x3', { k: 'l', m: 1, tip: 'Rows × columns' })),
        GP('Style', RB('bd', 'Borders', 'frame', { k: 'l', m: 1 }), RB('hd', 'Header row', 'rows-3', { k: 'l', tip: 'First row is a header: bold, with a rule below it' })),
        GP('Type', RB('lg', 'Long table', 'table-properties', { k: 'l', tip: 'A longtable that can span pages (not a float; placement is ignored)' }), RB('rw', 'Raw LaTeX', 'braces', { k: 'l', tip: 'Cells contain raw LaTeX (otherwise special characters are escaped)' })),
        GP('Float & Caption', ST(CB('pl', 'Float placement', 230, true), TX('cap', 'Caption'), TX('lab', 'Label'))),
        GP('Output', RB('pv', 'LaTeX preview', 'file-code', { k: 'l', tip: 'Show the LaTeX that will be inserted' }))
      ].join('')
    };
    const rq = (id) => $(`[data-tb="${id}"]`, rib);
    const syncRib = () => {
      const [ar, ac] = master(A[0], A[1]), x = cells[ar][ac], ms = []; each((y, r, c) => ms.push({ y, c }), true);
      const val = (id, v) => { const n = rq(id); if (n && document.activeElement !== n) n.value = v; };
      const on = (id, f) => { const n = rq(id); if (n) n.classList.toggle('is-on', !!ms.length && ms.every(f)); };
      const set = (id, f) => { const n = rq(id); if (n) f(n); };
      val('font', x.f || docFont()); val('size', x.z || docSize()); val('pl', TB_PL[P.pl]); val('cap', P.cap); val('lab', P.lab);
      on('b', (m) => m.y.b); on('i', (m) => m.y.i); on('u', (m) => m.y.u);
      on('al-l', (m) => effAl(m.y, m.c) === 'l'); on('al-c', (m) => effAl(m.y, m.c) === 'c'); on('al-r', (m) => effAl(m.y, m.c) === 'r');
      set('fc', (n) => $('.rbtn__sw', n).style.setProperty('--sw', x.c ? '#' + x.c : '#313A75')); set('bg', (n) => $('.rbtn__sw', n).style.setProperty('--sw', x.bg ? '#' + x.bg : '#F2E04B'));
      const q = rect(), one = q.r0 === q.r1 && q.c0 === q.c1, merged = (() => { let k = false; each((y) => { if (y.rs * y.cs > 1) k = true; }, true); return k; })();
      set('mg', (n) => { n.disabled = one; }); set('sp', (n) => { n.disabled = !merged; });
      set('undo', (n) => { n.disabled = !hist.length; }); set('redo', (n) => { n.disabled = !fut.length; });
      set('hd', (n) => n.classList.toggle('is-on', P.hd)); set('lg', (n) => n.classList.toggle('is-on', P.long)); set('rw', (n) => n.classList.toggle('is-on', P.raw)); set('pv', (n) => n.classList.toggle('is-on', !pv.hidden));
      set('pl', (n) => { n.disabled = P.long; $('[data-tb="pl-m"]', rib).disabled = P.long; });
      set('tsz', (n) => { $('.rbtn__label', n).textContent = R() + ' × ' + C(); }); set('bd', (n) => { $('.rbtn__label', n).textContent = P.border; });
      set('ra', (n) => { n.disabled = R() >= TB_MAXR; }); set('rb', (n) => { n.disabled = R() >= TB_MAXR; }); set('ca', (n) => { n.disabled = C() >= TB_MAXC; }); set('cb', (n) => { n.disabled = C() >= TB_MAXC; });
      set('rd', (n) => { n.disabled = q.r1 - q.r0 + 1 >= R(); }); set('cd', (n) => { n.disabled = q.c1 - q.c0 + 1 >= C(); });
    };
    const sync = () => { paintSel(); syncRib(); preview(); };
    const showTab = (t) => {
      tab = t; endEdit(false); rib.innerHTML = RIB[t](); paint(rib);
      $$('.tab', tabs).forEach((b) => { b.classList.toggle('is-active', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'); });
      syncRib();
    };
    /* ---- editing operations ---- */
    const act = (fn) => { push(); fn(); paintAll(); sync(); };
    const startEdit = (r, c, ch) => {
      const [mr, mc] = master(r, c); endEdit(false);
      const td = tdAt(mr, mc); if (!td) return; const inp = td.firstChild;
      A = Fo = [mr, mc]; editing = { r: mr, c: mc, orig: cells[mr][mc].t, dirty: false };
      inp.readOnly = false; inp.classList.add('is-edit');
      if (ch !== undefined) { push(); editing.dirty = true; inp.value = ch; cells[mr][mc].t = ch; }
      inp.focus(); const n = inp.value.length; inp.setSelectionRange(n, n); sync();
    };
    function endEdit(back) {
      if (!editing) return;
      const e = editing, td = $(`td[data-r="${e.r}"][data-c="${e.c}"]`, host), inp = td && td.firstChild; editing = null;
      if (inp) { inp.readOnly = true; inp.classList.remove('is-edit'); if (back) sheet.focus({ preventScroll: true }); }
    }
    const mv = (dr, dc, ext) => {
      const [r, c] = master(Fo[0], Fo[1]), m = cells[r][c], nr = dr > 0 ? r + m.rs : dr < 0 ? r - 1 : r, nc2 = dc > 0 ? c + m.cs : dc < 0 ? c - 1 : c;
      if (nr < 0 || nc2 < 0 || nr >= R() || nc2 >= C()) return false;
      Fo = master(nr, nc2); if (!ext) A = Fo.slice(); sync(); const td = tdAt(Fo[0], Fo[1]); if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true;
    };
    const tabMove = (back) => {
      if (mv(0, back ? -1 : 1, false)) return true;
      const [r, c] = master(Fo[0], Fo[1]), nr = back ? r - 1 : r + cells[r][c].rs; if (nr < 0 || nr >= R()) return false;
      Fo = master(nr, back ? C() - 1 : 0); A = Fo.slice(); sync(); return true;
    };
    const setFont = async (name) => {
      name = (name || '').trim();
      if (name) {
        if (!/^[\p{L}\p{N} .+-]+$/u.test(name)) return toast('Unsupported font name');
        const ok = await fontOK(name); if (ok === null) return;
        if (!ok) return toast('Font “' + name + '” isn’t available to XeLaTeX: not applied');
      }
      act(() => each((x) => { x.f = name; }));
    };
    const setSize = (v) => {
      v = String(v).trim(); if (!SIZES_MAP[v]) return toast('Choose a size from the list (' + Object.keys(SIZES_MAP).join(', ') + ')');
      act(() => each((x) => { x.z = v; }));
    };
    const stepSize = (k) => act(() => each((x) => { const i = TEX_SIZES.indexOf(SIZES_MAP[x.z || '12']); x.z = SIZES_REV[TEX_SIZES[clamp((i < 0 ? 4 : i) + k, 0, TEX_SIZES.length - 1)]]; }));
    const toggle = (k) => { let all = true; each((x) => { if (!x[k]) all = false; }, true); act(() => each((x) => { x[k] = !all; })); };
    const setColor = (k, hex) => {
      if (hex && !/^#[0-9a-f]{6}$/i.test(hex)) return toast('Choose a six-digit color');
      act(() => each((x) => { x[k] = hex ? hex.slice(1).toUpperCase() : ''; }));
    };
    const setAl = (v) => act(() => {
      const q = rect();
      if (q.r0 === 0 && q.r1 === R() - 1) { for (let c = q.c0; c <= q.c1; c++) { al[c] = v; cells.forEach((row) => { row[c].al = ''; }); } }   // whole columns: the column alignment itself
      else each((x, r, c) => { x.al = v === al[c] ? '' : v; });
    });
    const merge = () => {
      const q = rect(); if (q.r0 === q.r1 && q.c0 === q.c1) return toast('Select two or more cells to merge');
      act(() => {
        const m = cells[q.r0][q.c0], parts = [];
        each((x) => { if (x.t.trim()) parts.push(x.t.trim()); }, true);
        m.t = parts.join(' '); m.rs = q.r1 - q.r0 + 1; m.cs = q.c1 - q.c0 + 1;
        each((x, r, c) => { if (r !== q.r0 || c !== q.c0) cells[r][c] = tbCell(''); });
        tbRecalc(cells); A = [q.r0, q.c0]; Fo = A.slice(); draw();
      });
    };
    const split2 = () => {
      let any = false; each((x) => { if (x.rs * x.cs > 1) any = true; }, true); if (!any) return toast('No merged cells in the selection');
      act(() => {
        each((x, r, c) => { if (x.rs * x.cs > 1) for (let i = r; i < r + x.rs; i++) for (let j = c; j < c + x.cs; j++) if (i !== r || j !== c) cells[i][j].bg = x.bg; });
        each((x) => { x.rs = x.cs = 1; }, true); tbRecalc(cells); draw();
      });
    };
    const insRow = (after) => {
      if (R() >= TB_MAXR) return toast('A table can have at most ' + TB_MAXR + ' rows');
      const q = rect(), at = after ? q.r1 + 1 : q.r0;
      act(() => { cells.forEach((row, r) => row.forEach((x) => { if (!x.cov && x.rs > 1 && r < at && at < r + x.rs) x.rs++; })); cells.splice(at, 0, al.map(() => tbCell(''))); tbRecalc(cells); A = Fo = [at, q.c0]; draw(); });
    };
    const insCol = (after) => {
      if (C() >= TB_MAXC) return toast('A table can have at most ' + TB_MAXC + ' columns');
      const q = rect(), at = after ? q.c1 + 1 : q.c0;
      act(() => { cells.forEach((row) => { row.forEach((x, c) => { if (!x.cov && x.cs > 1 && c < at && at < c + x.cs) x.cs++; }); row.splice(at, 0, tbCell('')); }); al.splice(at, 0, 'l'); tbRecalc(cells); A = Fo = [q.r0, at]; draw(); });
    };
    const delRow = () => { const q = rect(); if (q.r1 - q.r0 + 1 >= R()) return toast('A table needs at least one row'); act(() => { cells.splice(q.r0, q.r1 - q.r0 + 1); tbRecalc(cells); A = Fo = [Math.min(q.r0, R() - 1), q.c0]; draw(); }); };
    const delCol = () => { const q = rect(); if (q.c1 - q.c0 + 1 >= C()) return toast('A table needs at least one column'); act(() => { cells.forEach((row) => row.splice(q.c0, q.c1 - q.c0 + 1)); al.splice(q.c0, q.c1 - q.c0 + 1); tbRecalc(cells); A = Fo = [q.r0, Math.min(q.c0, C() - 1)]; draw(); }); };
    const fit = (nr, nc2) => {
      nr = clamp(nr, 1, TB_MAXR); nc2 = clamp(nc2, 1, TB_MAXC); if (nr === R() && nc2 === C()) return;
      act(() => {
        cells = Array.from({ length: nr }, (_, r) => Array.from({ length: nc2 }, (_, c) => (cells[r] && cells[r][c]) || tbCell('')));
        al = Array.from({ length: nc2 }, (_, c) => al[c] || 'l'); tbRecalc(cells); draw();
      });
    };
    const clearFmt = () => act(() => each((x) => { x.f = x.z = x.c = x.bg = x.al = ''; x.b = x.i = x.u = false; }));
    const undo = () => { if (!hist.length) return; endEdit(false); fut.push(snap()); const o = JSON.parse(hist.pop()); cells = o.cells; al = o.al; P.hd = o.hd; draw(); };
    const redo = () => { if (!fut.length) return; endEdit(false); hist.push(snap()); const o = JSON.parse(fut.pop()); cells = o.cells; al = o.al; P.hd = o.hd; draw(); };
    const sizePop = (anchor) => {
      const pop = h(`<div class="popover is-open"><div class="tbd__pick"><div class="tbd__pick-l"></div><div class="tgrid">${Array.from({ length: 80 }, (_, i) => `<i data-i="${i}"></i>`).join('')}</div></div></div>`), lab = $('.tbd__pick-l', pop);
      const hot = (nr, nc2) => { lab.textContent = nr + ' rows × ' + nc2 + ' columns'; $$('.tgrid i', pop).forEach((i) => i.classList.toggle('on', i.dataset.i % 10 < nc2 && Math.floor(i.dataset.i / 10) < nr)); };
      hot(R(), C());
      pop.addEventListener('mouseover', (e) => { const i = e.target.closest('.tgrid i'); if (i) hot(Math.floor(i.dataset.i / 10) + 1, i.dataset.i % 10 + 1); });
      pop.addEventListener('mouseleave', () => hot(R(), C()));
      pop.addEventListener('click', (e) => { const i = e.target.closest('.tgrid i'); if (i) { closePop(); fit(Math.floor(i.dataset.i / 10) + 1, i.dataset.i % 10 + 1); } });
      RPE.ui.openPop(anchor, pop);
    };
    const onRib = (e) => {
      const b = e.target.closest('[data-tb]'); if (!b || b.disabled || b.tagName === 'INPUT') return;
      const id = b.dataset.tb;
      switch (id) {
        case 'undo': return undo(); case 'redo': return redo();
        case 'b': return toggle('b'); case 'i': return toggle('i'); case 'u': return toggle('u');
        case 'szu': return stepSize(1); case 'szd': return stepSize(-1);
        case 'al-l': return setAl('l'); case 'al-c': return setAl('c'); case 'al-r': return setAl('r');
        case 'clr': return clearFmt(); case 'mg': return merge(); case 'sp': return split2();
        case 'ra': return insRow(false); case 'rb': return insRow(true); case 'rd': return delRow();
        case 'ca': return insCol(false); case 'cb': return insCol(true); case 'cd': return delCol();
        case 'font-m': return void RPE.fonts.load().catch(() => {}).finally(() => menu(b.parentNode, RPE.fonts.menuItems({ selected: rq('font').value, includeNone: true, noneLabel: 'Default (document font)' }), (v) => setFont(v)));
        case 'size-m': return menu(b.parentNode, Object.keys(SIZES_MAP), (v) => setSize(v));
        case 'fc': return RPE.ui.colorPanel(b, { none: 'Automatic', swatchEl: $('.rbtn__sw', b), onPick: (hex) => setColor('c', hex) });
        case 'bg': return RPE.ui.colorPanel(b, { none: 'No fill', swatchEl: $('.rbtn__sw', b), onPick: (hex) => setColor('bg', hex) });
        case 'tsz': return sizePop(b);
        case 'bd': return menu(b, TB_BD.map((l) => ({ l, checked: P.border === l })), (v) => { P.border = v; paintTbl(); sync(); });
        case 'hd': return act(() => { P.hd = !P.hd; cells[0].forEach((x) => { if (!x.cov) x.b = P.hd; }); });
        case 'lg': P.long = !P.long; return sync();
        case 'rw': P.raw = !P.raw; return sync();
        case 'pv': pv.hidden = !pv.hidden; preview(); return syncRib();
        case 'pl-m': return menu(b.parentNode, TB_PL.map((l, i) => ({ l, val: i, checked: P.pl === i })), (v) => { P.pl = v; sync(); });
      }
    };
    rib.addEventListener('mousedown', (e) => { if (e.target.closest('.rbtn')) e.preventDefault(); });   // buttons never steal focus from the grid / the cell being edited
    rib.addEventListener('click', onRib);
    rib.addEventListener('keydown', (e) => {
      const n = e.target; if (e.key !== 'Enter' || n.tagName !== 'INPUT') return;
      if (n.dataset.tb === 'font') { e.preventDefault(); setFont(n.value); } else if (n.dataset.tb === 'size') { e.preventDefault(); setSize(n.value); }
    });
    rib.addEventListener('input', (e) => { const n = e.target; if (n.dataset && n.dataset.tb === 'cap') P.cap = n.value; else if (n.dataset && n.dataset.tb === 'lab') P.lab = n.value; else return; preview(); });
    tabs.addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab); });
    /* ---- grid interaction: click / drag / Shift+click / headers / corner handle ---- */
    const cellAt = (e) => { const n = document.elementFromPoint(e.clientX, e.clientY), td = n && n.closest ? n.closest('td[data-r]') : null; return td && host.contains(td) ? [+td.dataset.r, +td.dataset.c] : null; };
    const mm = (e) => {
      if (!drag) return;
      const sr = sheet.getBoundingClientRect(); sheet.scrollTop += e.clientY > sr.bottom - 26 ? 22 : e.clientY < sr.top + 26 ? -22 : 0; sheet.scrollLeft += e.clientX > sr.right - 26 ? 22 : e.clientX < sr.left + 26 ? -22 : 0;
      const p = cellAt(e); if (p && (Fo[0] !== p[0] || Fo[1] !== p[1])) { Fo = p; drag.moved = true; sync(); }
    };
    const mu = () => {
      document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); sheet.classList.remove('is-drag');
      const dg = drag; drag = null; if (dg && dg.was && !dg.moved) startEdit(dg.p[0], dg.p[1]);   // a second click on the selected cell edits it
    };
    sheet.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const td = e.target.closest('td[data-r]'), rh = e.target.closest('[data-rh]'), ch = e.target.closest('[data-ch]'), all = e.target.closest('[data-all]'), hn = e.target.closest('.tbd__hnd');
      if (editing && td && +td.dataset.r === editing.r && +td.dataset.c === editing.c) return;   // caret placement inside the cell being edited
      if (!td && !rh && !ch && !all && !hn) return;
      e.preventDefault(); endEdit(false); sheet.focus({ preventScroll: true });
      if (hn) { const q = rect(); A = [q.r0, q.c0]; drag = { moved: false }; }
      else if (td) {
        const p = [+td.dataset.r, +td.dataset.c], m = cells[p[0]][p[1]], q = rect(), was = !e.shiftKey && q.r0 === p[0] && q.c0 === p[1] && q.r1 === p[0] + m.rs - 1 && q.c1 === p[1] + m.cs - 1;
        if (e.shiftKey) Fo = p; else { A = p; Fo = p; } drag = { p, was, moved: false };
      } else if (rh) { const r = +rh.dataset.rh; if (!e.shiftKey) A = [r, 0]; Fo = [r, C() - 1]; }
      else if (ch) { const c = +ch.dataset.ch; if (!e.shiftKey) A = [0, c]; Fo = [R() - 1, c]; }
      else { A = [0, 0]; Fo = [R() - 1, C() - 1]; }
      sync();
      if (drag) { sheet.classList.add('is-drag'); document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu); }
    });
    sheet.addEventListener('dblclick', (e) => { const td = e.target.closest('td[data-r]'); if (td && !editing) startEdit(+td.dataset.r, +td.dataset.c); });
    sheet.addEventListener('input', (e) => { const td = e.target.closest('td[data-r]'); if (!td || !editing) return; if (!editing.dirty) { push(); editing.dirty = true; } cells[+td.dataset.r][+td.dataset.c].t = e.target.value; preview(); });
    sheet.addEventListener('focusout', (e) => { if (editing && e.target.tagName === 'INPUT') endEdit(false); });
    const revertEdit = () => { const e = editing; if (!e) return; cells[e.r][e.c].t = e.orig; const td = $(`td[data-r="${e.r}"][data-c="${e.c}"]`, host); if (td) td.firstChild.value = e.orig; preview(); };
    const escKey = (e) => {   // runs before the dialog's own Escape (which would discard the whole table)
      if (!document.body.contains(el)) return window.removeEventListener('keydown', escKey, true);
      if (e.key === 'Escape' && editing) { e.stopPropagation(); e.preventDefault(); revertEdit(); endEdit(true); }
    };
    window.addEventListener('keydown', escKey, true);
    sheet.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey, stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (editing) {
        if (e.key === 'Enter') { stop(); endEdit(true); mv(e.shiftKey ? -1 : 1, 0, false); }
        else if (e.key === 'Tab') { stop(); endEdit(true); tabMove(e.shiftKey); }
        else if (mod && /^[biu]$/i.test(e.key)) { stop(); toggle({ b: 'b', i: 'i', u: 'u' }[e.key.toLowerCase()]); }
        return;
      }
      if (e.target !== sheet) return;
      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 'z') { stop(); return e.shiftKey ? redo() : undo(); } if (k === 'y') { stop(); return redo(); }
        if (k === 'a') { stop(); A = [0, 0]; Fo = [R() - 1, C() - 1]; return sync(); }
        if (k === 'b' || k === 'i' || k === 'u') { stop(); return toggle(k); }
        return;
      }
      const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (arrows[e.key]) { stop(); return void mv(arrows[e.key][0], arrows[e.key][1], e.shiftKey); }
      if (e.key === 'Tab') { if (tabMove(e.shiftKey)) stop(); return; }
      if (e.key === 'Enter' || e.key === 'F2') { stop(); return startEdit(A[0], A[1]); }
      if (e.key === 'Delete' || e.key === 'Backspace') { stop(); return act(() => each((x) => { x.t = ''; }, true)); }
      if (e.key.length === 1 && !e.altKey) { stop(); startEdit(A[0], A[1], e.key); }
    });
    sheet.addEventListener('copy', (e) => {
      if (editing) return; const q = rect(), rows = [];
      for (let r = q.r0; r <= q.r1; r++) { const row = []; for (let c = q.c0; c <= q.c1; c++) row.push(cells[r][c].cov ? '' : cells[r][c].t.replace(/[\t\r\n]+/g, ' ')); rows.push(row.join('\t')); }
      e.clipboardData.setData('text/plain', rows.join('\n')); e.preventDefault();
    });
    sheet.addEventListener('paste', (e) => {
      if (editing) return; const txt = (e.clipboardData.getData('text/plain') || '').replace(/\r/g, '').replace(/\n$/, ''); if (!txt) return; e.preventDefault();
      const q = rect(), rows = txt.split('\n').map((l) => l.split('\t'));
      if (rows.length === 1 && rows[0].length === 1) return act(() => each((x) => { x.t = rows[0][0]; }, true));
      const w = Math.max(...rows.map((r) => r.length));
      if (q.r0 + rows.length > TB_MAXR || q.c0 + w > TB_MAXC) return toast('The pasted data does not fit: a table can have at most ' + TB_MAXR + ' rows and ' + TB_MAXC + ' columns');
      endEdit(false); push();
      while (R() < q.r0 + rows.length) cells.push(al.map(() => tbCell(''))); while (C() < q.c0 + w) { cells.forEach((row) => row.push(tbCell(''))); al.push('l'); }
      tbRecalc(cells); rows.forEach((row, i) => row.forEach((v, j) => { const x = cells[q.r0 + i][q.c0 + j]; if (!x.cov) x.t = v; })); draw();
    });
    d.el.addEventListener('transitionend', place);
    window.addEventListener('resize', place);
    /* ---- insert / update ---- */
    $('.dlg__foot .btn--primary', el).onclick = async () => {
      endEdit(false);
      const g = gen(); if (g.err) return toast(g.err);
      const fonts = [...new Set(cells.flat().filter((x) => !x.cov && x.f && x.t.trim()).map((x) => x.f))];
      if (fonts.length) {
        if (/^[ \t]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:inputenc|fontenc)\b/m.test(t0) && !/fontspec/.test(t0)) return toast('This document is set up for pdfLaTeX (inputenc/fontenc): a font change needs XeLaTeX/fontspec');
        for (const f of fonts) { const ok = await fontOK(f); if (ok === null) return; if (!ok) return toast('Font “' + f + '” isn’t available to XeLaTeX: not applied'); }
        if (!document.body.contains(el)) return;
      }
      const cur = ta.value, p = ta.selectionEnd; if (cur !== t0 || p !== pos) { d.close(); return toast('The source changed. Place the cursor and try again'); }
      const pk = g.need.length ? ensurePackage(cur, ...g.need) : null;
      if (pk === false) return toast('Could not add ' + g.need.join(' and ') + '. Check the \\documentclass / preamble');
      const [ra, rb] = rng, pre = ra > 0 && cur[ra - 1] !== '\n' ? '\n' : '', post = rb < cur.length && cur[rb] !== '\n' ? '\n' : '', txt = g.out.join('\n'), end = ra + pre.length + txt.length;
      window.removeEventListener('resize', place); window.removeEventListener('keydown', escKey, true);
      d.close(); fmtEdit(ta, ra, rb, pre + txt + post, end, end);
      if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, end + pk.str.length, end + pk.str.length);   // preamble precedes the body: cursor just shifts
      syncFmtBtns();
    };
    showTab('home'); draw();
  }
  /* Layout ▸ Paragraph number boxes: show the caret paragraph's formatting, and commit edits through fmtPara (same transform as Home ▸ Paragraph) */
  const paDims = (st) => { const H = st.ind < 0 ? -st.ind : 0; return { left: Math.max(0, st.left - H), L: Math.max(0, st.left - H), right: st.right, first: st.ind > 0 ? st.ind : 0, hang: H, H, F: st.ind > 0 ? st.ind : 0, bef: st.bef, aft: st.aft }; };
  function paLayoutSync(ps) {
    const ta = $('#codeInput'), d = paDims(ps || (ta && paStateAt(ta)) || paEmpty());
    $$('.rnum__in[data-pk]').forEach((i) => { if (document.activeElement !== i) i.value = paNum(d[i.dataset.pk]) + (/^(bef|aft)$/.test(i.dataset.pk) ? ' pt' : ' cm'); });
  }
  function paLayoutCommit(i) {
    const ta = $('#codeInput'); if (!ta) return;
    const d = paDims(paStateAt(ta) || paEmpty()), k = i.dataset.pk, v = parseFloat(i.value);
    if (!(v >= 0 && v <= 50)) { toast('Enter a number between 0 and 50'); return paLayoutSync(); }
    if (Math.abs(v - d[k]) < 1e-9) return paLayoutSync();
    fmtPara(k === 'right' || k === 'bef' || k === 'aft' ? { [k]: v }
      : k === 'left' ? { ind: { L: v, H: d.H, F: d.F, z: false } }
      : k === 'first' ? { ind: { L: d.L, H: 0, F: v, z: true } } : { ind: { L: d.L, H: v, F: 0, z: true } });
    paLayoutSync();
  }
  function paraDialog() {   // Home ▸ Paragraph ▸ Paragraph Options… : the existing D.para dialog, now wired to fmtPara
    const ta = $('#codeInput'), st = (ta && paStateAt(ta)) || paEmpty(), H0 = st.ind < 0 ? -st.ind : 0, L0 = Math.max(0, st.left - H0), F0 = st.ind > 0 ? st.ind : 0;
    const LS = { 1: 'Single', 1.15: '1.15', 1.5: '1.5', 2: 'Double' }[st.ls || 1] || 'Single', LSV = { Single: 1, '1.15': 1.15, '1.5': 1.5, Double: 2 };
    const d = dlg(D.para([L0, st.right, F0, H0, st.bef, st.aft, LS])); $('select', d.el).value = LS;
    $('.dlg__foot .btn--primary', d.el).onclick = () => {
      const [L, R, F, H, bef, aft] = $$('input', d.el).map((i) => parseFloat(i.value)), sel = $('select', d.el).value, c = {}, df = (a, b) => Math.abs(a - b) > 1e-9;
      if ([L, R, F, H, bef, aft].some((x) => !(x >= 0 && x <= 50))) return toast('Enter numbers between 0 and 50');
      if (df(L, L0) || df(F, F0) || df(H, H0)) c.ind = { L, H, F, z: df(F, F0) || df(H, H0) };
      if (df(R, st.right)) c.right = R; if (df(bef, st.bef)) c.bef = bef; if (df(aft, st.aft)) c.aft = aft; if (sel !== LS) c.ls = LSV[sel];
      d.close(); if (Object.keys(c).length) fmtPara(c);
    };
  }
  /* Home ▸ Paragraph ▸ Bulleted / Numbered list: turns the selected lines (or the caret line) into itemize/enumerate, or switches
     the style/type of the list(s) already there. Non-default labels use enumitem (+ pifont for the arrow) via ensurePackage. */
  const LI_LAB = { bul: [null, '$\\circ$', '\\rule{0.8ex}{0.8ex}', '\\textendash', '\\ding{228}'], num: [null, '\\Alph*.', '\\alph*.', '\\Roman*.', '\\roman*.'] };
  const LI_MARK = /^(?:\\item(?:\s*\[[^\]]*\])?\s*|[-*•●○■–➤]\s+|\d+[.)]\s+|[A-Za-z][.)]\s+)/;
  function listEnvs(t) {   // all itemize/enumerate envs as {name,bs,be,es,ee,opt}; null if the pairs don't match
    const st = [], out = [], re = /\\(begin|end)\{(itemize|enumerate)\}/g; let m;
    while ((m = re.exec(t))) {
      if (/(^|[^\\])%/.test(t.slice(t.lastIndexOf('\n', m.index - 1) + 1, m.index))) continue;
      if (m[1] === 'begin') {
        let be = m.index + m[0].length, k = be, opt = ''; while (t[k] === ' ' || t[k] === '\t') k++;
        if (t[k] === '[') { let d = 0, j = k; for (; j < t.length; j++) { if (t[j] === '{') d++; else if (t[j] === '}') d--; else if (t[j] === ']' && !d) break; } if (j < t.length) { opt = t.slice(k + 1, j); be = j + 1; } }
        st.push({ name: m[2], bs: m.index, be, opt });
      } else { const b = st.pop(); if (!b || b.name !== m[2]) return null; out.push({ ...b, es: m.index, ee: m.index + m[0].length }); }
    }
    return st.length ? null : out;
  }
  function liBegin(env, opt, label) {   // keeps the user's other options, replaces only label=
    const parts = []; let d = 0, cur = '';
    for (const c of opt || '') { if (c === '{') d++; else if (c === '}') d--; if (c === ',' && !d) { parts.push(cur); cur = ''; } else cur += c; }
    parts.push(cur); const keep = parts.map((x) => x.trim()).filter((x) => x && !/^label\s*=/.test(x));
    if (label) keep.unshift('label=' + label);
    return '\\begin{' + env + '}' + (keep.length ? '[' + keep.join(',') + ']' : '');
  }
  function fmtList(kind, idx) {
    const ta = $('#codeInput'); if (!ta || idx < 0) return;
    const t = ta.value, bd = t.indexOf('\\begin{document}'), ed = t.lastIndexOf('\\end{document}'), ss = ta.selectionStart;
    let a = ss ? t.lastIndexOf('\n', ss - 1) + 1 : 0, e = ta.selectionEnd; if (e > ss && t[e - 1] === '\n') e--;
    let b = t.indexOf('\n', e); if (b < 0) b = t.length;
    if (bd < 0 || a < bd + 16 || (ed >= 0 && b > ed)) return toast('Place the cursor or selection inside the document body to make a list');
    const envs = listEnvs(t); if (!envs) return toast('Could not read the existing lists. Check their \\begin/\\end pairs');
    const env = kind === 'bul' ? 'itemize' : 'enumerate', label = LI_LAB[kind][idx], region = t.slice(a, b);
    const inside = envs.filter((l) => a <= l.bs && l.ee <= b), top = inside.filter((l) => !inside.some((o) => o !== l && o.bs <= l.bs && l.ee <= o.ee));
    if (envs.some((l) => l.bs < b && l.ee > a && !(a <= l.bs && l.ee <= b) && !(l.be <= a && b <= l.es))) return toast('Selection partly overlaps a list. Select whole items or the whole list');
    const pkgs = label ? ['enumitem', ...(label.includes('\\ding') ? ['pifont'] : [])] : [];
    const pk = pkgs.length ? ensurePackage(t, ...pkgs) : null;
    if (pk === false) return toast('Could not add the needed package. Check the \\documentclass / preamble');
    let A, B, out, selA, selB, tgt = null;
    if (!top.length) { const c = envs.filter((l) => l.be <= a && b <= l.es).sort((x, y) => y.bs - x.bs)[0]; if (c && /^[ \t]*\\item\b/m.test(region)) tgt = [c]; }
    else {
      let rest = region; for (const l of [...top].sort((x, y) => y.bs - x.bs)) rest = rest.slice(0, l.bs - a) + rest.slice(l.ee - a);
      if (rest.split('\n').some((x) => !/^\s*(%.*)?$/.test(x))) return toast('Selection mixes lists with plain text. Select only the list or only the lines to convert');
      tgt = top;
    }
    if (tgt) {   // switch existing list(s): rewrite just the begin/end lines, text and nested lists untouched
      if (tgt.every((l) => l.name === env && liBegin(env, l.opt, label) === t.slice(l.bs, l.be))) return toast('Already that list style');
      A = Math.min(...tgt.map((l) => l.bs)); B = Math.max(...tgt.map((l) => l.ee)); out = t.slice(A, B);
      for (const l of [...tgt].sort((x, y) => y.bs - x.bs)) {
        const nb = liBegin(env, l.opt, label);
        out = out.slice(0, l.bs - A) + nb + out.slice(l.be - A, l.es - A) + '\\end{' + env + '}' + out.slice(l.ee - A);
      }
      if (tgt.length === 1 && tgt[0].be <= a) { const dl = liBegin(env, tgt[0].opt, label).length - (tgt[0].be - tgt[0].bs); selA = ta.selectionStart + dl; selB = ta.selectionEnd + dl; }
      else { selA = A; selB = A + out.length; }
    } else {     // plain lines -> one list per run of non-blank lines
      if (/\\(?:begin|end)\{/.test(region)) return toast('Selection contains other environments. Select plain text lines only');
      if (!balanced(region)) return toast('Selection has unmatched braces. Adjust it and try again');
      const res = []; let blk = [];
      const flush = () => { if (!blk.length) return; const ind = blk[0].ind; res.push(ind + liBegin(env, '', label), ...blk.map((x) => ind + '  \\item ' + x.txt), ind + '\\end{' + env + '}'); blk = []; };
      for (const ln of region.split('\n')) {
        const txt = /^\s*(%.*)?$/.test(ln) ? '' : ln.trim().replace(LI_MARK, '').trim();
        if (/^\s*%/.test(ln)) { flush(); res.push(ln); } else if (!txt) { flush(); res.push(''); } else blk.push({ txt, ind: ln.match(/^[ \t]*/)[0] });
      }
      flush(); if (!res.some((x) => x.includes('\\item'))) return toast('Select some text to make a list');
      A = a; B = b; out = res.join('\n'); selA = A; selB = A + out.length;
    }
    fmtEdit(ta, A, B, out, selA, selB);
    if (pk) fmtEdit(ta, pk.pos, pk.pos, pk.str, selA + pk.str.length, selB + pk.str.length);
    syncFmtBtns();
  }
  /* Home ▸ Paragraph ▸ Multilevel list: Increase/Decrease list level (nest/un-nest whole \item blocks, so no \item is ever orphaned)
     plus whole-list presets (per-level labels via enumitem). Every result is re-parsed with listEnvs() and refused if it doesn't pair up. */
  const ML_PRE = {
    '1. / a. / i.': ['enumerate', [null, '\\alph*.', '\\roman*.', '\\Alph*.']],
    '1.1 / 1.1.1': ['enumerate', [null, '\\arabic{enumi}.\\arabic*.', '\\arabic{enumi}.\\arabic{enumii}.\\arabic*.', '\\arabic{enumi}.\\arabic{enumii}.\\arabic{enumiii}.\\arabic*.']],
    '● / ○ / ■': ['itemize', [null, '$\\circ$', '\\rule{0.8ex}{0.8ex}', '\\textendash']],
  };
  function lvSpan(ta, t) {   // caret/selection widened to whole lines, must sit in the document body -> { a, b } or null
    const bd = t.indexOf('\\begin{document}'), ed = t.lastIndexOf('\\end{document}'), ss = ta.selectionStart;
    const a = ss ? t.lastIndexOf('\n', ss - 1) + 1 : 0; let e = ta.selectionEnd; if (e > ss && t[e - 1] === '\n') e--;
    let b = t.indexOf('\n', e); if (b < 0) b = t.length;
    if (bd < 0 || a < bd + 16 || (ed >= 0 && b > ed)) return toast('Place the cursor inside a list in the document body'), null;
    return { a, b };
  }
  function lvItems(t, envs, c) {   // direct \item blocks of env c ({s,e,te}), nested lists masked; null if the layout is unsafe to edit
    let body = t.slice(c.be, c.es);
    for (const l of envs) if (c.bs < l.bs && l.ee < c.es) { const x = l.bs - c.be, y = l.ee - c.be; body = body.slice(0, x) + body.slice(x, y).replace(/[^\n]/g, ' ') + body.slice(y); }
    const idx = [], re = /^[ \t]*\\item\b/gm; let m; while ((m = re.exec(body))) idx.push(c.be + m.index);
    const eL = t.lastIndexOf('\n', c.es - 1) + 1;
    if (!idx.length || idx[0] === c.be || t.slice(eL, c.es).trim()) return null;
    return idx.map((s, i) => { const e = i + 1 < idx.length ? idx[i + 1] : eL; return { s, e, te: s + t.slice(s, e).replace(/\s+$/, '').length }; });
  }
  function fmtLevel(dir) {
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, sp = lvSpan(ta, t); if (!sp) return; const { a, b } = sp;
    const envs = listEnvs(t); if (!envs) return toast('Could not read the existing lists. Check their \\begin/\\end pairs');
    const dep = (l) => envs.filter((o) => o.bs <= l.bs && l.ee <= o.ee).length;
    const ind = (p) => /^[ \t]*/.exec(t.slice(t.lastIndexOf('\n', p - 1) + 1))[0];
    const c = envs.filter((l) => l.be <= a && b <= l.es).sort((x, y) => y.bs - x.bs)[0];
    if (!c) return toast('Place the cursor inside a list item first');
    const blks = lvItems(t, envs, c); if (!blks) return toast('Could not read this list. Put each \\item and the \\end on its own line');
    const sel = blks.map((_, i) => i).filter((i) => blks[i].s <= b && blks[i].e > a);
    if (!sel.length) return toast('Place the cursor inside a list item first');
    const i0 = sel[0], i1 = sel[sel.length - 1], s0 = blks[i0].s, s1 = blks[i1].te, seg = t.slice(s0, s1);
    if (/\\begin\{(?:verbatim|lstlisting|minted)/.test(seg)) return toast('Cannot re-indent items containing verbatim/code blocks');
    let A, B = s1, out;
    if (dir > 0) {
      if (!i0) return toast('The first item of a list cannot be demoted: there is no previous item to nest it under');
      let mx = dep(c); envs.forEach((l) => { if (l.bs >= s0 && l.ee <= s1) mx = Math.max(mx, dep(l)); });
      if (mx + 1 > 4) return toast('LaTeX allows at most 4 nested list levels');
      const mv = seg.replace(/^(?=.*\S)/gm, '    '), prev = blks[i0 - 1], n = envs.find((l) => l.ee === prev.te && l.bs > prev.s);
      if (n) {   // previous item already ends with a nested list: join it instead of starting a second one
        const eL = t.lastIndexOf('\n', n.es - 1) + 1; if (t.slice(eL, n.es).trim()) return toast('Could not read the nested list. Put its \\end on its own line');
        A = eL; out = mv + '\n' + t.slice(eL, n.ee);
      } else { const bi = ind(s0); A = prev.te; out = '\n' + bi + '  \\begin{' + c.name + '}\n' + mv + '\n' + bi + '  \\end{' + c.name + '}'; }
    } else {
      const p = envs.filter((l) => l !== c && l.be <= c.bs && c.ee <= l.es).sort((x, y) => y.bs - x.bs)[0];
      if (!p) return toast('Already at the top list level');
      const pb = lvItems(t, envs, p), P = pb && pb.find((x) => x.s <= c.bs && c.ee <= x.e);
      if (!P || t.slice(c.ee, P.e).trim() || t.slice(c.be, blks[0].s).trim()) return toast('Cannot promote here: unexpected text around the nested list');
      const d = Math.max(0, ind(s0).length - /^[ \t]*/.exec(t.slice(P.s))[0].length), ec = ind(c.es);
      const rest = i1 + 1 < blks.length ? '\n' + ind(c.bs) + t.slice(c.bs, c.be) + '\n' + t.slice(blks[i1 + 1].s, blks[blks.length - 1].te) + '\n' + ec + '\\end{' + c.name + '}' : '';
      const promoted = seg.replace(new RegExp('^[ \\t]{0,' + d + '}', 'gm'), '') + rest;
      A = c.bs; B = c.ee;
      if (i0) out = t.slice(c.bs, blks[i0 - 1].te) + '\n' + ec + '\\end{' + c.name + '}\n' + promoted;
      else { while (A > 0 && /\s/.test(t[A - 1])) A--; out = '\n' + promoted; }
    }
    if (!listEnvs(t.slice(0, A) + out + t.slice(B))) return toast('Could not change the level safely. Nothing was changed');
    fmtEdit(ta, A, B, out, A, A + out.length); syncFmtBtns();
  }
  function fmtMulti(label) {
    if (/^Increase/.test(label)) return fmtLevel(1);
    if (/^Decrease/.test(label)) return fmtLevel(-1);
    const pre = ML_PRE[label]; if (!pre) return;
    const ta = $('#codeInput'); if (!ta) return;
    const t = ta.value, sp = lvSpan(ta, t); if (!sp) return; const { a, b } = sp;
    const envs = listEnvs(t); if (!envs) return toast('Could not read the existing lists. Check their \\begin/\\end pairs');
    const hit = envs.filter((l) => l.bs < b && l.ee > a), roots = hit.filter((l) => !hit.some((o) => o !== l && o.bs <= l.bs && l.ee <= o.ee));
    if (!roots.length) return toast('Place the cursor inside a list first');
    const tree = envs.filter((l) => roots.some((r) => r.bs <= l.bs && l.ee <= r.ee)), [env, labs] = pre;
    const pkg = labs.slice(0, Math.max(...tree.map((l) => tree.filter((o) => o.bs <= l.bs && l.ee <= o.ee).length))).some(Boolean) ? ensurePackage(t, 'enumitem') : null;
    if (pkg === false) return toast('Could not add the needed package. Check the \\documentclass / preamble');
    const A = Math.min(...roots.map((r) => r.bs)), B = Math.max(...roots.map((r) => r.ee)), eds = [];
    for (const l of tree) {
      const lab = labs[Math.min(tree.filter((o) => o.bs <= l.bs && l.ee <= o.ee).length - 1, 3)];
      eds.push({ p: l.bs, n: l.be - l.bs, s: liBegin(env, l.opt, lab) }, { p: l.es, n: l.ee - l.es, s: '\\end{' + env + '}' });
    }
    let out = t.slice(A, B); for (const e of eds.sort((x, y) => y.p - x.p)) out = out.slice(0, e.p - A) + e.s + out.slice(e.p - A + e.n);
    if (out === t.slice(A, B)) return toast('Already that list style');
    fmtEdit(ta, A, B, out, A, A + out.length);
    if (pkg) fmtEdit(ta, pkg.pos, pkg.pos, pkg.str, A + pkg.str.length, A + out.length + pkg.str.length);
    syncFmtBtns();
  }
  function syncFmtBtns() {
    const ta = $('#codeInput'); if (!ta) return;
    const r = fmtLayers(ta.value, ta.selectionStart, ta.selectionEnd), fi = $('.combo__in[aria-label="Font"]'), si = $('.combo__in[aria-label="Size"]');
    if (fi && document.activeElement !== fi) {   // Font box mirrors the caret: enclosing font group, else \setmainfont, else the XeLaTeX default
      const f = r.L.find((l) => l.name === 'font'), mf = /\\setmainfont(?:\[[^\]]*\])?\{([^{}]+)\}/.exec(ta.value);
      fi.value = f ? f.val : mf ? mf[1] : 'Latin Modern Roman';
    }
    if (si && document.activeElement !== si) {
      const cur = curSizeCmd(ta.value, ta.selectionStart);
      const docM = /\\documentclass\[[^\]]*?(\d+)pt/.exec(ta.value);
      si.value = cur === 'normalsize' && docM ? docM[1] : (SIZES_REV[cur] || '12');
    }
    $$('[data-fmt]').forEach((b) => b.classList.toggle('is-on', r.L.some((l) => l.name === b.dataset.fmt || (b.dataset.fmt === 'textit' && l.name === 'emph'))));
    const ps = paStateAt(ta), pon = ps ? ['al' + (ps.al || 'j'), ps.ind > 0 && 'first', ps.ind < 0 && 'hang', ps.noind && 'noind'] : [];
    $$('[data-pa]').forEach((b) => b.classList.toggle('is-on', pon.includes(b.dataset.pa)));
    $$('[data-pag]').forEach((b) => b.classList.toggle('is-on', b.dataset.pag === 'wo' ? widowOn(ta.value) : !!(ps && ps[b.dataset.pag])));
    const envs = listEnvs(ta.value);
    const curEnv = envs ? envs.find((l) => ta.selectionStart >= l.bs && ta.selectionEnd <= l.ee) : null;
    $$('[data-ls]').forEach((b) => b.classList.toggle('is-on', !!curEnv && (b.dataset.ls === 'bul' ? curEnv.name === 'itemize' : curEnv.name === 'enumerate')));
    paLayoutSync(ps);
  }

  /* ---------- Find & Replace: real search/replace against the ctx.SRC string, highlighted at the exact matched range
     via paintFind() (CSS Custom Highlight API; falls back to line-level .hit classes where unsupported) (no HTML injected into tokenized source spans). ---------- */

  /* ---------- Comments: a persistent store kept apart from the LaTeX source (localStorage, one list per project folder).
     Each comment = { id, file, start, end, quote, before, after, text, at, bad }. The quote + 40 chars of context on each side
     let it relocate after edits (cmtLocate); if it can't be found uniquely it is flagged `bad` (unresolved), never guessed. ---------- */
  const CMT = { key: null, list: [], show: true, lines: new Set(), ranges: [], timer: 0 };
  /* Review ▸ Track Changes: per-file baseline snapshot (TRK.base, key = histKey()) diffed against ctx.SRC, a line diff first, then a word diff inside the changed lines. */
  const TRK = { on: false, mode: 'All', base: new Map(), hunks: [], lines: new Set(), timer: 0 };
  const trkCut = (s, re) => { const t = s.match(re) || [], o = [0]; t.forEach((x) => o.push(o[o.length - 1] + x.length)); return [t, o]; };   // tokens + char offsets
  function trkDif(A, B) {   // LCS diff of two token arrays → hunks [a0, a1, b0, b1]; oversized middles collapse into one hunk
    let s = 0, ea = A.length, eb = B.length;
    while (s < ea && s < eb && A[s] === B[s]) s++;
    while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    const n = ea - s, m = eb - s, out = [];
    if (!n && !m) return out;
    if (!n || !m || n * m > 4e6) return [[s, ea, s, eb]];
    const W = m + 1, T = new Uint16Array((n + 1) * W);   // T[i*W+j] = LCS length of A[s+i..], B[s+j..] (≤ 2000, fits 16 bits)
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i * W + j] = A[s + i] === B[s + j] ? T[(i + 1) * W + j + 1] + 1 : Math.max(T[(i + 1) * W + j], T[i * W + j + 1]);
    for (let i = 0, j = 0, cur = null; i < n || j < m;) {
      if (i < n && j < m && A[s + i] === B[s + j]) { cur = null; i++; j++; continue; }
      if (!cur) out.push(cur = [s + i, s + i, s + j, s + j]);
      if (j < m && (i === n || T[i * W + j + 1] >= T[(i + 1) * W + j])) cur[3] = s + ++j; else cur[1] = s + ++i;
    }
    return out;
  }
  function trkHunks(a, b) {   // character ranges {a0,a1} in the baseline ↔ {b0,b1} in the current text
    const [la, oa] = trkCut(a, /[^\n]*\n|[^\n]+/g), [lb, ob] = trkCut(b, /[^\n]*\n|[^\n]+/g), out = [];
    trkDif(la, lb).forEach(([a0, a1, b0, b1]) => {
      const [ta, xa] = trkCut(a.slice(oa[a0], oa[a1]), /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu), [tb, xb] = trkCut(b.slice(ob[b0], ob[b1]), /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu);
      trkDif(ta, tb).forEach(([p, q, r, z]) => {
        const x = { a0: oa[a0] + xa[p], a1: oa[a0] + xa[q], b0: ob[b0] + xb[r], b1: ob[b0] + xb[z] }, g = out[out.length - 1];
        if (g && /^\s*$/.test(b.slice(g.b1, x.b0)) && b.slice(g.b1, x.b0) === a.slice(g.a1, x.a0)) { g.a1 = x.a1; g.b1 = x.b1; } else out.push(x);   // changes separated only by identical whitespace read as one
      });
    });
    return out;
  }
  function trkSync() {   // recompute this file's changes (a file first seen while tracking takes its current text as baseline)
    clearTimeout(TRK.timer); TRK.timer = 0; const k = histKey(); indexSrc();
    if (TRK.on && !TRK.base.has(k)) TRK.base.set(k, ctx.SRC);
    TRK.hunks = TRK.base.has(k) ? trkHunks(TRK.base.get(k), ctx.SRC) : []; TRK.lines = new Set();
    if (TRK.mode !== 'Off') TRK.hunks.forEach((x) => { for (let n = lineOf(x.b0), z = lineOf(Math.max(x.b0, x.b1 - 1)); n <= z; n++) TRK.lines.add(n); });
    ensureWindow(true); trkRender();
  }
  function trkSchedule() { if (TRK.on || TRK.hunks.length) { clearTimeout(TRK.timer); TRK.timer = setTimeout(trkSync, 250); } }
  function paintTrk() {   // All Markup: insertions underlined, deletions flagged on the character beside them (Simple Markup = gutter bar only)
    if (!HAS_HL) return; CSS.highlights.delete('trk-ins'); CSS.highlights.delete('trk-del');
    if (TRK.mode !== 'All' || !TRK.hunks.length) return;
    const ins = new Highlight(), del = new Highlight(), hl = $('#codeHighlight');
    const mark = (set, a, b) => {
      for (let n = Math.max(lineOf(a), ctx.WIN.a), z = Math.min(lineOf(Math.max(a, b - 1)), ctx.WIN.b); n <= z; n++) {
        const sp = $(`.ln[data-n="${n}"] > span`, hl); if (!sp || sp.textContent.length !== ctx.LINES[n].length) continue;
        const x = Math.max(a, ctx.LINE_START[n]) - ctx.LINE_START[n], y = Math.min(b, ctx.LINE_START[n] + ctx.LINES[n].length) - ctx.LINE_START[n];
        const w = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT); let node, off = 0, rg = null;
        while ((node = w.nextNode())) {
          const l = node.nodeValue.length;
          if (!rg && x < off + l) { rg = document.createRange(); rg.setStart(node, x - off); }
          if (rg && y <= off + l) { rg.setEnd(node, y - off); break; }
          off += l;
        }
        if (rg && !rg.collapsed) set.add(rg);
      }
    };
    TRK.hunks.forEach((x) => { if (x.b1 > x.b0) mark(ins, x.b0, x.b1); else if (ctx.SRC[x.b0] === '\n' && x.b0 > 0) mark(del, x.b0 - 1, x.b0); else mark(del, x.b0, x.b0 + 1); });
    CSS.highlights.set('trk-ins', ins); CSS.highlights.set('trk-del', del);
  }
  function trkSet(t) {   // replace the whole text as one undoable step (Reject)
    const ta = $('#codeInput'), a = ta.selectionStart; historyRecord(ctx.SRC, a, ta.selectionEnd, false);
    ctx.SRC = ta.value = t; ta.setSelectionRange(Math.min(a, t.length), Math.min(a, t.length)); syncSaveSoon(); renderCode();
  }
  function trkAct(op, x) {   // op 'acc' | 'rej'; x = one change, or omitted for every change in this file
    const k = histKey(), b = TRK.base.get(k); if (b === undefined) return;
    if (op === 'acc') TRK.base.set(k, x ? b.slice(0, x.a0) + ctx.SRC.slice(x.b0, x.b1) + b.slice(x.a1) : ctx.SRC);
    else trkSet(x ? ctx.SRC.slice(0, x.b0) + b.slice(x.a0, x.a1) + ctx.SRC.slice(x.b1) : b);
    trkSync();
  }
  /* Review ▸ Compare: side-by-side line diff (trkDif) of this file against its saved copy or another project .tex file.
     "Use other side" copies one hunk into the editor as a single undo step (trkSet); the other file is never modified. */
  async function compareDialog() {
    const me = ctx.activePath && findNode(ctx.activePath), opts = [];
    if (me && me.handle) opts.push(['Saved version on disk', async () => (await me.handle.getFile()).text()]);
    (ctx.rootDirHandle && ctx.PROJECT.length ? await scanAllTexNodes(ctx.PROJECT[0]) : []).filter((n) => n.path !== ctx.activePath).forEach((n) => opts.push([n.path, async () => ctx.fileCache.has(n.path) ? ctx.fileCache.get(n.path) : (await n.handle.getFile()).text()]));
    if (!opts.length) return toast('Save this file, or open a project folder with another .tex file, to compare');
    const d = dlg({ t: 'Compare Documents', i: 'copy-plus', w: 960, cls: 'cmp', btns: ['Close'], b: `<div class="cmp__bar"><select id="cmpSrc" aria-label="Compare with">${opts.map((o) => `<option>${esc(o[0])}</option>`).join('')}</select><label><input type="checkbox" id="cmpWs" style="accent-color:var(--accent)"> Ignore whitespace</label><span class="cmp__nav"><button class="btn btn--sm" id="cmpPrev">Previous</button><span id="cmpCnt" aria-live="polite"></span><button class="btn btn--sm" id="cmpNext">Next</button></span></div><div class="cmp__cols"><span id="cmpL"></span><span>Current file</span></div><div class="cmp__body" id="cmpBody"></div>` });
    const q = (i) => $(i, d.el), lines = (t) => trkCut(t, /[^\n]*\n|[^\n]+/g)[0];
    let other = '', H = [], cur = 0;
    const pre = (L, c) => `<pre class="cmp__c ${c || ''}">${esc(L.join('').replace(/\n$/, ''))}</pre>`;
    const mark = (go) => {
      $$('.cmp__h', d.el).forEach((e) => e.classList.toggle('is-cur', +e.dataset.k === cur));
      q('#cmpCnt').textContent = H.length ? `${cur + 1} of ${H.length}` : 'No differences';
      q('#cmpPrev').disabled = q('#cmpNext').disabled = !H.length;
      const e = $(`.cmp__h[data-k="${cur}"]`, d.el); if (go && e) e.scrollIntoView({ block: 'center' });
    };
    const run = () => {
      const A = lines(other), B = lines(ctx.SRC), ws = q('#cmpWs').checked, nz = (L) => ws ? L.map((x) => x.replace(/\s+/g, ' ').trim()) : L;
      H = trkDif(nz(A), nz(B)); cur = Math.min(cur, Math.max(0, H.length - 1));
      const ctx = (a, b, n, from, to) => {   // unchanged lines (identical on both sides); long runs collapse to a gap marker
        const keep = (i, j) => `<div class="cmp__r">${pre(A.slice(a + i, a + j))}${pre(B.slice(b + i, b + j))}</div>`;
        if (n <= 6) return n ? keep(0, n) : '';
        return (from ? keep(0, 2) : '') + `<div class="cmp__gap">${n - (from ? 2 : 0) - (to ? 2 : 0)} unchanged lines</div>` + (to ? keep(n - 2, n) : '');
      };
      let pa = 0, pb = 0, out = '';
      H.forEach(([a0, a1, b0, b1], k) => {
        out += ctx(pa, pb, a0 - pa, k > 0, true);
        out += `<div class="cmp__h" data-k="${k}"><div class="cmp__hb"><span>${a1 > a0 ? 'Other lines ' + (a0 + 1) + '–' + a1 : 'Other: nothing here'} · ${b1 > b0 ? 'Current lines ' + (b0 + 1) + '–' + b1 : 'Current: nothing here'}</span><button class="btn btn--sm" data-k="${k}">Use other side</button></div><div class="cmp__r">${pre(A.slice(a0, a1), 'cmp__c--a')}${pre(B.slice(b0, b1), 'cmp__c--b')}</div></div>`;
        pa = a1; pb = b1;
      });
      out += ctx(pa, pb, A.length - pa, true, false);
      q('#cmpBody').innerHTML = H.length ? out : '<div class="cmp__gap">The two versions are identical.</div>'; mark(false);
    };
    const load = async () => {
      q('#cmpL').textContent = opts[q('#cmpSrc').selectedIndex][0];
      try { other = await opts[q('#cmpSrc').selectedIndex][1](); } catch (e) { other = ''; toast('Could not read “' + q('#cmpL').textContent + '”'); }
      cur = 0; run(); mark(true);
    };
    q('#cmpSrc').onchange = load; q('#cmpWs').onchange = () => run();
    q('#cmpPrev').onclick = () => { cur = (cur + H.length - 1) % H.length; mark(true); };
    q('#cmpNext').onclick = () => { cur = (cur + 1) % H.length; mark(true); };
    q('#cmpBody').onclick = (e) => {
      const b = e.target.closest('button[data-k]'); if (!b) return;
      const [a0, a1, b0, b1] = H[+b.dataset.k], A = lines(other), B = lines(ctx.SRC);
      trkSet(B.slice(0, b0).join('') + A.slice(a0, a1).join('') + B.slice(b1).join('')); trkSchedule(); run(); mark(true);
      toast('Copied from the other side: Ctrl+Z to undo');
    };
    load();
  }
  function trkToggle() {
    if (TRK.on) {
      let n = 0; TRK.base.forEach((b, k) => { const t = k === histKey() ? ctx.SRC : ctx.fileCache.get(k); if (t !== undefined && t !== b) n += trkHunks(b, t).length; });
      if (n && !confirm(`Turn off Track Changes? The ${n} tracked change${n > 1 ? 's' : ''} will be accepted and can no longer be rejected.`)) return;
      TRK.on = false; TRK.base.clear(); $('#trkPanel').hidden = true; toast('Track Changes off');
    } else { TRK.on = true; $('#trkPanel').hidden = false; toast('Track Changes on: edits are marked against this version of the file'); }
    $$('[data-trk="on"]').forEach((b) => b.classList.toggle('is-on', TRK.on)); trkSync();
  }
  function trkPick(k, l) {   // Display Markup / Accept / Reject menus
    if (k === 'mode') {
      if (l === 'Reviewing Pane') { const p = $('#trkPanel'); p.hidden = !p.hidden; return trkRender(); }
      TRK.mode = l[0] === 'N' ? 'Off' : l.split(' ')[0]; return trkSync();
    }
    if (!TRK.hunks.length) return toast(TRK.on ? 'No tracked changes in this file' : 'Turn on Track Changes first');
    const all = /All/.test(l), p = $('#codeInput').selectionStart, x = all ? null : TRK.hunks.find((y) => p >= y.b0 && p <= y.b1);
    if (!all && !x) return toast('Place the cursor inside a tracked change first');
    trkAct(k, x); toast(all ? (k === 'acc' ? 'All changes accepted' : 'All changes rejected') : (k === 'acc' ? 'Change accepted' : 'Change rejected'));
  }
  function trkRender() {   // Review panel: one card per change, Accept / Reject each, Accept all / Reject all on top
    const p = $('#trkPanel'); if (!p || p.hidden) return;
    const body = $('.cmtpanel__body', p), base = TRK.base.get(histKey()) || '', n = TRK.hunks.length, sn = (s) => esc(s.replace(/\s+/g, ' ').trim().slice(0, 90)) || '␣';
    $('.cmtpanel__title', p).textContent = 'Changes (' + n + ')';
    body.innerHTML = n ? '' : `<p class="cmt__empty">${TRK.on ? 'No tracked changes in this file yet. Edits you make are listed here.' : 'Turn on Track Changes to mark edits against the current version of this file.'}</p>`;
    const btn = (m, l, fn) => { const b = h(`<button class="cmt__b">${l}</button>`); b.onclick = (e) => { e.stopPropagation(); fn(); }; m.append(b); };
    if (n) { const m = h('<div class="cmt__m"></div>'); btn(m, 'Accept all', () => trkAct('acc')); btn(m, 'Reject all', () => trkAct('rej')); body.append(m); }
    TRK.hunks.forEach((x) => {
      const del = base.slice(x.a0, x.a1), ins = ctx.SRC.slice(x.b0, x.b1), card = h(`<div class="cmt" tabindex="0">${del ? `<div class="trk__d">${sn(del)}</div>` : ''}${ins ? `<div class="trk__i">${sn(ins)}</div>` : ''}<div class="cmt__m">${del && ins ? 'Replaced' : ins ? 'Inserted' : 'Deleted'} · line ${lineOf(x.b0) + 1}<span class="sp"></span></div></div>`), m = $('.cmt__m', card);
      btn(m, 'Accept', () => trkAct('acc', x)); btn(m, 'Reject', () => trkAct('rej', x));
      card.onclick = () => { const ta = $('#codeInput'); goToLine(lineOf(x.b0)); ta.focus(); ta.setSelectionRange(x.b0, x.b1); setCurLine(lineOf(x.b0)); };
      body.append(card);
    });
  }
  const cmtFile = () => ctx.activePath || '(untitled)';
  const cmtKey = () => 'lplum:comments:' + (ctx.rootDirHandle ? ctx.rootDirHandle.name : '(no project)');
  const cmtId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cmtOk = (c) => !!c && typeof c.id === 'string' && typeof c.file === 'string' && typeof c.quote === 'string' && typeof c.text === 'string' && Number.isInteger(c.start) && Number.isInteger(c.end) && c.start >= 0 && c.end >= c.start && Number.isFinite(c.at);
  function cmtLoad() {
    const k = cmtKey(); if (CMT.key === k) return CMT.list;
    CMT.key = k; CMT.list = [];
    const rd = (key) => { let raw = null; try { raw = localStorage.getItem(key); const v = raw === null ? [] : JSON.parse(raw); return { raw, v: Array.isArray(v) ? v : null }; } catch (e) { return { raw, v: null }; } };
    const m = rd(k);
    if (m.v && m.v.every(cmtOk)) { CMT.list = m.v; return CMT.list; }
    if (m.raw === null) return CMT.list;
    try { localStorage.setItem(k + ':damaged', m.raw); } catch (e) { /* best-effort: keep the unreadable text aside for manual recovery */ }
    const keep = (m.v || []).filter(cmtOk), b = rd(k + ':bak');
    if (keep.length || !b.v) { CMT.list = keep; toast(keep.length ? 'Some saved comments were damaged and skipped: a copy was kept in browser storage' : 'Saved comments could not be read: a copy of the damaged data was kept'); }
    else { CMT.list = b.v.filter(cmtOk); toast('Saved comments were damaged: restored from the last good backup'); }
    return CMT.list;
  }
  function cmtSave() {
    const k = CMT.key || cmtKey(), s = JSON.stringify(CMT.list);
    try {
      const p = localStorage.getItem(k);   // keep the previous good copy so a damaged or failed write never costs every comment
      try { if (p && p !== s && JSON.parse(p).every(cmtOk)) localStorage.setItem(k + ':bak', p); } catch (e) { /* backup is best-effort */ }
      localStorage.setItem(k, s);
      if (localStorage.getItem(k) !== s) throw new Error('verify');
    } catch (e) { toast('Could not save comments (browser storage unavailable or full)'); }
  }
  function cmtLocate(c, t) {   // -> { start, end } in text t, or null when the anchor can't be found unambiguously
    if (!c.quote) return null;
    if (t.slice(c.start, c.end) === c.quote) return { start: c.start, end: c.end };
    const at = []; let i = -1;
    while ((i = t.indexOf(c.quote, i + 1)) >= 0 && at.length < 500) at.push(i);
    if (!at.length) return null;
    if (at.length === 1) return { start: at[0], end: at[0] + c.quote.length };
    const score = (p) => {   // how much of the stored context still surrounds this occurrence
      let b = 0, a = 0; const B = c.before || '', A = c.after || '', e = p + c.quote.length;
      while (b < B.length && t[p - 1 - b] === B[B.length - 1 - b]) b++;
      while (a < A.length && t[e + a] === A[a]) a++;
      return a + b;
    };
    const sc = at.map(score), best = Math.max(...sc);
    if (best === 0 || sc.indexOf(best) !== sc.lastIndexOf(best)) return null;   // ambiguous: mark unresolved
    const p = at[sc.indexOf(best)]; return { start: p, end: p + c.quote.length };
  }
  function cmtSync(now) {   // re-anchor this file's comments against ctx.SRC, refresh gutter marks / highlights / panel
    clearTimeout(CMT.timer); CMT.timer = 0; cmtLoad(); if (!now && !CMT.list.length) return;
    const f = cmtFile(); let dirty = false;
    CMT.lines = new Set(); CMT.ranges = []; indexSrc();
    CMT.list.forEach((c) => {
      if (c.file !== f) return;
      const r = cmtLocate(c, ctx.SRC);
      if (!r) { if (!c.bad) { c.bad = true; dirty = true; } return; }
      if (c.bad || r.start !== c.start || r.end !== c.end) { Object.assign(c, { start: r.start, end: r.end, bad: false, before: ctx.SRC.slice(Math.max(0, r.start - 40), r.start), after: ctx.SRC.slice(r.end, r.end + 40) }); dirty = true; }
      if (c.done) return;   // resolved comments keep their anchor but are no longer marked in the editor
      CMT.ranges.push(r);
      for (let n = lineOf(r.start), z = lineOf(Math.max(r.start, r.end - 1)); n <= z; n++) CMT.lines.add(n);
    });
    if (!CMT.show) CMT.lines = new Set();
    if (dirty) cmtSave();
    ensureWindow(true); cmtRender();
  }
  function cmtSchedule() { if (CMT.list.length || CMT.key !== cmtKey()) { clearTimeout(CMT.timer); CMT.timer = setTimeout(() => cmtSync(), 250); } }
  function paintCmt() {   // exact-range underline via the CSS Custom Highlight API (gutter marker is the fallback)
    if (!HAS_HL) return; CSS.highlights.delete('cmt-hit');
    if (!CMT.show || !CMT.ranges.length) return;
    const hit = new Highlight();
    CMT.ranges.forEach((r) => {
      for (let n = Math.max(lineOf(r.start), ctx.WIN.a), z = Math.min(lineOf(Math.max(r.start, r.end - 1)), ctx.WIN.b); n <= z; n++) {
        const sp = $(`.ln[data-n="${n}"] > span`, $('#codeHighlight')); if (!sp || sp.textContent.length !== ctx.LINES[n].length) continue;
        const a = Math.max(r.start, ctx.LINE_START[n]) - ctx.LINE_START[n], b = Math.min(r.end, ctx.LINE_START[n] + ctx.LINES[n].length) - ctx.LINE_START[n];
        const w = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT); let node, off = 0, rg = null;
        while ((node = w.nextNode())) {
          const l = node.nodeValue.length;
          if (!rg && a < off + l) { rg = document.createRange(); rg.setStart(node, a - off); }
          if (rg && b <= off + l) { rg.setEnd(node, b - off); break; }
          off += l;
        }
        if (rg && !rg.collapsed) hit.add(rg);
      }
    });
    CSS.highlights.set('cmt-hit', hit);
  }
  function cmtMove(a, b, copy) {   // rename/Save As: comments follow the file to its new path; copy = the original file stays, so it keeps its own
    cmtLoad(); if (copy) CMT.list = CMT.list.filter((c) => c.file !== b);
    const add = []; CMT.list.forEach((c) => { if (c.file === a) { if (copy) add.push(Object.assign({}, c, { id: cmtId(), file: b })); else c.file = b; } });
    if (add.length || (!copy && CMT.list.some((c) => c.file === b))) { CMT.list.push(...add); cmtSave(); }
  }
  function cmtShow(on) {
    CMT.show = on; $('#cmtPanel').hidden = !on; cmtSync(true);
    if (on && !cmtLoad().length) toast('No comments yet. Select text and use New Comment');
  }
  function cmtGo(c) {
    const open = () => {
      if (c.bad) return toast('This comment is detached: its text was changed or removed. Re-anchor or delete it');
      const ta = $('#codeInput'); goToLine(lineOf(c.start)); ta.focus(); ta.setSelectionRange(c.start, c.end); setCurLine(lineOf(c.start));
    };
    if (c.file === cmtFile()) return open();
    const n = findNode(c.file); if (!n) return toast('The file for this comment is no longer in the project');
    openFileNode(n).then(open);
  }
  function cmtRender() {
    const p = $('#cmtPanel'); if (!p || p.hidden) return;
    const f = cmtFile(), all = cmtLoad(), L = all.filter((c) => !(ctx.PREFS.cmtHideDone && c.done)).sort((x, y) => (x.file === f ? 0 : 1) - (y.file === f ? 0 : 1) || x.start - y.start), body = $('.cmtpanel__body', p);
    $('.cmtpanel__title', p).textContent = 'Comments (' + all.filter((c) => !c.done).length + ' open' + (all.some((c) => c.done) ? ' · ' + all.filter((c) => c.done).length + ' resolved' : '') + ')';
    body.innerHTML = L.length ? '' : '<p class="cmt__empty">' + (all.length ? 'All comments are resolved. Clear “Hide resolved” to see them.' : 'No comments yet. Select text in the editor, then choose New Comment.') + '</p>';
    L.forEach((c) => {
      const q = c.quote.replace(/\s+/g, ' ').trim(), card = h(`<div class="cmt${c.bad ? ' cmt--bad' : ''}${c.done ? ' cmt--done' : ''}" tabindex="0"><div class="cmt__q">${esc(q.length > 70 ? q.slice(0, 70) + '…' : q)}</div><div class="cmt__t">${esc(c.text)}</div><div class="cmt__m">${c.file !== f ? esc(c.file.split('/').pop()) + ' · ' : ''}${c.bad ? '<b>Detached</b> · ' : ''}${c.done ? 'Resolved · ' : ''}${esc(new Date(c.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}<span class="sp"></span></div></div>`), m = $('.cmt__m', card);
      const btn = (l, fn) => { const b = h(`<button class="cmt__b">${l}</button>`); b.onclick = (e) => { e.stopPropagation(); fn(); }; m.append(b); };
      btn('Edit', () => {
        const t = $('.cmt__t', card); t.innerHTML = `<textarea class="cmt__edit">${esc(c.text)}</textarea>`; const ta = $('textarea', t); ta.focus();
        const done = (ok) => { ta.onblur = null; if (ok && ta.value.trim()) { c.text = ta.value.trim(); cmtSave(); } cmtRender(); };
        ta.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) done(true); };
        ta.onblur = () => done(true); ta.onclick = (e) => e.stopPropagation();
      });
      if (c.bad && c.file === f) btn('Re-anchor', () => {
        const ta = $('#codeInput'), a = ta.selectionStart, z = ta.selectionEnd;
        if (!ta.value.slice(a, z).trim()) return toast('Select the new text for this comment first');
        Object.assign(c, { start: a, end: z, quote: ta.value.slice(a, z), before: ta.value.slice(Math.max(0, a - 40), a), after: ta.value.slice(z, z + 40), bad: false }); cmtSave(); cmtSync(true);
      });
      btn(c.done ? 'Reopen' : 'Resolve', () => { c.done = !c.done; cmtSave(); cmtSync(true); });
      btn('Delete', () => { CMT.list = CMT.list.filter((x) => x !== c); cmtSave(); cmtSync(true); });
      card.onclick = () => cmtGo(c); card.onkeydown = (e) => { if (e.key === 'Enter' && e.target === card) cmtGo(c); };
      body.append(card);
    });
  }
  function commentDialog() {   // Insert/Review ▸ New Comment: the existing D.comment dialog, now saving to the comment store
    const ta = $('#codeInput'); if (!ta) return;
    if (ctx.PROJECT.length && !ctx.activePath) return toast('Open a file to add a comment');
    const t0 = ta.value, a = ta.selectionStart, z = ta.selectionEnd, hasSel = !!t0.slice(a, z).trim();
    indexSrc(); const ln = lineOf(a), lineA = ctx.LINE_START[ln], lineZ = lineA + ctx.LINES[ln].length;
    const para = () => { let x = ln, y = ln; while (x > 0 && ctx.LINES[x - 1].trim()) x--; while (y < ctx.LINES.length - 1 && ctx.LINES[y + 1].trim()) y++; return [ctx.LINE_START[x], ctx.LINE_START[y] + ctx.LINES[y].length]; };
    const spec = D.comment(); spec.focus = 'textarea'; const d = dlg(spec); $('.demo-note', d.el)?.remove();
    const sel = $('select', d.el), txt = $('textarea', d.el);
    sel.innerHTML = hasSel ? '<option>Selected text</option>' : `<option>Current line (${ln + 1})</option><option>Whole paragraph</option>`; sel.disabled = hasSel;
    const go = () => {
      const text = txt.value.trim(); if (!text) { txt.focus(); return toast('Write a comment first'); }
      if (ta.value !== t0) { d.close(); return toast('The source changed. Place the cursor and try again'); }
      let s, e; if (hasSel) [s, e] = [a, z]; else if (sel.selectedIndex === 0) [s, e] = [lineA, lineZ]; else [s, e] = para();
      const q = t0.slice(s, e); if (!q.trim()) return toast('That line is empty. Select some text to comment on');
      if (q.length > 5000) return toast('Select a shorter passage (under 5000 characters)');
      cmtLoad().push({ id: cmtId(), file: cmtFile(), start: s, end: e, quote: q, before: t0.slice(Math.max(0, s - 40), s), after: t0.slice(e, e + 40), text, at: Date.now(), bad: false });
      cmtSave(); d.close(); CMT.show = true; $('#cmtPanel').hidden = false; cmtSync(true); toast('Comment added');
    };
    $('.dlg__foot .btn--primary', d.el).onclick = go;
    txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(); });
  }
  const FIND = { matches: [], lens: [], idx: -1, sel: null, err: '' };   // sel: [start, end] while "In selection" is on
  const findOn = (id) => $('#' + id).classList.contains('is-on');
  function buildFindRe() {
    const q = $('#findInput').value; FIND.err = ''; if (!q) return null;
    let s = findOn('findRe') ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (findOn('findWord')) s = `\\b(?:${s})\\b`;
    try { return new RegExp(s, 'gm' + (findOn('findCase') ? '' : 'i')); } catch (e) { FIND.err = e.message.replace(/^Invalid regular expression: /, ''); return null; }
  }
  function scanFind() {   // every non-empty match inside the search range (whole file, or the selection), capped so a runaway pattern can't freeze the editor
    const re = buildFindRe(), out = []; if (!re) return out;
    const a = findOn('findSel') && FIND.sel ? Math.min(FIND.sel[0], ctx.SRC.length) : 0, b = findOn('findSel') && FIND.sel ? Math.min(FIND.sel[1], ctx.SRC.length) : ctx.SRC.length;
    let m; re.lastIndex = a;
    while (out.length < 20000 && (m = re.exec(ctx.SRC)) && m.index < b) { if (!m[0]) re.lastIndex++; else if (m.index + m[0].length <= b) out.push(m); }
    return out;
  }
  function runFind(from) {   // from (number): select the first match at/after that offset, else the first match
    const ms = scanFind();
    FIND.matches = ms.map((m) => m.index); FIND.lens = ms.map((m) => m[0].length); FIND.q = $('#findInput').value;
    FIND.idx = ms.length ? Math.max(0, typeof from === 'number' ? FIND.matches.findIndex((p) => p >= from) : 0) : -1;
    renderCode(); updateFindUI();
    if (FIND.idx >= 0) scrollToMatch();
  }
  function scrollToMatch() { const p = FIND.matches[FIND.idx], n = lineOf(p); goToLine(n, p - ctx.LINE_START[n], FIND.lens[FIND.idx]); }
  function stepMatch(dir) {
    if (!FIND.matches.length) return;
    FIND.idx = (FIND.idx + dir + FIND.matches.length) % FIND.matches.length;
    renderCode(); updateFindUI(); scrollToMatch();
  }
  function updateFindUI() {
    const n = FIND.matches.length, has = n > 0, c = $('#findCount');
    c.textContent = FIND.err || (FIND.q ? (has ? `${FIND.idx + 1} of ${n}` : 'No results') : '');
    c.title = FIND.err; c.classList.toggle('is-bad', !!FIND.err); $('#findInput').classList.toggle('is-bad', !!FIND.err);
    $('#findPrev').disabled = $('#findNext').disabled = $('#replaceOne').disabled = !has;
    $('#replaceAll').disabled = !has;
  }
  function findReplace(ms) {   // replace the given matches in ONE history step; comment anchors are shifted, outline/footnotes/track-changes refresh via renderCode
    const rx = findOn('findRe'), rep = $('#replaceInput').value, ta = $('#codeInput'), es = [];
    let out = '', last = 0;
    ms.forEach((m) => {   // regex mode expands $&, $1.. and $<name>; plain mode inserts the text literally
      const t = rx ? rep.replace(/\$([$&]|\d{1,2}|<(\w+)>)/g, (s, k, nm) => k === '$' ? '$' : k === '&' ? m[0] : nm ? (m.groups && m.groups[nm]) || '' : (m[+k] !== undefined ? m[+k] : s)) : rep;
      out += ctx.SRC.slice(last, m.index) + t; es.push([m.index, m[0].length, t.length]); last = m.index + m[0].length;
    });
    out += ctx.SRC.slice(last);
    historyRecord(ctx.SRC, ta ? ta.selectionStart : 0, ta ? ta.selectionEnd : 0, false);
    const old = ctx.SRC; ctx.SRC = out; if (ta) ta.value = ctx.SRC;
    const f = cmtFile(), shift = (p) => es.reduce((d, [q, ol, nl]) => q + ol <= p ? d + nl - ol : d, 0);
    cmtLoad().forEach((c) => {   // comments untouched by an edit move with the text; ones overlapping an edit keep their quote and re-anchor (or flag) as usual
      if (c.file !== f || c.bad || es.some(([q, ol]) => q < c.end && q + ol > c.start)) return;
      const d = shift(c.start); if (!d) return;
      c.start += d; c.end += d; c.before = ctx.SRC.slice(Math.max(0, c.start - 40), c.start); c.after = ctx.SRC.slice(c.end, c.end + 40);
    });
    if (CMT.list.length) cmtSave();
    if (FIND.sel) FIND.sel[1] += ctx.SRC.length - old.length;   // keep "In selection" covering the edited range
    syncSaveSoon();
    return es;
  }
  function replaceCurrent() {
    if (!FIND.matches.length) return;
    const m = scanFind().find((x) => x.index === FIND.matches[FIND.idx]); if (!m) return runFind(0);
    const [[pos, , len]] = findReplace([m]);
    runFind(pos + len); cmtSync(true);
  }
  function replaceAllMatches() {
    const ms = scanFind(); if (!ms.length) return;
    findReplace(ms); runFind(0); cmtSync(true);
    toast(`Replaced ${ms.length} match${ms.length === 1 ? '' : 'es'}: Ctrl+Z undoes all`);
  }
  function toggleFindPanel(force) {
    const p = $('#findPanel'), show = typeof force === 'boolean' ? force : p.hidden;
    closePop(); p.hidden = !show;
    if (show) { $('#findInput').focus(); $('#findInput').select(); runFind(); }
    else { FIND.matches = []; FIND.idx = -1; FIND.sel = null; $('#findSel').classList.remove('is-on'); $('#findSel').setAttribute('aria-pressed', 'false'); renderCode(); }   // renderCode -> paintFind clears the ranges
  }


  RPE.editor = {
    CMT, FIND, FP, HD_LEVELS, TRK, balanced, chartDialog, clipPaste,
    cmtRender, cmtSchedule, cmtShow, colsApply, commentDialog, compareDialog,
    ensurePackage, eqDialog, eqInsert, eqMode, fmtBreak, fmtCase, fmtClear,
    fmtColor, fmtEdit, fmtFont, fmtList, fmtMulti, fmtPara, fmtSize,
    fmtToggle, fnInsert, fnSchedule, fnToggle, fontLoad, fontOK, fontRaw,
    fontRole, fpApply, fpSet, fpToggle, headState, headingApply, headingDialog,
    hfDialog, hfQuick, lblDialog, linkDialog, listInsert, listUpdate,
    paLayoutCommit, pagAct, pageDialog, pageQuick, paintCmt, paintTrk,
    paraDialog, pdDialog, pictureDialog, replaceAllMatches, replaceCurrent,
    runFind, stepMatch, styleCss, symbolDialog, syncFmtBtns, tableDialog,
    tbApply, tbCmd, tbDialog, tbEsc, tbRead, tbUnesc, themeApply, themeMenu,
    themeWant, tocDepth, tocGo, tocInsert, tocUpdate, toggleFindPanel, trkPick,
    trkSchedule, trkToggle, xrDialog, toggleLineComment,
    PALETTES, getActivePalette, setActivePalette, themeMatrix, tintColor, shadeColor, hexToRgb, rgbToHex,
    // Extra exports for explorer.js
    needsXeTeX, get fontSet() { return fontSet; }, get fontBundled() { return fontBundled; }, cmtMove, cmtLoad, cmtSave,
    HD_RE, HF_RE, PD_RE, THEME_HEAD, sectRe, sectOurs, THEME_ROLES, docDiffEdit
  };
})(window.RPE = window.RPE || {});