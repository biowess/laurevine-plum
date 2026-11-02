/* ui.js: Laurevine Plum UI primitives: DOM helpers, toasts, popovers, custom dropdowns, dialog shell.
   Exposes window.RPE.ui for use by app.js and sub-modules. */
(function (RPE) {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [].slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (n, c) => `<i data-lucide="${n}" class="ic ${c || ''}"></i>`;
  const h = (html) => { const t = document.createElement('div'); t.innerHTML = html.trim(); return t.firstChild; };
  const paint = (r) => {
    window.RPE.icons.render(r || document);
    const root = r || document, sels = root.querySelectorAll ? Array.from(root.querySelectorAll('select')) : [];
    if (root.tagName === 'SELECT') sels.unshift(root);
    sels.forEach(setupCustomSelect);
  };
  const clearToasts = () => { const el = $('#toasts'); if (el) el.innerHTML = ''; };
  const toast = (m) => { const t = h(`<div class="toast is-in">${esc(m || 'Preview only. No action was taken')}</div>`); $('#toasts').append(t); setTimeout(() => t.remove(), 2200); return t; };

  /* ---------- popover menus ---------- */
  let pop = null, popAnchor = null;
  const popStack = [];   // open popovers, outermost first; a dropdown opened from inside a collapsed-group popover nests on top of it
  const syncTop = () => { const t = popStack[popStack.length - 1]; pop = t ? t.el : null; popAnchor = t ? t.anchor : null; };
  const dropTop = () => { const t = popStack.pop(); if (!t) return; if (t.el._cleanup) t.el._cleanup(); t.el.remove(); t.anchor.classList.remove('is-open'); t.anchor.setAttribute('aria-expanded', 'false'); syncTop(); };
  const closeTop = () => dropTop();                       // closes only the innermost popover
  const closePop = () => { while (popStack.length) dropTop(); };   // closes every open popover
  function openPop(anchor, el, onCleanup) {
    if (pop && popAnchor === anchor) return closeTop();
    const r = anchor.getBoundingClientRect();
    const parent = popStack.findIndex((p) => p.el.contains(anchor));   // anchor lives inside an open popover: keep it and everything below it
    while (popStack.length > parent + 1) dropTop();
    if (onCleanup) el._cleanup = onCleanup;
    document.body.append(el);
    el.style.left = Math.max(4, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px';
    const top = r.bottom + 2, fitsBelow = top + el.offsetHeight <= innerHeight - 8;
    el.style.top = (fitsBelow ? top : Math.max(8, r.top - el.offsetHeight - 2)) + 'px';
    popStack.push({ el, anchor }); syncTop(); anchor.classList.add('is-open'); anchor.setAttribute('aria-expanded', 'true');
    return el;
  }
  const STANDARD_COLORS = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
  const STANDARD_COLOR_NAMES = ['Dark Red', 'Red', 'Orange', 'Yellow', 'Light Green', 'Green', 'Light Blue', 'Blue', 'Dark Blue', 'Purple'];
  const RECENT_KEY = 'lplum.recentColors';
  const getRecentColors = () => {
    try { const j = JSON.parse(localStorage.getItem(RECENT_KEY)); if (Array.isArray(j) && j.length) return j.slice(0, 10); } catch (e) {}
    return ['#EEECE1', '#5A6B7C', '#1F262E', '#3D4956', '#8A82BE', '#E4E3F0', '#5D5392', '#FFFFFF', '#465358', '#B84E34'];
  };
  const addRecentColor = (h) => {
    if (!h || typeof h !== 'string' || !h.startsWith('#')) return;
    h = h.toUpperCase();
    const list = [h, ...getRecentColors().filter((c) => c.toUpperCase() !== h)].slice(0, 10);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
  };

  function menu(anchor, items, pick) {
    if (pop && popAnchor === anchor) return closeTop();
    const el = h('<div class="popover is-open"><div class="menu' + (items.length > 10 ? ' menu--scroll' : '') + '"></div></div>'), m = el.firstChild;
    if (items.some((it) => it && (it.sub || it.style || it.swatches))) m.style.minWidth = Math.max(240, anchor && anchor.offsetWidth ? anchor.offsetWidth : 0) + 'px';
    items.forEach((it) => {
      const isObj = typeof it === 'object' && it !== null;
      if (it === '-' || (isObj && it.sep)) return m.append(h('<div class="menu__sep"></div>'));
      if ((typeof it === 'string' && it[0] === '#') || (isObj && it.head)) return m.append(h(`<div class="menu__head">${esc(isObj ? it.head : it.slice(1))}</div>`));
      const l = isObj ? it.l : it.split('|')[0], d = isObj ? it.d : it.split('|')[1];
      const style = isObj && it.style ? ` style="${esc(it.style)}"` : '';
      const sub = isObj && it.sub ? `<span class="menu__tag" style="font-family:var(--font);font-size:11px;color:var(--text-2);margin-left:auto;padding-left:12px;flex:none">${esc(it.sub)}</span>` : '';
      const checked = isObj && (typeof it.checked === 'function' ? it.checked() : it.checked);
      const icon = isObj && it.icon ? ic(it.icon) : '';
      const chk = checked ? ic('check') : icon;
      const sw = isObj && it.swatches ? `<span class="menu__sw">${it.swatches.map((c) => `<i style="background:${c}"></i>`).join('')}</span>` : '';
      const b = h(`<button class="menu__item${checked ? ' is-checked' : ''}"><span class="menu__icon">${chk}</span>${sw}<span class="menu__label"${style}>${esc(l)}</span>${sub}</button>`);
      if (isObj && it.disabled) b.disabled = true;
      b.onclick = () => {
        if (!(isObj && it.nest)) closePop();   // nest: the pick opens a menu from this item, so the menus it sits in stay open
        if (d) {
          if (window.RPE && window.RPE.openD) window.RPE.openD(d.slice(1));
          else toast(l + ': preview only');
        } else if (pick) pick(isObj ? (it.val !== undefined ? it.val : (it.id || l)) : l, b);
        else toast(l + ': preview only');
      };
      m.append(b);
    });
    openPop(anchor, el);
    paint(el);
  }

  /* More Colors…: full colour-picking dialog. Saturation/brightness field + hue strip (pointer and keyboard), HEX / RGB / HSL entry,
     current-vs-new comparison, contrast readout, screen eyedropper, recent and standard swatches. Calls onApply('#RRGGBB') on Select. */
  function colorDialog(start, onApply) {
    const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
    const hex2rgb = (x) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(x || '').trim()); if (!m) return null; let t = m[1]; if (t.length === 3) t = t.replace(/./g, '$&$&'); const n = parseInt(t, 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    const hsv2rgb = (h, s, v) => { const f = (n) => { const k = (n + h / 60) % 6; return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255; }; return [f(5), f(3), f(1)].map(Math.round); };
    const rgb2hsv = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0; if (d) { hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; } return [hh, mx ? d / mx : 0, mx]; };
    const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const grade = (x) => (x >= 7 ? 'AAA' : x >= 4.5 ? 'AA' : x >= 3 ? 'AA Large' : 'Fail');
    const init = hex2rgb(start) || [112, 45, 59], origHex = rgb2hex(...init);
    const hv = rgb2hsv(...init), st = { h: hv[0], s: hv[1], v: hv[2] };
    const num = (k, l, max) => `<label class="cd__num"><span>${l}</span><input type="number" inputmode="numeric" min="0" max="${max}" step="1" data-k="${k}" aria-label="${l}"></label>`;
    const d = dlg({
      t: 'More Colors', i: 'palette', w: 600, btns: ['Cancel', 'Select'], cls: 'dlg--color', focus: '#cdHex',
      b: `<div class="cd">
        <div class="cd__left">
          <div class="cd__sv" id="cdSV" tabindex="0" role="slider" aria-label="Saturation and brightness"><i class="cd__thumb"></i></div>
          <div class="cd__hue" id="cdHue" tabindex="0" role="slider" aria-label="Hue" aria-valuemin="0" aria-valuemax="360"><i class="cd__thumb"></i></div>
        </div>
        <div class="cd__right">
          <div class="cd__cmp"><button type="button" class="cd__old" id="cdOld" title="Revert to the current colour" style="background:${origHex}"><span>Current</span></button><div class="cd__new" id="cdNew"><span>New</span></div></div>
          <div class="cd__hexrow"><label class="cd__num cd__num--hex"><span>HEX</span><input id="cdHex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex colour"></label><button type="button" class="btn btn--sm cd__eye" id="cdEye" title="Pick a colour from the screen">${ic('pipette')}</button></div>
          <div class="cd__grid">${num('r', 'R', 255)}${num('g', 'G', 255)}${num('b', 'B', 255)}${num('hh', 'H', 360)}${num('ss', 'S %', 100)}${num('ll', 'L %', 100)}</div>
          <div class="cd__ctr" id="cdCtr"></div>
        </div>
        <div class="cd__sws">
          <div class="cd__swh">Recent</div><div class="cd__row" id="cdRec"></div>
          <div class="cd__swh">Standard</div><div class="cd__row" id="cdStd"></div>
        </div>
      </div>`,
      ok: () => { if (onApply) onApply(curHex()); }
    });
    const el = d.el, q = (x) => el.querySelector(x), sv = q('#cdSV'), hue = q('#cdHue'), nw = q('#cdNew'), hexIn = q('#cdHex'), ctr = q('#cdCtr');
    const ins = Array.from(el.querySelectorAll('.cd__grid input')), primary = el.querySelector('.dlg__foot .btn--primary');
    const curRgb = () => hsv2rgb(st.h, st.s, st.v), curHex = () => rgb2hex(...curRgb());
    function sync(skip) {
      const rgb = curRgb(), hx = rgb2hex(...rgb), l = st.v * (1 - st.s / 2), sl = l > 0 && l < 1 ? (st.v - l) / Math.min(l, 1 - l) : 0;
      sv.style.setProperty('--h', Math.round(st.h)); sv.firstChild.style.cssText = `left:${st.s * 100}%;top:${(1 - st.v) * 100}%;background:${hx}`;
      hue.firstChild.style.cssText = `left:${st.h / 360 * 100}%;background:hsl(${Math.round(st.h)} 100% 50%)`;
      sv.setAttribute('aria-valuetext', `Saturation ${Math.round(st.s * 100)}%, brightness ${Math.round(st.v * 100)}%`);
      hue.setAttribute('aria-valuenow', Math.round(st.h));
      nw.style.background = hx; nw.classList.toggle('is-light', lum(...rgb) > 0.5);
      q('#cdOld').classList.toggle('is-light', lum(...(hex2rgb(origHex))) > 0.5);
      const vals = { r: rgb[0], g: rgb[1], b: rgb[2], hh: Math.round(st.h) % 360, ss: Math.round(sl * 100), ll: Math.round(l * 100) };
      ins.forEach((i) => { if (i !== skip) i.value = vals[i.dataset.k]; });
      if (skip !== hexIn) { hexIn.value = hx; hexIn.classList.remove('is-bad'); }
      const L = lum(...rgb), cw = 1.05 / (L + 0.05), cb = (L + 0.05) / 0.05;
      ctr.innerHTML = `<span><i style="background:#fff;color:${hx}">Aa</i>On white <b>${cw.toFixed(2)}</b> · ${grade(cw)}</span><span><i style="background:#000;color:${hx}">Aa</i>On black <b>${cb.toFixed(2)}</b> · ${grade(cb)}</span>`;
      primary.disabled = false;
    }
    const load = (hx) => { const c = hex2rgb(hx); if (!c) return; const t = rgb2hsv(...c); st.h = (t[1] && t[2]) ? t[0] : st.h; st.s = t[1]; st.v = t[2]; sync(); };
    const drag = (node, fn) => node.addEventListener('pointerdown', (e) => {
      if (e.button) return; e.preventDefault(); node.focus(); node.setPointerCapture(e.pointerId); fn(e);
      const mv = (ev) => fn(ev), up = () => { node.removeEventListener('pointermove', mv); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); };
      node.addEventListener('pointermove', mv); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
    });
    drag(sv, (e) => { const r = sv.getBoundingClientRect(); st.s = clamp((e.clientX - r.left) / r.width, 0, 1); st.v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1); sync(); });
    drag(hue, (e) => { const r = hue.getBoundingClientRect(); st.h = clamp((e.clientX - r.left) / r.width, 0, 1) * 360; sync(); });
    sv.addEventListener('keydown', (e) => {
      const k = e.key, step = e.shiftKey ? 0.1 : 0.01; let hit = true;
      if (k === 'ArrowLeft') st.s = clamp(st.s - step, 0, 1); else if (k === 'ArrowRight') st.s = clamp(st.s + step, 0, 1);
      else if (k === 'ArrowUp') st.v = clamp(st.v + step, 0, 1); else if (k === 'ArrowDown') st.v = clamp(st.v - step, 0, 1); else hit = false;
      if (hit) { e.preventDefault(); sync(); }
    });
    hue.addEventListener('keydown', (e) => {
      const k = e.key, step = e.shiftKey ? 10 : 1; let hit = true;
      if (k === 'ArrowLeft' || k === 'ArrowDown') st.h = clamp(st.h - step, 0, 360); else if (k === 'ArrowRight' || k === 'ArrowUp') st.h = clamp(st.h + step, 0, 360);
      else if (k === 'Home') st.h = 0; else if (k === 'End') st.h = 360; else hit = false;
      if (hit) { e.preventDefault(); sync(); }
    });
    hexIn.addEventListener('input', () => {
      const c = hex2rgb(hexIn.value), ok = !!c && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexIn.value.trim()); hexIn.classList.toggle('is-bad', !ok);
      if (!ok) return; const t = rgb2hsv(...c); st.h = (t[1] && t[2]) ? t[0] : st.h; st.s = t[1]; st.v = t[2]; sync(hexIn);
    });
    hexIn.addEventListener('blur', () => sync());
    ins.forEach((i) => i.addEventListener('input', () => {
      if (i.value === '' || isNaN(+i.value)) return; const k = i.dataset.k, n = Math.round(+i.value);
      if (k === 'r' || k === 'g' || k === 'b') { const c = curRgb(); c[{ r: 0, g: 1, b: 2 }[k]] = clamp(n, 0, 255); const t = rgb2hsv(...c); st.h = (t[1] && t[2]) ? t[0] : st.h; st.s = t[1]; st.v = t[2]; }
      else {
        let h = st.h, sl, l; const l0 = st.v * (1 - st.s / 2); sl = l0 > 0 && l0 < 1 ? (st.v - l0) / Math.min(l0, 1 - l0) : 0; l = l0;
        if (k === 'hh') h = clamp(n, 0, 360); else if (k === 'ss') sl = clamp(n, 0, 100) / 100; else l = clamp(n, 0, 100) / 100;
        const v = l + sl * Math.min(l, 1 - l); st.h = h; st.v = v; st.s = v ? 2 * (1 - l / v) : 0;
      }
      sync(i);
    }));
    ins.forEach((i) => i.addEventListener('blur', () => sync()));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('#cdHex, .cd__grid input')) { e.preventDefault(); if (!hexIn.classList.contains('is-bad')) primary.click(); } });
    q('#cdOld').onclick = () => load(origHex);
    const eye = q('#cdEye'); if (!window.EyeDropper) eye.hidden = true;
    else eye.onclick = async () => { try { const r = await new window.EyeDropper().open(); if (r && r.sRGBHex) load(r.sRGBHex); } catch (err) { /* cancelled */ } };
    const fill = (id, list) => { const row = q(id); list.forEach((c) => { const b = h(`<button type="button" class="cd__s" style="background:${c}" title="${esc(c)}" aria-label="${esc(c)}"></button>`); b.onclick = () => load(c); row.append(b); }); };
    fill('#cdRec', getRecentColors()); fill('#cdStd', STANDARD_COLORS.concat(['#000000', '#FFFFFF', '#7F7F7F']));
    sync();
    return d;
  }

  function colorPanel(anchor, opts) {
    if (pop && popAnchor === anchor) return closeTop();
    opts = opts || {};
    const pal = (typeof opts.palette === 'function' ? opts.palette() : opts.palette) || (window.RPE && window.RPE.editor && window.RPE.editor.getActivePalette ? window.RPE.editor.getActivePalette() : null) || {
      neutrals: ['#FFFFFF', '#000000', '#EEECE1', '#3D353A'],
      accents: ['#702D3B', '#2F6F8F', '#C28B3C', '#5E8C61', '#A65C68', '#6B5B95']
    };
    const M = (window.RPE && window.RPE.editor && window.RPE.editor.themeMatrix) ? window.RPE.editor.themeMatrix(pal) : null;
    const el = h('<div class="popover is-open"><div class="menu menu--colors"></div></div>'), m = el.firstChild;

    const apply = (val) => {
      if (val) addRecentColor(val);
      closePop();
      if (opts.onPick) opts.onPick(val);
      if (opts.swatchEl && val) opts.swatchEl.style.setProperty('--sw', val);
    };

    if (opts.none !== false) {
      const b = h(`<button type="button" class="menu__item menu__item--none"><span class="menu__icon">${ic('ban')}</span><span class="menu__label">${esc(opts.none || 'Automatic')}</span></button>`);
      b.onclick = () => apply(null);
      m.append(b, h('<div class="menu__sep"></div>'));
    }

    const swBtn = (col, title, cls) => {
      const b = h(`<button type="button" class="swatch ${cls || ''}" style="background:${col}" title="${esc(title)}" aria-label="${esc(title)}"></button>`);
      b.onclick = (e) => { e.stopPropagation(); apply(col); };
      return b;
    };

    m.append(h('<div class="menu__head">Theme Colors</div>'));
    const bGrid = h('<div class="swatches swatches--theme-base" role="group" aria-label="Theme base colors"></div>');
    (M ? M.base : pal.neutrals.concat(pal.accents)).forEach((c) => {
      bGrid.append(swBtn(typeof c === 'object' ? c.color : c, typeof c === 'object' ? c.name : c, 'swatch--base'));
    });
    m.append(bGrid);

    if (M && M.shades) {
      const sGrid = h('<div class="swatches swatches--theme-shades" role="group" aria-label="Theme shades and tints"></div>');
      M.shades.forEach((row) => row.forEach((c) => sGrid.append(swBtn(c.color, c.name, 'swatch--shade'))));
      m.append(sGrid);
    }

    m.append(h('<div class="menu__sep"></div>'), h('<div class="menu__head">Standard Colors</div>'));
    const stdGrid = h('<div class="swatches swatches--standard" role="group" aria-label="Standard colors"></div>');
    STANDARD_COLORS.forEach((c, idx) => stdGrid.append(swBtn(c, STANDARD_COLOR_NAMES[idx] || c, 'swatch--std')));
    m.append(stdGrid);

    m.append(h('<div class="menu__sep"></div>'), h('<div class="menu__head">Recent Colors</div>'));
    const recGrid = h('<div class="swatches swatches--recent" role="group" aria-label="Recent colors"></div>');
    getRecentColors().forEach((c) => recGrid.append(swBtn(c, c, 'swatch--recent')));
    m.append(recGrid);

    m.append(h('<div class="menu__sep"></div>'));
    const more = h(`<button type="button" class="menu__item"><span class="menu__icon">${ic('palette')}</span><span class="menu__label">More Colors…</span></button>`);
    more.onclick = (e) => { e.stopPropagation(); closePop(); colorDialog(opts.current || getRecentColors()[0] || '#702D3B', apply); };
    m.append(more);

    const eye = h(`<button type="button" class="menu__item menu__item--eyedropper"><span class="menu__icon">${ic('pipette')}</span><span class="menu__label">Eyedropper</span></button>`);
    eye.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      closePop();
      if (window.EyeDropper) {
        try {
          const ed = new window.EyeDropper();
          const res = await ed.open();
          if (res && res.sRGBHex) apply(res.sRGBHex);
        } catch (err) {}
      } else {
        toast('Eyedropper is not supported in this browser');
      }
    };
    m.append(eye);

    openPop(anchor, el);
    paint(el);
  }
  document.addEventListener('mousedown', (e) => { if (pop && !e.target.closest('.popover') && !e.target.closest('[aria-haspopup]') && !popStack.some((p) => p.anchor.contains(e.target))) closePop(); });

  /* ---------- custom dropdown menus ---------- */
  let activeCustomMenu = null;
  const closeCustomMenu = () => {
    if (activeCustomMenu) {
      if (activeCustomMenu.btn) {
        activeCustomMenu.btn.classList.remove('is-open');
        activeCustomMenu.btn.setAttribute('aria-expanded', 'false');
      }
      if (activeCustomMenu.el) activeCustomMenu.el.remove();
      activeCustomMenu = null;
    }
  };
  document.addEventListener('mousedown', (e) => {
    if (activeCustomMenu && !e.target.closest('.c-menu') && !e.target.closest('.c-select')) closeCustomMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeCustomMenu) closeCustomMenu();
  });
  window.addEventListener('resize', () => { if (activeCustomMenu) closeCustomMenu(); });
  window.addEventListener('scroll', (e) => {
    if (activeCustomMenu && (!e.target || !e.target.closest || !e.target.closest('.c-menu'))) closeCustomMenu();
  }, true);
  function setupCustomSelect(sel) {
    if (!sel) return;
    if (sel._cs) { sel._cs.sync(); return sel._cs; }
    sel.style.display = 'none';
    const btn = h('<button type="button" class="c-select" aria-haspopup="listbox" aria-expanded="false"><span class="c-select__text"></span><svg class="c-select__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>');
    if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    sel.after(btn);
    const syncText = () => {
      btn.disabled = !!sel.disabled;
      const opt = sel.selectedOptions && sel.selectedOptions[0];
      btn.querySelector('.c-select__text').textContent = opt ? opt.text : (sel.options[0] ? sel.options[0].text : '');
    };
    syncText();
    sel.addEventListener('change', syncText);
    sel.addEventListener('input', syncText);
    const mo = new MutationObserver(syncText);
    mo.observe(sel, { childList: true, subtree: true, attributes: true });
    const p = HTMLSelectElement.prototype, vD = Object.getOwnPropertyDescriptor(p, 'value'), iD = Object.getOwnPropertyDescriptor(p, 'selectedIndex');
    if (vD && iD && !sel._hasDesc) {
      sel._hasDesc = true;
      Object.defineProperty(sel, 'value', { get() { return vD.get.call(this); }, set(v) { vD.set.call(this, v); syncText(); } });
      Object.defineProperty(sel, 'selectedIndex', { get() { return iD.get.call(this); }, set(v) { iD.set.call(this, v); syncText(); } });
    }
    btn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (btn.disabled || sel.disabled) return;
      if (activeCustomMenu && activeCustomMenu.btn === btn) return closeCustomMenu();
      closeCustomMenu();
      btn.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      const m = h('<div class="c-menu" role="listbox"></div>');
      Array.from(sel.options).forEach((opt, idx) => {
        const isSel = idx === sel.selectedIndex;
        const item = h(`<button type="button" class="c-menu__item ${isSel ? 'is-selected' : ''}" role="option" aria-selected="${isSel}"><span>${esc(opt.text)}</span>${isSel ? '<svg class="c-menu__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}</button>`);
        item.onclick = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          sel.value = opt.value;
          sel.selectedIndex = idx;
          syncText();
          closeCustomMenu();
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          btn.focus();
        };
        m.append(item);
      });
      m.onkeydown = (ev) => {
        const items = $$('.c-menu__item', m);
        const cur = items.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown') { ev.preventDefault(); (items[cur + 1] || items[0])?.focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); (items[cur - 1] || items[items.length - 1])?.focus(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); closeCustomMenu(); btn.focus(); }
      };
      document.body.append(m);
      const r = btn.getBoundingClientRect(), mWidth = Math.max(r.width, 140);
      m.style.width = mWidth + 'px';
      m.style.left = Math.max(6, Math.min(r.left, window.innerWidth - mWidth - 8)) + 'px';
      const fitsBelow = r.bottom + m.offsetHeight + 4 <= window.innerHeight;
      m.style.top = (fitsBelow ? (r.bottom + 2) : Math.max(8, r.top - m.offsetHeight - 2)) + 'px';
      activeCustomMenu = { btn, el: m };
      const selItem = m.querySelector('.is-selected') || m.firstElementChild;
      if (selItem) { selItem.scrollIntoView({ block: 'nearest' }); selItem.focus(); }
    };
    btn.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    };
    sel._cs = { btn, sync: syncText };
    return sel._cs;
  }

  /* ---------- dialogs ---------- */
  function dlg(o) {
    closePop(); closeCustomMenu(); const prev = document.activeElement, btns = o.btns || ['Cancel', 'Apply'];
    const bd = h(`<div class="dlg-backdrop"><div class="dlg ${o.cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(o.t)}" tabindex="-1" style="width:min(${o.w || 520}px, calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100vh - 32px)"><div class="dlg__head"><span class="dlg__icon">${ic(o.i || 'info')}</span><h2 class="dlg__title">${esc(o.t)}</h2><button class="dlg__close" aria-label="Close">${ic('x')}</button></div><div class="dlg__body">${o.b}</div><div class="dlg__foot"></div></div></div>`);
    const el = $('.dlg', bd), close = () => { closeCustomMenu(); bd.remove(); document.removeEventListener('keydown', key, true); if (prev && prev.focus) prev.focus(); };
    function key(e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeCustomMenu(); close(); }
      if (e.key === 'Tab') { const f = $$('button,input,select,textarea', el).filter((n) => !n.disabled && n.offsetParent); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    }
    document.addEventListener('keydown', key, true);
    btns.forEach((l, i) => { const b = h(`<button class="btn ${i === btns.length - 1 ? 'btn--primary' : ''}">${esc(l)}</button>`); b.onclick = () => { const last = i === btns.length - 1; if (last && o.ok) o.ok(el); close(); if (last && l !== 'Close' && !o.ok) toast(l + ': preview only, nothing was changed'); }; $('.dlg__foot', el).append(b); });
    $('.dlg__close', el).onclick = close; bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
    el.addEventListener('click', (e) => {
      const c = e.target.closest('.chip,.sym button,.tbl tbody tr'); if (!c) return;
      if (c.matches('.chip')) { $$('.chip', c.parentNode).forEach((x) => x.classList.toggle('is-on', x === c)); }
      else if (c.matches('.sym button')) { $$('.sym button', el).forEach((x) => x.classList.toggle('is-on', x === c)); const r = $('#symSel', el); if (r) r.textContent = c.textContent + '  (selected: preview only)'; }
      else $$('.tbl tbody tr', el).forEach((x) => x.classList.toggle('on', x === c));
    });
    document.body.append(bd); paint(bd); requestAnimationFrame(() => { bd.classList.add('is-open'); (o.focus ? $(o.focus, el) : $('.btn--primary', el) || el).focus(); });
    return { el, close };
  }

  const F = (specs) => specs.map((s) => {
    const [k, l, v] = s;
    if (k === 't') return `<div class="field"><label class="field__label">${l}<input value="${esc(v || '')}"></label></div>`;
    if (k === 's') return `<div class="field"><label class="field__label">${l}<select>${v.split('|').map((o) => `<option>${esc(o)}</option>`).join('')}</select></label></div>`;
    if (k === 'a') return `<div class="field"><label class="field__label">${l}<textarea>${esc(v || '')}</textarea></label></div>`;
    if (k === 'c') return `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" ${v ? 'checked' : ''} style="accent-color:var(--accent)">${l}</label>`;
    if (k === 'ch') return `<div><div class="field__label">${l}</div><div class="chips" style="margin-top:4px">${v.split('|').map((o, i) => `<span class="chip ${i ? '' : 'is-on'}" tabindex="0" role="button">${o}</span>`).join('')}</div></div>`;
    if (k === 'g') return `<div class="dlg-grid">${F(l)}</div>`;
    return l;
  }).join('');

  const HF_POS = ['None', 'Header · left', 'Header · center', 'Header · right', 'Footer · left', 'Footer · center', 'Footer · right'];
  const HF_STY = ['1', 'Page 1', 'Page 1 of N'];
  const HF_TY = ['Normal', 'Italic', 'Small caps', 'Small'];
  const HF_FMT = [['Arabic (1, 2, 3)', ''], ['Roman (i, ii, iii)', '\\roman{page}'], ['Roman (I, II, III)', '\\Roman{page}'], ['Alphabetic (a, b, c)', '\\alph{page}']];
  const PD_COL = [['White', ''], ['Ivory', 'FFFFF0'], ['Light gray', 'F0F0F0']];
  const noDoc = () => { const t = $('#codeInput'); if (t && t.readOnly) { toast('No document is open. Create or open one first'); return true; } return false; };   // editor is locked until a document is created or opened
  const note = '<p class="demo-note">Interface preview only: this dialog does not change the document.</p>';
  const G = (t, i, specs, btns, w) => ({ t, i, w, btns, b: F(specs) + note });
  const str = (v) => (typeof v === 'string' ? v : '');
  const texEsc = (s) => String(s || '').replace(/[\\&%$#_{}~^]/g, (c) => ({ '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }[c] || '\\' + c));
  const tocMask = (t) => String(t || '').replace(/\\[\\%]|%[^\n]*/g, (m) => (m[0] === '%' ? ' '.repeat(m.length) : m))
    .replace(/\\begin\{(verbatim\*?|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}/g, (m) => ' '.repeat(m.length));

  RPE.ui = {
    $, $$, esc, ic, h, paint, clearToasts, toast,
    menu, closePop, openPop, setupCustomSelect, closeCustomMenu, colorPanel, colorDialog, getRecentColors, addRecentColor,
    dlg, F, G, HF_POS, HF_STY, HF_TY, HF_FMT, PD_COL, note, noDoc, texEsc, str, tocMask
  };
})(window.RPE = window.RPE || {});