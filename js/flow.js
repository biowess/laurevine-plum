/* flow.js: Laurevine Plum SVG Flow diagram editor, TikZ exporter, and .diagram.json handler.
   Exposes window.RPE.flow. */
(function (RPE) {
  'use strict';

  const { $, $$, esc, h, paint, toast, dlg, texEsc, menu, openPop, closePop, colorPanel } = RPE.ui;

  const FLOW_KEY = 'lplum.flow';
  /* type: [default width, default height, default text, label] */
  const FLOW_TYPES = {
    rect: [120, 60, 'Process', 'Process'], diamond: [120, 80, 'Decision?', 'Decision'], ellipse: [120, 60, 'Start', 'Ellipse'],
    rounded: [120, 60, 'Process', 'Rounded rectangle'], terminator: [120, 50, 'Start / End', 'Start / End (terminator)'],
    parallelogram: [130, 60, 'Input / Output', 'Input / Output'], subprocess: [130, 60, 'Subroutine', 'Predefined process'],
    document: [120, 70, 'Document', 'Document'], manual: [120, 60, 'Manual input', 'Manual input'],
    hexagon: [130, 60, 'Prepare', 'Preparation (hexagon)'], cylinder: [100, 80, 'Database', 'Database'],
    triangle: [100, 80, '', 'Triangle'], callout: [140, 70, 'Note', 'Callout'], text: [100, 30, 'Text', 'Text annotation']
  };
  const SHAPE_GROUPS = [['Basic', ['rect', 'rounded', 'ellipse', 'triangle', 'callout', 'text']], ['Flowchart', ['terminator', 'diamond', 'parallelogram', 'subprocess', 'document', 'manual', 'hexagon', 'cylinder']]];
  const TK = 10 / 12 / (0.02 * 28.45), LBL = 10 / (0.02 * 28.45), LW = 0.267 / (0.02 * 28.45), SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
  const QUICK = ['rect', 'rounded', 'diamond', 'ellipse', 'terminator'], RADIUS_TYPES = ['rect', 'rounded'];

  /* ---------- lightweight inline SVG icons (24px grid, shared stroke weight) ---------- */
  const ICO = {
    select: '<path d="M5 3v16l4.2-3.8 2.8 6 2.4-1.1-2.8-5.9H17z" fill="currentColor" fill-opacity=".18"/>',
    move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
    pan: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    line: '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M6.5 17.5l11-11"/>',
    arrow: '<path d="M3 21L15.5 8.5"/><path d="M21 3l-1.4 8.6-7.2-7.2z" fill="currentColor"/>',
    straight: '<path d="M4 19L20 5"/>', elbow: '<path d="M3 18h7V6h8"/><path d="M16 3l4 3-4 3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    dup: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
    front: '<rect x="3" y="3" width="12" height="12" rx="1.5"/><rect x="9" y="9" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".35"/>',
    back: '<rect x="3" y="3" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".35"/><rect x="9" y="9" width="12" height="12" rx="1.5" style="fill:var(--surface)"/>',
    zin: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>', zout: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', shapes: '<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="7" r="4"/><path d="M3 21l4-8 4 8z"/><path d="M14 14h7v7h-7z"/>',
    caret: '<path d="M7 10l5 5 5-5"/>', code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>', more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>', insert: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M12 11v6M9 14l3 3 3-3"/>',
    load: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>', refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5"/>',
    fill: '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" fill-opacity=".4"/>', stroke: '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>', textcolor: '<path d="M5 19L12 5l7 14M8 14.5h8"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>', italic: '<path d="M10 5h8M6 19h8M14 5L10 19"/>',
    alL: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', alC: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>', alR: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
    vaT: '<path d="M4 4h16"/><rect x="8" y="8" width="8" height="6" rx="1"/>', vaM: '<path d="M4 12h16" stroke-dasharray="2 2"/><rect x="8" y="8" width="8" height="8" rx="1"/>', vaB: '<path d="M4 20h16"/><rect x="8" y="10" width="8" height="6" rx="1"/>',
    solid: '<path d="M3 12h18"/>', dashed: '<path d="M3 12h4M10 12h4M17 12h4"/>', dotted: '<path d="M4 12h.01M9 12h.01M14 12h.01M19 12h.01" stroke-width="3"/>',
    hNone: '<path d="M3 12h18"/>', hEnd: '<path d="M3 12h13"/><path d="M21 12l-6-4.2v8.4z" fill="currentColor"/>', hStart: '<path d="M8 12h13"/><path d="M3 12l6-4.2v8.4z" fill="currentColor"/>', hBoth: '<path d="M8 12h8"/><path d="M3 12l6-4.2v8.4zM21 12l-6-4.2v8.4z" fill="currentColor"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
    drop: '<path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/>', radius: '<path d="M5 20V11a6 6 0 0 1 6-6h9"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    /* shape icons */
    rect: '<rect x="3" y="6" width="18" height="12" rx="1"/>', rounded: '<rect x="3" y="6" width="18" height="12" rx="4"/>', diamond: '<path d="M12 3l9 9-9 9-9-9z"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>', terminator: '<rect x="2.5" y="7" width="19" height="10" rx="5"/>', parallelogram: '<path d="M7 6h14l-4 12H3z"/>',
    document: '<path d="M4 5h16v12c-2.7-2.2-5.3 2.2-8 0s-5.3 2.2-8 0z"/>', cylinder: '<path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3z"/><path d="M4 6c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    manual: '<path d="M3 9l18-4v13H3z"/>', hexagon: '<path d="M7 5h10l5 7-5 7H7l-5-7z"/>', triangle: '<path d="M12 4l9 16H3z"/>', callout: '<path d="M4 4h16v11h-9l-5 5v-5H4z"/>',
    subprocess: '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M6.5 6v12M17.5 6v12"/>', text: '<path d="M5 6h14M12 6v13M9 19h6"/>'
  };
  const I = (n, c) => `<svg class="fe-i${c ? ' ' + c : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[n] || ''}</svg>`;

  /* ---------- data model: shapes + connectors, with optional per-element style (absent = theme default) ---------- */
  const HEX = /^#[0-9a-f]{6}$/i, num = (v) => typeof v === 'number' && isFinite(v), r2 = (v) => Math.round(v * 100) / 100;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rng = (v, lo, hi) => (num(v) ? clamp(v, lo, hi) : undefined);
  const colOk = (v) => v === 'none' || (typeof v === 'string' && HEX.test(v));
  function cleanShape(s) {
    if (!s || !FLOW_TYPES[s.type] || typeof s.id !== 'string' || ![s.x, s.y, s.w, s.h].every(num)) return null;
    const o = { id: s.id, type: s.type, x: s.x, y: s.y, w: s.w, h: s.h, text: String(s.text || '') };
    ['fill', 'stroke', 'tc'].forEach((k) => { if (colOk(s[k])) o[k] = s[k]; });
    [['sw', 0, 12], ['fs', 6, 96], ['r', 0, 60], ['op', 0.1, 1]].forEach(([k, lo, hi]) => { const v = rng(s[k], lo, hi); if (v !== undefined) o[k] = v; });
    if (typeof s.ff === 'string' && s.ff && s.ff.length < 64) o.ff = s.ff.replace(/['"\\<>;{}]/g, '');
    if (s.b === true) o.b = true;
    if (s.it === true) o.it = true;
    if (['l', 'c', 'r'].includes(s.al)) o.al = s.al;
    if (['t', 'm', 'b'].includes(s.va)) o.va = s.va;
    return o;
  }
  function cleanConn(c, shapes) {
    if (!c || typeof c.id !== 'string' || c.from === c.to || !shapes.some((s) => s.id === c.from) || !shapes.some((s) => s.id === c.to)) return null;
    const head = ['none', 'end', 'start', 'both'].includes(c.head) ? c.head : (c.arrow ? 'end' : 'none');
    const o = { id: c.id, from: c.from, to: c.to, arrow: head !== 'none', head, text: String(c.text || '') };
    if (typeof c.color === 'string' && HEX.test(c.color)) o.color = c.color;
    const w = rng(c.width, 0.5, 12); if (w !== undefined) o.width = w;
    if (c.dash === 'dashed' || c.dash === 'dotted') o.dash = c.dash;
    if (c.route === 'elbow') o.route = 'elbow';
    if (num(c.mid)) o.mid = c.mid;
    if (['n', 'e', 's', 'w'].includes(c.sa)) o.sa = c.sa;
    if (['n', 'e', 's', 'w'].includes(c.ea)) o.ea = c.ea;
    return o;
  }
  const sanitize = (j) => {
    const shapes = j && Array.isArray(j.shapes) ? j.shapes.map(cleanShape).filter(Boolean) : [];
    return { shapes, conns: j && Array.isArray(j.conns) ? j.conns.map((c) => cleanConn(c, shapes)).filter(Boolean) : [] };
  };
  const FLOW = (() => { let j = null; try { j = JSON.parse(localStorage.getItem(FLOW_KEY)); } catch (e) { /* storage unavailable */ } return sanitize(j); })();
  const seqOf = () => FLOW.shapes.concat(FLOW.conns).reduce((m, o) => Math.max(m, parseInt(o.id.slice(1), 10) || 0), 0);
  let flowSeq = seqOf();
  const flowId = (p) => p + (++flowSeq);
  let flowClip = null;

  /* ---------- geometry ---------- */
  const PAD = 5, STUB = 18, SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }, SIDE_NAME = { n: 'north', e: 'east', s: 'south', w: 'west' };
  const kk = (s) => Math.min(s.w * 0.2, 24);
  const poly = (s) => {
    const { x, y, w, h } = s, k = kk(s), cx = x + w / 2, cy = y + h / 2;
    switch (s.type) {
      case 'diamond': return [[cx, y], [x + w, cy], [cx, y + h], [x, cy]];
      case 'parallelogram': return [[x + k, y], [x + w, y], [x + w - k, y + h], [x, y + h]];
      case 'hexagon': return [[x + k, y], [x + w - k, y], [x + w, cy], [x + w - k, y + h], [x + k, y + h], [x, cy]];
      case 'triangle': return [[cx, y], [x + w, y + h], [x, y + h]];
      case 'manual': return [[x, y + h * 0.2], [x + w, y], [x + w, y + h], [x, y + h]];
      case 'callout': return [[x, y], [x + w, y], [x + w, y + h * 0.78], [x, y + h * 0.78]];
      default: return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }
  };
  const rayPoly = (pts, cx, cy, dx, dy) => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length], ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((x1 - cx) * ey - (y1 - cy) * ex) / den, u = ((x1 - cx) * dy - (y1 - cy) * dx) / den;
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
    }
    return best === Infinity ? [cx, cy] : [cx + dx * best, cy + dy * best];
  };
  const edgePt = (s, tx, ty) => {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    if (s.type === 'ellipse') { const m = Math.hypot(dx / (s.w / 2), dy / (s.h / 2)) || 1; return [cx + dx / m, cy + dy / m]; }
    return rayPoly(poly(s), cx, cy, dx, dy);
  };
  const anchorPt = (s, side) => ({ n: [s.x + s.w / 2, s.y], e: [s.x + s.w, s.y + s.h / 2], s: [s.x + s.w / 2, s.y + s.h], w: [s.x, s.y + s.h / 2] }[side]);
  const autoSide = (a, b) => {
    const dx = b.x + b.w / 2 - a.x - a.w / 2, dy = b.y + b.h / 2 - a.y - a.h / 2;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  };
  const tidy = (pts) => {
    const o = [];
    pts.forEach((p) => { const l = o[o.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.5) o.push(p); });
    return o.filter((p, i) => { if (i === 0 || i === o.length - 1) return true; const a = o[i - 1], b = o[i + 1]; return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1])); });
  };
  const midOf = (pts) => {
    let tot = 0; for (let i = 1; i < pts.length; i++) tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const sl = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + sl >= tot / 2 && sl) { const f = (tot / 2 - acc) / sl; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; }
      acc += sl;
    }
    return pts[0];
  };
  /* connector geometry: polyline (straight or orthogonal), label point and optional bend handle */
  function route(c, A, B) {
    const acx = A.x + A.w / 2, acy = A.y + A.h / 2, bcx = B.x + B.w / 2, bcy = B.y + B.h / 2;
    if (c.route !== 'elbow') {
      const tB = c.ea ? anchorPt(B, c.ea) : [bcx, bcy], tA = c.sa ? anchorPt(A, c.sa) : [acx, acy];
      const p = c.sa ? tA : edgePt(A, tB[0], tB[1]), q = c.ea ? tB : edgePt(B, tA[0], tA[1]);
      return { pts: [p, q], label: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], mh: null };
    }
    const sa = c.sa || autoSide(A, B), ea = c.ea || autoSide(B, A), p = anchorPt(A, sa), q = anchorPt(B, ea), d1 = SIDES[sa], d2 = SIDES[ea];
    const p1 = [p[0] + d1[0] * STUB, p[1] + d1[1] * STUB], q1 = [q[0] + d2[0] * STUB, q[1] + d2[1] * STUB], hz1 = d1[0] !== 0, hz2 = d2[0] !== 0;
    let pts, mh = null;
    if (hz1 && hz2) {
      const room = d1[0] === -d2[0] && (q[0] - p[0]) * d1[0] >= 2 * STUB;
      const xm = num(c.mid) ? c.mid : room ? (p[0] + q[0]) / 2 : (d1[0] > 0 ? Math.max(p1[0], q1[0]) : Math.min(p1[0], q1[0]));
      pts = [p, [xm, p[1]], [xm, q[1]], q]; mh = { x: xm, y: (p[1] + q[1]) / 2, ax: 'x' };
    } else if (!hz1 && !hz2) {
      const room = d1[1] === -d2[1] && (q[1] - p[1]) * d1[1] >= 2 * STUB;
      const ym = num(c.mid) ? c.mid : room ? (p[1] + q[1]) / 2 : (d1[1] > 0 ? Math.max(p1[1], q1[1]) : Math.min(p1[1], q1[1]));
      pts = [p, [p[0], ym], [q[0], ym], q]; mh = { x: (p[0] + q[0]) / 2, y: ym, ax: 'y' };
    } else if (hz1) {
      pts = (q[0] - p[0]) * d1[0] > 0 && (p[1] - q[1]) * d2[1] > 0 ? [p, [q[0], p[1]], q] : [p, p1, [p1[0], q1[1]], q1, q];
    } else {
      pts = (q[1] - p[1]) * d1[1] > 0 && (p[0] - q[0]) * d2[0] > 0 ? [p, [p[0], q[1]], q] : [p, p1, [q1[0], p1[1]], q1, q];
    }
    pts = tidy(pts);
    return { pts, label: midOf(pts), mh };
  }
  const textBox = (s) => {
    const { x, y, w, h } = s, k = kk(s);
    switch (s.type) {
      case 'diamond': return [x + w * 0.25, y + h * 0.25, w * 0.5, h * 0.5];
      case 'ellipse': return [x + w * 0.146, y + h * 0.146, w * 0.708, h * 0.708];
      case 'parallelogram': return [x + k, y, w - 2 * k, h];
      case 'hexagon': return [x + k * 0.8, y, w - k * 1.6, h];
      case 'triangle': return [x + w * 0.25, y + h * 0.42, w * 0.5, h * 0.54];
      case 'manual': return [x, y + h * 0.2, w, h * 0.8];
      case 'document': return [x, y, w, h * 0.82];
      case 'cylinder': { const e = Math.min(h * 0.15, 14); return [x, y + e * 2, w, Math.max(10, h - e * 3)]; }
      case 'callout': return [x, y, w, h * 0.78];
      default: return [x, y, w, h];
    }
  };
  /* LaTeX's default look (Computer Modern); KaTeX_Main is the web fallback that ships with the equation renderer */
  const LM = "'Latin Modern Roman','LM Roman 10','CMU Serif','Computer Modern',KaTeX_Main,'Times New Roman',serif";
  const fontFam = (n) => (!n || /^(computer modern|latin modern roman)$/i.test(n) ? LM : `'${n}', ${/mono|code|cursor/i.test(n) ? 'monospace' : /sans|heros/i.test(n) ? 'sans-serif' : /caveat|pacifico/i.test(n) ? 'cursive' : 'serif'}`);
  const textCss = (s) => `font-family:${fontFam(s.ff)};font-size:${r2((s.fs || 12) * TK)}px;line-height:1.2;font-weight:${s.b ? 700 : 400};font-style:${s.it ? 'italic' : 'normal'};`;
  /* grow a shape's height when its text no longer fits (never shrinks) */
  function fitH(s) {
    const tb = textBox(s), m = document.createElement('div');
    m.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:anywhere;box-sizing:border-box;padding:${PAD}px;width:${tb[2]}px;${textCss(s)}`;
    m.textContent = s.text || ' '; document.body.append(m);
    const need = m.scrollHeight; m.remove();
    if (need > tb[3] + 0.5) s.h = Math.min(800, Math.ceil(need / (tb[3] / s.h) / 10) * 10);
  }

  /* ---------- SVG markup ---------- */
  const shapeStyle = (s, noFill) => {
    let st = '';
    if (s.fill && !noFill) st += `fill:${s.fill};`;
    if (s.stroke) st += `stroke:${s.stroke};`;
    if (s.sw !== undefined) st += `stroke-width:${r2(s.sw * LW)};`;
    return st ? ` style="${st}"` : '';
  };
  function geo(s) {
    const { x, y, w, h } = s, cx = x + w / 2, cy = y + h / 2, st = shapeStyle(s), ln = shapeStyle(s, true), f = r2;
    const P = (pts) => `<polygon class="fl-shape" points="${pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' ')}"${st}/>`;
    switch (s.type) {
      case 'ellipse': return `<ellipse class="fl-shape" cx="${f(cx)}" cy="${f(cy)}" rx="${f(w / 2)}" ry="${f(h / 2)}"${st}/>`;
      case 'rect': case 'rounded': case 'terminator': case 'text': {
        const rx = s.type === 'terminator' ? Math.min(w, h) / 2 : Math.min(s.r !== undefined ? s.r : s.type === 'rounded' ? 12 : 3, w / 2, h / 2);
        return `<rect class="fl-shape" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}"${st}/>`;
      }
      case 'subprocess': {
        const k = Math.min(w * 0.1, 12);
        return `<rect class="fl-shape" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="1"${st}/><path class="fl-shape fl-line" d="M${f(x + k)} ${f(y)}V${f(y + h)}M${f(x + w - k)} ${f(y)}V${f(y + h)}"${ln}/>`;
      }
      case 'document': {
        const d = h * 0.12;
        return `<path class="fl-shape" d="M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h - d)}Q${f(x + w * 0.75)} ${f(y + h - 3 * d)} ${f(cx)} ${f(y + h - d)}T${f(x)} ${f(y + h - d)}Z"${st}/>`;
      }
      case 'cylinder': {
        const e = Math.min(h * 0.15, 14), rx = f(w / 2), ey = f(e);
        return `<path class="fl-shape" d="M${f(x)} ${f(y + e)}A${rx} ${ey} 0 0 1 ${f(x + w)} ${f(y + e)}V${f(y + h - e)}A${rx} ${ey} 0 0 1 ${f(x)} ${f(y + h - e)}Z"${st}/><path class="fl-shape fl-line" d="M${f(x)} ${f(y + e)}A${rx} ${ey} 0 0 0 ${f(x + w)} ${f(y + e)}"${ln}/>`;
      }
      case 'callout':
        return `<path class="fl-shape" d="M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h * 0.78)}H${f(x + w * 0.38)}L${f(x + w * 0.14)} ${f(y + h)}L${f(x + w * 0.22)} ${f(y + h * 0.78)}H${f(x)}Z"${st}/>`;
      default: return P(poly(s));
    }
  }
  const txtHtml = (s) => {
    const tb = textBox(s), jc = { t: 'flex-start', m: 'center', b: 'flex-end' }[s.va || 'm'], al = { l: 'left', c: 'center', r: 'right' }[s.al || 'c'];
    return `<foreignObject class="fl-fo" x="${r2(tb[0])}" y="${r2(tb[1])}" width="${r2(tb[2])}" height="${r2(tb[3])}"><div class="fl-tx" style="${textCss(s)}color:${s.tc || '#000'};text-align:${al};justify-content:${jc};padding:${PAD}px">${esc(s.text)}</div></foreignObject>`;
  };
  /* open barbed tip like TikZ's default '->' arrow */
  const headPath = (tip, from, dw) => {
    const dx = tip[0] - from[0], dy = tip[1] - from[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, L = 5.5 + 2 * dw, W = L * 0.42;
    const q = (a, b) => r2(tip[0] + ux * a - uy * b) + ' ' + r2(tip[1] + uy * a + ux * b);
    return `M${q(-L, -W)}C${q(-L * 0.55, -W * 0.35)} ${q(-L * 0.2, -W * 0.08)} ${q(0, 0)}C${q(-L * 0.2, W * 0.08)} ${q(-L * 0.55, W * 0.35)} ${q(-L, W)}`;
  };
  const ptsD = (pts) => 'M' + pts.map((p) => r2(p[0]) + ' ' + r2(p[1])).join('L');
  function connMarkup(c, g, on, dim, z, hideLabel) {
    const w = c.width || 1.5, dw = r2(w * LW), col = c.color || '#000', hd = c.head || 'none', pts = g.pts.map((p) => p.slice()), n = pts.length;
    let heads = '';
    const mk = (iT, iF) => { heads += `<path class="fl-head" d="${headPath(g.pts[iT], g.pts[iF], dw)}" style="stroke:${col};stroke-width:${dw}"/>`; };
    if (hd === 'end' || hd === 'both') mk(n - 1, n - 2);
    if (hd === 'start' || hd === 'both') mk(0, 1);
    const dash = c.dash === 'dashed' ? '5.27 5.27' : c.dash === 'dotted' ? `${dw} 3.51` : '';
    const full = ptsD(g.pts), lbl = c.text && !hideLabel ? `<text class="fl-clabel" x="${r2(g.label[0])}" y="${r2(g.label[1])}" text-anchor="middle" dominant-baseline="central" style="font-size:${r2(LBL)}px;font-family:${LM}">${esc(c.text)}</text>` : '';
    return `<g class="fl-c${on ? ' is-sel' : ''}" data-c="${c.id}"${dim ? ' style="opacity:.3"' : ''}>${on ? `<path class="fl-halo" d="${full}" style="stroke-width:${dw + 7}"/>` : ''}<path class="fl-hit" d="${full}" style="stroke-width:${Math.max(12, 10 / z)}"/><path class="fl-conn" d="${ptsD(pts)}" style="stroke:${col};stroke-width:${dw}${dash ? ';stroke-dasharray:' + dash : ''}"/>${heads}${lbl}</g>`;
  }

  /* TikZ from the diagram data: canvas px → cm (y flipped, 0.02 cm/px), one named \node per shape, one \draw per connector */
  const flowTikz = (F) => {
    const f = (v) => +v.toFixed(2), SC = 0.02, VH = 360, PT = 28.45, byId = (id) => F.shapes.find((s) => s.id === id);
    const rgb = (c) => { const n = parseInt(c.slice(1), 16); return `{rgb,255:red,${n >> 16};green,${(n >> 8) & 255};blue,${n & 255}}`; };
    const xy = (p) => `(${f(p[0] * SC)}, ${f((VH - p[1]) * SC)})`;
    const P = (x, y) => `(${f(x * SC)}, ${f((VH - y) * SC)})`, CUSTOM = ['parallelogram', 'hexagon', 'triangle', 'manual', 'subprocess', 'callout', 'cylinder', 'document'];
    const quad = (a, c, b) => `.. controls ${P(a[0] + (c[0] - a[0]) * 2 / 3, a[1] + (c[1] - a[1]) * 2 / 3)} and ${P(b[0] + (c[0] - b[0]) * 2 / 3, b[1] + (c[1] - b[1]) * 2 / 3)} .. ${P(b[0], b[1])}`;
    const isCustom = (id) => { const s = byId(id); return !!s && CUSTOM.includes(s.type); };
    /* outline of the shapes TikZ has no matching built-in for: same geometry as the canvas, so the result looks like the preview */
    const outline = (s) => {
      const { x, y, w, h } = s, cx = x + w / 2, ply = (pts) => pts.map((p) => P(p[0], p[1])).join(' -- ') + ' -- cycle';
      if (s.type === 'subprocess') { const k = Math.min(w * 0.1, 12); return `${P(x, y)} rectangle ${P(x + w, y + h)} ${P(x + k, y)} -- ${P(x + k, y + h)} ${P(x + w - k, y)} -- ${P(x + w - k, y + h)}`; }
      if (s.type === 'cylinder') {
        const e = Math.min(h * 0.15, 14), a = `x radius=${f(w / 2 * SC)}cm, y radius=${f(e * SC)}cm`;
        return `${P(x, y + e)} arc[start angle=180, end angle=0, ${a}] -- ${P(x + w, y + h - e)} arc[start angle=0, end angle=-180, ${a}] -- cycle ${P(x, y + e)} arc[start angle=180, end angle=360, ${a}]`;
      }
      if (s.type === 'document') {
        const d = h * 0.12, yb = y + h - d;
        return `${P(x, y)} -- ${P(x + w, y)} -- ${P(x + w, yb)} ${quad([x + w, yb], [x + w * 0.75, y + h - 3 * d], [cx, yb])} ${quad([cx, yb], [x + w * 0.25, y + h + d], [x, yb])} -- cycle`;
      }
      if (s.type === 'callout') return ply([[x, y], [x + w, y], [x + w, y + h * 0.78], [x + w * 0.38, y + h * 0.78], [x + w * 0.14, y + h], [x + w * 0.22, y + h * 0.78], [x, y + h * 0.78]]);
      return ply(poly(s));
    };
    const nodes = F.shapes.map((s) => {
      const tb = textBox(s), rc = (r) => `rounded corners=${f(r * SC * PT)}pt`, custom = CUSTOM.includes(s.type), op = s.op !== undefined && s.op < 1, paint = [], t = [];
      if (!(s.type === 'text' && !s.stroke) && s.stroke !== 'none' && s.sw !== 0) paint.push(s.stroke ? `draw=${rgb(s.stroke)}` : 'draw');
      if (s.fill && s.fill !== 'none') paint.push(`fill=${rgb(s.fill)}`);
      if (s.sw !== undefined && s.sw !== 1.5) paint.push(`line width=${f(s.sw * 0.267)}pt`);
      if (op) { paint.push(`fill opacity=${f(s.op)}`, `draw opacity=${f(s.op)}`); t.push(`text opacity=${f(s.op)}`); }
      t.push(`align=${{ l: 'left', r: 'right' }[s.al] || 'center'}`);
      if (s.tc && s.tc !== 'none') t.push(`text=${rgb(s.tc)}`);
      {   // always set the size and leading (1.2×) explicitly, so line spacing matches the canvas whatever the document's font size is
        const Pt = f((s.fs || 12) * 10 / 12), fam = s.ff ? String(s.ff).replace(/[^\p{L}\p{N} .+-]/gu, '') : '';
        t.push('font={\\linespread{1}' + (fam ? `\\fontspec{${fam}}` : '') + `\\fontsize{${Pt}}{${f(Pt * 1.2)}}\\selectfont` + (s.b ? '\\bfseries' : '') + (s.it ? '\\itshape' : '') + '}');   // braces: fontspec options contain commas
      }
      if (s.text) t.push(`text width=${f(Math.max(0.5, (tb[2] - 2 * PAD) * SC))}cm`);
      const body = String(s.text || '').split('\n').map(texEsc).join(' \\\\ '), at = (x, y) => `at ${P(x, y)}`, bw = `minimum width=${f(s.w * SC)}cm`, bh = `minimum height=${f(s.h * SC)}cm`;
      const va = s.text && (s.va === 't' || s.va === 'b') ? s.va : '', tcx = tb[0] + tb[2] / 2, tcy = tb[1] + tb[3] / 2;
      const vnode = () => `  \\node[${t.concat([`anchor=${va === 't' ? 'north' : 'south'}`, 'inner sep=0pt']).join(', ')}] ${at(tcx, va === 't' ? tb[1] + PAD : tb[1] + tb[3] - PAD)} {${body}};`;
      if (!custom) {
        const kind = {
          rect: s.r ? ['rectangle', rc(s.r)] : ['rectangle'], rounded: ['rectangle', rc(s.r !== undefined ? s.r : 12)], ellipse: ['ellipse'], diamond: ['diamond'],
          terminator: ['rectangle', rc(Math.min(s.w, s.h) / 2)], text: ['rectangle']
        }[s.type] || ['rectangle'];
        if (va) return `  \\node[${kind.concat(paint, [bw, bh]).join(', ')}] (${s.id}) ${at(s.x + s.w / 2, s.y + s.h / 2)} {};\n` + vnode();
        return `  \\node[${kind.concat(paint, t, [bw, bh]).join(', ')}] (${s.id}) ${at(s.x + s.w / 2, s.y + s.h / 2)} {${body}};`;
      }
      const out = [`  \\path[${['line join=round'].concat(paint).join(', ')}] ${outline(s)};`];
      if (s.text && !va && Math.abs(tcx - (s.x + s.w / 2)) < 0.5 && Math.abs(tcy - (s.y + s.h / 2)) < 0.5) out.push(`  \\node[${t.concat([bw, bh]).join(', ')}] (${s.id}) ${at(tcx, tcy)} {${body}};`);
      else {
        out.push(`  \\node[${bw}, ${bh}] (${s.id}) ${at(s.x + s.w / 2, s.y + s.h / 2)} {};`);
        if (s.text && va) out.push(vnode());
        else if (s.text) out.push(`  \\node[${t.concat([`minimum width=${f(tb[2] * SC)}cm`, `minimum height=${f(tb[3] * SC)}cm`]).join(', ')}] ${at(tcx, tcy)} {${body}};`);
      }
      return out.join('\n');
    });
    const conns = F.conns.map((c) => {
      const A = byId(c.from), B = byId(c.to), hd = c.head || (c.arrow ? 'end' : 'none'), o = [];
      if (hd !== 'none') o.push({ end: '->', start: '<-', both: '<->' }[hd]);
      if (c.color) o.push(`draw=${rgb(c.color)}`);
      if (c.width && c.width !== 1.5) o.push(`line width=${f(c.width * 0.267)}pt`);
      if (c.dash) o.push(c.dash);
      const head = `  \\draw${o.length ? '[' + o.join(', ') + ']' : ''} `, lab = c.text ? `node[fill=white,inner sep=1pt] {${texEsc(c.text)}} ` : '';
      if ((c.route === 'elbow' || isCustom(c.from) || isCustom(c.to)) && A && B) {
        const g = route(c, A, B);
        return head + g.pts.map(xy).join(' -- ') + ';' + (c.text ? `\n  \\node[fill=white,inner sep=1pt] at ${xy(g.label)} {${texEsc(c.text)}};` : '');
      }
      const ref = (id, a) => `(${id}${a ? '.' + SIDE_NAME[a] : ''})`;
      return `${head}${ref(c.from, c.sa)} -- ${lab}${ref(c.to, c.ea)};`;
    });
    return ['\\begin{tikzpicture}'].concat(nodes, conns, ['\\end{tikzpicture}']).join('\n');
  };

  /* TikZ libraries auto-detection for shapes, arrows, positioning, calc, and explicit \usetikzlibrary calls */
  function tikzLibs(code) {
    const libs = new Set();
    if (/\b(diamond|ellipse|cylinder|regular polygon|trapezium|star|isosceles triangle)\b/.test(code)) libs.add('shapes.geometric');
    if (/\btape\b/.test(code)) libs.add('shapes.symbols');
    if (/\brectangle callout\b/.test(code)) libs.add('shapes.callouts');
    if (/\b(arrows\.meta|Stealth|Latex)\b/.test(code) || />=\s*\{?[A-Za-z]/.test(code)) libs.add('arrows.meta');
    if (/\bpositioning\b/.test(code) || /\b(above|below|left|right|above left|above right|below left|below right)\s*=\s*(?:[0-9.]+\s*(?:cm|mm|pt|em|in)\s*)?of\b/.test(code)) libs.add('positioning');
    if (/\bcalc\b/.test(code) || /\(\$[^$]+\$\)/.test(code)) libs.add('calc');
    if (/\bfit\s*=/.test(code)) libs.add('fit');
    if (/\bbackgrounds\b/.test(code) || /on background layer/.test(code)) libs.add('backgrounds');
    if (/\bmatrix of (?:math )?nodes\b/.test(code)) libs.add('matrix');
    if (/\bpattern\s*=/.test(code)) libs.add('patterns');
    if (/\b(?:drop|copy) shadow\b/.test(code)) libs.add('shadows');
    const re = /\\usetikzlibrary\s*\{([^}]*)\}/g; let m;
    while ((m = re.exec(code))) m[1].split(',').forEach((x) => { const s = x.trim(); if (s) libs.add(s); });
    return [...libs];
  }

  /* Preamble edit for a TikZ snippet: tikz via ensurePackage(), plus auto-detected TikZ libraries. */
  function flowPre(t, code) {
    const ep = (RPE.ctx && RPE.ctx.ensurePackage) || window.ensurePackage;
    if (!ep) return false;
    const pk = /\\fontspec\{/.test(code) ? ep(t, 'tikz', 'fontspec') : ep(t, 'tikz'); if (pk === false) return false;
    const libs = tikzLibs(code);
    if (!libs.length) return pk;
    const have = new Set();
    const lre = /^[ \t]*\\usetikzlibrary\s*\{([^}]*)\}/gm; let m, lastLib = -1;
    while ((m = lre.exec(t))) {
      m[1].split(',').forEach((x) => have.add(x.trim()));
      lastLib = m.index + m[0].length;
    }
    const missing = libs.filter((x) => !have.has(x) && !have.has(x.replace(/\..*$/, '')));
    if (!missing.length) return pk;
    const libStr = '\n\\usetikzlibrary{' + missing.join(', ') + '}';
    if (pk) return { pos: pk.pos, str: pk.str + libStr };
    if (lastLib > 0) return { pos: lastLib, str: libStr };
    const bd = t.indexOf('\\begin{document}');
    const ure = /^[ \t]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\}/gm; let lastPkg = -1;
    while ((m = ure.exec(t))) lastPkg = m.index + m[0].length;
    const pos = lastPkg > 0 ? lastPkg : (t.indexOf('\\documentclass') >= 0 ? t.indexOf('\n', t.indexOf('\\documentclass')) : -1);
    return pos < 0 || (bd >= 0 && pos > bd) ? false : { pos, str: libStr };
  }

  function diagramRef(t, pos) {
    const re = /\\input\{(figures\/[^\/{}]+\.tex)\}/g; let m;
    while ((m = re.exec(t))) {
      const a = m.index, b = a + m[0].length;
      if (a <= pos && pos <= b) return m[1];
    }
    return null;
  }

  /* ---------- editor markup ---------- */
  const tb = (kind, v, icon, title, extra) => `<button class="fe-b" type="button" data-${kind}="${v}"${extra || ''} title="${title}" aria-label="${title}">${I(icon)}</button>`;
  const lb = (kind, v, icon, label, title, extra) => `<button class="fe-b fe-b--lg" type="button" data-${kind}="${v}"${extra || ''} title="${title}" aria-label="${title}">${I(icon)}<span class="fe-bl">${label}</span></button>`;
  const tg = (k, v, icon, title) => `<button class="fe-b" type="button" data-k="${k}" data-v="${v}" title="${title}" aria-label="${title}">${I(icon)}</button>`;
  const sw = (p, icon, title) => `<button class="fe-b fe-sw" type="button" data-p="${p}" title="${title}" aria-label="${title}">${I(icon)}<i></i></button>`;
  const grp = (label, body, need) => `<div class="fe-grp"${need ? ` data-need="${need}"` : ''} role="group" aria-label="${label}"><div class="fe-grp__c">${body}</div><div class="fe-grp__l">${label}</div></div>`;
  const row = (...a) => `<div class="fe-row">${a.join('')}</div>`, col = (...a) => `<div class="fe-col">${a.join('')}</div>`;
  const opts = (a) => a.map((v) => `<option value="${v}">${v}</option>`).join('');
  const FLOW_UI = `<div class="fe">
<div class="fe-rib fe-top" role="toolbar" aria-label="Diagram tools">
${grp('Select', lb('tool', 'select', 'select', 'Select', 'Select (V): click, Shift-click or drag a box') + lb('tool', 'move', 'move', 'Move', 'Move (M): drag shapes') + lb('tool', 'pan', 'pan', 'Pan', 'Pan (H or hold Space): drag the canvas'))}
${grp('Shapes', col(row(QUICK.map((t) => tb('tool', t, t, FLOW_TYPES[t][3])).join('')), `<button class="fe-b fe-b--wide fe-b--pick" type="button" data-act="shapes" title="More shapes" aria-label="More shapes" aria-haspopup="menu">${I('shapes')}<span class="fe-bl">More shapes</span>${I('caret', 'fe-i--s')}</button>`))}
${grp('Connectors', lb('tool', 'line', 'line', 'Line', 'Line connector (L): drag from one shape to another') + lb('tool', 'arrow', 'arrow', 'Arrow', 'Arrow connector (A): drag from one shape to another'))}
${grp('Edit', col(row(tb('act', 'undo', 'undo', 'Undo (Ctrl+Z)') + tb('act', 'redo', 'redo', 'Redo (Ctrl+Y)') + tb('act', 'dup', 'dup', 'Duplicate (Ctrl+D)') + tb('act', 'del', 'trash', 'Delete (Del)')), row(tb('act', 'front', 'front', 'Bring to front (Ctrl+])') + tb('act', 'back', 'back', 'Send to back (Ctrl+[)') + tb('act', 'more', 'more', 'More actions'))))}
${grp('View', col(row(tb('act', 'zoomOut', 'zout', 'Zoom out (Ctrl+-)') + '<button class="fe-b fe-zoom" type="button" data-act="resetView" id="flZoom" title="Reset zoom to 100% (Ctrl+0)">100%</button>' + tb('act', 'zoomIn', 'zin', 'Zoom in (Ctrl++)')), `<button class="fe-b fe-b--wide" type="button" data-act="fit" title="Fit diagram to window (Ctrl+1)">${I('fit')}<span class="fe-bl">Fit to window</span></button>`))}
${grp('Project', `<label class="fe-nl"><span>Diagram title</span><input id="flName" class="fe-name" value="flow-diagram" placeholder="flow-diagram" autocomplete="off" aria-label="Diagram name" title="Saved to figures/&lt;name&gt;.diagram.json and figures/&lt;name&gt;.tex"></label>` + lb('act', 'load', 'load', 'Open from project', 'Open a diagram from the project') + lb('act', 'save', 'save', 'Save to project', 'Save to project (figures/)'))}
${grp('Export', lb('act', 'codeToggle', 'code', 'TikZ code', 'Show or hide the TikZ code', ' id="flCodeBtn"') + lb('act', 'copyTikz', 'copy', 'Copy TikZ', 'Copy the TikZ code') + lb('act', 'ins', 'insert', 'Insert into document', 'Insert into document at the cursor', ' data-primary="1"'))}
</div>
<div class="fe-rib fe-fmt fe-ctx" role="toolbar" aria-label="Format">
${grp('Shape', col(row(sw('fill', 'fill', 'Fill color') + sw('stroke', 'stroke', 'Border color') + `<label class="fe-lab" title="Border thickness">Thickness<select class="fe-sel" data-i="sw" title="Border thickness" aria-label="Border thickness">${opts([0, 1, 1.5, 2, 3, 4, 6])}</select></label>`), row(`<label class="fe-lab" data-only="r" title="Corner radius">${I('radius')}<input class="fe-num" type="number" data-i="r" min="0" max="60" step="1" aria-label="Corner radius"></label>`, `<button class="fe-b fe-b--wide" type="button" data-p="opacity" title="Opacity" aria-label="Opacity" aria-haspopup="dialog">${I('drop')}<span class="fe-bl">Opacity</span><span class="fe-pct" id="flPct">100%</span></button>`)), 's')}
${grp('Font', col(row(`<button class="c-select fe-font" type="button" data-p="font" title="Font family" aria-label="Font family" aria-haspopup="menu"><span class="c-select__text"></span><svg class="c-select__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>`, `<button class="c-select fe-fsz" type="button" data-p="size" title="Font size" aria-label="Font size" aria-haspopup="menu"><span class="c-select__text"></span><svg class="c-select__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>`), row(tg('b', '1', 'bold', 'Bold (Ctrl+B)') + tg('it', '1', 'italic', 'Italic (Ctrl+I)') + sw('tc', 'textcolor', 'Text color'))), 's')}
${grp('Paragraph', col(row(tg('al', 'l', 'alL', 'Align text left') + tg('al', 'c', 'alC', 'Center text') + tg('al', 'r', 'alR', 'Align text right')), row(tg('va', 't', 'vaT', 'Align text to top') + tg('va', 'm', 'vaM', 'Center text vertically') + tg('va', 'b', 'vaB', 'Align text to bottom'))), 's')}
${grp('Connector', col(row(sw('ccolor', 'stroke', 'Line color') + `<select class="fe-sel" data-i="cw" title="Line thickness" aria-label="Line thickness">${opts([1, 1.5, 2, 3, 4, 6])}</select>` + tg('dash', 'solid', 'solid', 'Solid line') + tg('dash', 'dashed', 'dashed', 'Dashed line') + tg('dash', 'dotted', 'dotted', 'Dotted line')), row(tg('head', 'none', 'hNone', 'No arrowheads') + tg('head', 'end', 'hEnd', 'Arrowhead at end') + tg('head', 'start', 'hStart', 'Arrowhead at start') + tg('head', 'both', 'hBoth', 'Arrowheads at both ends') + tg('route', 'straight', 'straight', 'Straight connector') + tg('route', 'elbow', 'elbow', 'Elbow connector (drag the square handle to bend)'))), 'c')}
${grp('Line label', '<input class="fe-label" type="text" data-i="ctext" placeholder="Text on the line" maxlength="80" autocomplete="off" aria-label="Connector label">', 'c')}
${grp('Style', lb('act', 'resetStyle', 'reset', 'Reset', 'Reset to default style'), 'any')}
</div>
<div class="fe-stage"><svg class="flow-svg t-select" tabindex="0" role="application" aria-label="Flow diagram canvas"><defs><pattern id="flGrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" class="fl-gridp"/></pattern></defs><rect class="fl-bg" x="-5000" y="-5000" width="10000" height="10000"/><rect class="fl-paper" x="0" y="0" width="640" height="360"/><rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#flGrid)" pointer-events="none"/><rect class="fl-frame" x="0" y="0" width="640" height="360"/><g id="flLayer"></g></svg><div class="fe-empty" id="flEmpty"><b>Empty canvas</b><span>Pick a shape in the ribbon, then click the canvas to place it.<br>Double-click a shape to type inside it. Choose a connector tool and drag from one shape to another.</span></div><div class="fe-stat"><span id="flHint"></span></div></div>
<div class="fe-code" id="flCodeBox" hidden><div class="fl-code-head"><span class="fe-ttl">TikZ code <span class="muted" id="flNote" style="font-weight:400"></span></span><span id="flLock" class="fl-lock fl-lock--linked"></span><span class="fe-grow"></span><button class="btn btn--sm" data-act="unlock" id="flUnlockBtn" title="Clear manual lock and auto-sync with canvas" style="display:none">Clear lock</button><button class="btn btn--sm" data-act="regen" title="Regenerate the code from the canvas">Regenerate</button><button class="btn btn--sm" data-act="copy">Copy TikZ</button></div><textarea class="chcode" id="flCode" spellcheck="false" aria-label="TikZ code"></textarea></div>
</div>`;

  const flowDlgConfig = () => ({ t: 'Flow Diagram', i: 'workflow', w: 1240, cls: 'dlg--flow', btns: ['Close'], b: FLOW_UI, focus: '.flow-svg' });

  function flowDialog(diagNode) {
    const ctx = RPE.ctx || {};
    const d = dlg(flowDlgConfig()), el = d.el, $e = (s) => $(s, el), svg = $e('.flow-svg'), layer = $e('#flLayer'), stage = $e('.fe-stage'), ctxEl = $e('.fe-ctx');
    const GRID = 10, T = 6, MINW = 40, MINH = 24, SEL = '#2f7ae5';
    let tool = 'select', cx = null, drag = null, edit = null, hov = null, mouse = null, guides = [], tap = { id: '', t: 0 }, spaceDown = false, fitted = false, raf = 0, manual = false, gen = '';
    const selS = new Set(), selC = new Set(), view = { x: 0, y: 0, z: 1 }, hist = [JSON.stringify(FLOW)]; let hIdx = 0;
    const cd = $e('#flCode');
    const shp = (id) => FLOW.shapes.find((s) => s.id === id), cnn = (id) => FLOW.conns.find((c) => c.id === id);
    const snap = (v) => Math.round(v / GRID) * GRID;
    const selShapes = () => FLOW.shapes.filter((s) => selS.has(s.id)), selConns = () => FLOW.conns.filter((c) => selC.has(c.id));
    const clearSel = () => { selS.clear(); selC.clear(); };
    const selectOnly = (k, id) => { clearSel(); (k === 's' ? selS : selC).add(id); };
    const save = () => { try { localStorage.setItem(FLOW_KEY, JSON.stringify(FLOW)); } catch (e) { /* storage unavailable */ } };
    const pushState = () => { const cur = JSON.stringify(FLOW); if (cur === hist[hIdx]) return; hist.splice(hIdx + 1); hist.push(cur); hIdx++; if (hist.length > 100) { hist.shift(); hIdx--; } };
    const restore = () => { const b = JSON.parse(hist[hIdx]); FLOW.shapes = b.shapes; FLOW.conns = b.conns; clearSel(); edit = null; cx = null; save(); render(); };
    const undo = () => { if (hIdx > 0) { hIdx--; restore(); } else toast('Nothing to undo'); };
    const redo = () => { if (hIdx < hist.length - 1) { hIdx++; restore(); } else toast('Nothing to redo'); };
    const refreshCode = () => {
      const g = flowTikz(FLOW); if (!manual) { if (cd.value !== g) cd.value = g; gen = g; }
      const status = $e('#flLock'), unlk = $e('#flUnlockBtn'), note = $e('#flNote');
      if (status) {
        status.className = 'fl-lock ' + (manual ? 'fl-lock--locked' : 'fl-lock--linked');
        const nh = manual ? 'Manually edited (locked)' : 'Linked to canvas';
        if (status.dataset.s !== nh) { status.dataset.s = nh; status.textContent = nh; }
      }
      if (unlk) unlk.style.display = manual ? '' : 'none';
      cd.classList.toggle('is-manual', manual);
      $e('#flCodeBtn').classList.toggle('has-lock', manual);
      if (note) note.textContent = manual ? (g !== gen ? '(edited by hand; canvas changed)' : '(edited by hand)') : '(follows canvas)';
    };
    cd.addEventListener('input', () => { manual = true; refreshCode(); });
    const loadDiagData = (data, name) => {
      if (!data || !Array.isArray(data.shapes)) return toast('Invalid diagram data');
      const clean = sanitize(data); FLOW.shapes = clean.shapes; FLOW.conns = clean.conns; flowSeq = seqOf();
      manual = !!data.manual && typeof data.code === 'string';
      if (manual) { cd.value = data.code; gen = flowTikz(FLOW); }
      if (name && $e('#flName')) $e('#flName').value = name.replace(/\.diagram\.json$/, '').replace(/\.json$/, '');
      clearSel(); cx = null; edit = null; pushState(); save(); fit(); refreshCode();
    };
    if (diagNode && diagNode.handle) {
      (async () => {
        try {
          const raw = await (await diagNode.handle.getFile()).text();
          loadDiagData(JSON.parse(raw), diagNode.n);
          toast('Loaded “' + diagNode.n + '”');
        } catch (e) { toast('Could not load “' + diagNode.n + '”'); }
      })();
    } else if (ctx.rootDirHandle) {
      const ta = $('#codeInput');
      const r0 = ta && diagramRef(ta.value, ta.selectionStart);
      if (r0) {
        (async () => {
          try {
            const stem = r0.slice(8, r0.lastIndexOf('.')), dir = await ctx.rootDirHandle.getDirectoryHandle('figures');
            const h = await dir.getFileHandle(stem + '.diagram.json');
            loadDiagData(JSON.parse(await (await h.getFile()).text()), stem);
            toast('Editing diagram at cursor (“' + stem + '”)');
          } catch (e) { /* sidecar not found */ }
        })();
      }
    }
    /* ---------- viewport ---------- */
    const size = () => [svg.clientWidth || 800, svg.clientHeight || 480];
    const applyView = () => { const [W, H] = size(); svg.setAttribute('viewBox', `${r2(view.x)} ${r2(view.y)} ${r2(W / view.z)} ${r2(H / view.z)}`); $e('#flZoom').textContent = Math.round(view.z * 100) + '%'; };
    const zoomTo = (nz, sx, sy) => {
      const [W, H] = size(); sx = sx === undefined ? W / 2 : sx; sy = sy === undefined ? H / 2 : sy; nz = clamp(nz, 0.2, 4);
      const wx = view.x + sx / view.z, wy = view.y + sy / view.z; view.z = nz; view.x = wx - sx / nz; view.y = wy - sy / nz; applyView(); render();
    };
    function fit() {
      const [W, H] = size(); let x0 = 0, y0 = 0, x1 = 640, y1 = 360;
      if (FLOW.shapes.length) { x0 = Math.min(...FLOW.shapes.map((s) => s.x)); y0 = Math.min(...FLOW.shapes.map((s) => s.y)); x1 = Math.max(...FLOW.shapes.map((s) => s.x + s.w)); y1 = Math.max(...FLOW.shapes.map((s) => s.y + s.h)); }
      const bw = Math.max(x1 - x0, 60), bh = Math.max(y1 - y0, 40);
      view.z = clamp(Math.min((W - 64) / bw, (H - 64) / bh), 0.2, 1.5); view.x = x0 - (W / view.z - (x1 - x0)) / 2; view.y = y0 - (H / view.z - (y1 - y0)) / 2; applyView(); render();
    }
    if (window.ResizeObserver) new ResizeObserver(() => { if (!document.body.contains(el)) return; if (!fitted && svg.clientWidth > 50) { fitted = true; fit(); } else { applyView(); render(); } }).observe(stage);
    const pt = (e) => { const r = svg.getBoundingClientRect(); return [view.x + (e.clientX - r.left) / view.z, view.y + (e.clientY - r.top) / view.z]; };
    svg.addEventListener('wheel', (e) => {
      e.preventDefault(); const r = svg.getBoundingClientRect();
      zoomTo(view.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    /* ---------- snapping helpers ---------- */
    const snapAx = (ax, v, skip) => {
      const tol = T / view.z; let best = null;
      FLOW.shapes.forEach((o) => {
        if (skip.has(o.id)) return;
        (ax === 'x' ? [o.x, o.x + o.w / 2, o.x + o.w] : [o.y, o.y + o.h / 2, o.y + o.h]).forEach((l) => { const dd = l - v; if (Math.abs(dd) <= tol && (!best || Math.abs(dd) < Math.abs(best.d))) best = { d: dd, at: l }; });
      });
      return best ? [v + best.d, best.at] : [snap(v), null];
    };
    const nearAnchor = (s, px, py) => {
      let best = null, bd = 14 / view.z;
      Object.keys(SIDES).forEach((k) => { const a = anchorPt(s, k), dd = Math.hypot(a[0] - px, a[1] - py); if (dd < bd) { bd = dd; best = k; } });
      return best;
    };
    const hover = (e, px, py, skip) => {
      const t = document.elementFromPoint(e.clientX, e.clientY), g = t && t.closest ? t.closest('[data-s]') : null, s = g && shp(g.dataset.s);
      hov = s && s.id !== skip ? { id: s.id, anchor: nearAnchor(s, px, py) } : null;
    };
    const isConn = () => tool === 'line' || tool === 'arrow';
    const req = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

    /* ---------- inline text editing ---------- */
    function startEdit(k, id) {
      if (edit) commitEdit();
      const o = k === 's' ? shp(id) : cnn(id); if (!o) return;
      selectOnly(k, id);
      const ta = document.createElement('textarea'); ta.className = 'fe-edit'; ta.spellcheck = false; ta.value = o.text || ''; ta.setAttribute('aria-label', 'Edit text');
      edit = { k, id, ta, orig: o.text || '' }; stage.append(ta);
      ta.addEventListener('input', () => placeEdit());
      ta.addEventListener('blur', () => { if (edit && edit.ta === ta) commitEdit(); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); svg.focus(); }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || k === 'c')) { e.preventDefault(); commitEdit(); svg.focus(); }
        e.stopPropagation();
      });
      render(); ta.focus(); ta.select();
    }
    function placeEdit() {
      if (!edit) return;
      const { ta, k, id } = edit, o = k === 's' ? shp(id) : cnn(id); if (!o) return;
      const z = view.z, sx = (x) => (x - view.x) * z, sy = (y) => (y - view.y) * z;
      let bx, by, bw, bh, css;
      if (k === 's') { const b = textBox(o); [bx, by, bw, bh] = [sx(b[0]), sy(b[1]), b[2] * z, b[3] * z]; css = `${textCss(o)}background:#fff;color:${o.tc || '#000'};text-align:${{ l: 'left', r: 'right' }[o.al] || 'center'};padding:${PAD * z}px;font-size:${(o.fs || 12) * TK * z}px;line-height:1.2`; }
      else {
        const g = route(o, shp(o.from), shp(o.to)); bw = 150 * z; bh = 1.5 * LBL * z; bx = sx(g.label[0]) - bw / 2; by = sy(g.label[1]) - bh / 2;
        css = `font-family:${LM};font-size:${LBL * z}px;background:#fff;color:#000;text-align:center;padding:${3 * z}px`;
      }
      ta.style.cssText = `${css};left:${r2(bx)}px;top:${r2(by)}px;width:${r2(bw)}px;height:0`;
      const hh = Math.max(ta.scrollHeight + 3, k === 's' ? 0 : bh), va = k === 's' ? { t: 0, m: 0.5, b: 1 }[o.va || 'm'] : 0.5;
      ta.style.height = hh + 'px'; ta.style.top = r2(by + (k === 's' ? (bh - hh) * va : (bh - hh) / 2)) + 'px';
    }
    function commitEdit() {
      if (!edit) return; const { ta, k, id } = edit; edit = null;
      const o = k === 's' ? shp(id) : cnn(id), v = k === 's' ? ta.value : ta.value.replace(/\s*\n\s*/g, ' ');
      ta.remove();
      if (o && v !== o.text) { o.text = v; if (k === 's') fitH(o); pushState(); save(); }
      render();
    }
    function cancelEdit() { if (!edit) return; const { ta } = edit; edit = null; ta.remove(); render(); }

    /* ---------- render ---------- */
    function render() {
      const z = view.z, sh = [], cn = [], ov = [], one = selS.size + selC.size === 1, hs = 8 / z, sk = `stroke:${SEL};stroke-width:${1.5 / z}`;
      const editS = edit && edit.k === 's' ? edit.id : null, editC = edit && edit.k === 'c' ? edit.id : null;
      FLOW.shapes.forEach((s) => {
        const on = selS.has(s.id);
        sh.push(`<g class="fl-s${on ? ' is-sel' : ''}${editS === s.id ? ' is-editing' : ''}" data-s="${s.id}" data-t="${s.type}"${s.op !== undefined ? ` style="opacity:${s.op}"` : ''}><g class="fl-geo">${geo(s)}</g>${txtHtml(s)}</g>`);
        if (on) ov.push(`<rect class="fl-selbox" x="${r2(s.x)}" y="${r2(s.y)}" width="${r2(s.w)}" height="${r2(s.h)}" style="${sk};stroke-dasharray:${4 / z} ${3 / z}"/>`);
      });
      FLOW.conns.forEach((c) => {
        const A = shp(c.from), B = shp(c.to); if (!A || !B) return;
        const g = route(c, A, B), on = selC.has(c.id), dim = drag && drag.k === 'ce' && drag.id === c.id;
        cn.push(connMarkup(c, g, on, dim, z, editC === c.id));
        if (on && one && !dim && tool === 'select') {
          [[0, 's'], [g.pts.length - 1, 'e']].forEach(([i, w]) => ov.push(`<circle class="fl-ce" data-ce="${c.id}:${w}" cx="${r2(g.pts[i][0])}" cy="${r2(g.pts[i][1])}" r="${5 / z}" style="${sk}"/>`));
          if (g.mh) ov.push(`<rect class="fl-cm" data-cm="${c.id}" data-ax="${g.mh.ax}" x="${r2(g.mh.x - hs / 2)}" y="${r2(g.mh.y - hs / 2)}" width="${hs}" height="${hs}" style="${sk};cursor:${g.mh.ax === 'x' ? 'ew-resize' : 'ns-resize'}"/>`);
        }
      });
      if (selS.size === 1 && !selC.size && !edit && tool === 'select') {
        const s = shp([...selS][0]), cxm = s.x + s.w / 2, cym = s.y + s.h / 2;
        [['nw', s.x, s.y, 'nwse-resize'], ['n', cxm, s.y, 'ns-resize'], ['ne', s.x + s.w, s.y, 'nesw-resize'], ['e', s.x + s.w, cym, 'ew-resize'], ['se', s.x + s.w, s.y + s.h, 'nwse-resize'], ['s', cxm, s.y + s.h, 'ns-resize'], ['sw', s.x, s.y + s.h, 'nesw-resize'], ['w', s.x, cym, 'ew-resize']]
          .forEach(([k, hx, hy, cur]) => ov.push(`<rect class="fl-h" data-h="${k}" x="${r2(hx - hs / 2)}" y="${r2(hy - hs / 2)}" width="${hs}" height="${hs}" style="${sk};cursor:${cur}"/>`));
      }
      /* connection points and live previews */
      const dots = (s, anchor) => Object.keys(SIDES).map((k) => { const a = anchorPt(s, k); return `<circle class="fl-dot${anchor === k ? ' is-near' : ''}" cx="${r2(a[0])}" cy="${r2(a[1])}" r="${(anchor === k ? 5.5 : 4) / z}" style="stroke-width:${1.5 / z}"/>`; }).join('');
      const hovS = hov && shp(hov.id);
      if ((isConn() || (drag && drag.k === 'ce')) && hovS) ov.push(`<rect class="fl-selbox" x="${r2(hovS.x)}" y="${r2(hovS.y)}" width="${r2(hovS.w)}" height="${r2(hovS.h)}" style="${sk}"/>${dots(hovS, hov.anchor)}`);
      const prev = (A, sa, ea0, mx, my, arrow) => {
        let q, p;
        if (hovS && hovS !== A) { q = hov.anchor ? anchorPt(hovS, hov.anchor) : null; p = sa ? anchorPt(A, sa) : edgePt(A, q ? q[0] : hovS.x + hovS.w / 2, q ? q[1] : hovS.y + hovS.h / 2); q = q || edgePt(hovS, p[0], p[1]); }
        else { p = sa ? anchorPt(A, sa) : edgePt(A, mx, my); q = [mx, my]; }
        return `<circle cx="${r2(p[0])}" cy="${r2(p[1])}" r="${3.5 / z}" style="fill:${SEL};pointer-events:none"/><path d="M${r2(p[0])} ${r2(p[1])}L${r2(q[0])} ${r2(q[1])}" style="fill:none;stroke:${SEL};stroke-width:${1.5 / z};stroke-dasharray:${5 / z} ${3 / z};pointer-events:none"/>${arrow ? `<polygon points="${headPoly(q, p, 10 / z)}" style="fill:${SEL};pointer-events:none"/>` : ''}`;
      };
      if (cx) { const A = shp(cx.from); if (A) { ov.push(`<rect class="fl-selbox" x="${r2(A.x)}" y="${r2(A.y)}" width="${r2(A.w)}" height="${r2(A.h)}" style="${sk}"/>`, prev(A, cx.sa, null, cx.x, cx.y, tool === 'arrow')); } }
      if (drag && drag.k === 'ce' && drag.x !== undefined) { const c = cnn(drag.id), F = c && shp(drag.end === 's' ? c.to : c.from); if (F) ov.push(prev(F, drag.end === 's' ? c.ea : c.sa, null, drag.x, drag.y, false)); }
      if (tool in FLOW_TYPES && mouse && !drag) { const [gw, gh] = FLOW_TYPES[tool], gs = { id: 'ghost', type: tool, x: snap(mouse[0] - gw / 2), y: snap(mouse[1] - gh / 2), w: gw, h: gh, text: '' }; ov.push(`<g class="fl-ghost">${geo(gs)}</g>`); }
      guides.forEach(([k, v]) => ov.push(k === 'v' ? `<line class="fl-guide" x1="${v}" y1="-5000" x2="${v}" y2="5000" style="stroke-width:${1 / z};stroke-dasharray:${3 / z} ${3 / z}"/>` : `<line class="fl-guide" x1="-5000" y1="${v}" x2="5000" y2="${v}" style="stroke-width:${1 / z};stroke-dasharray:${3 / z} ${3 / z}"/>`));
      if (drag && drag.k === 'marquee') { const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1); ov.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(Math.abs(drag.x1 - drag.x0))}" height="${r2(Math.abs(drag.y1 - drag.y0))}" style="fill:${SEL};fill-opacity:.08;${sk};pointer-events:none"/>`); }
      layer.innerHTML = sh.join('') + cn.join('') + `<g class="fl-ov">${ov.join('')}</g>`;
      syncBar(); syncCtx(); refreshCode(); if (edit) placeEdit();
    }
    function syncBar() {
      svg.setAttribute('class', 'flow-svg ' + (spaceDown || tool === 'pan' ? 't-pan' : tool === 'move' ? 't-move' : tool === 'select' ? 't-select' : 't-draw') + (drag && drag.k === 'pan' ? ' is-panning' : ''));
      $$('[data-tool]', el).forEach((b) => b.classList.toggle('is-on', b.dataset.tool === tool));
      const pick = $e('[data-act="shapes"]'), other = tool in FLOW_TYPES && !QUICK.includes(tool);
      pick.classList.toggle('is-on', other); pick.firstElementChild.outerHTML = I(other ? tool : 'shapes');
      $e('#flCodeBtn').classList.toggle('is-on', !$e('#flCodeBox').hidden);
      const has = selS.size + selC.size > 0;
      $e('[data-act="undo"]').disabled = hIdx <= 0; $e('[data-act="redo"]').disabled = hIdx >= hist.length - 1;
      ['dup', 'del'].forEach((k) => { $e(`[data-act="${k}"]`).disabled = !has; });
      ['front', 'back'].forEach((k) => { $e(`[data-act="${k}"]`).disabled = !selS.size; });
      $e('#flEmpty').hidden = FLOW.shapes.length > 0 || tool in FLOW_TYPES || !!edit;
      $e('#flHint').textContent = edit ? 'Editing text · Ctrl+Enter or click outside to finish · Esc cancels'
        : tool in FLOW_TYPES ? 'Click the canvas to place the shape · Esc cancels'
        : isConn() ? (cx ? 'Click or release on the target shape · side dots snap to the shape edge · Esc cancels' : 'Press on a shape and drag to another shape · side dots snap the connector')
        : tool === 'pan' ? 'Drag to pan · wheel to zoom'
        : tool === 'move' ? 'Drag shapes to move them · wheel to zoom'
        : 'Click to select · Shift-click or drag a box for several · double-click to type · wheel to zoom';
    }
    const setSw = (p, col) => { const b = $e(`[data-p="${p}"]`); if (b) b.style.setProperty('--sw', col); };
    const put = (q, v) => { const n = $e(q); if (n && document.activeElement !== n) n.value = v; };
    function syncCtx() {
      const ss = selShapes(), cs = selConns(), f = ss[0] || { type: 'rect' }, c = cs[0] || {};
      const on = { s: ss.length > 0, c: cs.length > 0, any: ss.length + cs.length > 0 };
      const gate = (n, off) => { n.classList.toggle('is-off', off); n.toggleAttribute('inert', off); n.setAttribute('aria-disabled', off ? 'true' : 'false'); };
      $$('[data-need]', ctxEl).forEach((g) => { const off = !on[g.dataset.need]; gate(g, off); if (g._c) gate(g._c, off); });
      gate($e('[data-only="r"]'), on.s && !ss.some((s) => RADIUS_TYPES.includes(s.type)));
      setSw('fill', f.fill === 'none' ? 'transparent' : f.fill || 'transparent'); setSw('stroke', f.stroke === 'none' ? 'transparent' : f.stroke || '#000'); setSw('tc', f.tc || '#000');
      put('[data-i="sw"]', f.sw !== undefined ? f.sw : 1.5); { const fz = $e('.fe-fsz .c-select__text'); if (fz) fz.textContent = f.fs || 12; } put('[data-i="r"]', f.r !== undefined ? f.r : f.type === 'rounded' ? 12 : 3);
      $e('#flPct').textContent = Math.round((f.op === undefined ? 1 : f.op) * 100) + '%';
      const ft = $e('.fe-font .c-select__text'); ft.textContent = f.ff || 'Default font'; ft.style.fontFamily = f.ff ? fontFam(f.ff) : '';
      $$('[data-k="b"]', el).forEach((b) => b.classList.toggle('is-on', !!f.b)); $$('[data-k="it"]', el).forEach((b) => b.classList.toggle('is-on', !!f.it));
      $$('[data-k="al"]', el).forEach((b) => b.classList.toggle('is-on', on.s && (f.al || 'c') === b.dataset.v)); $$('[data-k="va"]', el).forEach((b) => b.classList.toggle('is-on', on.s && (f.va || 'm') === b.dataset.v));
      setSw('ccolor', c.color || '#000'); put('[data-i="cw"]', c.width || 1.5); put('[data-i="ctext"]', c.text || '');
      $$('[data-k="dash"]', el).forEach((b) => b.classList.toggle('is-on', on.c && (c.dash || 'solid') === b.dataset.v)); $$('[data-k="head"]', el).forEach((b) => b.classList.toggle('is-on', on.c && (c.head || 'none') === b.dataset.v));
      $$('[data-k="route"]', el).forEach((b) => b.classList.toggle('is-on', on.c && (c.route || 'straight') === b.dataset.v));
    }
    /* ---------- style editing ---------- */
    const TEXTKEYS = ['fs', 'ff', 'b', 'it'];
    function setStyle(kind, patch, live) {
      const list = kind === 's' ? selShapes() : selConns(); if (!list.length) return;
      list.forEach((o) => {
        Object.keys(patch).forEach((k) => { if (patch[k] === undefined || patch[k] === '') delete o[k]; else o[k] = patch[k]; });
        if ('head' in patch) o.arrow = o.head !== 'none';
        if (kind === 's' && Object.keys(patch).some((k) => TEXTKEYS.includes(k))) fitH(o);
      });
      save(); if (!live) pushState(); render();
    }
    const pickColor = (btn, kind, key, noneLabel, noneVal) => colorPanel(btn, { none: noneLabel, onPick: (hex) => { if (hex && !HEX.test(hex)) return; setStyle(kind, { [key]: hex ? hex.toUpperCase() : noneVal }); } });
    const onCtxClick = (e) => {
      const p = e.target.closest('[data-p]'), t = e.target.closest('[data-k]'); if (!p && !t) return;
      if (p) {
        const k = p.dataset.p;
        if (k === 'fill') pickColor(p, 's', 'fill', 'No fill', 'none'); else if (k === 'stroke') pickColor(p, 's', 'stroke', 'No border', 'none');
        else if (k === 'opacity') opacityPop(p);
        else if (k === 'tc') pickColor(p, 's', 'tc', 'Automatic', undefined); else if (k === 'ccolor') pickColor(p, 'c', 'color', 'Automatic', undefined);
        else if (k === 'size') { const cur = selShapes()[0]; menu(p, SIZES.map((n) => ({ l: String(n), val: n, checked: !!cur && (cur.fs || 12) === n })), (v) => setStyle('s', { fs: v })); }
        else if (k === 'font') {
          const F = RPE.fonts, first = selShapes()[0], DEF = 'Default (LaTeX font)';
          if (!F) return toast('Font list unavailable');
          Promise.resolve(F.load()).catch(() => {}).then(() => menu(p, F.menuItems({ includeNone: true, noneLabel: DEF, selected: first && first.ff }), (v) => setStyle('s', { ff: v === DEF ? '' : v })));
        }
        return;
      }
      const k = t.dataset.k, v = t.dataset.v, first = selShapes()[0];
      if (k === 'b' || k === 'it') setStyle('s', { [k]: first && first[k] ? undefined : true });
      else if (k === 'al' || k === 'va') setStyle('s', { [k]: v });
      else if (k === 'dash') setStyle('c', { dash: v === 'solid' ? undefined : v });
      else if (k === 'head') setStyle('c', { head: v });
      else if (k === 'route') setStyle('c', { route: v === 'straight' ? undefined : v, mid: undefined });
    };
    const NUMIN = { sw: ['s', 'sw', 0, 12, 1], fs: ['s', 'fs', 6, 96, 1], r: ['s', 'r', 0, 60, 1], cw: ['c', 'width', 0.5, 12, 1] };
    const onCtxInput = (e) => {
      const i = e.target.dataset.i; if (!i) return;
      if (i === 'ctext') return setStyle('c', { text: e.target.value }, true);
      const m = NUMIN[i], v = parseFloat(e.target.value); if (!m || !isFinite(v)) return;
      setStyle(m[0], { [m[1]]: clamp(v, m[2], m[3]) * m[4] }, true);
    };
    const onCtxChange = (e) => { if (e.target.dataset.i) { pushState(); save(); render(); } };
    [['click', onCtxClick], ['input', onCtxInput], ['change', onCtxChange]].forEach(([ev, fn]) => ctxEl.addEventListener(ev, fn));

    /* opacity popover: checkerboard track with a transparent → text-colour gradient and a live sample */
    function opacityPop(btn) {
      const first = selShapes()[0]; if (!first) return;
      let v = Math.round((first.op === undefined ? 1 : first.op) * 100);
      const tc = first.tc || '#000', fill = first.fill && first.fill !== 'none' ? first.fill : '#fff', bd = first.stroke && first.stroke !== 'none' ? first.stroke : '#000';
      const pop = h(`<div class="popover is-open"><div class="fe-op" style="--c:${tc}"><div class="fe-op__h"><span>Opacity</span><output class="fe-op__v"></output></div><div class="fe-op__track" tabindex="0" role="slider" aria-label="Opacity" aria-valuemin="10" aria-valuemax="100"><div class="fe-op__fill"></div><div class="fe-op__thumb"></div></div><div class="fe-op__pre"><div class="fe-op__chip" style="background:${fill};border-color:${bd};color:${tc}">Aa</div></div><div class="fe-op__btns">${[10, 25, 50, 75, 100].map((n) => `<button type="button" class="fe-op__p" data-v="${n}">${n}%</button>`).join('')}</div></div></div>`);
      const track = $('.fe-op__track', pop), thumb = $('.fe-op__thumb', pop), out = $('.fe-op__v', pop), chip = $('.fe-op__chip', pop);
      const paint = () => {
        thumb.style.left = ((v - 10) / 90 * 100) + '%'; out.textContent = v + '%'; chip.style.opacity = v / 100; track.setAttribute('aria-valuenow', v);
        $$('.fe-op__p', pop).forEach((b) => b.classList.toggle('is-on', +b.dataset.v === v));
      };
      const set = (n, live) => { v = clamp(Math.round(n), 10, 100); paint(); setStyle('s', { op: v >= 100 ? undefined : v / 100 }, live); };
      const fromX = (e) => { const r = track.getBoundingClientRect(); return 10 + clamp((e.clientX - r.left) / r.width, 0, 1) * 90; };
      let down = false;
      track.addEventListener('pointerdown', (e) => { down = true; track.setPointerCapture(e.pointerId); track.focus(); set(fromX(e), true); e.preventDefault(); });
      track.addEventListener('pointermove', (e) => { if (down) set(fromX(e), true); });
      const up = () => { if (down) { down = false; pushState(); save(); } };
      track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
      track.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -10, PageUp: 10 }[e.key];
        if (d) { e.preventDefault(); set(v + d, false); } else if (e.key === 'Home') { e.preventDefault(); set(10, false); } else if (e.key === 'End') { e.preventDefault(); set(100, false); }
      });
      pop.addEventListener('click', (e) => { const b = e.target.closest('.fe-op__p'); if (b) set(+b.dataset.v, false); });
      paint(); openPop(btn, pop, () => { pushState(); save(); });
      track.focus();
    }

    /* ---------- responsive ribbons: when a strip is too narrow, the least-used groups fold into one dropdown button each (nothing is ever hidden) ---------- */
    const GICO = { Select: 'select', Shapes: 'shapes', Connectors: 'line', Edit: 'undo', View: 'zin', Project: 'load', Export: 'code', Shape: 'fill', Font: 'textcolor', Paragraph: 'alL', Connector: 'straight', 'Line label': 'text', Style: 'reset' };
    const RIBS = [[$e('.fe-top'), 'top', ['View', 'Edit', 'Connectors', 'Select', 'Shapes', 'Export', 'Project']], [$e('.fe-fmt'), 'fmt', ['Line label', 'Paragraph', 'Style', 'Connector', 'Font', 'Shape']]];
    RIBS.forEach(([rib]) => $$('.fe-grp', rib).forEach((g) => { g._c = g.firstElementChild; }));
    let dd = null, lastW = 0, fitRaf = 0;
    function closeDD() { if (!dd) return; dd.p.hidden = true; dd.g._btn.classList.remove('is-on'); dd.g._btn.setAttribute('aria-expanded', 'false'); dd = null; }
    function openDD(g) {
      closeDD(); closePop(); const p = g._dd, fr = $e('.fe').getBoundingClientRect(), br = g._btn.getBoundingClientRect();
      p.hidden = false; p.style.left = Math.max(4, Math.min(br.left - fr.left, fr.width - p.offsetWidth - 4)) + 'px'; p.style.top = (br.bottom - fr.top + 2) + 'px';
      g._btn.classList.add('is-on'); g._btn.setAttribute('aria-expanded', 'true'); dd = { g, p };
    }
    function collapseGrp(g, kind) {
      if (g.classList.contains('is-collapsed')) return;
      const name = g.getAttribute('aria-label');
      if (!g._btn) {
        g._btn = h(`<button class="fe-b fe-b--lg fe-collapse" type="button" aria-haspopup="true" aria-expanded="false" title="${name}">${I(GICO[name] || 'more')}<span class="fe-bl">${name}</span>${I('caret', 'fe-i--s')}</button>`);
        g._btn.addEventListener('click', (e) => { e.stopPropagation(); if (dd && dd.g === g) closeDD(); else openDD(g); });
        g._dd = h(`<div class="fe-dd" data-rib="${kind}" hidden role="group" aria-label="${name}"></div>`);
        [['click', onCtxClick], ['input', onCtxInput], ['change', onCtxChange]].forEach(([ev, fn]) => g._dd.addEventListener(ev, fn));
        $e('.fe').append(g._dd);
      }
      g._dd.append(g._c); g.prepend(g._btn); g.classList.add('is-collapsed');
    }
    function expandGrp(g) { if (!g.classList.contains('is-collapsed')) return; g._btn.remove(); g.prepend(g._c); g.classList.remove('is-collapsed'); }
    function fitRibbons() {
      fitRaf = 0; if (!document.body.contains(el)) return; closeDD();
      RIBS.forEach(([rib, kind, order]) => {
        $$('.fe-grp.is-collapsed', rib).forEach(expandGrp);
        for (const n of order) {
          if (rib.scrollWidth <= rib.clientWidth + 1) break;
          const g = $$('.fe-grp', rib).find((x) => x.getAttribute('aria-label') === n); if (g) collapseGrp(g, kind);
        }
      });
    }
    const queueFit = () => { if (!fitRaf) fitRaf = requestAnimationFrame(fitRibbons); };
    if (window.ResizeObserver) new ResizeObserver(() => { const w = el.clientWidth; if (w !== lastW) { lastW = w; queueFit(); } }).observe(el); else window.addEventListener('resize', queueFit);
    el.addEventListener('pointerdown', (e) => { if (dd && !e.target.closest('.fe-dd, .fe-collapse')) closeDD(); }, true);
    queueFit();

    /* ---------- pointer interaction ---------- */
    const setTool = (t) => { closeDD(); if (edit) commitEdit(); tool = t; cx = null; hov = null; if (t in FLOW_TYPES || t === 'line' || t === 'arrow') drag = null; render(); };
    function finishConn(toId, ea) {
      const from = cx.from, sa = cx.sa, B = shp(toId); cx = null; hov = null;
      if (!B || toId === from) return;
      if (FLOW.conns.some((c) => c.from === from && c.to === toId && c.sa === sa && c.ea === ea)) { toast('These shapes are already connected'); return; }
      const arrow = tool === 'arrow', c = { id: flowId('c'), from, to: toId, arrow, head: arrow ? 'end' : 'none', text: '' };
      if (sa) c.sa = sa; if (ea) c.ea = ea;
      FLOW.conns.push(c); selectOnly('c', c.id); tool = 'select'; pushState(); save();
    }
    svg.addEventListener('pointerdown', (e) => {
      if (edit) commitEdit();
      if (e.button === 2) return;
      svg.focus();
      const [px, py] = pt(e), T0 = e.target, hd = T0.closest('[data-h]'), ce = T0.closest('[data-ce]'), cm = T0.closest('[data-cm]'), sh = T0.closest('[data-s]'), cn = T0.closest('[data-c]');
      if (e.button === 1 || tool === 'pan' || spaceDown) { drag = { k: 'pan', ox: e.clientX, oy: e.clientY, vx: view.x, vy: view.y }; svg.setPointerCapture(e.pointerId); e.preventDefault(); render(); return; }
      if (e.button) return;
      if (tool in FLOW_TYPES) {
        const [w, hh, t] = FLOW_TYPES[tool], s = { id: flowId('s'), type: tool, x: snap(px - w / 2), y: snap(py - hh / 2), w, h: hh, text: t };
        FLOW.shapes.push(s); selectOnly('s', s.id); tool = 'select'; pushState(); save(); render(); return;
      }
      if (isConn()) {
        const id = sh && sh.dataset.s, s = id && shp(id);
        if (!cx) { if (s) { cx = { from: id, sa: nearAnchor(s, px, py), x: px, y: py, down: true, cx0: e.clientX, cy0: e.clientY }; svg.setPointerCapture(e.pointerId); } }
        else if (s && id !== cx.from) finishConn(id, nearAnchor(s, px, py)); else cx = null;
        render(); return;
      }
      if (tool === 'select' && hd && selS.size === 1) {
        const s = shp([...selS][0]); drag = { k: 'resize', h: hd.dataset.h, id: s.id, o: { x: s.x, y: s.y, w: s.w, h: s.h }, px, py }; svg.setPointerCapture(e.pointerId); return;
      }
      if (tool === 'select' && ce) { const [id, end] = ce.dataset.ce.split(':'); drag = { k: 'ce', id, end }; svg.setPointerCapture(e.pointerId); return; }
      if (tool === 'select' && cm) { drag = { k: 'cm', id: cm.dataset.cm, ax: cm.dataset.ax }; svg.setPointerCapture(e.pointerId); return; }
      let dbl = false;
      if (sh) {
        const id = sh.dataset.s, s = shp(id); let collapse = null;
        if (e.shiftKey) { if (selS.has(id)) selS.delete(id); else selS.add(id); }
        else if (!selS.has(id)) selectOnly('s', id); else collapse = id;
        dbl = tap.id === id && e.timeStamp - tap.t < 400; tap = { id, t: e.timeStamp };
        if (selS.has(id) && !dbl) {
          const ids = [...selS], B = ids.map(shp);
          drag = { k: 'move', ids, collapse, px, py, cx0: e.clientX, cy0: e.clientY, moved: false, thr: tool === 'move' ? 0 : 3, orig: new Map(B.map((o) => [o.id, [o.x, o.y]])), b: [Math.min(...B.map((o) => o.x)), Math.min(...B.map((o) => o.y)), Math.max(...B.map((o) => o.x + o.w)), Math.max(...B.map((o) => o.y + o.h))] };
          svg.setPointerCapture(e.pointerId);
        }
        if (dbl && s) { drag = null; render(); setTimeout(() => startEdit('s', id), 0); return; }
      } else if (cn) {
        const id = cn.dataset.c;
        if (e.shiftKey) { if (selC.has(id)) selC.delete(id); else selC.add(id); } else selectOnly('c', id);
        dbl = tap.id === id && e.timeStamp - tap.t < 400; tap = { id, t: e.timeStamp };
        if (dbl) { render(); setTimeout(() => startEdit('c', id), 0); return; }
      } else if (tool === 'select') {
        if (!e.shiftKey) clearSel();
        drag = { k: 'marquee', x0: px, y0: py, x1: px, y1: py, add: e.shiftKey, base: [new Set(selS), new Set(selC)] }; svg.setPointerCapture(e.pointerId);
      }
      render();
    });
    svg.addEventListener('pointermove', (e) => {
      const [px, py] = pt(e); mouse = [px, py];
      if (!drag && !cx) { if (tool in FLOW_TYPES) req(); else if (isConn()) { hover(e, px, py); req(); } return; }
      if (cx && !drag) { cx.x = px; cx.y = py; hover(e, px, py, cx.from); return req(); }
      if (!drag) return;
      const k = drag.k;
      if (k === 'pan') { drag.moved = true; view.x = drag.vx - (e.clientX - drag.ox) / view.z; view.y = drag.vy - (e.clientY - drag.oy) / view.z; return applyView(); }
      if (k === 'marquee') {
        drag.x1 = px; drag.y1 = py; const x0 = Math.min(drag.x0, px), x1 = Math.max(drag.x0, px), y0 = Math.min(drag.y0, py), y1 = Math.max(drag.y0, py);
        selS.clear(); selC.clear(); drag.base[0].forEach((i) => selS.add(i)); drag.base[1].forEach((i) => selC.add(i));
        FLOW.shapes.forEach((s) => { if (s.x <= x1 && s.x + s.w >= x0 && s.y <= y1 && s.y + s.h >= y0) selS.add(s.id); });
        FLOW.conns.forEach((c) => { if (selS.has(c.from) && selS.has(c.to)) selC.add(c.id); });
        return req();
      }
      if (k === 'ce') { drag.x = px; drag.y = py; const c = cnn(drag.id); hover(e, px, py, c && (drag.end === 's' ? c.to : c.from)); return req(); }
      if (k === 'cm') { const c = cnn(drag.id); if (c) c.mid = snap(drag.ax === 'x' ? px : py); return req(); }
      if (k === 'resize') {
        const s = shp(drag.id), o = drag.o, hh = drag.h, ids = new Set([s.id]), mw = s.type === 'text' ? 20 : MINW, mh = s.type === 'text' ? 16 : MINH; guides = [];
        let l = o.x, r = o.x + o.w, t = o.y, b = o.y + o.h; const ed = (ax, v) => { const q = snapAx(ax, v, ids); if (q[1] !== null) guides.push([ax === 'x' ? 'v' : 'h', q[1]]); return q[0]; };
        if (hh.includes('e')) r = Math.max(l + mw, ed('x', r + px - drag.px)); if (hh.includes('w')) l = Math.min(r - mw, ed('x', l + px - drag.px));
        if (hh.includes('s')) b = Math.max(t + mh, ed('y', b + py - drag.py)); if (hh.includes('n')) t = Math.min(b - mh, ed('y', t + py - drag.py));
        if (e.shiftKey && hh.length === 2) {
          const ratio = o.w / o.h; let w = r - l, h2 = b - t; if (w / h2 > ratio) w = h2 * ratio; else h2 = w / ratio;
          if (hh.includes('w')) l = r - w; else r = l + w; if (hh.includes('n')) t = b - h2; else b = t + h2;
        }
        s.x = l; s.y = t; s.w = r - l; s.h = b - t; return req();
      }
      if (k === 'move') {
        if (!drag.moved) { if (Math.hypot(e.clientX - drag.cx0, e.clientY - drag.cy0) <= drag.thr) return; drag.moved = true; }
        const bw = drag.b[2] - drag.b[0], bh = drag.b[3] - drag.b[1], ids = new Set(drag.ids); let nx = snap(drag.b[0] + px - drag.px), ny = snap(drag.b[1] + py - drag.py), bx = null, by = null; guides = [];
        const tol = T / view.z;
        FLOW.shapes.forEach((o) => {
          if (ids.has(o.id)) return;
          [0, 0.5, 1].forEach((a) => {
            const dx = o.x + o.w * a - (nx + bw * a), dy = o.y + o.h * a - (ny + bh * a);
            if (Math.abs(dx) <= tol && (!bx || Math.abs(dx) < Math.abs(bx.d))) bx = { d: dx, at: o.x + o.w * a };
            if (Math.abs(dy) <= tol && (!by || Math.abs(dy) < Math.abs(by.d))) by = { d: dy, at: o.y + o.h * a };
          });
        });
        if (bx) { nx += bx.d; guides.push(['v', bx.at]); } if (by) { ny += by.d; guides.push(['h', by.at]); }
        drag.ids.forEach((id) => { const s = shp(id), o = drag.orig.get(id); s.x = o[0] + nx - drag.b[0]; s.y = o[1] + ny - drag.b[1]; });
        req();
      }
    });
    function drop(e) {
      if (cx && cx.down) {
        cx.down = false; const [px, py] = pt(e), moved = Math.hypot(e.clientX - cx.cx0, e.clientY - cx.cy0) > 6; hover(e, px, py, cx.from);
        if (moved) { if (hov) finishConn(hov.id, hov.anchor || undefined); else cx = null; }
        render(); return;
      }
      if (!drag) return;
      const k = drag.k, d0 = drag; drag = null; guides = [];
      if (k === 'move') { if (d0.moved) pushState(); else if (d0.collapse) selectOnly('s', d0.collapse); }
      else if (k === 'resize' || k === 'cm') pushState();
      else if (k === 'ce') {
        const c = cnn(d0.id), [px, py] = pt(e); if (c) {
          hover(e, px, py, d0.end === 's' ? c.to : c.from);
          if (hov) { const a = hov.anchor || undefined; if (d0.end === 's') { c.from = hov.id; if (a) c.sa = a; else delete c.sa; } else { c.to = hov.id; if (a) c.ea = a; else delete c.ea; } delete c.mid; pushState(); }
        }
        hov = null;
      }
      save(); render();
    }
    svg.addEventListener('pointerup', drop); svg.addEventListener('pointercancel', drop);
    svg.addEventListener('dblclick', (e) => {
      if (edit || isConn() || tool in FLOW_TYPES || tool === 'pan') return;
      const t = document.elementFromPoint(e.clientX, e.clientY), g = t && t.closest && t.closest('[data-s]'), c = t && t.closest && t.closest('[data-c]');
      if (g) startEdit('s', g.dataset.s); else if (c) startEdit('c', c.dataset.c);
    });
    svg.addEventListener('pointerleave', () => { if (!drag && !cx) { mouse = null; hov = null; if (tool in FLOW_TYPES) req(); } });

    /* ---------- actions ---------- */
    function dupSel() {
      const ss = selShapes(); if (!ss.length) return toast('Select a shape to duplicate (connectors can’t be duplicated alone)');
      const map = {}, ns = ss.map((s) => { const c = Object.assign({}, s, { id: flowId('s'), x: s.x + 20, y: s.y + 20 }); map[s.id] = c.id; return c; });
      const nc = FLOW.conns.filter((c) => map[c.from] && map[c.to]).map((c) => Object.assign({}, c, { id: flowId('c'), from: map[c.from], to: map[c.to] }));
      FLOW.shapes.push(...ns); FLOW.conns.push(...nc); clearSel(); ns.forEach((s) => selS.add(s.id)); nc.forEach((c) => selC.add(c.id));
    }
    function copySel() {
      const ss = selShapes(); if (!ss.length) return false;
      const ids = new Set(ss.map((s) => s.id)); flowClip = { shapes: JSON.parse(JSON.stringify(ss)), conns: JSON.parse(JSON.stringify(FLOW.conns.filter((c) => ids.has(c.from) && ids.has(c.to)))), n: 0 }; return true;
    }
    function pasteClip() {
      if (!flowClip) return toast('Nothing to paste'); const off = 20 * (++flowClip.n), map = {};
      const ns = flowClip.shapes.map((s) => { const c = Object.assign({}, s, { id: flowId('s'), x: s.x + off, y: s.y + off }); map[s.id] = c.id; return c; });
      const nc = flowClip.conns.map((c) => Object.assign({}, c, { id: flowId('c'), from: map[c.from], to: map[c.to] }));
      FLOW.shapes.push(...ns); FLOW.conns.push(...nc); clearSel(); ns.forEach((s) => selS.add(s.id)); nc.forEach((c) => selC.add(c.id));
    }
    function act(k) {
      if (edit) commitEdit();
      if (k === 'undo') return undo();
      if (k === 'redo') return redo();
      if (k === 'resetView') return zoomTo(1);
      if (k === 'zoomIn') return zoomTo(view.z * 1.25);
      if (k === 'zoomOut') return zoomTo(view.z / 1.25);
      if (k === 'fit') return fit();
      if (k === 'codeToggle') { const bx = $e('#flCodeBox'); bx.hidden = !bx.hidden; syncBar(); return applyView(); }
      if (k === 'selectAll') { FLOW.shapes.forEach((s) => selS.add(s.id)); FLOW.conns.forEach((c) => selC.add(c.id)); return render(); }
      if (k === 'paste') { pasteClip(); pushState(); save(); return render(); }
      if (k === 'copy') { return toast(copySel() ? 'Copied' : 'Select a shape to copy'); }
      if (k === 'cut') { if (!copySel()) return toast('Select a shape to cut'); return act('del'); }
      if (k === 'clear') { if (!FLOW.shapes.length) return toast('The diagram is already empty'); if (!confirm('Remove every shape and connector from the diagram?')) return; FLOW.shapes = []; FLOW.conns = []; clearSel(); cx = null; }
      else if (!selS.size && !selC.size) return toast('Select a shape or connector first');
      else if (k === 'del') {
        FLOW.shapes = FLOW.shapes.filter((s) => !selS.has(s.id)); FLOW.conns = FLOW.conns.filter((c) => !selC.has(c.id) && !selS.has(c.from) && !selS.has(c.to)); clearSel();
      } else if (k === 'dup') dupSel();
      else if (k === 'front' || k === 'back') {
        const on = FLOW.shapes.filter((s) => selS.has(s.id)), off = FLOW.shapes.filter((s) => !selS.has(s.id)); FLOW.shapes = k === 'front' ? off.concat(on) : on.concat(off);
      } else if (k === 'resetStyle') {
        const STY = ['fill', 'stroke', 'tc', 'sw', 'fs', 'r', 'op', 'ff', 'b', 'it', 'al', 'va', 'color', 'width', 'dash'];
        selShapes().concat(selConns()).forEach((o) => STY.forEach((q) => { delete o[q]; }));
      }
      pushState(); save(); render();
    }
    function shapePicker(btn) {
      const pop = h(`<div class="popover is-open"><div class="fe-pick">${SHAPE_GROUPS.map(([g, l]) => `<div class="fe-pick__h">${g}</div><div class="fe-pick__g">${l.map((t) => `<button type="button" class="fe-pick__b${tool === t ? ' is-on' : ''}" data-pick="${t}" title="${FLOW_TYPES[t][3]}">${I(t)}<span>${FLOW_TYPES[t][3].replace(/ \(.*\)/, '')}</span></button>`).join('')}</div>`).join('')}</div></div>`);
      pop.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { closePop(); setTool(b.dataset.pick); svg.focus(); } });
      openPop(btn, pop);
    }
    const MORE = [['Select all', 'selectAll'], ['Cut', 'cut'], ['Copy', 'copy'], ['Paste', 'paste'], ['-'], ['Clear all', 'clear']];
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tool]'), a = e.target.closest('[data-act]'), inDD = e.target.closest('.fe-dd');
      if (inDD && inDD.dataset.rib === 'top' && (t || (a && !['shapes', 'zoomIn', 'zoomOut', 'more'].includes(a.dataset.act)))) setTimeout(closeDD, 0);
      if (t) { setTool(tool === t.dataset.tool ? 'select' : t.dataset.tool); }
      else if (a) {
        const k = a.dataset.act;
        if (k === 'shapes') return shapePicker(a);
        if (k === 'more') return menu(a, MORE.map((m) => (m[0] === '-' ? '-' : m[0])), (l) => act(MORE.find((m) => m[0] === l)[1]));
        if (k === 'ins' || k === 'save' || k === 'load' || k === 'copyTikz' || k === 'regen' || k === 'unlock') tikzAct(k); else if (k === 'copy' && a.closest('#flCodeBox')) tikzAct('copy'); else act(k);
      }
    });
    const EDITKEY = (e) => e.target.matches('input, textarea, select');
    el.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase(), isInput = EDITKEY(e);
      if (isInput) return;
      if (e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
      if (e.key === ' ' && document.activeElement === svg) { e.preventDefault(); if (!spaceDown) { spaceDown = true; syncBar(); } return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return act('del'); }
      if (mod) {
        if (key === 'd') { e.preventDefault(); act('dup'); } else if (key === 'a') { e.preventDefault(); act('selectAll'); }
        else if (key === 'c') { e.preventDefault(); act('copy'); } else if (key === 'x') { e.preventDefault(); act('cut'); } else if (key === 'v') { e.preventDefault(); act('paste'); }
        else if (key === 'b' || key === 'i') { e.preventDefault(); const f = selShapes()[0]; if (f) setStyle('s', { [key === 'b' ? 'b' : 'it']: f[key === 'b' ? 'b' : 'it'] ? undefined : true }); }
        else if (key === ']') { e.preventDefault(); act('front'); } else if (key === '[') { e.preventDefault(); act('back'); }
        else if (key === '0') { e.preventDefault(); act('resetView'); } else if (key === '1') { e.preventDefault(); act('fit'); }
        else if (key === '=' || key === '+') { e.preventDefault(); act('zoomIn'); } else if (key === '-') { e.preventDefault(); act('zoomOut'); }
        return;
      }
      if (e.altKey) return;
      if (e.key.startsWith('Arrow') && selS.size) {
        e.preventDefault(); const st = e.shiftKey ? 1 : GRID, dx = { ArrowLeft: -st, ArrowRight: st }[e.key] || 0, dy = { ArrowUp: -st, ArrowDown: st }[e.key] || 0;
        selShapes().forEach((s) => { s.x += dx; s.y += dy; }); pushState(); save(); return render();
      }
      if ((e.key === 'Enter' || e.key === 'F2') && selS.size === 1) { e.preventDefault(); return startEdit('s', [...selS][0]); }
      if (e.key === 'Enter' && selC.size === 1 && !selS.size) { e.preventDefault(); return startEdit('c', [...selC][0]); }
      const T2 = { v: 'select', m: 'move', h: 'pan', l: 'line', a: 'arrow', r: 'rect', d: 'diamond', o: 'ellipse', t: 'text' }[key];
      if (T2 && e.key.length === 1) { e.preventDefault(); setTool(T2); }
    });
    el.addEventListener('keyup', (e) => { if (e.key === ' ' && spaceDown) { spaceDown = false; syncBar(); } });
    svg.addEventListener('blur', () => { if (spaceDown) { spaceDown = false; syncBar(); } });
    /* Escape: finish the innermost interaction first; only an idle editor lets the dialog close */
    const escGuard = (e) => {
      if (!document.body.contains(el)) return window.removeEventListener('keydown', escGuard, true);
      if (e.key !== 'Escape') return;
      const stop = () => { e.stopPropagation(); e.preventDefault(); };
      const pk = $e('.fe-modal');
      if (pk) { stop(); pk.remove(); svg.focus(); }
      else if (edit) { stop(); cancelEdit(); svg.focus(); }
      else if (document.querySelector('.popover.is-open, .c-menu')) { stop(); closePop(); RPE.ui.closeCustomMenu(); }
      else if (dd) { stop(); closeDD(); }
      else if (cx || drag) { stop(); cx = null; drag = null; guides = []; hov = null; render(); }
      else if (tool !== 'select') { stop(); setTool('select'); }
      else if (selS.size || selC.size) { stop(); clearSel(); render(); }
    };
    window.addEventListener('keydown', escGuard, true);
    /* the diagram keeps its own history: while the editor is open, Ctrl+Z / Ctrl+Y / Ctrl+S never reach the document's undo stack or save */
    const modGuard = (e) => {
      if (!document.body.contains(el)) return window.removeEventListener('keydown', modGuard, true);
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase(); if (k !== 'z' && k !== 'y' && k !== 's') return;
      e.stopPropagation();
      const dl = document.querySelectorAll('.dlg'); if (dl[dl.length - 1] !== el) return;
      if (k !== 's' && e.target.matches && e.target.matches('input, textarea, select')) return;
      e.preventDefault();
      if (k === 's') return tikzAct('save');
      if (edit) commitEdit();
      if (k === 'y' || e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', modGuard, true);

    /* ---------- Open from project: modal listing every editable diagram (.diagram.json) in the project ---------- */
    async function projectDiagrams() {
      const nodes = [], root = ctx.PROJECT && ctx.PROJECT[0];
      const walk = async (f) => {
        if (f.c === null && f.handle && ctx.listDir) { try { f.c = await ctx.listDir(f.handle, f.path); } catch (e) { f.c = []; } }
        for (const it of (f.c || [])) { if (it.t === 'file' && /\.diagram\.json$/i.test(it.n)) nodes.push(it); else if (it.t === 'folder') await walk(it); }
      };
      if (root) await walk(root);
      const rows = await Promise.all(nodes.map(async (n) => {
        try {
          const file = await n.handle.getFile(), data = JSON.parse(await file.text());
          if (!data || !Array.isArray(data.shapes)) return null;
          const cl = sanitize(data); return { node: n, data, shapes: cl.shapes, conns: cl.conns, mod: file.lastModified };
        } catch (e) { return null; }
      }));
      return rows.filter(Boolean).sort((a, b) => b.mod - a.mod);
    }
    const thumbSvg = (r) => {
      if (!r.shapes.length) return '<div class="fe-pj-th is-empty">Empty</div>';
      const x0 = Math.min(...r.shapes.map((s) => s.x)), y0 = Math.min(...r.shapes.map((s) => s.y)), x1 = Math.max(...r.shapes.map((s) => s.x + s.w)), y1 = Math.max(...r.shapes.map((s) => s.y + s.h)), pad = 14;
      const by = (id) => r.shapes.find((s) => s.id === id);
      const lines = r.conns.map((c) => { const A = by(c.from), B = by(c.to); return A && B ? `<path class="fl-conn" d="${ptsD(route(c, A, B).pts)}"${c.color ? ` style="stroke:${c.color}"` : ''}/>` : ''; }).join('');
      return `<svg class="fe-pj-th" viewBox="${r2(x0 - pad)} ${r2(y0 - pad)} ${r2(x1 - x0 + 2 * pad)} ${r2(y1 - y0 + 2 * pad)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${r.shapes.map(geo).join('')}${lines}</svg>`;
    };
    function openDisk() {
      if (typeof window.showOpenFilePicker !== 'function') return toast('File picker unavailable here. Run in Chrome/Edge or open the diagram from the Project Explorer');
      window.showOpenFilePicker({ multiple: false, types: [{ description: 'Diagram files (*.diagram.json)', accept: { 'application/json': ['.json'] } }] }).then(async (hs) => {
        if (hs && hs[0]) { loadDiagData(JSON.parse(await (await hs[0].getFile()).text()), hs[0].name); toast('Loaded “' + hs[0].name + '”'); }
      }).catch(() => {});
    }
    async function openProject() {
      closePop(); if (edit) commitEdit(); if ($e('.fe-modal')) return;
      const ov = h(`<div class="fe-modal"><div class="fe-modal__box" role="dialog" aria-modal="true" aria-label="Open diagram from project"><div class="fe-modal__head"><b>Open diagram from project</b><button class="fe-b" type="button" data-m="x" title="Close" aria-label="Close">${I('x')}</button></div><div class="fe-modal__tools"><input class="fe-label" type="text" data-m="q" placeholder="Search diagrams…" autocomplete="off" aria-label="Search diagrams"></div><div class="fe-modal__list"><div class="fe-modal__empty">Scanning project…</div></div><div class="fe-modal__foot"><span class="muted" data-m="n"></span><button class="btn btn--sm" type="button" data-m="disk">Browse disk…</button></div></div></div>`);
      el.append(ov);
      const list = $('.fe-modal__list', ov), q = $('[data-m="q"]', ov), shut = () => { ov.remove(); svg.focus(); };
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) shut(); });
      ov.addEventListener('click', (e) => { const m = e.target.closest('[data-m]'); if (!m) return; if (m.dataset.m === 'x') shut(); else if (m.dataset.m === 'disk') { shut(); openDisk(); } });
      q.focus();
      let rows = [];
      const draw = () => {
        const f = q.value.trim().toLowerCase(), vis = rows.filter((r) => !f || (r.node.path + ' ' + r.node.n).toLowerCase().includes(f));
        $('[data-m="n"]', ov).textContent = rows.length ? vis.length + ' of ' + rows.length + ' diagram' + (rows.length === 1 ? '' : 's') : '';
        list.innerHTML = vis.length ? vis.map((r) => `<button type="button" class="fe-pj-row" data-i="${rows.indexOf(r)}">${thumbSvg(r)}<span class="fe-pj-meta"><b>${esc(r.node.n.replace(/\.diagram\.json$/i, ''))}</b><span class="fe-pj-path">${esc(r.node.path)}</span><span class="fe-pj-sub">${r.shapes.length} shape${r.shapes.length === 1 ? '' : 's'} · ${r.conns.length} connector${r.conns.length === 1 ? '' : 's'} · ${esc(new Date(r.mod).toLocaleDateString())}</span></span></button>`).join('')
          : `<div class="fe-modal__empty">${!ctx.rootDirHandle ? 'Open a project folder to see its diagrams here.' : rows.length ? 'No diagrams match your search.' : 'No editable diagrams in this project yet.<br>Use “Save to project” to create one.'}</div>`;
      };
      list.addEventListener('click', (e) => {
        const b = e.target.closest('.fe-pj-row'); if (!b) return;
        const r = rows[+b.dataset.i]; shut(); loadDiagData(r.data, r.node.n); toast('Opened “' + r.node.n + '” · Ctrl+Z restores the previous diagram');
      });
      q.addEventListener('input', draw);
      q.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { const b = $('.fe-pj-row', list); if (b) { e.preventDefault(); b.focus(); } } });
      list.addEventListener('keydown', (e) => {
        const b = e.target.closest('.fe-pj-row'); if (!b || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
        e.preventDefault(); const n = e.key === 'ArrowDown' ? b.nextElementSibling : b.previousElementSibling; if (n && n.classList.contains('fe-pj-row')) n.focus(); else if (e.key === 'ArrowUp') q.focus();
      });
      try { rows = await projectDiagrams(); } catch (e) { rows = []; }
      if (document.body.contains(ov)) draw();
    }

    async function tikzAct(k) {
      if (k === 'regen') { if (manual && !confirm('Replace your hand-edited code with TikZ generated from the canvas?')) return; manual = false; refreshCode(); return toast('TikZ regenerated from canvas'); }
      if (k === 'unlock') { manual = false; refreshCode(); return toast('Lock cleared: code now follows canvas'); }
      const code = cd.value.trim();
      if (k === 'copy' || k === 'copyTikz') { try { await navigator.clipboard.writeText(cd.value); toast('TikZ code copied'); } catch (e) { cd.select(); toast('Press Ctrl+C to copy'); } return; }
      if (k === 'load') return openProject();
      if (!FLOW.shapes.length && !manual) return toast('The diagram is empty. Add shapes first');
      if (!/\\begin\{tikzpicture\}[\s\S]*\\end\{tikzpicture\}/.test(code)) return toast('The code must contain a complete tikzpicture environment');
      try {
        if (k === 'save') {
          if (!ctx.rootDirHandle) return toast('Open a project folder first: diagrams are saved into its figures/ folder');
          if (ctx.ensureWrite && !(await ctx.ensureWrite())) return;
          const rawName = ($e('#flName') && $e('#flName').value.trim()) || 'flow-diagram';
          const stem = rawName.replace(/\.(?:tex|json|diagram\.json)$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f\s]/g, '-').replace(/^-+|-+$/g, '') || 'diagram';
          const dir = await ctx.rootDirHandle.getDirectoryHandle('figures', { create: true });
          let finalStem = stem, n = 0;
          if (ctx.existsIn) {
            while (!(await ctx.existsIn(dir, finalStem + '.diagram.json')) && await ctx.existsIn(dir, finalStem + '.tex')) {
              finalStem = stem + '-' + (++n);
            }
          }
          const diagJson = JSON.stringify({
            version: 1,
            type: 'lplum.diagram',
            shapes: FLOW.shapes,
            conns: FLOW.conns,
            manual,
            code: cd.value
          }, null, 2);
          const needed = tikzLibs(cd.value);
          const libComment = '% needs \\usepackage{tikz}' + (/\\fontspec\{/.test(cd.value) ? ' and \\usepackage{fontspec} (XeLaTeX/LuaLaTeX)' : '') + (needed.length ? ' and \\usetikzlibrary{' + needed.join(', ') + '}' : '') + '\n';
          const cleanCode = cd.value.replace(/^[ \t]*\\usetikzlibrary\{[^}]*\}\s*\n?/gm, '').trim();
          const put = async (fn, text) => {
            const w = await (await dir.getFileHandle(fn, { create: true })).createWritable();
            await w.write(text);
            await w.close();
          };
          await put(finalStem + '.diagram.json', diagJson);
          await put(finalStem + '.tex', libComment + cleanCode + '\n');
          if ($e('#flName')) $e('#flName').value = finalStem;
          const root = ctx.PROJECT && ctx.PROJECT[0];
          if (root && ctx.refreshDir) {
            await ctx.refreshDir(root.path);
            const fd = ctx.findNode && ctx.findNode(root.path + '/figures');
            if (fd) await ctx.refreshDir(fd.path);
            if (ctx.renderExplorer) ctx.renderExplorer();
          }
          return toast('Saved to figures/' + finalStem + '.diagram.json and figures/' + finalStem + '.tex');
        }
        const ta = $('#codeInput'), t = ta.value, q = ta.selectionEnd, bs = t.indexOf('\\begin{document}'), be = t.indexOf('\\end{document}');
        if (bs < 0 || q < bs + 16 || (be >= 0 && q > be)) return toast('Place the cursor inside the document body to insert the diagram');
        let depth = 0, m; const re = /\\(begin|end)\{tikzpicture\}/g, before = t.slice(0, q); while ((m = re.exec(before))) depth += m[1] === 'begin' ? 1 : -1;
        if (depth > 0) return toast('The cursor is inside a tikzpicture: pictures can’t be nested');
        if (/\\fontspec\{/.test(code) && /^[ \t]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:inputenc|fontenc)\b/m.test(t) && !/fontspec/.test(t)) return toast('This document is set up for pdfLaTeX: diagram fonts need XeLaTeX/fontspec. Use the default font or switch engine');
        const pk = flowPre(t, code); if (pk === false) return toast('Could not add tikz. Check the \\documentclass / preamble');
        const cleanCode = code.replace(/^[ \t]*\\usetikzlibrary\{[^}]*\}\s*\n?/gm, '').trim();
        const pre = q > 0 && t[q - 1] !== '\n' ? '\n' : '', post = q < t.length && t[q] !== '\n' ? '\n' : '', end = q + pre.length + cleanCode.length;
        d.close();
        if (ctx.fmtEdit) {
          ctx.fmtEdit(ta, q, q, pre + cleanCode + post, end, end);
          if (pk) ctx.fmtEdit(ta, pk.pos, pk.pos, pk.str, end + pk.str.length, end + pk.str.length);
        }
        if (ctx.syncFmtBtns) ctx.syncFmtBtns();
        toast('Diagram inserted');
      } catch (e) { toast(e.message || 'Could not complete that action'); }
    }

    render();
  }

  RPE.flow = {
    FLOW, FLOW_TYPES, FLOW_UI, flowTikz, tikzLibs, flowPre, diagramRef,
    flowDialog, dialogConfig: flowDlgConfig,
    get: () => JSON.parse(JSON.stringify(FLOW)),
    tikz: () => flowTikz(FLOW)
  };
})(window.RPE = window.RPE || {});