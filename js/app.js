/* app.js: Laurevine Plum frontend. Most of this file is still presentation-only demo data and
   open/close/selection behaviour, EXCEPT the LaTeX source editor (a real, editable textarea layered
   under the syntax-highlighted display, see wireEditorInput()) and Compile (see runCompile()),
   which POSTs the current source to server/server.js and renders the resulting PDF or error log. */
(function () {
  'use strict';
  const APP_NAME = 'Laurevine Plum';                      // single place to rename the product
  const APP_VERSION = '1.0.0';                           // single place to bump the version (shown in About)
  const {
    $, $$, esc, ic, h, paint, clearToasts, toast,
    menu, closePop, openPop, setupCustomSelect, closeCustomMenu, colorPanel,
    dlg, F, G, HF_POS, HF_STY, HF_TY, HF_FMT, PD_COL, note, noDoc, texEsc, str, tocMask
  } = window.RPE.ui;

  /* ---------- package information (loaded from docs/packages.json) ---------- */
  let PK_NAMES = new Set();
  const pkgDlgFocus = (p) => {
    const doc = str(p.ctan || p.doc), short = esc(str(p.short)), desc = str(p.desc), det = str(p.details) || desc;
    const d = dlg({ t: p.name, i: 'layers', w: 640, cls: 'dlg--pkg', btns: ['Close'],
      b: `<div class="pk pk--dlg"><span class="pk__ic">${ic('layers')}</span><div><h3>${esc(p.name)}</h3><small>${short}</small></div></div>`
       + (desc && det !== desc ? `<div class="pkg-lead md">${mdRender(desc, 'docs/')}</div>` : '')
       + (det ? `<div class="pkg-dtl__body md">${mdRender(det, 'docs/')}</div>` : '')
       + `<div class="pkg-act"><button type="button" class="btn btn--sm" data-copy>${ic('copy')}Copy \\usepackage</button>`
       + (doc ? `<a class="btn btn--sm" href="${esc(doc)}" target="_blank" rel="noopener noreferrer">${ic('share')}Open on CTAN</a>` : '') + '</div>'
    });
    $('[data-copy]', d.el).onclick = () => { const t = `\\usepackage{${p.name}}`; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Copied ' + t), () => toast('Could not copy')); };
  };

  const pkgDlg = (n) => pkCat().then(c => { const p = c.find(x => x.name === n); if (p) pkgDlgFocus(p); }, () => {});

  /* ---------- dialog catalogue ---------- */
  const REFS = [['candes2006', 'Candès, Romberg, Tao', '2006', 'Robust uncertainty principles'], ['donoho2006', 'Donoho', '2006', 'Compressed sensing'], ['tibshirani96', 'Tibshirani', '1996', 'Regression shrinkage and selection via the lasso'], ['chen2001', 'Chen, Donoho, Saunders', '2001', 'Atomic decomposition by basis pursuit']];
  const D = {
    link: () => G('Insert Link', 'link', [['t', 'Address (URL)', 'https://'], ['t', 'Text to display', '']], ['Cancel', 'Insert'], 440),
    toc: () => G('Table of Contents', 'list', [['s', 'Show headings down to', 'Sections|Subsections|Subsubsections'], ['t', 'Title (optional: blank keeps the default)', '']], ['Cancel', 'Insert'], 440),
    comment: () => G('New Comment', 'message-square', [['a', 'Comment', ''], ['s', 'Anchor', 'Selected text|Current line (14)|Whole paragraph']], ['Cancel', 'Add Comment'], 440),
    table: () => ({ t: 'Insert Table', i: 'table', w: 1060, cls: 'dlg--tbd', focus: '.tbd__sheet', btns: ['Cancel', 'Insert'], b: `<div class="tbd"><div class="tbd__tabs" role="tablist"><button type="button" class="tab is-active" role="tab" aria-selected="true" data-tab="home">Home</button><button type="button" class="tab" role="tab" aria-selected="false" data-tab="table">Table</button></div><div class="tbd__rib"></div><div class="tbd__sheet" tabindex="0" role="grid" aria-label="Table cells"><div class="tbd__in"><div class="tbd__host"></div><i class="tbd__box" hidden></i><i class="tbd__hnd" hidden title="Drag to extend the selection"></i></div></div><pre class="tbd__pv" hidden></pre><div class="tbd__status"><span class="tbd__sel"></span><span class="tbd__hint">Drag across cells or pull the corner handle to select a range · Enter / double-click edits · Shift+arrows extend</span></div></div>` }),
    picture: (fig) => ({ t: fig ? 'Insert Figure' : 'Insert Picture', i: fig ? 'images' : 'image', w: 500, btns: ['Cancel', 'Insert'], b: F([['s', 'Image (from this project)', ''], ['h', '<div><button class="btn btn--sm" id="picImp">' + ic('image-up') + 'Import image or PDF…</button></div>'], ['g', [['s', 'Width', 'Text width|Fraction of text width|Custom'], ['t', 'Value', '']]]].concat(fig ? [['t', 'Caption (optional)', ''], ['g', [['s', 'Alignment', 'Centered|Left|Right'], ['s', 'Placement', 'Automatic|Here if possible|Top of page|Bottom of page|Separate page']]], ['t', 'Label (optional)', '']] : [])) }),
    hf: (f) => ({ t: 'Header & Footer', i: 'panel-top-close', w: 680, btns: ['Cancel', 'Reset to default', 'Apply'], focus: f === 'f' ? '[data-s="4"]' : f === 'n' ? '.hff__g .c-select' : '[data-s="1"]', b: `<div class="hfp"><div class="hfp__seg" role="group" aria-label="Preview page"><button type="button" data-pg="1">First page</button><button type="button" data-pg="2">Other pages</button></div><div class="hfp__sheet">${['h', 'f'].map((r) => `${r === 'f' ? '<div class="hfp__body hfp__body--b"><i></i><i></i><i></i></div>' : ''}<div class="hfp__row hfp__row--${r}">${[0, 1, 2].map((c) => `<span data-p="${(r === 'f' ? 3 : 0) + c}" data-a="${['left', 'center', 'right'][c]}" title="Click to edit"></span>`).join('')}</div>${r === 'h' ? '<div class="hfp__body"><i></i><i></i><i></i></div>' : ''}`).join('')}</div></div>
      <div class="hff"><span></span>${['Left', 'Center', 'Right'].map((x) => `<b>${x}</b>`).join('')}${[['Header', 0], ['Footer', 1]].map(([l, r]) => `<em>${l}</em>${[0, 1, 2].map((c) => `<input data-s="${r * 3 + c}" aria-label="${l} ${['left', 'center', 'right'][c]}" spellcheck="false" autocomplete="off">`).join('')}`).join('')}</div>
      <div class="hff__ins"><span>Insert</span><button type="button" data-ins="\\nouppercase{\\leftmark}">Section title</button><button type="button" data-ins="\\nouppercase{\\rightmark}">Subsection title</button><button type="button" data-ins="\\today">Date</button></div>
      <div class="hff__opts"><div class="hff__g"><div class="hff__gt">Page number</div>${F([['s', 'Position', HF_POS.join('|')], ['g', [['s', 'Style', HF_STY.join('|')], ['s', 'Numbering', HF_FMT.map((x) => x[0]).join('|')]]]])}</div><div class="hff__g"><div class="hff__gt">Appearance</div>${F([['s', 'Text style', HF_TY.join('|')], ['c', 'Line under header'], ['c', 'Line above footer'], ['c', 'Blank first page']])}</div></div>
      <p class="demo-note">Type text or click a spot on the page. Plain text is fine; LaTeX such as <code>\\textbf{…}</code> also works. Chapter or section opening pages follow “Blank first page”.</p>` }),
    equation: () => ({ t: 'Equation Editor', i: 'sigma', w: 720, cls: 'dlg--eq', btns: ['Cancel', 'Insert'], b:
      `<div class="eq-mode" id="eqModePills">
        <button class="eq-mode__pill is-on" data-m="Inline Equation" type="button">Inline</button>
        <button class="eq-mode__pill" data-m="Display Equation" type="button">Display</button>
        <button class="eq-mode__pill" data-m="Align Block" type="button">Align</button>
      </div>
      <div class="eq-prev" id="eqPrev"><span class="eq-prev__hint">Start typing below…</span></div>
      <div class="eq-kb">
        <div class="eq-tabs-bar">
          <button class="eq-tabs-nav" id="eqTabsL" aria-label="Previous categories" title="Scroll left" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
          <div class="eq-tabs" id="eqTabs"></div>
          <button class="eq-tabs-nav" id="eqTabsR" aria-label="Next categories" title="Scroll right" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
        </div>
        <div class="eq-grid" id="eqGrid"></div>
      </div>
      <textarea class="eq-src" id="eqSrc" rows="2" placeholder="LaTeX: type here or click symbols above" autocomplete="off" spellcheck="false"></textarea>` }),
    symbols: () => ({ t: 'Symbols', i: 'omega', cls: 'dlg--symbols', w: 880, btns: [], focus: '#symQ', b: `<div class="sym-search-row"><input id="symQ" class="sym-search" placeholder="Search by name, keyword or character..." autocomplete="off"><span class="sym-hint">Click a symbol to insert it at the cursor.</span></div><div class="sym-main"><div class="sym-cats" id="symCats"></div><div class="sym-grid-wrap" id="symGridWrap"><div class="sym-grid" id="symGrid"></div></div></div><div class="sym-footer"><div class="sym-preview-box" id="symPrevBox"></div><div class="sym-preview-info"><div class="sym-preview-name" id="symPrevName"></div><div class="sym-preview-code" id="symPrevCode"></div></div></div>` }),
    margins: () => G('Page Setup', 'ruler', [['s', 'Preset', 'Normal (2.5 cm)|Narrow (1.27 cm)|Wide (3.8 cm)|Custom'], ['g', [['t', 'Top (cm)', '2.5'], ['t', 'Bottom (cm)', '2.5'], ['t', 'Left (cm)', '2.5'], ['t', 'Right (cm)', '2.5']]], ['ch', 'Orientation', 'Portrait|Landscape'], ['s', 'Paper size', 'A4|Letter|Legal|A5']], ['Cancel', 'OK'], 460),
    bib: () => ({ t: 'Manage Sources', i: 'folder-open', w: 780, btns: ['Close', 'Save Sources'], b: `<div class="dlg-grid" style="grid-template-columns:1.25fr 1fr"><div><table class="tbl"><thead><tr><th>Key</th><th>Authors</th><th>Year</th></tr></thead><tbody>${REFS.map((r, i) => `<tr class="${i ? '' : 'on'}"><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table><div class="prev" style="font:12px var(--font);margin-top:10px;color:var(--text-2);min-height:56px">${ic('file-down')} Import PDF: drop a file here (not read in this preview)</div></div><div>${F([['t', 'Title', REFS[0][3]], ['t', 'Authors', REFS[0][1]], ['g', [['t', 'Year', '2006'], ['s', 'Type', 'Article|Book|Thesis']]], ['t', 'Journal', 'IEEE Trans. Inf. Theory'], ['t', 'DOI', '10.1109/TIT.2005.862083']])}</div></div>${note}` }),
    bibimport: () => ({ t: 'Import references', i: 'file-down', w: 820, btns: ['Close', 'Import selected'], b: '' }),
    options: () => ({ t: 'Preferences', i: 'settings', b: `
<div class="bs-prefs-section">
  <div class="bs-prefs-section__head">Appearance</div>
  <p class="bs-prefs-section__desc">Color mode and interface theme.</p>
  <div class="bs-prefs-list">
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><b>Color Mode</b><small>Light, dark or follow the OS.</small></div>
      <div class="bs-prefs-row__ctrl"><div class="chips"><span class="chip is-on" tabindex="0" role="button">Light</span><span class="chip" tabindex="0" role="button">Dark</span><span class="chip" tabindex="0" role="button">System</span></div></div>
    </div>
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><label class="field__label" style="font-weight:500;font-size:inherit;color:var(--text)">Interface font<input value="" style="display:none"></label><small>Font used for menus, ribbon, panels and dialogs.</small></div>
      <div class="bs-prefs-row__ctrl"></div>
    </div>
  </div>
</div>
<div class="bs-prefs-section">
  <div class="bs-prefs-section__head">Editor</div>
  <p class="bs-prefs-section__desc">Code editor display settings.</p>
  <div class="bs-prefs-list">
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><label class="field__label" style="font-weight:500;font-size:inherit;color:var(--text)">Editor font size (px)<input type="number" value="12.5" style="display:none"></label><small>Size of the source editor text.</small></div>
      <div class="bs-prefs-row__ctrl"><input type="number" aria-label="Editor font size (px)" style="width:72px"></div>
    </div>
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><label class="field__label" style="font-weight:500;font-size:inherit;color:var(--text)">Tab width (spaces)<input type="number" value="2" style="display:none"></label><small>Number of spaces per indentation level.</small></div>
      <div class="bs-prefs-row__ctrl"><input type="number" aria-label="Tab width (spaces)" style="width:72px"></div>
    </div>
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><b>Show line numbers</b><small>Display line numbers in the gutter.</small></div>
      <div class="bs-prefs-row__ctrl"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" checked style="accent-color:var(--accent);width:18px;height:18px">Show line numbers</label></div>
    </div>
  </div>
</div>
<div class="bs-prefs-section">
  <div class="bs-prefs-section__head">Compilation</div>
  <p class="bs-prefs-section__desc">When and how the document is compiled.</p>
  <div class="bs-prefs-list">
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><b>Compile on save</b><small>Recompile every time you save.</small></div>
      <div class="bs-prefs-row__ctrl"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" style="accent-color:var(--accent);width:18px;height:18px">Compile on save</label></div>
    </div>
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><b>Autosave to disk</b><small>Automatically save every 30 seconds.</small></div>
      <div class="bs-prefs-row__ctrl"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" style="accent-color:var(--accent);width:18px;height:18px">Autosave to disk</label></div>
    </div>
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><b>Auto-compile after pause</b><small>Compile 2 s after you stop typing.</small></div>
      <div class="bs-prefs-row__ctrl"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" style="accent-color:var(--accent);width:18px;height:18px">Auto-compile after pause</label></div>
    </div>
  </div>
</div>
<div class="bs-prefs-section">
  <div class="bs-prefs-section__head">LaTeX Setup</div>
  <p class="bs-prefs-section__desc">The LaTeX compiler Plum uses to build PDFs. Editing, saving and opening projects work without one.</p>
  <div class="bs-prefs-list">
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><span class="field__label" style="font-weight:500;font-size:inherit;color:var(--text)">LaTeX setup…</span><div class="lx-stat" id="lxStatus" aria-live="polite"></div></div>
      <div class="bs-prefs-row__ctrl"><button type="button" class="btn btn--sm" id="lxRerun">Run setup again</button></div>
    </div>
  </div>
</div>
<div class="bs-prefs-section">
  <div class="bs-prefs-section__head">Document Defaults</div>
  <p class="bs-prefs-section__desc">Apply to new documents only. A document that names its own compiler (<code>% !TEX program</code>) or sets its own <code>\\setmainfont</code> is never changed.</p>
  <div class="bs-prefs-list">
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><label class="field__label" style="font-weight:500;font-size:inherit;color:var(--text)">Default compiler<select style="display:none"><option>XeLaTeX</option><option>LuaLaTeX</option></select></label><small>Engine used for new documents.</small></div>
      <div class="bs-prefs-row__ctrl"></div>
    </div>
    <div class="bs-prefs-row">
      <div class="bs-prefs-row__info"><label class="field__label" style="font-weight:500;font-size:inherit;color:var(--text)">Default body font<input value="" style="display:none"></label><small>Font applied via <code>\\setmainfont</code> in new documents.</small></div>
      <div class="bs-prefs-row__ctrl"></div>
    </div>
  </div>
</div>
` }),
    chart: () => ({ t: 'Chart', i: 'chart-column', w: 980, cls: 'dlg--plot', btns: ['Close'], b: `<div class="pd"><div class="pd__ctrl">
      <div class="pd__grp"><div class="pd__gb">
        <div class="field"><span class="field__label">Chart type</span><select id="chType"><option value="line">Line</option><option value="scatter">Scatter</option><option value="bar">Bar</option><option value="histogram">Histogram</option><option value="box">Box plot</option><option value="heatmap">Heatmap</option></select></div>
        <div class="field"><span class="field__label" id="chVarL">Variant</span><select id="chVar"></select></div>
        <div class="field" id="chBinsF" style="display:none"><span class="field__label">Bins</span><input id="chBins" type="number" min="1" max="200" value="10"></div>
        <div class="pd__btns"><button type="button" class="btn btn--sm" id="chPubPreset" title="8 pt font, open axes, no grid, 3.4 in width">Publication style</button></div>
      </div></div>
      <details class="pd__grp" open><summary>Size & Ratio</summary><div class="pd__gb">
        <div class="pd__row">
          <div class="field"><span class="field__label">Width (in)</span><input id="chWin" type="number" step="0.1" min="0.5" max="30" value="6.4"></div>
          <div class="field"><span class="field__label">Height (in)</span><input id="chHin" type="number" step="0.1" min="0.5" max="30" value="4.2"></div>
        </div>
        <label class="pd__check"><input type="checkbox" id="chLock">Lock ratio</label>
        <div class="pd__btns" id="chRatios">
          <button type="button" class="btn btn--sm" data-r="1.7778" title="16:9 widescreen">16:9</button>
          <button type="button" class="btn btn--sm" data-r="1.3333" title="4:3 ratio">4:3</button>
          <button type="button" class="btn btn--sm" data-r="1.5" title="3:2 ratio">3:2</button>
          <button type="button" class="btn btn--sm" data-r="1" title="1:1 square">1:1</button>
          <button type="button" class="btn btn--sm" data-w="3.4" title="Journal single column">1-col (3.4")</button>
          <button type="button" class="btn btn--sm" data-w="7" title="Journal double column">2-col (7")</button>
        </div>
      </div></details>
      <details class="pd__grp" open><summary>Titles & Labels</summary><div class="pd__gb">
        <div class="field"><span class="field__label">Title</span><input id="chTitle"></div>
        <div class="field"><span class="field__label">Subtitle</span><input id="chSubtitle"></div>
        <div class="field"><span class="field__label">X-axis label</span><input id="chX"></div>
        <div class="field"><span class="field__label">Y-axis label</span><input id="chY"></div>
      </div></details>
      <details class="pd__grp" open><summary>Theme & Palettes</summary><div class="pd__gb">
        <div class="pd__row">
          <div class="field"><span class="field__label">Theme</span><select id="chStyle"><option value="">Default</option><option value="seaborn-v0_8-whitegrid">Clean grid</option><option value="seaborn-v0_8-ticks">Minimal ticks</option><option value="ggplot">ggplot</option><option value="bmh">Bayesian (bmh)</option></select></div>
          <div class="field"><span class="field__label">Palette</span><select id="chPal"><option value="default">Default (Okabe-Ito)</option><option value="colorblind">Colorblind (Okabe-Ito)</option><option value="muted">Muted (Tol)</option><option value="grayscale">Grayscale</option><option value="viridis">Viridis</option><option value="plasma">Plasma</option><option value="inferno">Inferno</option><option value="magma">Magma</option><option value="coolwarm">Coolwarm</option><option value="bwr">Blue-White-Red</option><option value="RdBu">Red-Blue</option><option value="seismic">Seismic</option></select></div>
        </div>
      </div></details>
      <details class="pd__grp"><summary>Typography</summary><div class="pd__gb">
        <div class="field"><span class="field__label">Font family</span><select id="chFam"><option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option></select></div>
        <div class="pd__row">
          <div class="field"><span class="field__label">Base (pt)</span><input id="chFsz" type="number" step="0.5" min="4" max="72" value="10"></div>
          <div class="field"><span class="field__label">Title (pt)</span><input id="chFszT" type="number" step="0.5" min="4" max="72" placeholder="Auto"></div>
        </div>
        <div class="pd__row">
          <div class="field"><span class="field__label">Labels (pt)</span><input id="chFszL" type="number" step="0.5" min="4" max="72" placeholder="Auto"></div>
          <div class="field"><span class="field__label">Ticks (pt)</span><input id="chFszTk" type="number" step="0.5" min="4" max="72" placeholder="Auto"></div>
        </div>
      </div></details>
      <details class="pd__grp"><summary>Axes & Limits</summary><div class="pd__gb">
        <label class="pd__check"><input type="checkbox" id="chDespine">Open axes (despine)</label>
        <div class="field"><span class="field__label">Tick direction</span><select id="chTickDir"><option value="out">Ticks out</option><option value="in">Ticks in</option><option value="inout">Ticks in & out</option></select></div>
        <div class="pd__row">
          <div class="field"><span class="field__label">X scale</span><select id="chXscale"><option value="linear">Linear</option><option value="log">Log</option></select></div>
          <div class="field"><span class="field__label">Y scale</span><select id="chYscale"><option value="linear">Linear</option><option value="log">Log</option></select></div>
        </div>
        <div class="pd__row">
          <div class="field"><span class="field__label">X range</span><input id="chXlim" placeholder="Auto (min, max)"></div>
          <div class="field"><span class="field__label">Y range</span><input id="chYlim" placeholder="Auto (min, max)"></div>
        </div>
        <div class="pd__row">
          <div class="field"><span class="field__label">X tick rot (°)</span><input id="chXrot" type="number" step="5" min="-90" max="90" placeholder="0"></div>
          <div class="field"><span class="field__label">Y tick rot (°)</span><input id="chYrot" type="number" step="5" min="-90" max="90" placeholder="0"></div>
        </div>
      </div></details>
      <details class="pd__grp"><summary>Grid & Legend</summary><div class="pd__gb">
        <div class="pd__checks">
          <label class="pd__check"><input type="checkbox" id="chGrid" checked>Major grid</label>
          <label class="pd__check"><input type="checkbox" id="chGridMin">Minor grid</label>
        </div>
        <div class="pd__row">
          <div class="field"><span class="field__label">Grid style</span><select id="chGridSty"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="dashdot">Dash-dot</option></select></div>
          <div class="field"><span class="field__label">Grid opacity</span><select id="chGridSub"><option value="0.3">Faint (30%)</option><option value="0.6">Light (60%)</option><option value="1">Full (100%)</option></select></div>
        </div>
        <div class="pd__checks">
          <label class="pd__check"><input type="checkbox" id="chLeg" checked>Show legend</label>
          <label class="pd__check"><input type="checkbox" id="chLegFrame" checked>Legend frame</label>
        </div>
        <div class="field"><span class="field__label">Legend position</span><select id="chLegPos"><option value="best">Best automatic</option><option value="upper right">Upper right</option><option value="upper left">Upper left</option><option value="lower right">Lower right</option><option value="lower left">Lower left</option><option value="center">Center</option><option value="outside">Outside right</option></select></div>
      </div></details>
      <p class="pd__note" id="chNote"></p></div>
      <div class="pd__main"><div class="dtabs" role="tablist"><button class="dtab is-active" data-t="preview">Preview</button><button class="dtab" data-t="sheet">Spreadsheet</button><button class="dtab" data-t="code">Code</button><button class="dtab" data-t="export">Export</button></div>
      <div class="pd__pane" data-p="preview"><div class="pd__canvas" id="chCanvas"></div><div class="pd__status" id="chStat"></div></div>
      <div class="pd__pane" data-p="sheet" style="display:none"><div class="chgrid-wrap"><table class="chgrid" id="chGridT"></table></div><div class="pd__srcbar"><button class="btn btn--sm" data-a="ar">+ Row</button><button class="btn btn--sm" data-a="dr">− Row</button><button class="btn btn--sm" data-a="ac">+ Column</button><button class="btn btn--sm" data-a="dc">− Column</button><button class="btn btn--sm" data-a="csv">Import CSV</button><span class="pd__note">You can paste from Excel / Sheets.</span></div></div>
      <div class="pd__pane" data-p="code" style="display:none"><textarea class="chcode" id="chCode" spellcheck="false"></textarea><div class="pd__srcbar"><select id="chCodeMode" aria-label="Code view"><option value="cfg">Plot configuration (editable)</option><option value="py">Matplotlib script (read-only)</option></select><button class="btn btn--sm" id="chCopy">Copy</button><span class="pd__note" id="chCodeNote"></span></div></div>
      <div class="pd__pane" data-p="export" style="display:none"><div class="pd__row"><div class="field"><span class="field__label">Format</span><select id="chFmt"><option>PNG</option><option>PDF</option><option>SVG</option></select></div><div class="field"><span class="field__label">File name</span><input id="chName" value="chart"></div></div>
      <div class="field"><span class="field__label">PNG resolution</span><select id="chDpi"><option value="150">150 dpi</option><option value="300" selected>300 dpi</option><option value="600">600 dpi</option></select></div>
      <div class="field"><span class="field__label">Caption (used when inserting into the document)</span><input id="chCap"></div>
      <div class="pd__srcbar"><button class="btn" id="chDl">Download</button><button class="btn" id="chSave">Save to figures/</button><button class="btn btn--primary" id="chIns">Insert into document</button></div>
      <p class="pd__note">Saving and inserting need an open project folder. Insert places a figure with \\includegraphics at the cursor (PNG or PDF; XeLaTeX can’t include SVG).</p></div></div></div>` }),
    flow: () => ({ t: 'Flow Diagram', i: 'braces', w: 700, btns: ['Close'], b: FLOW_UI }),
    titleblock: () => ({ t: 'Title Block', i: 'type', w: 460, btns: ['Cancel', 'Apply'], b: F([['t', 'Title', ''], ['t', 'Subtitle (optional)', ''], ['t', 'Author', ''], ['t', 'Affiliation (optional)', ''], ['s', 'Date', '\\today|Fixed date|None'], ['t', 'Fixed date text', '']]) + '<p class="pd__note">Fields holding custom LaTeX are shown as-is and left untouched unless you edit them. Typed text is escaped automatically.</p>' }),
    decor: (f) => ({ t: 'Page Decoration', i: 'frame', w: 720, cls: 'dlg--dec', btns: ['Cancel', 'Remove all', 'Apply'], focus: f === 'wm' ? '[data-k="wm"]' : f === 'bd' ? '[data-a="pre"][data-v="all"]' : '[data-k="bghex"]', b: `<div class="dec">
      <div class="dec__scope" data-r="scope">
        <div class="field dec__f1"><label class="field__label">Apply to<select data-k="scope"><option>Entire document</option></select></label></div>
        <div class="field dec__f2" data-r="pgrow" hidden><label class="field__label">PDF pages<input data-k="pages" placeholder="1, 3-5, 8-" spellcheck="false" autocomplete="off"></label></div>
        <div class="dec__acts"><button type="button" class="btn btn--sm" data-a="addrule">Add page set</button><button type="button" class="btn btn--sm" data-a="rmrule" hidden>Remove page set</button></div>
      </div>
      <div class="dtabs" role="tablist" aria-label="Page decoration">${[['bg', 'Background'], ['bd', 'Borders'], ['wm', 'Watermark']].map(([k, l]) => `<button type="button" class="dtab" role="tab" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="dec__main">
        <div class="dec__panes">
          <section class="dec__pane" data-p="bg">
            <div class="dec__h">Page color</div>
            <div class="dec__colrow"><button type="button" class="dec__sw" data-a="pick" data-w="bg" aria-label="Choose page color" title="Choose page color"><i></i></button><div class="field"><input data-k="bghex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Page color, hex"></div><button type="button" class="btn btn--sm" data-a="bgreset">Default</button></div>
            <p class="dec__state" data-r="bgstate"></p>
            <div class="dec__h">Quick colors</div>
            <div class="dec__quick">${[['FFFFF0', 'Ivory'], ['F0F0F0', 'Light gray'], ['F4ECD8', 'Sepia'], ['EAF2FB', 'Light blue'], ['EAF5EA', 'Light green'], ['FDEBEC', 'Light rose']].map(([x, n]) => `<button type="button" class="dec__q" data-a="bgq" data-hex="${x}" style="background:#${x}" title="${n} (#${x})" aria-label="${n}"></button>`).join('')}</div>
          </section>
          <section class="dec__pane" data-p="bd">
            <div class="dec__h">Sides</div>
            <div class="hfp__seg" role="group" aria-label="Presets">${[['none', 'None'], ['all', 'All sides'], ['tb', 'Top and bottom'], ['lr', 'Left and right']].map(([k, l]) => `<button type="button" data-a="pre" data-v="${k}">${l}</button>`).join('')}</div>
            <div class="dec__sides" role="group" aria-label="Active sides">${['Top', 'Right', 'Bottom', 'Left'].map((l, i) => `<button type="button" class="dec__side" data-a="side" data-i="${i}" aria-pressed="false">${l}</button>`).join('')}</div>
            <div class="dec__h">Line</div>
            <div class="dec__edit"><span>Edit</span><div class="hfp__seg" role="group" aria-label="Sides to edit"><button type="button" data-a="tg" data-v="all">All sides</button>${['Top', 'Right', 'Bottom', 'Left'].map((l, i) => `<button type="button" data-a="tg" data-v="${i}">${l}</button>`).join('')}</div></div>
            <div class="dlg-grid">
              <div class="field"><label class="field__label">Line style<select data-k="style"><option>None</option><option>Solid</option><option>Dashed</option><option>Dotted</option><option>Double</option></select></label></div>
              <div class="field"><label class="field__label">Thickness (pt)<input data-k="w" type="number" min="0.25" max="12" step="0.25"></label></div>
              <div class="field"><div class="field__label">Color<div class="dec__colrow"><button type="button" class="dec__sw" data-a="pick" data-w="bd" aria-label="Choose border color" title="Choose border color"><i></i></button><input data-k="bdhex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Border color, hex"></div></div></div>
              <div class="field"><label class="field__label">Distance from page edge (pt)<input data-k="d" type="number" min="0" max="72" step="1"></label></div>
            </div>
            <p class="dec__state" data-r="bdstate"></p>
            <div><button type="button" class="btn btn--sm" data-a="bdreset">Reset borders</button></div>
          </section>
          <section class="dec__pane" data-p="wm">
            <div class="field"><label class="field__label">Watermark text (empty = none)<input data-k="wm" spellcheck="false" autocomplete="off"></label></div>
            <div class="dec__h">Font</div>
            <div class="dlg-grid dec__wmf">
              <div class="field"><div class="field__label">Family<button type="button" class="c-select" data-a="wmfont" aria-haspopup="listbox"><span class="c-select__text" data-r="wmfont"></span><svg class="c-select__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button></div></div>
              <div class="field"><label class="field__label">Size (pt)<input data-k="wmz" type="number" min="6" max="400" step="1" placeholder="Auto"></label></div>
              <div class="field"><div class="field__label">Style<div class="hfp__seg" role="group" aria-label="Font style"><button type="button" data-a="wmb" aria-pressed="false" title="Bold"><b>B</b></button><button type="button" data-a="wmi" aria-pressed="false" title="Italic"><i>I</i></button></div></div></div>
            </div>
            <div class="dec__h">Appearance</div>
            <div class="dlg-grid">
              <div class="field"><div class="field__label">Color<div class="dec__colrow"><button type="button" class="dec__sw" data-a="pick" data-w="wm" aria-label="Choose watermark color" title="Choose watermark color"><i></i></button><input data-k="wmhex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Watermark color, hex"></div></div></div>
              <div class="field"><div class="field__label">Opacity<div class="dec__op"><input class="zoom__range dec__rng" type="range" min="0" max="100" step="1" data-k="wmo" aria-label="Watermark opacity"><input type="number" min="0" max="100" step="1" data-k="wmon" aria-label="Watermark opacity, percent"><span>%</span></div></div></div>
            </div>
            <div class="dec__h">Rotation and position</div>
            <div class="dlg-grid">
              <div class="field"><div class="field__label">Rotation (counterclockwise)<div class="hfp__seg" role="group" aria-label="Rotation presets">${[0, 45, 90, 180].map((a) => `<button type="button" data-a="wmrot" data-v="${a}">${a}°</button>`).join('')}</div></div></div>
              <div class="field"><label class="field__label">Custom angle (°)<input data-k="wma" type="number" min="-180" max="180" step="1"></label></div>
            </div>
            <div class="dlg-grid dec__wmp">
              <div class="field"><label class="field__label">Horizontal (% of page width)<input data-k="wmx" type="number" min="0" max="100" step="1"></label></div>
              <div class="field"><label class="field__label">Vertical (% from page top)<input data-k="wmy" type="number" min="0" max="100" step="1"></label></div>
              <button type="button" class="btn btn--sm dec__cen" data-a="wmcen">Center</button>
            </div>
            <div><button type="button" class="btn btn--sm" data-a="wmreset">Reset watermark style</button></div>
            <p class="dec__state" data-r="wmstate"></p>
          </section>
          <p class="dec__state dec__src">Written to one managed preamble block. Headers, footers and margins are untouched. Pages are counted in the compiled PDF.</p>
        </div>
        <aside class="dec__prev" aria-label="Preview"><div class="dec__cap" data-r="cap"></div><div class="dec__sheet" data-r="sheet"></div><div class="dec__strip" data-r="strip" aria-label="First pages"></div></aside>
      </div>
    </div>` }),
    colors: () => ({ t: 'Custom Colors', i: 'palette', w: 380, btns: ['Cancel', 'Apply'], b: F([['s', 'Apply to', 'Accent|Body text|Chapter|Section|Subsection|Subsubsection|All headings'], ['t', 'HTML value', '1F3A7A']]), ok: (el) => {
      const v = $('input', el).value.trim().replace(/^#/, ''), r = ['accent', 'body', 'chapter', 'section', 'subsection', 'subsubsection', 'heading'][$('select', el).selectedIndex];
      if (!/^[0-9a-f]{6}$/i.test(v)) return toast('Enter a 6-digit HTML color such as 1F3A7A. Nothing was changed');
      themeApply(themeWant(r, v.toUpperCase()));
    } }),
    para: (v) => { v = v || [0, 0, 0, 0, 0, 0, 'Single']; return { t: 'Paragraph', i: 'align-left', w: 440, btns: ['Cancel', 'OK'], b: F([['g', [['t', 'Left indent (cm)', v[0]], ['t', 'Right indent (cm)', v[1]], ['t', 'First line (cm)', v[2]], ['t', 'Hanging (cm)', v[3]], ['t', 'Before (pt)', v[4]], ['t', 'After (pt)', v[5]]]], ['s', 'Line spacing', 'Single|1.15|1.5|Double']]) }; },
    nav: () => ({ t: 'Navigation Pane', i: 'panel-left', w: 420, btns: ['Close'], b: `<table class="tbl"><tbody><tr><td><b>Chapter 1</b> Introduction</td></tr><tr><td style="padding-left:24px">1.1 Background</td></tr><tr><td style="padding-left:24px">1.2 Contributions</td></tr><tr><td><b>Chapter 2</b> Methods</td></tr></tbody></table>${note}` }),
    about: () => ({ t: 'About ' + APP_NAME, i: 'info', w: 400, btns: ['Close'], b: `<p><b>${esc(APP_NAME)}</b> <span class="muted">version ${esc(APP_VERSION)}</span></p><p>A local LaTeX editor that runs in your browser. Your source and project files are compiled with XeLaTeX by the small Node server on this machine (<code>server/server.js</code>).</p><p class="demo-note">Nothing is sent to any third party.</p>` })
  };
  const INFO = { docs: ['Documentation', 'Browse guides for writing and compiling documents with XeLaTeX.'], start: ['Getting Started', 'Create a document, write a few sections, then press Compile to see the PDF.'], basics: ['LaTeX Basics', 'Commands start with a backslash, environments wrap content between \\begin and \\end, and packages extend the language.'], diag: ['Compilation Diagnostics', 'Warnings and errors from the last compile would appear here, with line numbers.'] };
  /* ---------- Markdown docs (Documentation / Getting Started / LaTeX Basics) ---------- */
  const {
    MD_DOCS, mdInline, mdRender, mdDialog, openDoc,
    refPanel, refPackages, refShortcuts, refTrouble, pkCat
  } = window.RPE.docs;
  /* ---------- Flow diagram editor (Insert › Charts & Diagrams › Flow Diagram) ---------- */
  const {
    FLOW, FLOW_TYPES, FLOW_UI, flowTikz, tikzLibs, flowPre, diagramRef, flowDialog
  } = window.RPE.flow;
  /* ---------- Citation Library & Bibliography ---------- */
  const {
    LIB_KEY, LIB, libSave, libId, BIB_TYPES, PUB_FIELDS, pubField, pubOf, normDoi, normTitle,
    keyOk, bracesOk, keyTaken, bibEsc, BIB_REQ, uniqueKey, lastName, authorsShort, autoKey,
    pdfDb, pdfOp, pdfPut, pdfGet, pdfDel, pdfMeta,
    parseBib, formatBibEntry, bibEntry, bibText,
    bibDialog, citeDialog, detectAndParseRefs, bibImportDialog,
    CITE_STYLES, bibSys, bibRefuse, bibApplyEds, bibApply, bibInsert,
    bibHeadingPick, bibStylePick, bibMenu, bibUpdate
  } = window.RPE.bib;
  function openD(id) {
    window.RPE.openD = openD;
    if (id === 'cite') return citeDialog();
    if (id === 'options') return backstage(true, 'Preferences');
    if (id === 'about') return backstage(true, 'About');
    if (id === 'latexsetup') return openWizard(1);
    if (id === 'bib') return bibDialog();
    if (id === 'bibimport') return bibImportDialog();
    if (id === 'para') return paraDialog();
    if (id === 'link') return linkDialog();
    if (id === 'toc') return tocInsert(true);
    if (id === 'hf' || id === 'hfh' || id === 'hff' || id === 'hfn') return hfDialog(id === 'hf' ? 'h' : id.slice(2));
    if (id === 'decor' || id.startsWith('decor:')) return pdDialog(id.slice(6));
    if (id === 'titleblock') return tbDialog();
    if (id === 'margins') return pageDialog();
    if (id === 'table') return tableDialog();
    if (id === 'picture' || id === 'figure') return pictureDialog(id === 'figure');
    if (id === 'chart') return chartDialog();
    if (id === 'flow') return flowDialog();
    if (id === 'comment') return commentDialog();
    if (id === 'compare') return compareDialog();
    if (id === 'equation') return eqDialog();
    if (id === 'symbols') return symbolDialog();
    if (id === 'hdesign') return headingDialog();
    if (id === 'footnotes') return fnToggle();
    if (id === 'find') return toggleFindPanel();   // Find/Replace is a real panel now, not a dialog, see below
    if (id === 'pkgref') return refPackages();
    if (id === 'shortcuts') return refShortcuts();
    if (id === 'trouble') return refTrouble();
    if (id === 'diag') return diagDialog();
    if (PK_NAMES.has(id)) return pkgDlg(id);
    if (D[id]) return dlg(D[id]());
    if (MD_DOCS[id]) return mdDialog(id);
    const i = INFO[id] || [id, 'Sample help text.']; dlg({ t: i[0], i: 'circle-help', w: 440, btns: ['Close'], b: `<p>${i[1]}</p>${note}` });
  }
  window.RPE.openD = openD;
  document.addEventListener('mouseover', (e) => { const g = $('#tg'); if (!g || !e.target.closest('#tg')) return; const n = +e.target.dataset.i; if (isNaN(n)) return; const c = n % 10 + 1, r = Math.floor(n / 10) + 1; $$('i', g).forEach((x) => x.classList.toggle('on', x.dataset.i % 10 < c && Math.floor(x.dataset.i / 10) < r)); $('#tgl').textContent = c + ' × ' + r; });

  /* ---------- ribbon (data-driven) ---------- */
  const L = (l, i, o) => Object.assign({ k: 'L', l, i }, o), S = (l, i, o) => Object.assign({ k: 'S', l, i }, o), I = (l, i, o) => Object.assign({ k: 'I', l, i }, o);
  const st = (...a) => ({ k: 'st', a }), rw = (...a) => ({ k: 'rw', a }), CB = (l, w, v, m) => ({ k: 'cb', l, w, v, m }), NM = (l, v, pk) => ({ k: 'nm', l, v, pk }), SP = { k: 'sp' };
  const g = (l, ...items) => ({ l, items });
  const SYSTEM_FONTS = [
    'Computer Modern', 'Latin Modern Roman', 'Latin Modern Sans', 'Latin Modern Mono',
    'TeX Gyre Termes', 'TeX Gyre Pagella', 'TeX Gyre Heros', 'TeX Gyre Cursor', 'TeX Gyre Bonum',
    'Libertinus Serif', 'Source Serif 4', 'Fira Sans'
  ];
  const BUNDLED_FONTS = ['Amiri', 'Arimo', 'Bitter', 'Cairo', 'Caveat', 'Cinzel', 'Cormorant Garamond', 'EB Garamond', 'Fira Code', 'Inconsolata', 'Inter', 'JetBrains Mono', 'Lato', 'Libre Baskerville', 'Lora', 'Merriweather', 'Montserrat', 'Noto Sans Arabic', 'Open Sans', 'OpenDyslexic', 'Oswald', 'Outfit', 'PT Serif', 'Pacifico', 'Playfair Display', 'Plus Jakarta Sans', 'Poppins', 'Raleway', 'Roboto', 'Scheherazade New', 'Source Code Pro', 'Source Sans 3', 'Space Grotesk', 'Space Mono', 'Spline Sans', 'Tajawal'];
  const FONTS = [...SYSTEM_FONTS, '-', ...BUNDLED_FONTS], SIZES = ['8', '9', '10', '10.5', '11', '12', '14', '16', '18', '24'];
  function fontMenuItems(opts) {
    const items = [], ed = (window.RPE && window.RPE.editor) || {}, fs = ed.fontSet, fb = ed.fontBundled;
    const bSet = (fb && fb.size) ? fb : new Set(BUNDLED_FONTS.map((f) => f.toLowerCase()));
    const cur = (opts && opts.selected ? opts.selected : '').toLowerCase();
    const fStyle = (name) => {
      const fallback = /mono|code|cursor/i.test(name) ? 'monospace' : /sans|heros/i.test(name) ? 'sans-serif' : /caveat|pacifico/i.test(name) ? 'cursive, sans-serif' : 'serif';
      return `font-family:'${name}', ${fallback}; font-size:13px`;
    };
    if (opts && opts.includeNone) {
      items.push({ l: (opts.noneLabel || 'None (LaTeX default)'), val: '', checked: !cur, sub: 'Default' }, '-');
    }
    items.push({ head: 'Standard & System Fonts' });
    SYSTEM_FONTS.forEach((f) => {
      const ok = !fs || fs.has(f.toLowerCase()), sub = ok ? 'System' : 'Unavailable';
      items.push({ l: f, style: fStyle(f), sub, checked: !!cur && cur === f.toLowerCase() });
    });
    items.push({ head: 'Bundled Fonts' });
    const allBundled = [...BUNDLED_FONTS];
    if (typeof fontRaw !== 'undefined' && fontRaw.length) fontRaw.forEach((f) => { if (bSet.has(f.toLowerCase()) && !allBundled.some((x) => x.toLowerCase() === f.toLowerCase())) allBundled.push(f); });
    allBundled.sort((a, b) => a.localeCompare(b)).forEach((f) => {
      const ok = !fs || fs.has(f.toLowerCase()), sub = ok ? '' : 'Unavailable';
      items.push({ l: f, style: fStyle(f), sub, checked: !!cur && cur === f.toLowerCase() });
    });
    return items;
  }
  window.RPE.fonts = { menuItems: fontMenuItems, load: () => fontLoad(), list: FONTS };   // shared with the Flow Diagram editor's font dropdown
  const HLC = ['● Yellow', '● Green', '● Cyan', '● Pink', '● Orange'];
  const COL = ['● Navy', '● Indigo', '● Forest', '● Crimson', '● Charcoal', '-', 'Custom Colors…|@colors'];
  const BUL = ['● Filled circle', '○ Hollow circle', '■ Square', '– Dash', '➤ Arrow'], NUM = ['1.  2.  3.   Arabic', 'A.  B.  C.   Uppercase letters', 'a.  b.  c.   Lowercase letters', 'I.  II.  III.   Uppercase Roman', 'i.  ii.  iii.   Lowercase Roman'];
  const SPC = ['0 pt', '6 pt', '12 pt', '18 pt', '-', 'Paragraph Options…|@para'];
  const SECM = ['New section', 'New section on a new page', 'Page layout boundary (\\clearpage)'];
  const BRK = (p) => [S('Page Break', 'file-plus-2', { brk: 'page' }), S('Column Break', 'separator-vertical', { brk: 'col' }), S('Section Break', 'between-vertical-end', { brk: 'sec', m: SECM })];
  /* Styles gallery, LaTeX-aware preview per style. Integration point: once the backend exists, replace this
     static list (and its CSS previews) with styles derived from the compiled document's class/packages. */
  const STYLES = [
    { id: 'normal', label: 'Normal', css: 'font:12px var(--font)' },
    { id: 'title', label: 'Title', css: `font:700 19px 'TeX Gyre Termes','Times New Roman',serif` },
    { id: 'subtitle', label: 'Subtitle', css: `font:italic 14px 'TeX Gyre Termes','Times New Roman',serif;color:var(--text-2)` },
    { id: 'chapter', label: 'Chapter', css: `font:700 17px 'TeX Gyre Termes','Times New Roman',serif;color:var(--accent)` },
    { id: 'section', label: 'Section', css: `font:700 14.5px 'TeX Gyre Termes','Times New Roman',serif` },
    { id: 'subsection', label: 'Subsection', css: `font:italic 600 13.5px 'TeX Gyre Termes','Times New Roman',serif;padding-left:22px` },
    { id: 'subsubsection', label: 'Subsubsection', css: `font:600 12.5px 'TeX Gyre Termes','Times New Roman',serif;color:var(--text-2);padding-left:34px` },
    { id: 'paragraph', label: 'Paragraph', css: 'font:12px var(--font);color:var(--text-2)' },
    { id: 'quote', label: 'Quote', css: `font:italic 13px 'TeX Gyre Termes','Times New Roman',serif;color:var(--text-2);padding-left:18px;border-left:2px solid var(--border-2)` },
    { id: 'code', label: 'Code / Listing', css: 'font:12px var(--mono);box-shadow:inset 0 0 0 1px var(--border-2),inset 3px 0 0 var(--accent);border-radius:2px' }
  ];
  let curStyle = 'normal';
  const HD_STYLES = { 'Classic': '\\relax', 'Small caps': '\\mdseries\\scshape', 'Sans-serif': '\\sffamily', 'Rule below': '\\relax' }, HD_NUMS = ['1, 1.1, 1.1.1', 'I, A, 1', 'None'], HD_SPACE = ['Compact', 'Normal', 'Open'];
  /* Document-structure styles act on the real source: the lines covered by the selection (or the caret line) become
     \chapter…\paragraph{} or a quote environment. Headings are re-styled in place (keeping a \section* star / [short title]). */
  const HEAD = ['chapter', 'section', 'subsection', 'subsubsection', 'paragraph'];
  const HEAD_RE = /^\\(chapter|section|subsection|subsubsection|paragraph)(\*?)(\[[^\]]*\])?\{/;
  function styleSupport(t) {   // -> { ok:(id)=>reason|null }
    const c = (/^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/m.exec(t) || [])[1] || '';
    const chap = /^(report|book|memoir|scrbook|scrreprt|amsbook|ctexrep|ctexbook)$/.test(c), noSec = c === 'letter';
    return (id) => id === 'chapter' && !chap ? '\\chapter isn’t available in the “' + (c || 'unknown') + '” class. Use report/book, or pick Section'
      : noSec && HEAD.includes(id) ? 'The “letter” class has no sectioning commands' : null;
  }
  function applyCode(ta) {   // Code / Listing: wraps the selected lines in lstlisting (when the listings package is loaded) or verbatim; needs a real selection
    const t = ta.value, bs = t.indexOf('\\begin{document}'), be = t.lastIndexOf('\\end{document}');
    let a = ta.selectionStart, b = ta.selectionEnd;
    if (a === b) return toast('Select the text to turn into code first'), false;
    if (t[b - 1] === '\n') b--;
    const s = t.lastIndexOf('\n', a - 1) + 1; let e = t.indexOf('\n', b); if (e < 0) e = t.length;
    if (bs < 0 || s < bs + 16 || (be >= 0 && e > be)) return toast('Select text inside the document body to apply a style'), false;
    const seg = t.slice(s, e); if (!seg.trim()) return toast('Select some text first'), false;
    const CODE = /\\(begin|end)\{(?:verbatim|lstlisting)\*?\}/g, before = t.slice(bs, s);
    if ((before.match(/\\begin\{(?:verbatim|lstlisting)\*?\}/g) || []).length > (before.match(/\\end\{(?:verbatim|lstlisting)\*?\}/g) || []).length || /^\s*\\begin\{(?:verbatim|lstlisting)\*?\}[\s\S]*\\end\{(?:verbatim|lstlisting)\*?\}\s*$/.test(seg)) return toast('Already a code block'), true;
    if (CODE.test(seg)) return toast('Selection already contains a code block. Select plain text only'), false;
    const st = []; let bad = false;   // the selection must open and close its own environments
    for (const m of seg.matchAll(/\\(begin|end)\{([^}]*)\}/g)) { if (m[1] === 'begin') st.push(m[2]); else if (st.pop() !== m[2]) bad = true; }
    if (bad || st.length) return toast('Selection cuts through a LaTeX environment. Select whole blocks'), false;
    if (!balanced(seg)) return toast('Selection has unmatched braces. Adjust it and try again'), false;
    const env = /^[ \t]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\blistings\b[^}]*\}/m.test(t.slice(0, bs)) ? 'lstlisting' : 'verbatim', out = '\\begin{' + env + '}\n' + seg + '\n\\end{' + env + '}';
    fmtEdit(ta, s, e, out, s, s + out.length);
    return true;
  }
  function applyStyle(id) {
    const ta = $('#codeInput'); if (!ta) return false;
    const t = ta.value, blocked = styleSupport(t)(id);
    if (blocked) return toast(blocked), false;
    if (id === 'code') return applyCode(ta);
    const bs = t.indexOf('\\begin{document}'), be = t.lastIndexOf('\\end{document}');
    let a = ta.selectionStart, b = ta.selectionEnd; if (b > a && t[b - 1] === '\n') b--;
    const s = t.lastIndexOf('\n', a - 1) + 1; let e = t.indexOf('\n', b); if (e < 0) e = t.length;
    if (bs < 0 || s < bs + 16 || (be >= 0 && e > be)) return toast('Select text inside the document body to apply a style'), false;
    let blk = t.slice(s, e); const ind = /^[ \t]*/.exec(blk)[0]; blk = blk.trim();
    if (!blk) return toast('Place the cursor in (or select) some text first'), false;
    if (/\n[ \t]*\n/.test(blk) && id !== 'quote') return toast('A heading can’t span a paragraph break. Select a single paragraph'), false;
    // Peel off whatever structure is already there: an enclosing/selected quote, then a heading command.
    let from = s, to = e, q = /^\\begin\{quote\}\s*([\s\S]*?)\s*\\end\{quote\}$/.exec(blk), wasQuote = false;
    if (q) blk = q[1], wasQuote = true;
    else {
      const pl = t.lastIndexOf('\n', s - 2) + 1, nl = t.indexOf('\n', e + 1), pv = t.slice(pl, Math.max(pl, s - 1)).trim(), nx = t.slice(e + 1, nl < 0 ? t.length : nl).trim();
      if (pv === '\\begin{quote}' && nx === '\\end{quote}') { from = pl; to = nl < 0 ? t.length : nl; wasQuote = true; }
    }
    let star = '', opt = '', wasHead = false; const hm = HEAD_RE.exec(blk);
    if (hm && close(blk, hm[0].length - 1) === blk.length - 1) { star = hm[2]; opt = hm[3] || ''; blk = blk.slice(hm[0].length, -1).trim(); wasHead = true; }
    else if (/\\(?:begin|end)\s*\{/.test(blk) || /\\(?:chapter|section|subsection|subsubsection|paragraph)\b/.test(blk)) return toast('Selection contains LaTeX environments or headings. Select plain text only'), false;
    if (!balanced(blk)) return toast('Selection has unmatched braces. Adjust it and try again'), false;
    let out;
    if (id === 'normal') { if (!wasQuote && !wasHead) return toast('Already normal body text. Nothing to change'), true; out = blk.replace(/\s*\n\s*/g, '\n'); }
    else if (id === 'quote') { if (wasQuote && !wasHead) return toast('Already a quote'), true; out = '\\begin{quote}\n' + blk.replace(/^[ \t]+/gm, '') + '\n\\end{quote}'; }
    else {
      const one = blk.replace(/\s*\n\s*/g, ' ');
      if (/(^|[^\\])%/.test(blk)) return toast('Selection contains a comment. Remove it before making a heading'), false;
      const short = !blk.includes('\n') && one.length <= 80 && !/[.!?;:,]$/.test(one);
      if (id === 'paragraph' && !wasHead && !wasQuote && !short) return toast('Already ordinary body text: left unchanged'), true;
      if (wasHead && hm[1] === id) return toast('Already ' + id), true;
      out = id === 'paragraph' && !short ? blk : '\\' + id + star + opt + '{' + one + '}';   // long text leaving a quote/heading becomes plain body text
    }
    out = ind + out.replace(/\n(?!$)/g, '\n' + (from === s ? ind : ''));
    fmtEdit(ta, from, to, out, from + ind.length, from + out.length);
    return true;
  }
  function selectStyle(id) {
    const s = STYLES.find((x) => x.id === id) || STYLES[0];
    if (!HEAD.includes(id) && id !== 'normal' && id !== 'quote' && id !== 'code') return toast(s.label + ' style isn’t supported on the source yet');
    if (!applyStyle(id)) return;
    curStyle = id;
    const p = $('.rsty-btn__preview'); if (p) { p.textContent = s.label; p.dataset.sty = id; p.setAttribute('style', styleCss(s, headState($('#codeInput').value))); }
  }
  function openStylesMenu(anchor) {
    const el = h('<div class="popover is-open"><div class="menu menu--styles" role="listbox" aria-label="Styles"></div></div>'), m = el.firstChild, hs = headState($('#codeInput').value);
    STYLES.forEach((s) => {
      const b = h(`<button class="style-opt ${s.id === curStyle ? 'is-sel' : ''}" role="option" aria-selected="${s.id === curStyle}" data-sty="${s.id}" style="${styleCss(s, hs)}">${esc(s.label)}</button>`);
      const why = styleSupport($('#codeInput').value)(s.id); if (why) { b.classList.add('is-off'); b.title = why; }
      b.onclick = () => { closePop(); selectStyle(s.id); };
      b.oncontextmenu = (e) => {   // right-click ▸ Edit: same Heading Design controls as the Design tab
        e.preventDefault(); closePop();
        const at = { getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY - 2, bottom: e.clientY - 2 }), setAttribute() {} };
        menu(at, ['Edit…'], () => (!HD_LEVELS.includes(s.id) ? toast('Only Chapter, Section, Subsection and Subsubsection styles can be edited') : why ? toast(why) : headingDialog(s.id)));
      };
      m.append(b);
    });
    openPop(anchor, el);
  }
  const DOC_CLASSES = ['article', 'report', 'book', 'letter'];
  const TABS = {
    Home: [
      g('Undo', L('Undo', 'undo-2', { undo: 1 }), L('Redo', 'redo-2', { redo: 1 })),
      g('Clipboard', L('Paste', 'clipboard-paste', { paste: 'paste', m: ['Paste', 'Paste as Plain Text', 'Paste as Escaped LaTeX'] }), st(S('Cut', 'scissors', { sel: 'cut' }), S('Copy', 'copy', { sel: 'copy' }), S('Format Painter', 'paintbrush', { fp: 1 }))),
      g('Font', st(rw(CB('Font', 138, FONTS[0], FONTS), CB('Size', 50, '12', SIZES), I('Increase font size', 'a-arrow-up', { fsz: 1 }), I('Decrease font size', 'a-arrow-down', { fsz: -1 }), I('Change case', null, { x: 'Aa', cas: 1, m: ['Sentence case', 'lowercase', 'UPPERCASE'] })),
        rw(I('Bold', 'bold', { t: 1, f: 'textbf' }), I('Italic', 'italic', { t: 1, f: 'textit' }), I('Underline', 'underline', { t: 1, f: 'underline' }), I('Strikethrough', 'strikethrough', { t: 1, f: 'sout' }), I('Subscript', null, { x: 'x₂', t: 1, f: 'textsubscript' }), I('Superscript', null, { x: 'x²', t: 1, f: 'textsuperscript' }), SP, I('Text highlight', 'highlighter', { m: 1, sw: '#F2E04B', c: 'hl' }), I('Font color', null, { x: 'A', m: 1, sw: '#313A75', c: 'textcolor' }), I('Clear formatting', 'ban', { clr: 1 })))),
      g('Paragraph', { k: 'st3', a: [rw(I('Bulleted list', 'list', { m: BUL, ls: 'bul' }), I('Numbered list', 'list-ordered', { m: NUM, ls: 'num' }), I('Multilevel list', 'rows-3', { ml: 1, m: ['Increase list level', 'Decrease list level', '1. / a. / i.', '1.1 / 1.1.1', '● / ○ / ■'] }), SP, I('Decrease indent', 'indent-decrease', { pa: { dIndent: -1 } }), I('Increase indent', 'indent-increase', { pa: { dIndent: 1 } })),
        rw(I('Align left', 'align-left', { pa: { al: 'l' } }), I('Center', 'align-center', { pa: { al: 'c' } }), I('Align right', 'align-right', { pa: { al: 'r' } }), I('Justify', 'align-justify', { pa: { al: 'j' } }), SP, I('Line spacing', 'align-vertical-justify-center', { m: ['1.0', '1.15', '1.5', '2.0'], pk: 'ls' }), I('Spacing before', 'arrow-up', { m: SPC, pk: 'bef' }), I('Spacing after', 'arrow-down', { m: SPC, pk: 'aft' })),
        rw(I('First-line indent', null, { x: '¶→', pa: { first: 0.6 } }), I('Hanging indent', null, { x: '⇤', pa: { hang: 1 } }), I('No indent', 'ban', { pa: { noind: 1 } }))] }),
      g('Styles', { k: 'sty' }),
      g('Editing & Proofing', st(S('Find', 'search', { d: 'find' }), S('Replace', 'replace', { d: 'find' }), S('Select All', 'scan-text', { sel: 'selectAll' })), L('Proofing', 'spell-check', { proof: 1, m: ['Spelling', { l: 'Language', nest: 1 }, 'Word Count'] }))
    ],
    Insert: [
      g('Pages & Breaks', st(...BRK())), g('Links', L('Link', 'link', { d: 'link' }), L('Cross-reference', 'corner-down-right', { xr: 'all' })), g('Footnotes', L('Footnote', 'superscript', { fn: 1 })), g('Comments', L('New Comment', 'message-square', { d: 'comment' })), g('Tables', L('Table', 'table', { d: 'table' })),
      g('Illustrations', { k: 'ill' }),
      g('Contents', L('Table of Contents', 'list', { toc: 1, m: ['Automatic: Classic', 'Automatic: Compact', 'Custom Table of Contents…|@toc'] })),
      g('Header & Footer', st(S('Header', 'panel-top-close', { d: 'hfh' }), S('Footer', 'rows-3', { d: 'hff' }), S('Page Number', 'list-ordered', { hf: 1, m: ['Top of Page', 'Bottom of Page', 'Page X of Y', 'Format Page Numbers…|@hfn'] }))),
      g('Equations', { k: 'eq' }), g('Symbols', L('Symbol', 'omega', { d: 'symbols' })),
      g('Charts & Diagrams', L('Chart', 'chart-column', { d: 'chart' }), L('Flow Diagram', 'braces', { d: 'flow' }))
    ],
    Layout: [
      g('Page Setup', L('Margins', 'frame', { pg: 'm', m: ['Normal (2.5 cm)', 'Narrow (1.27 cm)', 'Wide (3.8 cm)', '-', 'Custom Margins…|@margins'] }), L('Orientation', 'rectangle-vertical', { pg: 'o', m: ['Portrait', 'Landscape'] }), L('Size', 'file-text', { pg: 's', m: ['A4', 'Letter', 'Legal', 'A5'] })),
      g('Columns & Breaks', L('Columns', 'layout-grid', { col: 1, m: ['One', 'Two', 'Three'] }), st(...BRK())),
      g('Paragraph', st(NM('Left', '0 cm', 'left'), NM('Right', '0 cm', 'right'), NM('First line', '0 cm', 'first')), st(NM('Before', '0 pt', 'bef'), NM('After', '0 pt', 'aft'), NM('Hanging', '0 cm', 'hang')), L('Line Spacing', 'align-vertical-justify-center', { m: ['1.0', '1.15', '1.5', '2.0'], pk: 'ls' }), L('Alignment', 'align-justify', { m: ['Left', 'Center', 'Right', 'Justify'], pal: 1 })),
      g('Pagination', st(S('Keep with Next', 'link', { t: 1, pag: 'kwn' }), S('Keep Together', 'group', { t: 1, pag: 'ktg' }), S('Widow/Orphan Control', 'check', { t: 1, pag: 'wo' })), L('Break Options', 'separator-vertical', { pag: 'brk', m: ['Page break before', 'Avoid break inside', 'Clear page'] })),
      g('Source Display', st(S('Line Numbers', 'list-ordered', { t: 1, on: 1, a: 'ln' }), S('Break Markers', 'separator-vertical', { t: 1, a: 'brk' })))
    ],
    Design: [
      g('Document Classes', { k: 'doc' }), g('Templates', { k: 'tpl' }), g('Colors', L('Colors', 'swatch-book', { role: 'theme', m: 1 }), st(S('Body Text Color', 'type', { role: 'body', m: 1 }), S('Heading Color', 'baseline', { role: 'heading', m: 1 }), S('Accent Color', 'swatch-book', { role: 'accent', m: 1 }))),
      g('Fonts', st(S('Body Font', 'type', { frole: 'body', m: FONTS }), S('Heading Font', 'type', { frole: 'heading', m: FONTS }), S('Display Font', 'type', { frole: 'display', m: FONTS }))),
      g('Page Decoration', st(S('Page Borders', 'frame', { d: 'decor:bd' }), S('Page Color', 'paint-bucket', { d: 'decor:bg' }), S('Watermark', 'ghost', { d: 'decor:wm' }))),
      g('Heading Design', L('Heading Styles', 'captions', { hd: 'style', m: [...Object.keys(HD_STYLES), '-', 'Customize…|@hdesign'] }), st(S('Numbering', 'list-ordered', { hd: 'num', m: HD_NUMS }), S('Heading Color', 'baseline', { role: 'heading', m: 1 }), S('Spacing', 'proportions', { hd: 'space', m: HD_SPACE }))),
      g('Document Identity', L('Title Block', 'type', { d: 'titleblock' }), st(S('Author & Affiliation', 'pen-line', { d: 'titleblock' }), S('Reset to Template', 'rotate-ccw', { rst: 1 })))
    ],
    References: [
      g('Table of Contents', L('Table of Contents', 'list', { toc: 1, m: ['Automatic: Classic', 'Automatic: Compact', 'Custom Table of Contents…|@toc'] }), st(S('Update Table', 'refresh-cw', { tu: 1 }), S('Configure Depth', 'rows-3', { tocd: 1, m: ['Chapters only', 'To sections', 'To subsections'] }))),
      g('Lists', st(S('Insert List of Figures', 'images', { lof: 'figures' }), S('Insert List of Tables', 'table', { lof: 'tables' }), S('Update Lists', 'refresh-cw', { lou: 1 }))),
      g('Footnotes', L('Insert Footnote', 'message-square', { fn: 1 }), L('Show Footnotes', 'panel-left', { d: 'footnotes' })),
      g('Citations', L('Insert Citation', 'captions', { d: 'cite' }), st(S('Manage Sources', 'folder-open', { d: 'bib' }), S('Import references', 'file-down', { d: 'bibimport', title: 'Export from Zotero as BibTeX/CSL JSON, then import' }), rw(CB('Style', 112, 'Choose style', ['APA', 'Vancouver', 'Chicago', 'IEEE'])))),
      g('Bibliography', L('Bibliography', 'folder-open', { bib: 1, m: ['Insert Bibliography', 'Insert at End of Document', '-', '#Heading', 'References', 'Bibliography', 'Works Cited'] }), st(S('Update Bibliography', 'refresh-cw', { bibu: 1 }), S('Open Manager', 'folder-open', { d: 'bib' }))),
      g('Cross-references', L('Insert Label', 'tags', { lbl: 1 }), L('Cross-reference', 'link', { xr: 'all' }), st(S('Reference Figures', 'image', { xr: 'fig' }), S('Reference Tables', 'table', { xr: 'tab' }), S('Reference Equations', 'sigma', { xr: 'eq' })))
    ],
    Review: [
      g('Proofing', L('Spelling', 'spell-check', { t: 1, a: 'spell' }), st(S('Language', 'type', { lang: 1 }), S('Word Count', 'list-ordered', { wc: 1 }))),
      g('Comments', L('New Comment', 'message-square', { d: 'comment' }), st(S('Show Comments', 'message-square', { cmt: 'show' }), S('Hide Comments', 'square-x', { cmt: 'hide' }))),
      g('Changes', L('Track Changes', 'pencil-line', { t: 1, trk: 'on' }), st(S('Display Markup', 'scan', { trk: 'mode', m: ['All Markup', 'Simple Markup', 'No Markup', '-', 'Reviewing Pane'] }), S('Accept', 'check', { trk: 'acc', m: ['Accept This', 'Accept All'] }), S('Reject', 'x', { trk: 'rej', m: ['Reject This', 'Reject All'] }))),
      g('Comparison', L('Compare', 'copy-plus', { d: 'compare' }))
    ],
    View: [
      g('Workspace', L('Stack Panes', 'rows-3', { t: 1, a: 'stack' }), st(S('Source Pane', 'file-code', { t: 1, on: 1, a: 'src' }), S('PDF Pane', 'file-text', { t: 1, on: 1, a: 'pdf' }), S('Navigation Pane', 'list', { t: 1, a: 'sidebar' }))),
      g('PDF View', st(S('PDF View', 'file-text', { t: 2, pv: 'pdf' }), S('Print Layout', 'frame', { t: 2, pv: 'print' }), S('Reading View', 'monitor', { t: 2, pv: 'read' })), S('Thumbnails', 'layout-grid', { t: 1, a: 'thumbs' })),
      g('Zoom', st(S('Zoom In', 'zoom-in', { pv: 'in' }), S('Zoom Out', 'minus', { pv: 'out' }), S('Fit Page', 'scan', { pv: 'page' })), st(S('Fit Width', 'proportions', { pv: 'width' }), S('Page Navigation', 'arrow-down', { pvm: 1, m: ['First Page', 'Previous Page', 'Next Page', 'Last Page', 'Go to Page…'] }))),
      g('Show', st(S('Ruler', 'ruler', { t: 1, a: 'ruler' }), S('Page Boundaries', 'frame', { t: 1, a: 'pgb' }), S('Break Markers', 'separator-vertical', { t: 1, a: 'brk' })), st(S('Source Line Numbers', 'list-ordered', { t: 1, on: 1, a: 'ln' }), S('Find and Replace', 'search', { d: 'find' }))),
      g('Appearance', L('Light Mode', 'monitor', { t: 2, on: 1, a: 'light' }), L('Dark Mode', 'monitor-speaker', { t: 2, a: 'dark' }))
    ],
    Help: [
      g('Learn', L('Documentation', 'file-text', { d: 'docs' }), L('Getting Started', 'circle-play', { d: 'start' }), L('LaTeX Basics', 'file-code', { d: 'basics' })),
      g('Reference', L('Package Reference', 'layers', { d: 'pkgref' }), L('Keyboard Shortcuts', 'keyboard', { d: 'shortcuts' })),
      g('Support', L('Troubleshooting', 'triangle-alert', { d: 'trouble' }), L('Compilation Diagnostics', 'terminal', { d: 'diag' }), L('LaTeX Setup…', 'settings', { d: 'latexsetup' })), g('About', L('About', 'info', { d: 'about' }))
    ]
  };
  const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  /* Editor display prefs (Source Display: Line Numbers / Break Markers), persisted in localStorage like the other app state. */
  const PREF_KEY = 'lplum.prefs', PREFS = { ln: true, brk: false, ruler: false, pgb: true, stack: false, cos: false, asd: false, acp: false, thumbs: false, theme: 'light', uiTheme: '', fs: 12.5, tab: 2, compiler: 'xelatex', bodyFont: '', uiFont: '', spell: false, lang: 'en-US', findCase: false, findWord: false, findRe: false, cmtHideDone: false, setupCompleted: false, setupDeferred: false };
  try { const j = JSON.parse(localStorage.getItem(PREF_KEY)); if (j) Object.keys(PREFS).forEach((k) => { if (typeof j[k] === typeof PREFS[k]) PREFS[k] = j[k]; }); } catch (e) { /* storage unavailable: defaults */ }
  if (!/^(light|dark|system)$/.test(PREFS.theme)) PREFS.theme = 'light';
  /* Review ▸ Proofing: [label, BCP-47 tag, babel option]. Spelling = the browser's native spellcheck on the source textarea; Language sets its lang attribute. */
  const PROOF = [['English (US)', 'en-US', 'american'], ['English (UK)', 'en-GB', 'british'], ['French', 'fr', 'french'], ['German', 'de', 'ngerman'], ['Spanish', 'es', 'spanish'], ['Arabic', 'ar', '']];
  if (!PROOF.some((p) => p[1] === PREFS.lang)) PREFS.lang = 'en-US';
  if (!(PREFS.fs >= 8 && PREFS.fs <= 32)) PREFS.fs = 12.5;
  if (!(Number.isInteger(PREFS.tab) && PREFS.tab >= 1 && PREFS.tab <= 8)) PREFS.tab = 2;
  if (!/^(xelatex|lualatex)$/.test(PREFS.compiler)) PREFS.compiler = 'xelatex';   // Default Compiler (new documents / documents naming no program)
  PREFS.uiFont = String(PREFS.uiFont || '').replace(/[^\w .\-]/g, '').trim();
  PREFS.bodyFont = String(PREFS.bodyFont || '').trim();                             // Default Body Font (new documents only); '' = none
  const prefSet = (k, v) => { PREFS[k] = typeof PREFS[k] === 'boolean' ? !!v : v; try { localStorage.setItem(PREF_KEY, JSON.stringify(PREFS)); } catch (e) { toast('Could not save this setting (browser storage unavailable)'); } };
  const ACT = { src: (on) => pane('.src', on), pdf: (on) => pane('.pdf', on), ln: (on) => { prefSet('ln', on); $('#code').classList.toggle('nonum', !on); prefSync('ln'); rulerSync(); schedSel(); }, brk: (on) => { prefSet('brk', on); ensureWindow(true); prefSync('brk'); },
    ruler: (on) => { prefSet('ruler', on); showApply(); prefSync('ruler'); }, pgb: (on) => { prefSet('pgb', on); showApply(); prefSync('pgb'); }, dark: () => appearanceSet('dark'), light: () => appearanceSet('light'), stack: (on) => { prefSet('stack', on); showApply(); prefSync('stack'); }, sidebar: (on) => toggleSidebar(on), thumbs: (on) => toggleThumbs(on), acp: (on) => { prefSet('acp', on); prefSync('acp'); toast('Auto-compile after pause ' + (on ? 'on: compiles 2s after you stop typing' : 'off')); }, welcome: () => showWelcome(true),
    spell: (on) => { prefSet('spell', on); proofApply(); prefSync('spell'); toast('Spell check ' + (on ? 'on: the browser underlines misspelled words in the editor' : 'off')); } };
  /* Appearance: Light / Dark / System. The one real mechanism is <html data-theme="dark"> (all panes, menus, dialogs and Backstage read the CSS vars);
     "System" follows the OS and re-applies when it changes. View ▸ Appearance buttons and the Preferences page both go through here. */
  const DARK_MQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null, isDark = () => PREFS.theme === 'dark' || (PREFS.theme === 'system' && !!DARK_MQ && DARK_MQ.matches);
  /* UI_THEMES: curated palette library. id matches data-ui-theme CSS attribute and dark flag matches data-theme="dark". */
  const UI_THEMES = [
    { id: '', name: 'Plum Classic Light', dark: false },
    { id: 'paper', name: 'Paper', dark: false },
    { id: 'porcelain', name: 'Porcelain', dark: false },
    { id: 'rosewater', name: 'Rosewater', dark: false },
    { id: 'sage', name: 'Sage', dark: false },
    { id: 'lavender-mist', name: 'Lavender Mist', dark: false },
    { id: 'arctic', name: 'Arctic', dark: false },
    { id: 'mint', name: 'Mint', dark: false },
    { id: 'terracotta', name: 'Terracotta', dark: false },
    { id: 'olive-grove', name: 'Olive Grove', dark: false },
    { id: 'ocean', name: 'Ocean', dark: false },
    { id: 'amber', name: 'Amber', dark: false },
    { id: 'blush', name: 'Blush', dark: false },
    { id: 'eucalyptus', name: 'Eucalyptus', dark: false },
    { id: 'cobalt', name: 'Cobalt', dark: false },
    { id: 'lilac', name: 'Lilac', dark: false },
    { id: 'coffee', name: 'Coffee', dark: false },
    { id: 'glacier', name: 'Glacier', dark: false },
    { id: 'high-contrast-light', name: 'High Contrast Light', dark: false },
    { id: 'monochrome', name: 'Monochrome', dark: false },
    { id: 'dark', name: 'Plum Midnight', dark: true },
    { id: 'nightshade', name: 'Nightshade', dark: true },
    { id: 'northwind', name: 'Northwind', dark: true },
    { id: 'mocha', name: 'Mocha', dark: true },
    { id: 'forest-dark', name: 'Forest', dark: true },
    { id: 'ocean-deep', name: 'Ocean Deep', dark: true },
    { id: 'burgundy-dark', name: 'Burgundy', dark: true },
    { id: 'amber-terminal', name: 'Amber Terminal', dark: true },
    { id: 'carbon', name: 'Carbon', dark: true },
    { id: 'high-contrast-dark', name: 'High Contrast Dark', dark: true },
  ];
  /* Palette preview colors [bg, surface, accent, selection] for each theme swatch. */
  const UI_THEME_PREVIEW = {
    '':                  ['#F5F6F8', '#FFFFFF', '#313A75', '#E8EAF5'],
    'paper':             ['#FAF9F6', '#FFFFFF', '#6C6950', '#EAE7D6'],
    'porcelain':         ['#F7F9FB', '#FFFFFF', '#3E668F', '#DCEAF8'],
    'rosewater':         ['#FCF7F7', '#FFFFFF', '#9A4D68', '#F4DFE7'],
    'sage':              ['#F7F9F5', '#FFFFFF', '#52734F', '#DFEBDD'],
    'lavender-mist':     ['#F8F7FC', '#FFFFFF', '#7761B5', '#E7E0FA'],
    'arctic':            ['#F5F8FA', '#FFFFFF', '#397F91', '#D7EDF2'],
    'mint':              ['#F5FAF7', '#FFFFFF', '#287A60', '#D8F0E3'],
    'terracotta':        ['#FBF7F3', '#FFFFFF', '#A65E3F', '#F4E0D1'],
    'olive-grove':       ['#F8F8F1', '#FFFFFF', '#70752D', '#E9E9CC'],
    'ocean':             ['#F4F9FB', '#FFFFFF', '#247D9A', '#D4EBF5'],
    'amber':             ['#FCF9F1', '#FFFFFF', '#996A16', '#F5E8C5'],
    'blush':             ['#FFF7FA', '#FFFFFF', '#B44D78', '#F6DCE8'],
    'eucalyptus':        ['#F5F9F7', '#FFFFFF', '#467B67', '#DCEEE4'],
    'cobalt':            ['#F7F8FC', '#FFFFFF', '#345AC5', '#DCE5FC'],
    'lilac':             ['#FBF8FC', '#FFFFFF', '#9459AD', '#EEDDF7'],
    'coffee':            ['#F9F6F2', '#FFFFFF', '#79533C', '#EBDDCF'],
    'glacier':           ['#F4FAFC', '#FFFFFF', '#438CA5', '#D9EDF5'],
    'high-contrast-light': ['#FFFFFF', '#F0F0F0', '#174FB5', '#D1E1FF'],
    'monochrome':        ['#FAFAFA', '#FFFFFF', '#414141', '#E1E1E1'],
    'dark':              ['#1C1E27', '#232532', '#97A2E3', '#303455'],
    'nightshade':        ['#282A36', '#343746', '#BD93F9', '#44475A'],
    'northwind':         ['#2E3440', '#3B4252', '#88C0D0', '#465568'],
    'mocha':             ['#211E1B', '#2B2622', '#D8A16E', '#554031'],
    'forest-dark':       ['#171F1A', '#202B23', '#8FCB9B', '#304D39'],
    'ocean-deep':        ['#111E29', '#192B38', '#65BDD5', '#25485C'],
    'burgundy-dark':     ['#21171D', '#2D2028', '#DC8AA7', '#513041'],
    'amber-terminal':    ['#201C14', '#2B261A', '#E4B95F', '#504324'],
    'carbon':            ['#181818', '#222222', '#C5C5C5', '#3B3B3B'],
    'high-contrast-dark': ['#101010', '#1A1A1A', '#8AB4FF', '#263F61'],
  };
  function uiThemeApply() {
    const LEGACY_THEME = { dracula: 'nightshade', 'nordic-night': 'northwind' };   // ids saved before the rename
    if (LEGACY_THEME[PREFS.uiTheme]) prefSet('uiTheme', LEGACY_THEME[PREFS.uiTheme]);
    const id = PREFS.uiTheme, t = UI_THEMES.find((x) => x.id === id);
    const el = document.documentElement;
    if (id && id !== 'dark') el.dataset.uiTheme = id; else delete el.dataset.uiTheme;
    // dark palette themes force data-theme="dark"; light palette themes always clear it so dark-only rules (e.g. dark button text) stop applying
    if (t && t.dark) { el.dataset.theme = 'dark'; }
    else if (t && !t.dark) { if (id || !isDark()) delete el.dataset.theme; else el.dataset.theme = 'dark'; }   // id '' = default theme: follows the Light/Dark/System choice
    $$('[data-app]').forEach((b) => b.classList.toggle('is-on', b.dataset.app === ((id && t ? t.dark : isDark()) ? 'dark' : 'light')));
  }
  function uiFontApply() { const r = document.documentElement.style, f = PREFS.uiFont; if (f) r.setProperty('--font', `'${f}', 'Spline Sans', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`); else r.removeProperty('--font'); }
  function appearanceApply() { const d = isDark(); if (d) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme; $$('[data-app]').forEach((b) => b.classList.toggle('is-on', b.dataset.app === (d ? 'dark' : 'light'))); uiThemeApply(); }
  const appearanceSet = (m) => { prefSet('theme', m); prefSet('uiTheme', ''); appearanceApply(); };
  function uiThemeSet(id) { prefSet('uiTheme', id); uiThemeApply(); }
  if (DARK_MQ) DARK_MQ.addEventListener('change', () => { if (PREFS.theme === 'system') appearanceApply(); });
  /* Editor font size / tab width: CSS vars read by .code-input/.code-highlight/.ln; line-height metrics are re-measured so the gutter, ruler and find highlights stay aligned. */
  function editorApply() { const r = document.documentElement.style; r.setProperty('--ed-fs', PREFS.fs + 'px'); r.setProperty('--ed-tab', PREFS.tab); LH = 0; if ($('#codeInput') && $('#codeHighlight')) { ensureWindow(true); rulerSync(); } }
  /* Review ▸ Proofing. proofApply: native spellcheck + lang on the source textarea. langSet: stores the language and offers the matching babel line
     (adds \usepackage[opt]{babel} via ensurePackage, or makes opt the last/main option of an existing one). */
  function proofApply() { const ta = $('#codeInput'); if (!ta) return; ta.spellcheck = PREFS.spell; ta.lang = PREFS.lang; }
  const langMenu = (el) => menu(el, PROOF.map((p) => p[0]), langSet);
  function langSet(l) {
    const p = PROOF.find((x) => x[0] === l); if (!p) return;
    prefSet('lang', p[1]); proofApply();
    const ta = $('#codeInput'), bb = p[2], t = ta ? ta.value : '', m = /^[ \t]*\\usepackage\[([^\]]*)\]\{babel\}/m.exec(t), done = 'Proofing language set to ' + p[0];
    if (!bb) return toast(done + '. Arabic typesetting needs polyglossia or babel plus an Arabic font, so no preamble line is offered');
    if (!/^[ \t]*\\documentclass/m.test(t)) return toast(done);
    if (m && m[1].split(',').pop().trim() === bb) return toast(done + ': babel already uses it');
    const opts = m ? m[1].split(',').map((x) => x.trim()).filter((x) => x && x !== bb).concat(bb).join(',') : bb;
    dlg({ t: 'Typeset in ' + p[0] + '?', i: 'type', w: 460, btns: ['Not now', m ? 'Update babel' : 'Add babel'], b: `<p>Proofing language is now <b>${esc(p[0])}</b>. ${m ? 'Update' : 'Add'} <code>\\usepackage[${esc(opts)}]{babel}</code> in the preamble so hyphenation and captions follow it?</p>`, ok: () => {
      const s = ta.selectionStart, e = ta.selectionEnd, sh = (at, n) => [s >= at ? s + n : s, e >= at ? e + n : e];
      if (m) { const a = m.index + m[0].indexOf('[') + 1; fmtEdit(ta, a, a + m[1].length, opts, ...sh(a + m[1].length, opts.length - m[1].length)); return toast('babel now ends with ' + bb); }
      const pk = ensurePackage(t, ['babel', bb]);
      if (pk === false) return toast('Could not add babel. Check the \\documentclass and preamble');
      if (!pk) return toast('babel is already loaded without options. Add the language option by hand');
      fmtEdit(ta, pk.pos, pk.pos, pk.str, ...sh(pk.pos, pk.str.length)); toast('Added babel with the ' + bb + ' option');
    } });
  }
  /* Word Count: counts the open file only. Whole document → text between \begin{document} and \end{document}; with a selection → just that text.
     Comments, math and LaTeX commands (plus label/ref/cite/include-style arguments and tabular column specs) are not counted; their text arguments are. */
  function wcStats(t, body) {
    if (body) { const a = t.indexOf('\\begin{document}'), z = t.lastIndexOf('\\end{document}'); if (a >= 0) t = t.slice(a + 16, z > a ? z : t.length); }
    t = t.replace(/(?<!\\)%.*\n?/g, '').replace(/\\begin\{comment\}[\s\S]*?\\end\{comment\}/g, '')
      .replace(/\\begin\{(equation|align|gather|multline|flalign|alignat|eqnarray|displaymath|math)(\*?)\}[\s\S]*?\\end\{\1\2\}|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\\)\$[\s\S]*?(?<!\\)\$/g, ' ');
    const clean = (x) => x.replace(/\\begin\{(?:tabular\*?|tabularx|longtable|array)\}(?:\{[^{}]*\}){1,2}/g, ' ')
      .replace(/\\(?:begin|end|label|ref|eqref|pageref|autoref|cref|Cref|cite\w*|includegraphics|input|include|usepackage|documentclass|bibliography\w*|bibitem|url|newcommand|renewcommand|setlength|vspace|hspace|pagestyle|thispagestyle|usetikzlibrary)(?![a-zA-Z@])\*?(?:\[[^\]]*\])*(?:\{[^{}]*\})?/g, ' ')
      .replace(/\\\\(?:\[[^\]]*\])?/g, ' ').replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?/g, ' ').replace(/\\([%$#_&])/g, '$1').replace(/\\./g, ' ').replace(/[{}~]/g, ' '),
      has = (x) => /[\p{L}\p{N}]/u.test(x), paras = t.split(/\n[ \t]*\n/).map(clean).filter(has), flat = paras.join('\n');
    return { words: flat.split(/\s+/).filter(has).length, chars: flat.replace(/\s+/g, ' ').trim().length, nospace: flat.replace(/\s/g, '').length, paras: paras.length };
  }
  function wordCountDialog() {
    const ta = $('#codeInput'); if (!ta) return;
    const sa = ta.selectionStart, sb = ta.selectionEnd, has = sa !== sb, row = ([l, i]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>${l}</span><b id="${i}">0</b></div>`;
    const d = dlg({ t: 'Word Count', i: 'list-ordered', w: 380, btns: ['Close'], b: [['Words', 'wcW'], ['Characters (no spaces)', 'wcN'], ['Characters (with spaces)', 'wcC'], ['Paragraphs', 'wcP']].map(row).join('') + `<label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="wcSel" ${has ? 'checked' : 'disabled'} style="accent-color:var(--accent)">Selection only</label><p class="muted">LaTeX commands, comments and math are not counted. Only the open file is counted: \\input files are not included.</p>` });
    const run = () => { const r = wcStats($('#wcSel', d.el).checked ? ta.value.slice(sa, sb) : ta.value, !$('#wcSel', d.el).checked); [['wcW', r.words], ['wcN', r.nospace], ['wcC', r.chars], ['wcP', r.paras]].forEach(([i, v]) => { $('#' + i, d.el).textContent = v.toLocaleString(); }); };
    $('#wcSel', d.el).onchange = run; run();
  }
  function pane(sel, on) { $(sel).hidden = !on; const s = !$('.src').hidden, p = !$('.pdf').hidden, m = $('#main'); m.classList.toggle('no-src', !s); m.classList.toggle('no-pdf', !p); $('#divider').hidden = !(s && p); }
  /* View ▸ Show: display-only toggles. Ruler = source-column (character) ruler aligned to the editor's monospace grid, it does NOT
     represent physical page margins. Page Boundaries = outline/shadow around PDF pages in every viewer mode. Both persist in PREFS. */
  const prefSync = (k) => $$('[data-pref="' + k + '"]').forEach((b) => b.classList.toggle('is-on', PREFS[k]));
  let RULER_KEY = '';
  function rulerSync() {
    const r = $('#srcRuler'), ta = $('#codeInput'); if (!r || !ta || r.hidden || !ta.clientWidth) return;
    const cs = getComputedStyle(ta), cv = rulerSync.cv || (rulerSync.cv = document.createElement('canvas').getContext('2d'));
    cv.font = cs.fontSize + ' ' + cs.fontFamily; const cw = cv.measureText('0').width, pad = parseFloat(cs.paddingLeft) || 0;
    if (!cw) return;
    const n = Math.min(400, Math.ceil((Math.max(ta.scrollWidth, ta.clientWidth) - pad) / (cw * 5)) + 1), key = [cw.toFixed(3), pad, n].join('|'), inn = r.firstChild;
    if (key !== RULER_KEY) {
      RULER_KEY = key; inn.style.paddingLeft = '0'; inn.style.width = Math.max(ta.scrollWidth, ta.clientWidth) + 'px';
      inn.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i % 2 ? 'mn' : 'mj'}" style="left:${(pad + i * 5 * cw).toFixed(2)}px">${i % 2 ? '' : i * 5}</i>`).join('');
    }
    inn.style.transform = 'translateX(' + -ta.scrollLeft + 'px)';
  }
  function showApply() {
    const r = $('#srcRuler'); if (r) { r.hidden = !PREFS.ruler; rulerSync(); }
    const p = $('.pdf'); if (p) p.classList.toggle('pv-noedge', !PREFS.pgb);
    const mn = $('#main'); if (mn) mn.classList.toggle('stack', !!PREFS.stack);   // View ▸ Stack Panes: source above PDF instead of side by side
  }
  /* Swatch colors for the color-menu controls (Font color, Text highlight, etc.), frontend demo only. */
  const HLMAP = { 'Yellow': '#F2E04B', 'Green': '#7BD389', 'Cyan': '#6FD3E0', 'Pink': '#F4A6C0', 'Orange': '#F5B461' };
  const COLORMAP = { 'Navy': '#1F3A7A', 'Indigo': '#313A75', 'Forest': '#2F6F47', 'Crimson': '#A23B3B', 'Charcoal': '#33313A' };
  function wire(el, o) {
    el._o = o; el.title = o.title || o.l || ''; if (o.on) el.classList.add('is-on'); if (o.m) el.setAttribute('aria-haspopup', 'menu');
    if (o.a === 'ln' || o.a === 'brk' || o.a === 'ruler' || o.a === 'pgb' || o.a === 'stack' || o.a === 'spell') { el.dataset.pref = o.a; el.classList.toggle('is-on', PREFS[o.a]); }   // reflect saved state on (re)build
    if (o.a === 'light' || o.a === 'dark') { el.dataset.app = o.a; el.classList.toggle('is-on', (isDark() ? 'dark' : 'light') === o.a); }   // reflect the saved/effective theme on (re)build
    if (o.a === 'sidebar') el.classList.toggle('is-on', !$('#sidebar').hidden);   // reflect live sidebar state on (re)build
    if (o.a === 'thumbs') { el.dataset.a = 'thumbs'; el.classList.toggle('is-on', !$('#pdfThumbs').hidden); el.setAttribute('aria-pressed', !$('#pdfThumbs').hidden); }
    if (o.f || o.c) { el.dataset.fmt = o.f || o.c; queueMicrotask(syncFmtBtns); }
    if (o.fp) { el.dataset.fp = 1; el.classList.toggle('is-on', !!FP); }   // reflect armed state on (re)build
    if (o.pa) el.dataset.pa = o.pa.al ? 'al' + o.pa.al : Object.keys(o.pa)[0];
    if (o.ls) { el.dataset.ls = o.ls; queueMicrotask(syncFmtBtns); }
    if (o.pv && o.t) el.classList.toggle('is-on', PV.mode === o.pv);   // View ▸ PDF View modes reflect the live mode on (re)build
    if (o.pag && o.t) { el.dataset.pag = o.pag; el.classList.remove('is-on'); queueMicrotask(syncFmtBtns); }
    if (o.trk) { el.dataset.trk = o.trk; if (o.trk === 'on') el.classList.toggle('is-on', TRK.on); }   // reflect Track Changes state on (re)build
    if (o.undo) { el.dataset.undo = 1; el.title = 'Undo (' + (MAC ? '⌘Z' : 'Ctrl+Z') + ')'; }
    if (o.redo) { el.dataset.redo = 1; el.title = 'Redo (' + (MAC ? '⌘Y / ⌘⇧Z' : 'Ctrl+Y / Ctrl+Shift+Z') + ')'; }
    el.onclick = () => {
      if (o.undo) return docUndo();
      if (o.redo) return docRedo();
      if (o.pv) return pvAct(o.pv, el);
      if (o.pvm && o.m) return menu(el, o.m, pvNav);
      if (o.brk) return fmtBreak(o.brk, el);
      if (o.cmt) return cmtShow(o.cmt === 'show');
      if (o.trk) return o.m ? menu(el, o.m, (l) => trkPick(o.trk, l)) : trkToggle();
      if (o.sel) {
        const ta = $('#codeInput');
        if (ta) {
          ta.focus();
          if (o.sel === 'selectAll') {
            ta.select();
          } else if (o.sel === 'cut' || o.sel === 'copy') {
            const s = ta.selectionStart, e = ta.selectionEnd, txt = ta.value.slice(s, e);
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(txt).then(() => {
                if (o.sel === 'cut') fmtEdit(ta, s, e, '', s, s);
              }).catch(() => { document.execCommand(o.sel); });
            } else {
              document.execCommand(o.sel);
            }
          } else {
            document.execCommand(o.sel);
          }
        }
        return;
      }
      if (o.paste) {
        if (o.m) return menu(el, o.m, (l) => clipPaste(l === 'Paste' ? 'paste' : l === 'Paste as Plain Text' ? 'plain' : 'esc'));
        return clipPaste(typeof o.paste === 'string' ? o.paste : 'paste');
      }
      if (o.fp) return fpToggle();
      if (o.rst) return resetTemplate();   // Design ▸ Document Identity ▸ Reset to Template
      if (o.fsz) return fmtSize(o.fsz);
      if (o.cas && o.m) return menu(el, o.m, fmtCase);
      if (o.clr) return fmtClear();
      if (o.proof && o.m) return menu(el, o.m, (l, it) => (l === 'Spelling' ? ACT.spell(!PREFS.spell) : l === 'Language' ? langMenu(it) : wordCountDialog()));
      if (o.lang) return langMenu(el);
      if (o.wc) return wordCountDialog();
      if (o.pa) return fmtPara(o.pa);
      if (o.pag) return pagAct(o.pag, el);
      if (o.ml && o.m) return menu(el, o.m, fmtMulti);
      if (o.toc && o.m) return menu(el, o.m, tocInsert);
      if (o.tu) return tocUpdate();
      if (o.bibu) return bibUpdate(); if (o.bib && o.m) return menu(el, o.m, bibMenu);
      if (o.lof) return listInsert(o.lof); if (o.lou) return listUpdate(); if (o.fn) return fnInsert(); if (o.lbl) return lblDialog(); if (o.xr) return xrDialog(o.xr);
      if (o.tocd && o.m) return menu(el, o.m, tocDepth);
      if (o.hf && o.m) return menu(el, o.m, hfQuick);
      if (o.pg && o.m) return menu(el, o.m, (l) => pageQuick(o.pg, l));
      if (o.col && o.m) return menu(el, o.m, colsApply);
      if (o.ls && o.m) return menu(el, o.m, (l) => fmtList(o.ls, o.m.indexOf(l)));
      if (o.pal && o.m) return menu(el, o.m, (l) => fmtPara({ al: l[0].toLowerCase() }));   // Layout ▸ Alignment: Left/Center/Right/Justify
      if (o.pk && o.m) return menu(el, o.m, (l) => fmtPara({ [o.pk]: parseFloat(l) }));
      if (o.eq && o.m) return menu(el, o.m, eqInsert);
      if (o.frole && o.m) return fontLoad().catch(() => {}).finally(() => menu(el, fontMenuItems(), (l) => fontRole(o.frole, l)));   // Design ▸ Fonts: role-based fontspec definitions
      if (o.hd && o.m) return menu(el, o.m, (l) => headingApply({ [o.hd]: l }));   // Design ▸ Heading Design
      if (o.role === 'theme') {
        const ed = window.RPE.editor || {}, P = ed.PALETTES || {}, curId = ed.getActivePalette ? ed.getActivePalette().id : 'burgundy';
        const palItems = [
          { head: 'Built-in' },
          ...['office', 'burgundy', 'okabe', 'viridis', 'grayscale'].filter((id) => P[id]).map((id) => {
            const p = P[id];
            return { id: p.id, l: p.name, swatches: p.swatches, checked: () => curId === p.id };
          }),
          { sep: true },
          { head: 'Template palettes' },
          ...['clinical-blue', 'editorial-review', 'field-biology', 'molecular-translational', 'hematology-oncology', 'data-methods', 'population-health', 'computational-biology', 'dark-auditorium', 'swiss-minimal'].filter((id) => P[id]).map((id) => {
            const p = P[id];
            return { id: p.id, l: p.name, swatches: p.swatches, checked: () => curId === p.id };
          })
        ];
        return menu(el, palItems, (id) => {
          if (ed.setActivePalette) ed.setActivePalette(id);
          const p = P[id];
          if (p && p.latex) themeApply(p.latex);
          toast('Palette set to ' + (p ? p.name : id));
        });
      }
      if (o.c || (o.role && o.role !== 'theme')) {
        const role = o.role, kind = o.c, sw = $('.rbtn__sw', el);
        return colorPanel(el, {
          swatchEl: sw,
          none: 'Automatic',
          onPick: (hex) => {
            if (kind) {
              fmtColor(kind, hex ? hex.replace(/^#/, '').toUpperCase() : null);
              if (sw && hex) sw.style.setProperty('--sw', hex);
            } else if (role) {
              const ed = window.RPE.editor || {}, curPal = ed.getActivePalette ? ed.getActivePalette() : null;
              if (hex) {
                themeApply(themeWant(role, hex.replace(/^#/, '').toUpperCase()));
              } else {
                const def = role === 'body' ? '000000' : (curPal ? curPal.accents[0].replace(/^#/, '') : '702D3B');
                themeApply(themeWant(role, def));
              }
              if (sw && hex) sw.style.setProperty('--sw', hex);
            }
          }
        });
      }
      if (o.f) return fmtToggle(o.f);
      if (o.d) return openD(o.d);
      if (o.m) return menu(el, o.m);
      if (o.t) { if (o.t === 2) { $$('.rbtn', el.parentNode).forEach((x) => x.classList.remove('is-on')); el.classList.add('is-on'); } else el.classList.toggle('is-on'); if (o.a && ACT[o.a]) ACT[o.a](el.classList.contains('is-on')); return; }
      toast((o.l || '') + ': preview only');
    };
  }
  const glyph = (o) => {
    const style = o.i ? '' : ' style="font:600 13px var(--font);min-width:16px;justify-content:center"';
    const inner = o.i ? ic(o.i) : esc(o.x);
    return `<span class="rbtn__ico"${style}>${inner}${o.sw ? `<i class="rbtn__sw" style="--sw:${o.sw}"></i>` : ''}</span>`;
  };
  function build(it) {
    const chev = it.m ? ic('chevron-down', 'ic--chev') : '';
    switch (it.k) {
      case 'L': { const b = h(`<button class="rbtn rbtn--lg">${glyph(it)}<span class="rbtn__label">${it.l}</span>${chev}</button>`); wire(b, it); return b; }
      case 'S': { const b = h(`<button class="rbtn rbtn--sm">${glyph(it)}<span class="rbtn__label">${it.l}</span>${chev}</button>`); wire(b, it); return b; }
      case 'I': { const b = h(`<button class="rbtn rbtn--icon ${it.m ? 'rbtn--icon-menu' : ''}" aria-label="${it.l}">${glyph(it)}<span class="rbtn__label rbtn__label--ico">${it.l}</span>${chev}</button>`); wire(b, it); return b; }
      case 'cb': { const c = h(`<div class="combo" style="width:${it.w}px"><input class="combo__in" value="${it.v}" aria-label="${it.l}"><button class="combo__btn" aria-label="${it.l} options" aria-haspopup="menu">${ic('chevron-down')}</button></div>`); const isF = it.l === 'Font', isS = it.l === 'Size', isC = it.l === 'Style'; if (isC) $('input', c).readOnly = true; $('button', c).onclick = (e) => { if (isF) { fontLoad().catch(() => {}).finally(() => menu(c, fontMenuItems({ selected: $('input', c).value }), (v) => { $('input', c).value = v; fmtFont(v).finally(syncFmtBtns); })); return; } menu(c, it.m, (v) => { if (isC) { if (citeStyle(v)) $('input', c).value = v; return; } $('input', c).value = v; if (isS) fmtSize(v); }); }; if (isF || isS) $('input', c).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (isF) fmtFont(e.target.value).finally(syncFmtBtns); else if (isS) fmtSize(e.target.value); } }); return c; }
      case 'nm': {
        const c = h(`<label class="rnum"><span class="rnum__lbl" style="width:58px">${it.l}</span><input class="rnum__in" value="${it.v}"></label>`), i = $('input', c);
        if (it.pk) { i.dataset.pk = it.pk; i.onchange = () => paLayoutCommit(i); i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const ta = $('#codeInput'); if (ta) ta.focus(); else i.blur(); } }; }
        return c;
      }
      case 'sp': return h('<span class="rvsep"></span>');
      case 'st': case 'st3': case 'rw': { const c = h(`<div class="${it.k === 'rw' ? 'rrow' : 'rstack' + (it.k === 'st3' ? ' rstack--3' : '')}"></div>`); it.a.forEach((x) => c.append(build(x))); return c; }
      case 'sty': {
        const c = h('<div class="rsty-trigger"></div>'); const cur = STYLES.find((s) => s.id === curStyle) || STYLES[0];
        const b = h(`<button class="rbtn rbtn--sm rsty-btn" aria-haspopup="listbox" aria-label="Styles"><span class="rsty-btn__preview" data-sty="${cur.id}" style="${styleCss(cur, headState($('#codeInput') ? $('#codeInput').value : ''))}">${esc(cur.label)}</span>${ic('chevron-down', 'ic--chev')}</button>`);
        b.onclick = () => openStylesMenu(b); c.append(b); return c;
      }
      case 'doc': return docClassGallery();
      case 'tpl': return tplGallery();
      case 'eq': return eqGroup();
      case 'ill': return illGroup();
    }
  }
  function illGroup() {
    const wrap = h('<div class="rill-wrap"><div class="rill-lg"></div><button class="rbtn rbtn--lg rill-dropdown-btn" aria-haspopup="menu" aria-label="Pictures & Figures" title="Pictures & Figures"><span class="rbtn__ico">' + ic('image') + '</span><span class="rbtn__label">Pictures</span>' + ic('chevron-down', 'ic--chev') + '</button></div>');
    $('.rill-lg', wrap).append(build(L('Picture', 'image', { d: 'picture' })), build(L('Figure', 'images', { d: 'figure' })));
    const btn = $('.rill-dropdown-btn', wrap);
    btn.onclick = (e) => { e.stopPropagation(); menu(btn, ['Picture…|@picture', 'Figure (with caption)…|@figure']); };
    return wrap;
  }
  function eqGroup() {
    const wrap = h('<div class="req-wrap"><div class="req-lg"></div><div class="req-sm"></div></div>');
    const eq = { eq: 1, m: ['Inline Equation', 'Display Equation', 'Align Block', '-', 'Equation Editor…|@equation'] };
    const ed = { d: 'equation' };
    $('.req-lg', wrap).append(build(L('Equation', 'sigma', eq)), build(L('Equation Editor', 'pencil-line', ed)));
    $('.req-sm', wrap).append(build(st(S('Equation', 'sigma', eq), S('Equation Editor', 'pencil-line', ed))));
    return wrap;
  }
  const GRP_ICONS = {
    'Undo': 'undo-2', 'Clipboard': 'clipboard-paste', 'Font': 'type', 'Paragraph': 'align-left', 'Styles': 'a-large-small',
    'Editing & Proofing': 'search', 'Pages & Breaks': 'file-plus-2', 'Links': 'link', 'Footnotes': 'superscript',
    'Comments': 'message-square', 'Tables': 'table', 'Illustrations': 'image', 'Contents': 'list',
    'Header & Footer': 'panel-top-close', 'Equations': 'sigma', 'Symbols': 'omega', 'Charts & Diagrams': 'chart-column',
    'Page Setup': 'frame', 'Columns & Breaks': 'layout-grid', 'Pagination': 'link', 'Source Display': 'list-ordered',
    'Document Classes': 'layers', 'Templates': 'file-text', 'Colors': 'palette', 'Fonts': 'type',
    'Page Decoration': 'frame', 'Heading Design': 'captions', 'Document Identity': 'pen-line',
    'Table of Contents': 'list', 'Lists': 'images', 'Citations': 'captions', 'Bibliography': 'folder-open',
    'Cross-references': 'tags', 'Proofing': 'spell-check', 'Changes': 'pencil-line', 'Comparison': 'copy-plus',
    'Workspace': 'rows-3', 'PDF View': 'file-text', 'Zoom': 'zoom-in', 'Show': 'ruler', 'Appearance': 'monitor',
    'Learn': 'file-text', 'Reference': 'layers', 'Support': 'triangle-alert', 'About': 'info'
  };
  const TAB_COLLAPSE_PRIORITY = {
    Home: ['Editing & Proofing', 'Styles', 'Clipboard', 'Undo', 'Paragraph', 'Font'],
    Insert: ['Charts & Diagrams', 'Contents', 'Header & Footer', 'Comments', 'Footnotes', 'Links', 'Pages & Breaks', 'Symbols', 'Illustrations', 'Tables', 'Equations'],
    Layout: ['Source Display', 'Pagination', 'Columns & Breaks', 'Paragraph', 'Page Setup'],
    Design: ['Document Identity', 'Page Decoration', 'Heading Design', 'Templates', 'Document Classes', 'Colors', 'Fonts'],
    References: ['Lists', 'Table of Contents', 'Bibliography', 'Footnotes', 'Cross-references', 'Citations'],
    Review: ['Comparison', 'Changes', 'Comments', 'Proofing'],
    View: ['Appearance', 'Workspace', 'Show', 'PDF View', 'Zoom'],
    Help: ['About', 'Support', 'Reference', 'Learn']
  };
  function findGroupIcon(gr) {
    const search = (items) => {
      for (const it of items) {
        if (!it) continue;
        if (it.i) return it.i;
        if (it.a && Array.isArray(it.a)) { const r = search(it.a); if (r) return r; }
      }
      return null;
    };
    return search(gr.items);
  }
  function openGroupPop(btn, grEl) {
    if (btn.classList.contains('is-open')) return closePop();
    const content = $('.rgroup__content', grEl), label = $('.rgroup__label', grEl);
    if (!content) return;
    const popEl = h('<div class="popover popover--group is-open"><div class="rgroup-pop"></div></div>');
    const holder = $('.rgroup-pop', popEl);
    holder.append(content);
    if (label) holder.append(label);
    openPop(btn, popEl, () => {
      grEl.append(content);
      if (label) grEl.append(label);
    });
  }
  let curTabName = 'Home';
  function updateRibbonOverflow() {
    const body = $('#ribbonBody');
    if (!body || !body.offsetParent) return;
    const groups = $$('.rgroup', body);
    if (!groups.length) return;
    groups.forEach((el) => el.classList.remove('is-collapsed'));
    if (body.scrollWidth <= body.clientWidth) return;
    const priority = TAB_COLLAPSE_PRIORITY[curTabName] || [];
    const order = [];
    priority.forEach((n) => { const g = groups.find((el) => el.dataset.group === n); if (g) order.push(g); });
    for (let i = groups.length - 1; i >= 0; i--) { if (!order.includes(groups[i])) order.push(groups[i]); }
    for (const el of order) {
      el.classList.add('is-collapsed');
      if (body.scrollWidth <= body.clientWidth) break;
    }
  }
  function showTab(name) {
    curTabName = name;
    $$('#tablist .tab').forEach((t) => { const on = t.textContent === name; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on); });
    closePop(); const body = $('#ribbonBody'); body.innerHTML = '';
    TABS[name].forEach((gr) => {
      const icon = GRP_ICONS[gr.l] || findGroupIcon(gr) || 'more-horizontal';
      const el = h(`<div class="rgroup" data-group="${esc(gr.l)}"><button class="rbtn rbtn--collapsed${/\s/.test(gr.l.trim()) ? ' rbtn--wrap' : ''}" aria-haspopup="true" aria-expanded="false" title="${esc(gr.l)}"><span class="rbtn__ico">${ic(icon)}</span><span class="rbtn__label">${esc(gr.l)}</span>${ic('chevron-down', 'ic--chev')}</button><div class="rgroup__content"></div><div class="rgroup__label">${esc(gr.l)}</div></div>`);
      const cBtn = $('.rbtn--collapsed', el);
      cBtn.onclick = (e) => { e.stopPropagation(); if (gr.l === 'Templates') { if (cBtn.classList.contains('is-open')) return closePop(); tplMenu(cBtn); } else openGroupPop(cBtn, el); };
      gr.items.forEach((x) => $('.rgroup__content', el).append(build(x)));
      body.append(el);
    });
    paint(body);
    updateRibbonOverflow();
    queueMicrotask(() => { syncFmtBtns(); historyUIUpdate(); });   // Layout ▸ Paragraph boxes show the caret paragraph's values
  }

  /* ---------- LaTeX source + tokenizer for display styling ---------- */
  let SRC = String.raw`% !TEX program = xelatex
\documentclass{article}

\begin{document}

\end{document}
`;
  const SAMPLE_ARTICLE_TEX = String.raw`% !TEX program = xelatex
\documentclass[12pt,a4paper]{report}

% ---- Preamble ----
\usepackage{fontspec}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage[a4paper,margin=2.5cm]{geometry}
\usepackage[dvipsnames]{xcolor}
\usepackage{hyperref}

\setmainfont{TeX Gyre Termes}
\definecolor{Navy}{HTML}{1F3A7A}

\title{Adaptive Sampling for Sparse Signal Recovery}
\author{Mohammed W. Hammami \\ Department of Mathematics}

\begin{document}
\maketitle

\chapter{Introduction}
\section{Background}\label{sec:background}
Compressed sensing recovers signals from \textbf{far fewer samples}
than classical theory requires~\cite{candes2006}. The results of
\textcolor{Navy}{\textbf{\textit{this chapter}}} build on the model
$y = Ax + \varepsilon$, where \textit{sparsity} is the key assumption.

\begin{itemize}
  \item Sparse priors and \textbf{basis pursuit}
  \item \textit{Adaptive} measurement schedules
\end{itemize}

\begin{equation}\label{eq:lasso}
  \hat{x} = \arg\min_x \tfrac{1}{2}\lVert y - Ax \rVert_2^2 + \lambda \lVert x \rVert_1
\end{equation}

\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.8\linewidth]{figures/recovery}
  \caption{Recovery error versus sampling ratio.}\label{fig:recovery}
\end{figure}

As Figure~\ref{fig:recovery} and Equation~\eqref{eq:lasso} show, the
error decays quickly once the sampling ratio exceeds 0.3.

\bibliographystyle{apalike}
\bibliography{references}
\end{document}`;
  const FMT = { textbf: 'fb', textit: 'fi', emph: 'fi', textcolor: 'fc', underline: 'fu', sout: 'fst' }, STRUCT = /^(chapter|section|subsection|title|author|maketitle)$/;
  const close = (s, i) => { let d = 0; for (let j = i; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && !--d) return j; } return s.length; };
  function tok(s, cls) {
    let o = '', i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '%') { o += `<span class="c">${esc(s.slice(i))}</span>`; break; }
      if (c === '$') { const j = s.indexOf('$', i + 1), e = j < 0 ? s.length : j + 1; o += `<span class="m">${esc(s.slice(i, e))}</span>`; i = e; continue; }
      if (c === '\\') {
        const n = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
        if (!n) { o += esc(c); i++; continue; }   // a lone trailing backslash has nothing to attach to
        i += n[0].length; const nm = n[1];
        o += `<span class="${STRUCT.test(nm) ? 's' : /^(begin|end)$/.test(nm) ? 'e' : 'k'}">${esc(n[0])}</span>`;
        const ac = /^(begin|end)$/.test(nm) ? 'e' : 'a';
        for (let a = 0; (s[i] === '{' || s[i] === '[') && a < 4; a++) {
          const op = s[i], e = op === '{' ? close(s, i) : s.indexOf(']', i), end = e < 0 ? s.length : e, inner = s.slice(i + 1, end);   // an unclosed [ runs to end of line (it used to rewind i to 0 and loop forever)
          const klass = nm === 'textcolor' && a === 1 ? FMT.textcolor : (FMT[nm] && op === '{') ? FMT[nm] : ac;
          o += `<span class="br">${op}</span><span class="${klass}">${tok(inner)}</span>${end < s.length ? `<span class="br">${op === '{' ? '}' : ']'}</span>` : ''}`; i = end + 1;
        }
        continue;
      }
      let j = i; while (j < s.length && !'\\%$'.includes(s[j])) j++; o += esc(s.slice(i, j)); i = j;
    }
    return o;
  }
  /* ---------- lazy (windowed) rendering: the full text always lives in the real <textarea> (so every line is
     there to scroll to, select, search and edit), but the syntax-highlight layer only builds DOM rows for the
     lines in or near the viewport and sizes itself as if all of them existed. A 10,000-line file therefore costs
     ~100 rows per redraw instead of 10,000. Rows are a fixed height (the editor's line-height), which is what
     makes the window position computable straight from scrollTop. ---------- */
  let LINES = [], LINE_START = [], MATH_IN = new Uint8Array(0), INDEXED_SRC = null;   // per-SRC line index, rebuilt only when SRC changes
  const RE_MATH_B = /\\begin\{(equation|align)\}/, RE_MATH_E = /\\end\{(equation|align)\}/;
  function indexSrc() {
    if (INDEXED_SRC === SRC) return;
    INDEXED_SRC = SRC; LINES = SRC.split('\n');
    LINE_START = new Array(LINES.length); MATH_IN = new Uint8Array(LINES.length);
    let off = 0, m = false;   // m = "inside equation/align" when entering a line, so any window can start mid-document
    for (let i = 0; i < LINES.length; i++) {
      LINE_START[i] = off; off += LINES[i].length + 1; MATH_IN[i] = m ? 1 : 0;
      if (RE_MATH_B.test(LINES[i])) m = true; else if (RE_MATH_E.test(LINES[i])) m = false;
    }
  }
  const lineOf = (pos) => {   // 0-based line containing character offset `pos` (binary search; was an O(n) split per call)
    indexSrc(); let lo = 0, hi = LINE_START.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (LINE_START[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const HAS_HL = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';   // CSS Custom Highlight API: paints Range objects, injects no HTML
  let CUR_LINE = 13, HITS = new Set(), HIT_CUR = -1, WIN = { a: 0, b: -1 }, LH = 0, PAD_TOP = 8, CW = 0, SEL_RAF = 0, CARET_KEY = '';
  let BIB_ERR_LINES = new Map();
  // PROB_LINES / PROB_LINES_TIP are owned by js/pdf-viewer.js (RPE.pv)
  function checkBibErrors() {
    const ap = window.RPE.explorer && window.RPE.explorer.activePath;
    if (!ap || !/\.bib$/i.test(ap)) return;
    const res = parseBib(SRC);
    for (const err of res.errors) {
      const l = Math.max(0, Math.min(LINES.length - 1, (err.line || 1) - 1));
      BIB_ERR_LINES.set(l, (BIB_ERR_LINES.get(l) ? BIB_ERR_LINES.get(l) + '; ' : '') + err.msg);
    }
    const st = $('#statusMainText'), dot = $('#statusDot');
    if (st && dot) {
      if (res.errors.length) {
        st.textContent = res.errors.length + ' .bib syntax error' + (res.errors.length === 1 ? '' : 's');
        dot.style.background = '#A23B3B';
      } else {
        st.textContent = '.bib valid (' + res.entries.length + ' entries)';
        dot.style.background = '#6C8F6E';
      }
    }
  }
  const OVERSCAN = 40, RE_BRK = /\\(?:newpage|clearpage|pagebreak)(?![a-zA-Z])/;   // explicit break commands (comment text stripped before testing)
  function metrics() {
    if (LH && CW) return; const cs = getComputedStyle($('#codeInput')); LH = parseFloat(cs.lineHeight) || 20; PAD_TOP = parseFloat(cs.paddingTop) || 8;
    const hl = $('#codeHighlight'), t = document.createElement('span'); t.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'; t.textContent = '0'.repeat(64);
    hl.append(t); CW = t.getBoundingClientRect().width / 64; t.remove();   // monospace advance, used for the selected line-break cell
  }
  function drawLines(first, last) {
    let out = '';
    const BD = LINES.findIndex((l) => l.indexOf('\\begin{document}') >= 0), PRE_END = BD < 0 ? LINES.length : BD;
    for (let n = first; n <= last; n++) {
      const ln = LINES[n]; let math = MATH_IN[n] === 1;
      if (RE_MATH_B.test(ln)) math = 'b'; else if (RE_MATH_E.test(ln)) math = false;
      let inner; try { inner = math === true ? `<span class="m">${esc(ln)}</span>` : tok(ln); } catch (e) { inner = esc(ln); }   // one odd line must never blank the editor
      const nc = ln.replace(/(^|[^\\])%.*/, '$1'), pm = /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]*)\}/.exec(nc), pn = pm ? pm[1].split(',').map((x) => x.trim()).filter((x) => PK_NAMES.has(x)) : [];   // one (i) per bundled package on the line, sticky at the pane's right edge
      const info = pn.length ? `<span class="pkg-is">${pn.map((x) => `<button class="pkg-i" data-pk="${x}" aria-label="About package ${x}" title="About ${x}">${ic('info')}</button>`).join('')}</span>` : '';
      let csw = '';   // preamble hex colours ({HTML}{RRGGBB} / [HTML]{RRGGBB}): a small clickable square right after the colour code (in ch = mono columns, so it tracks the text), vertically centred in the row
      if (n < PRE_END) { const re = /[\[{]HTML[\]}]\{([0-9A-Fa-f]{6})\}/g; let m; while ((m = re.exec(nc))) { const end = m.index + m[0].length, tight = /\S/.test(nc.slice(end, end + 2)); csw += `<button type="button" class="csw${tight ? ' csw--hi' : ''}" data-n="${n}" data-o="${end - 7}" aria-haspopup="true" aria-label="Pick colour #${m[1].toUpperCase()}" title="#${m[1].toUpperCase()}" style="background:#${m[1]};left:${end + (tight ? 0.2 : 0.5)}ch"></button>`; } if (csw) csw = `<b class="csws">${csw}</b>`; }
      const cls = ['ln']; if (n === CUR_LINE && HIT_CUR < 0) cls.push('cur'); if (!HAS_HL && HITS.has(n)) cls.push(n === HIT_CUR ? 'hit-cur' : 'hit'); if (CMT.lines.has(n)) cls.push('has-cmt'); if (TRK.lines.has(n)) cls.push('has-trk'); if (PREFS.brk && RE_BRK.test(ln.replace(/(^|[^\\])%.*/, '$1'))) cls.push('brk');
      if (BIB_ERR_LINES.has(n)) cls.push('has-err');
      const _pl = (window.RPE && RPE.pv && RPE.pv.PROB_LINES) || new Map(), _pt = (window.RPE && RPE.pv && RPE.pv.PROB_LINES_TIP) || new Map();
      const probSev = _pl.get(n); if (probSev) cls.push(probSev === 'err' ? 'has-prob-err' : 'has-prob-warn');
      const errTip = BIB_ERR_LINES.has(n) ? ` title="Syntax error: ${esc(BIB_ERR_LINES.get(n))}"` : (probSev ? ` title="${esc(_pt.get(n) || '')}"` : '');
      out += `<div class="${cls.join(' ')}" data-n="${n}"${errTip}><i>${n + 1}</i><span>${inner}${csw}</span>${info}</div>`;
    }
    return out;
  }
  /* Exact-range find highlight: a Range per match over the rendered line's text nodes, painted via ::highlight(find-hit / find-cur). */
  function paintFind() {
    if (!HAS_HL) return;
    CSS.highlights.delete('find-hit'); CSS.highlights.delete('find-cur');
    if (!FIND.matches.length || !FIND.q) return;
    const all = new Highlight(), cur = new Highlight();
    FIND.matches.forEach((pos, i) => {
      const n = lineOf(pos), len = FIND.lens[i]; if (n < WIN.a || n > WIN.b) return;
      const sp = $(`.ln[data-n="${n}"] > span`, $('#codeHighlight')); if (!sp) return;
      const a = pos - LINE_START[n], b = Math.min(a + len, LINES[n].length);
      if (sp.textContent.length !== LINES[n].length) return;   // rendered text must mirror the source line, else skip rather than mis-paint
      const w = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT); let node, off = 0, r = null;
      while ((node = w.nextNode())) {
        const l = node.nodeValue.length;
        if (!r && a < off + l) { r = document.createRange(); r.setStart(node, a - off); }
        if (r && b <= off + l) { r.setEnd(node, b - off); break; }
        off += l;
      }
      if (r && !r.collapsed) (i === FIND.idx ? cur : all).add(r);
    });
    CSS.highlights.set('find-hit', all); CSS.highlights.set('find-cur', cur);
  }
  function ensureWindow(force) {   // (re)build the rendered rows only when the viewport has left them, and keep the layer scroll-synced
    indexSrc(); metrics();
    const ta = $('#codeInput'), hl = $('#codeHighlight'), total = LINES.length, st = ta.scrollTop, vh = ta.clientHeight || 800;
    const needA = Math.max(0, Math.floor((st - PAD_TOP) / LH)), needB = Math.min(total - 1, Math.ceil((st + vh - PAD_TOP) / LH));
    if (force || needA < WIN.a || needB > WIN.b) {
      const a = Math.max(0, needA - OVERSCAN), b = Math.min(total - 1, needB + OVERSCAN);
      hl.innerHTML = `<div class="ln-wrap" style="box-sizing:border-box;height:${total * LH}px;padding-top:${a * LH}px;min-width:${ta.scrollWidth}px">${drawLines(a, b)}</div>`;
      WIN = { a, b }; paint(hl);
    }
    paintFind(); paintCmt(); paintTrk();
    hl.scrollTop = st; hl.scrollLeft = ta.scrollLeft;
    selScroll(); schedSel();
  }
  function renderCode() {
    indexSrc(); syncDocClass();
    HITS = new Set(FIND.matches.map(lineOf));
    HIT_CUR = FIND.idx >= 0 ? lineOf(FIND.matches[FIND.idx]) : -1;
    checkBibErrors();
    ensureWindow(true);
    if (typeof scheduleOutline === 'function') scheduleOutline();
    cmtSchedule(); fnSchedule(); trkSchedule();
  }
  /* Custom caret + selection. The textarea's own caret and ::selection are hidden in CSS; both are drawn in #codeSel (above the highlight layer,
     under the transparent textarea) from the textarea's selection. One rectangle per line, each exactly one line tall and positioned from the
     rendered text itself (tabs and all), so a selection never bleeds into neighbouring rows and always matches what is on screen. */
  function selScroll() {   // #codeSel is a scroll container mirroring the highlight layer's own (already snapped) scroll offsets, so the two can never drift apart
    const hl = $('#codeHighlight'), b = $('#codeSel'); if (!hl || !b) return;
    const n = b.firstChild, w = hl.scrollWidth + 'px', h = hl.scrollHeight + 'px';
    if (n.style.width !== w) n.style.width = w; if (n.style.height !== h) n.style.height = h;
    b.scrollTop = hl.scrollTop; b.scrollLeft = hl.scrollLeft;
  }
  function schedSel() { if (!SEL_RAF) SEL_RAF = requestAnimationFrame(paintSel); }
  function xAt(n, col) {   // x (px from the layer's scroll origin) of column `col` on rendered line n, or null if that row isn't drawn
    const hl = $('#codeHighlight'), sp = $(`.ln[data-n="${n}"] > span`, hl); if (!sp) return null;
    const hr = hl.getBoundingClientRect(), base = sp.getBoundingClientRect().left - hr.left + hl.scrollLeft;
    if (col <= 0 || !LINES[n].length) return base;
    if (sp.textContent.length === LINES[n].length) {
      const w = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT); let node, off = 0;
      while ((node = w.nextNode())) {
        const l = node.nodeValue.length;
        if (col <= off + l) {
          const r = document.createRange(); r.setStart(node, col - off - 1); r.setEnd(node, col - off);
          const b = r.getBoundingClientRect(); if (b.width || b.height) return b.right - hr.left + hl.scrollLeft;
          break;
        }
        off += l;
      }
    }
    return base + col * CW;
  }
  function paintSel() {
    SEL_RAF = 0;
    const ta = $('#codeInput'), box = $('#codeSel'); if (!ta || !box) return;
    indexSrc(); metrics(); selScroll();
    const gw = (parseFloat(getComputedStyle(ta).paddingLeft) || 0) + 'px'; if (box.style.getPropertyValue('--ed-gw') !== gw) box.style.setProperty('--ed-gw', gw);
    const rs = box.querySelector('.code-sel__rs'), caret = box.querySelector('.code-sel__c');
    const a = Math.min(ta.selectionStart, SRC.length), b = Math.min(ta.selectionEnd, SRC.length), la = lineOf(a), lb = lineOf(b);
    const st = ta.scrollTop, vh = ta.clientHeight || 800, dpr = window.devicePixelRatio || 1, px = (v) => Math.round(v * dpr) / dpr, y = (n) => px(PAD_TOP + n * LH);   // everything snaps to whole device pixels
    const v0 = Math.max(WIN.a, Math.floor((st - PAD_TOP) / LH) - 1), v1 = Math.min(WIN.b, Math.ceil((st + vh - PAD_TOP) / LH) + 1);
    let html = '';
    if (a !== b) {
      for (let n = Math.max(la, v0); n <= Math.min(lb, v1); n++) {
        const x0 = xAt(n, n === la ? a - LINE_START[n] : 0); let x1 = xAt(n, n === lb ? b - LINE_START[n] : LINES[n].length);
        if (x0 == null || x1 == null) continue;
        if (n < lb) x1 += CW || 7;   // the selected line break
        html += `<i class="code-sel__r" style="left:${px(x0)}px;top:${y(n)}px;width:${Math.max(0, px(x1) - px(x0))}px;height:${y(n + 1) - y(n)}px"></i>`;
      }
    }
    rs.innerHTML = html;
    let show = false;
    if (a === b && la >= v0 && la <= v1) {
      const cx = xAt(la, a - LINE_START[la]);
      if (cx != null) {   // fixed size on every line: constant height and a whole-device-pixel width, so the caret never changes thickness or straddles two rows
        const ch = Math.max(4, Math.round(LH) - 4);
        caret.style.left = px(cx) + 'px'; caret.style.width = Math.max(2, Math.round(1.5 * dpr)) / dpr + 'px';
        caret.style.top = px(PAD_TOP + la * LH + (LH - ch) / 2) + 'px'; caret.style.height = px(ch) + 'px'; show = true;
      }
    }
    caret.hidden = !show;
    const key = a + ':' + b; if (key !== CARET_KEY) { CARET_KEY = key; caret.style.animation = 'none'; void caret.offsetWidth; caret.style.animation = ''; }   // solid right after any move, then blink
  }
  function setCurLine(n, pos) {                                           // pos (exact char offset), when known, makes the outline's cursor-follow precise
    CUR_LINE = n; const hl = $('#codeHighlight');
    $$('.ln.cur', hl).forEach((x) => x.classList.remove('cur'));
    const row = $(`.ln[data-n="${n}"]`, hl); if (row) row.classList.add('cur');
    schedSel();
    if (typeof outSyncCursor === 'function') outSyncCursor(n, pos);
  }
  function goToLine(n, col, len) {   // scroll so line n (0-based) sits mid-viewport; the window follows. With col (+len) the span is also scrolled into view horizontally
    indexSrc(); metrics(); const ta = $('#codeInput');
    n = Math.max(0, Math.min(LINES.length - 1, n));
    ta.scrollTop = Math.max(0, PAD_TOP + n * LH - (ta.clientHeight - LH) / 2);
    ensureWindow();
    if (col == null) return;
    const pl = parseFloat(getComputedStyle(ta).paddingLeft) || 0, c0 = Math.min(col, LINES[n].length), c1 = Math.min(LINES[n].length, c0 + Math.max(1, len || 1));
    const x0 = xAt(n, c0) ?? pl + c0 * CW, x1 = xAt(n, c1) ?? pl + c1 * CW, vw = ta.clientWidth, m = Math.min(48, vw / 4), sl = ta.scrollLeft;
    if (x0 < sl + m) ta.scrollLeft = Math.max(0, x0 - m);
    else if (x1 > sl + vw - m) ta.scrollLeft = Math.max(0, Math.min(x0 - m, x1 - vw + m));
    ensureWindow();
  }
  function loadIntoEditor() {   // new document text: show it from the top
    const ta = $('#codeInput'); if (!ta) return;
    ta.value = SRC; ta.scrollTop = 0; ta.scrollLeft = 0; CUR_LINE = 0;
    try { ta.setSelectionRange(0, 0); } catch (e) { /* not focusable yet */ }
    if (window.RPE && RPE.pv) RPE.pv.lastCompiledSrc = null; const sb = $('#pdfStaleBadge'); if (sb) sb.hidden = true;
  }
  $('#code').addEventListener('click', (e) => {   // bound once, renderCode() may redraw #codeHighlight's innerHTML, but never replaces #code itself
    const b = e.target.closest('.pkg-i'); if (b) return pkgDlg(b.dataset.pk);
    const sw = e.target.closest('.csw'); if (sw) {   // hex colour in the preamble: the same floating colour menu as the ribbon, writing the pick back into the source
      const ta = $('#codeInput'), n = +sw.dataset.n, o = +sw.dataset.o, HX = /^[0-9a-f]{6}$/i, at = () => LINE_START[n] + o;
      if (!HX.test(ta.value.substr(at(), 6))) return;
      return colorPanel(sw, { none: false, current: '#' + ta.value.substr(at(), 6), onPick: (v) => { const a = at(); if (!/^#[0-9a-f]{6}$/i.test(v || '') || !HX.test(ta.value.substr(a, 6))) return; fmtEdit(ta, a, a + 6, v.slice(1).toUpperCase(), a + 6, a + 6); } });
    }
    const l = e.target.closest('.ln'); if (l) setCurLine(+l.dataset.n);
  });
  /* ---------- editor-wide history (per-file, max 500, coalesce typing within 600ms, store selection) ---------- */
  const HIST_MAX = 500, HIST_COALESCE = 600;
  const HIST_MAP = new Map(); // key (activePath || '(scratch)') -> { past: [{text, selA, selB}], future: [{text, selA, selB}], lastAt: 0 }
  let HIST_SUSPEND = false;

  function histKey() { return (window.RPE.explorer && window.RPE.explorer.activePath) || '(scratch)'; }
  function histGet() {
    const k = histKey();
    let h = HIST_MAP.get(k);
    if (!h) { h = { past: [], future: [], lastAt: 0 }; HIST_MAP.set(k, h); }
    return h;
  }
  function histClear() { HIST_MAP.clear(); TRK.base.clear(); historyUIUpdate(); }   // project/document switch also drops every Track Changes baseline

  function historyUIUpdate() {
    const h = histGet();
    const canUndo = h.past.length > 0;
    const canRedo = h.future.length > 0;
    const uTip = 'Undo (' + (MAC ? '⌘Z' : 'Ctrl+Z') + ')';
    const rTip = 'Redo (' + (MAC ? '⌘Y / ⌘⇧Z' : 'Ctrl+Y / Ctrl+Shift+Z') + ')';
    $$('[data-q="Undo"]').forEach((b) => { b.disabled = !canUndo; b.title = uTip; });
    $$('[data-q="Redo"]').forEach((b) => { b.disabled = !canRedo; b.title = rTip; });
    $$('[data-undo]').forEach((b) => { b.disabled = !canUndo; b.title = uTip; });
    $$('[data-redo]').forEach((b) => { b.disabled = !canRedo; b.title = rTip; });
  }

  function historyRecord(prevText, prevSelA, prevSelB, isTyping) {
    if (HIST_SUSPEND) return;
    const h = histGet();
    const now = Date.now();
    if (isTyping && h.past.length && (now - h.lastAt < HIST_COALESCE)) {
      // Coalesce continuous typing within 600ms: keep the baseline snapshot before this typing burst
      h.lastAt = now;
      return;
    }
    h.past.push({ text: prevText, selA: prevSelA, selB: prevSelB });
    if (h.past.length > HIST_MAX) h.past.shift();
    h.future = [];
    h.lastAt = now;
    historyUIUpdate();
  }

  function docApplySnapshot(snap) {
    const ta = $('#codeInput');
    HIST_SUSPEND = true;
    SRC = snap.text;
    if (ta) {
      ta.value = snap.text;
      const a = Math.max(0, Math.min(snap.text.length, snap.selA != null ? snap.selA : snap.text.length));
      const b = Math.max(0, Math.min(snap.text.length, snap.selB != null ? snap.selB : a));
      try { ta.setSelectionRange(a, b); ta.focus(); } catch (e) {}
      const curL = lineOf(Math.min(a, SRC.length));
      setCurLine(curL, a);
      syncFmtBtns();
    }
    renderCode();
    syncSaveSoon();
    markCompileStale();
    HIST_SUSPEND = false;
  }

  function docUndo() {
    const h = histGet();
    if (!h.past.length) return false;
    const ta = $('#codeInput');
    const curText = ta ? ta.value : SRC;
    const curA = ta ? ta.selectionStart : 0;
    const curB = ta ? ta.selectionEnd : 0;
    const prev = h.past.pop();
    h.future.push({ text: curText, selA: curA, selB: curB });
    h.lastAt = 0;
    docApplySnapshot(prev);
    historyUIUpdate();
    return true;
  }

  function docRedo() {
    const h = histGet();
    if (!h.future.length) return false;
    const ta = $('#codeInput');
    const curText = ta ? ta.value : SRC;
    const curA = ta ? ta.selectionStart : 0;
    const curB = ta ? ta.selectionEnd : 0;
    const next = h.future.pop();
    h.past.push({ text: curText, selA: curA, selB: curB });
    h.lastAt = 0;
    docApplySnapshot(next);
    historyUIUpdate();
    return true;
  }

  /* ---------- real text input: a transparent textarea is stacked under the syntax-highlighted
     layer above (which stays pointer-events:none except for the package-info icons), so native
     typing/paste/undo drive SRC directly while renderCode()'s tokenizer keeps doing the highlighting
     and the existing line-click / package-info-icon behaviour above keeps working unchanged. ---------- */
  function wireEditorInput() {
    const ta = $('#codeInput'), hl = $('#codeHighlight');
    let preVal = ta.value, preSelA = ta.selectionStart, preSelB = ta.selectionEnd;
    ta.value = SRC; $('#code').classList.toggle('nonum', !PREFS.ln);
    ta.addEventListener('beforeinput', () => {
      preVal = ta.value; preSelA = ta.selectionStart; preSelB = ta.selectionEnd;
    });
    ta.addEventListener('input', (e) => {
      if (!HIST_SUSPEND) {
        const isTyping = e && (e.inputType === 'insertText' || e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward');
        historyRecord(preVal, preSelA, preSelB, !!isTyping);
      }
      preVal = ta.value; preSelA = ta.selectionStart; preSelB = ta.selectionEnd;
      SRC = ta.value; renderCode(); syncSaveSoon(); markCompileStale();
    });
    const box = document.createElement('div'); box.id = 'codeSel'; box.className = 'code-sel'; box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<div class="code-sel__in"><div class="code-sel__rs"></div><i class="code-sel__c" hidden></i></div>'; hl.after(box);
    const code = $('#code'), focusSync = () => { code.classList.toggle('is-focus', document.activeElement === ta); schedSel(); };
    ta.addEventListener('focus', focusSync); ta.addEventListener('blur', focusSync);
    ['keydown', 'keyup', 'mousedown', 'mouseup', 'select', 'compositionend'].forEach((ev) => ta.addEventListener(ev, schedSel));
    ta.addEventListener('mousemove', (e) => {   // drag-selecting; and an arrow (not the text I-beam) over the scrollbars
      if (e.buttons) schedSel();
      const r = ta.getBoundingClientRect(), on = e.clientX - r.left > ta.clientWidth || e.clientY - r.top > ta.clientHeight;
      if (on !== (ta.dataset.sb === '1')) { ta.dataset.sb = on ? '1' : ''; ta.style.cursor = on ? 'default' : ''; }
    });
    /* Pointer hit-testing on the drawn rows: the native textarea can resolve a click to a different row than the one painted under the
       pointer (fallback-font line boxes, fractional line heights), so after a click or drag the caret/selection is re-snapped to the painted
       row the pointer is over (split at half a row) and to the nearest painted column. Double/triple-click and scrollbar presses stay native. */
    const posAt = (e) => {
      indexSrc(); metrics();
      const r = ta.getBoundingClientRect(), hl = $('#codeHighlight'), hr = hl.getBoundingClientRect();
      const n = Math.max(0, Math.min(LINES.length - 1, Math.floor((e.clientY - r.top + ta.scrollTop - PAD_TOP) / LH)));
      const x = e.clientX - hr.left + hl.scrollLeft; let lo = 0, hi = LINES[n].length;
      if (xAt(n, 0) === null) return LINE_START[n] + Math.max(0, Math.min(hi, Math.round((x - (parseFloat(getComputedStyle(ta).paddingLeft) || 0)) / CW)));
      while (lo < hi) { const mid = (lo + hi) >> 1; if (xAt(n, mid) < x) lo = mid + 1; else hi = mid; }
      if (lo > 0 && x - xAt(n, lo - 1) < xAt(n, lo) - x) lo--;
      return LINE_START[n] + lo;
    };
    let ptr = null;
    ta.addEventListener('mousedown', (e) => {
      const r = ta.getBoundingClientRect();
      if (e.button !== 0 || e.detail > 1 || e.clientX - r.left > ta.clientWidth || e.clientY - r.top > ta.clientHeight) { ptr = null; return; }
      const prev = ta.selectionDirection === 'backward' ? ta.selectionEnd : ta.selectionStart;
      ptr = { anchor: e.shiftKey ? prev : posAt(e) };
    });
    document.addEventListener('mouseup', (e) => {
      if (!ptr) return; const a = ptr.anchor; ptr = null;
      if (document.activeElement !== ta) return;
      const p = Math.min(posAt(e), ta.value.length), A = Math.min(a, ta.value.length), s0 = Math.min(A, p), s1 = Math.max(A, p);
      if (ta.selectionStart !== s0 || ta.selectionEnd !== s1) ta.setSelectionRange(s0, s1, p < A ? 'backward' : 'forward');
      schedSel();
    });
    document.addEventListener('selectionchange', () => { if (document.activeElement === ta) schedSel(); });
    focusSync();
    ta.addEventListener('scroll', () => ensureWindow());
    if (window.ResizeObserver) new ResizeObserver(() => { const bx = ta.parentNode; bx.style.setProperty('--sbw', (ta.offsetWidth - ta.clientWidth) + 'px'); bx.style.setProperty('--sbh', (ta.offsetHeight - ta.clientHeight) + 'px'); ensureWindow(); }).observe(ta);   // pane resized/shown: more rows may now be visible
    const syncCurLine = () => { preSelA = ta.selectionStart; preSelB = ta.selectionEnd; const p = Math.min(ta.selectionStart, SRC.length); setCurLine(lineOf(p), p); syncFmtBtns(); };
    ta.addEventListener('click', syncCurLine);
    ta.addEventListener('mouseup', () => { if (FP) setTimeout(fpApply, 0); });   // Format Painter target selection
    ta.addEventListener('keyup', (e) => { syncCurLine(); if (FP && ta.selectionStart !== ta.selectionEnd) setTimeout(fpApply, 0); });
  }

  /* ---------- Editor formatting, review, track changes & find (js/editor.js) ---------- */
  const {
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
    trkSchedule, trkToggle, xrDialog, toggleLineComment
  } = window.RPE.editor;
  /* ---------- Project Explorer, File System Access & Storage (js/explorer.js) ---------- */
  const {
    PROJECT, PROJ_NAME, TEXT_EXTS, checkDraftRecovery,
    checkExternalFsChanges, compilePayload, createFromTemplate, docClassGallery, tplMenu,
    docDirty, ensureWrite, existsIn, exitApp, extOf, fileCache, findNode,
    handleByRel, hideWelcome, listDir, mainPath, newDocument, newFromTemplate,
    openFile, openFileNode, openProjectFolder, openViewer, recentClick, recentPanel,
    recentRemove, refreshDir, relPath, renderExplorer, reopenRecent,
    resetTemplate, restoreProject, rootDirHandle, saveActiveFile, saveAs,
    saveDoc, saveExport, scanAllTexNodes, showWelcome, syncDocClass,
    syncSaveSoon, syncSaveState, syncTitle, toB64, tplGallery
  } = window.RPE.explorer;
  /* ---------- Document Navigation: live outline of the ACTIVE file only (intentionally not a merged multi-file outline) ---------- */
  const OUT_LVL = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
  const OUT_RE = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{/g;
  const OUT_VERB = /^(verbatim\*?|Verbatim|BVerbatim|lstlisting|minted\*?|comment|alltt)$/;   // envs whose body is never scanned for headings
  let OUT_NODES = [], OUT_ALL = [], OUT_SRC = null, OUT_TIMER = 0, OUT_ACTIVE = -1, OUT_CUR_KEY = null, OUT_FILTER = '';
  const OUT_COLLAPSED = new Set();                                        // keys of collapsed branches
  function parseOutline(src) {                                            // -> tree of { type, title, star, pos, key, anc, kids }
    const root = { lvl: -1, kids: [] }, stack = [root], seen = {}; let off = 0, inVerb = false;
    for (const raw of src.split('\n')) {
      const line = raw.replace(/(^|[^\\])((?:\\\\)*)%.*$/, '$1$2');       // drop comments (an escaped \% stays)
      if (inVerb) {                                                       // inside \begin{verbatim-like}…\end{…}: never a heading
        const em = /\\end\{([^}]*)\}/.exec(line);
        if (em && OUT_VERB.test(em[1])) inVerb = false;
        off += raw.length + 1; continue;
      }
      const bm = /\\begin\{([^}]*)\}/.exec(line);
      if (bm && OUT_VERB.test(bm[1])) { inVerb = true; off += raw.length + 1; continue; }
      OUT_RE.lastIndex = 0; let m;
      while ((m = OUT_RE.exec(line))) {
        if (line[m.index - 1] === '\\') continue;                         // \\section is a line break + text, not a heading
        let d = 1, i = OUT_RE.lastIndex;
        for (; i < line.length && d; i++) { const c = line[i]; if (c === '\\') i++; else if (c === '{') d++; else if (c === '}') d--; }
        const title = line.slice(OUT_RE.lastIndex, d ? line.length : i - 1).replace(/\\(?:label|index)\{[^}]*\}/g, '').replace(/\\[a-zA-Z]+\*?\s*/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() || '(untitled)';
        const n = { type: m[1], lvl: OUT_LVL[m[1]], title, star: !!m[2], pos: off + m.index, kids: [] };
        const k = m[1] + ':' + title; n.key = k + ':' + (seen[k] = (seen[k] || 0) + 1);
        while (stack[stack.length - 1].lvl >= n.lvl) stack.pop();
        n.anc = stack.slice(1).map((s) => s.key);                         // ancestor keys, root (lvl -1) excluded, used to auto-reveal collapsed parents
        stack[stack.length - 1].kids.push(n); stack.push(n);
      }
      off += raw.length + 1;
    }
    return root.kids;
  }
  function outRows(nodes, depth, out, flat) {
    nodes.forEach((n) => {
      const i = flat.push(n) - 1, has = n.kids.length > 0, open = !OUT_COLLAPSED.has(n.key);
      out.push(`<button class="sb-row sb-row--lvl${Math.min(n.lvl, 2) + 1}${n.pos === OUT_ACTIVE ? ' is-active' : ''}" data-i="${i}" data-key="${esc(n.key)}"${has ? ` aria-expanded="${open}"` : ''} title="${esc(n.title)}" style="padding-left:${8 + depth * 14}px">${has ? `<span class="sb-tg" data-tg>${ic('chevron-right', 'ic--chev')}</span>` : '<span class="sb-tg"></span>'}<span>${esc(n.title)}${n.star ? ' *' : ''}</span></button>`);
      if (has && open) outRows(n.kids, depth + 1, out, flat);
    });
  }
  function outFlatten(nodes, out) {                                       // full node list in document order, collapse-state ignored (filter + cursor tracking need every node)
    nodes.forEach((n) => { out.push(n); if (n.kids.length) outFlatten(n.kids, out); });
    return out;
  }
  let OUT_FLAT = [];
  function renderOutline() {                                              // immediate parse + paint (file switch / init / stale-click reparse)
    clearTimeout(OUT_TIMER); OUT_SRC = SRC; OUT_NODES = parseOutline(SRC); OUT_ALL = outFlatten(OUT_NODES, []);
    paintOutline();
  }
  function paintOutline() {
    const out = []; OUT_FLAT = [];
    if (OUT_FILTER) {
      OUT_ALL.filter((n) => n.title.toLowerCase().includes(OUT_FILTER)).forEach((n) => {
        const i = OUT_FLAT.push(n) - 1;
        out.push(`<button class="sb-row sb-row--lvl${Math.min(n.lvl, 2) + 1}${n.pos === OUT_ACTIVE ? ' is-active' : ''}" data-i="${i}" data-key="${esc(n.key)}" title="${esc(n.title)}" style="padding-left:8px"><span class="sb-tg"></span><span>${esc(n.title)}${n.star ? ' *' : ''}</span></button>`);
      });
    } else outRows(OUT_NODES, 0, out, OUT_FLAT);
    const body = $('#sbOutlineBody');
    body.innerHTML = out.length ? out.join('') : `<div class="sb-empty">${OUT_FILTER ? `No headings match “${esc(OUT_FILTER)}”.` : 'No headings found in this file.'}</div>`;
    paint(body);
  }
  function scheduleOutline() {                                            // debounced: called from renderCode() on every edit
    if (SRC === OUT_SRC) return;
    clearTimeout(OUT_TIMER); OUT_TIMER = setTimeout(renderOutline, 400);
  }
  function outJump(n) {                                                   // move the caret to a heading and mark it current
    OUT_ACTIVE = n.pos; OUT_CUR_KEY = n.key;
    $$('.sb-row.is-active', $('#sbOutlineBody')).forEach((x) => x.classList.remove('is-active'));
    const row = $('#sbOutlineBody').querySelector(`[data-key="${CSS.escape(n.key)}"]`); if (row) row.classList.add('is-active');
    const ta = $('#codeInput'), ln = lineOf(n.pos);
    ta.focus(); try { ta.setSelectionRange(n.pos, n.pos); } catch (err) { /* not focusable */ }
    goToLine(ln); setCurLine(ln, n.pos);
  }
  function outSyncCursor(ln, pos) {                                       // called from setCurLine(): highlight whichever section the caret is in now
    if (!OUT_ALL.length) return;
    indexSrc(); const p = pos != null ? pos : (LINE_START[ln] || 0);
    let node = null;
    for (let i = OUT_ALL.length - 1; i >= 0; i--) { if (OUT_ALL[i].pos <= p) { node = OUT_ALL[i]; break; } }
    const key = node ? node.key : null; if (key === OUT_CUR_KEY) return;
    OUT_CUR_KEY = key; OUT_ACTIVE = node ? node.pos : -1;
    let revealed = false;
    if (node) node.anc.forEach((k) => { if (OUT_COLLAPSED.delete(k)) revealed = true; });   // auto-expand so the active section is reachable
    if (revealed || OUT_FILTER) return paintOutline();
    const body = $('#sbOutlineBody'); $$('.sb-row.is-active', body).forEach((x) => x.classList.remove('is-active'));
    if (!node) return;
    const row = body.querySelector(`[data-key="${CSS.escape(node.key)}"]`);
    if (row) { row.classList.add('is-active'); row.scrollIntoView({ block: 'nearest' }); }
  }
  $('#sbOutlineFilter').addEventListener('input', (e) => { OUT_FILTER = e.target.value.trim().toLowerCase(); paintOutline(); });
  $('#sbOutlineFilter').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (e.target.value) { e.target.value = ''; OUT_FILTER = ''; paintOutline(); } else e.target.blur();
  });
  $('#sbOutlineBody').addEventListener('click', (e) => {
    const b = e.target.closest('.sb-row'); if (!b) return;
    let n = OUT_FLAT[+b.dataset.i]; if (!n) return;
    if (e.target.closest('[data-tg]')) { OUT_COLLAPSED.has(n.key) ? OUT_COLLAPSED.delete(n.key) : OUT_COLLAPSED.add(n.key); return paintOutline(); }
    if (OUT_SRC !== SRC) {                                                // edit landed inside the debounce window: reparse now and jump off the fresh tree
      renderOutline(); n = OUT_ALL.find((x) => x.key === n.key);
      if (!n) return toast('That heading no longer exists.');
    }
    outJump(n);
  });
  $$('.sb-collapse').forEach((btn) => { btn.onclick = () => { const sec = btn.closest('.sb-section'); const on = sec.classList.toggle('is-collapsed'); btn.setAttribute('aria-expanded', !on); }; });
  (function sidebarResizer() {
    const rz = $('#sbResizer'), top = $('#sbExplorer'), bot = $('#sbOutline'), root = document.documentElement.style;
    let pct = 50;
    const setPct = (p) => { pct = Math.min(88, Math.max(12, p)); root.setProperty('--sb-explorer-g', pct); root.setProperty('--sb-outline-g', 100 - pct); rz.setAttribute('aria-valuenow', Math.round(pct)); };
    rz.setAttribute('aria-valuemin', 12); rz.setAttribute('aria-valuemax', 88); setPct(50);
    rz.onpointerdown = (e) => {
      e.preventDefault(); rz.setPointerCapture(e.pointerId); document.body.style.userSelect = 'none';
      const mv = (ev) => { const a = top.getBoundingClientRect(), b = bot.getBoundingClientRect(), tot = (b.bottom - a.top) || 1; setPct((ev.clientY - a.top) / tot * 100); };
      const up = () => { rz.removeEventListener('pointermove', mv); document.body.style.userSelect = ''; };
      rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up, { once: true }); rz.addEventListener('pointercancel', up, { once: true });
    };
    rz.ondblclick = () => setPct(50);
    rz.onkeydown = (e) => { const d = { ArrowUp: -5, ArrowDown: 5 }[e.key]; if (d) { e.preventDefault(); setPct(pct + d); } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setPct(e.key === 'Home' ? 12 : 88); } };
  })();
  function toggleSidebar(force) {
    const sb = $('#sidebar'), show = typeof force === 'boolean' ? force : sb.hidden;
    sb.hidden = !show;
    const t = $('#sidebarToggle'); t.setAttribute('aria-pressed', show); t.classList.toggle('is-on', show);
    $$('.rbtn').filter((b) => b.title === 'Navigation Pane').forEach((b) => b.classList.toggle('is-on', show));   // keep View ▸ Navigation Pane in sync
  }

  /* ---------- project rename (click the project name in the title bar) ---------- */
  function cleanProjectName(v) {
    return String(v).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\.(tex|pdf)$/i, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  function applyProjectName(next) {
    const prev = PROJ_NAME; if (next === prev) return;
    if (PROJECT[0] && PROJECT[0].t === 'folder') PROJECT[0].n = next;   // relabels the root row shown in the explorer, the real folder on disk keeps its own name
    PROJ_NAME = next; $('#docFileName').textContent = next; window.RPE.explorer.syncPdfName();
    renderExplorer();
  }
  function startRename() {
    const btn = $('#docTitle'); if (!btn || btn.hidden) return;
    const input = h('<input class="doc-title-input" type="text" maxlength="80" spellcheck="false" aria-label="Project name">');
    const cur = (window.RPE.explorer.rootDirHandle && window.RPE.explorer.rootDirHandle.name) || PROJ_NAME;   // the real folder name
    const bw = btn.getBoundingClientRect().width, g2 = document.createElement('canvas').getContext('2d');   // the field hugs its text, while the row keeps the button's width so the name stays exactly where it was
    const fit = () => { g2.font = getComputedStyle(input).font; const w = Math.ceil(g2.measureText(input.value || ' ').width) + 16 + 2 + 3; input.style.width = w + 'px'; input.style.marginRight = Math.max(0, bw - w) + 'px'; };
    input.value = cur; btn.hidden = true; btn.after(input); fit(); input.addEventListener('input', fit); input.focus(); input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      const v = cleanProjectName(input.value);
      input.remove(); btn.hidden = false;
      if (commit) {
        if (!v) toast('Project name can’t be empty');
        else if (v !== cur) window.RPE.explorer.renameProjectFolder(v).then((r) => {
          if (r !== 'label') return;
          applyProjectName(v); toast(window.RPE.explorer.rootDirHandle ? 'Project label changed to “' + v + '”: renaming the folder on disk needs the local Plum server' : 'Project renamed to “' + v + '”');
        });
      }
      btn.focus();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
  }

  /* Backstage ▸ Properties: non-modal metadata page. Title/Author go through the Document Identity code (tbRead/tbApply → \title/\author);
     Subject/Keywords/Language are hyperref keys (pdfsubject/pdfkeywords/pdflang) updated in place wherever they already are
     (\hypersetup or hyperref's options), otherwise added once in one \hypersetup; Publisher is KOMA's \publishers. Source edits only,
     the compiled PDF changes after the next Compile. */
  const PM_LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, PM_HY = /\\usepackage(?:\[[^\]]*\])?\{[^}]*\bhyperref\b[^}]*\}/g, PM_KOMA = /^scr(artcl|reprt|book)$/;
  function pmScan(mk, a, b) {   // key=value entries in mk[a..b): { key, ea, va, vb, pe (end of previous entry or -1), nc (next comma or -1) }
    const out = []; let i = a, pe = -1;
    while (i < b) {
      while (i < b && /[\s,]/.test(mk[i])) i++;
      if (i >= b) break;
      const ea = i; while (i < b && mk[i] !== '=' && mk[i] !== ',') i++;
      const key = mk.slice(ea, i).trim(); let va = i, vb = i;
      if (mk[i] === '=') {
        i++; while (i < b && /\s/.test(mk[i])) i++; va = i;
        if (mk[i] === '{') { let d = 0; for (; i < b; i++) { if (mk[i] === '\\') i++; else if (mk[i] === '{') d++; else if (mk[i] === '}' && !--d) { i++; break; } } if (d) { out.bad = true; return out; } }
        else while (i < b && mk[i] !== ',') i++;
        vb = i; while (vb > va && /\s/.test(mk[vb - 1])) vb--;
      }
      let j = vb; while (j < b && /\s/.test(mk[j])) j++;
      out.push({ key, ea, va, vb, pe, nc: mk[j] === ',' && j < b ? j : -1 }); pe = vb;
    }
    return out;
  }
  function pmRead(t) {
    const mk = tocMask(t), dc = /^[ \t]*\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/m.exec(mk), bd = mk.indexOf('\\begin{document}');
    if (!dc || bd < 0) return { err: 'Open the main .tex file (with \\documentclass and \\begin{document}) to edit its properties' };
    const cs = [], hre = new RegExp(PM_HY.source, 'g'); let m, hyEnd = -1;
    while ((m = hre.exec(mk))) { hyEnd = m.index + m[0].length; const o = m[0].indexOf('['); if (o >= 0) { const c = o + m[0].slice(o).indexOf(']'); cs.push({ a: m.index + o + 1, b: m.index + c }); } }
    tbCmd(mk, 'hypersetup').forEach((x) => cs.push({ a: x.a, b: x.b, hs: true }));
    cs.forEach((c) => { c.e = pmScan(mk, c.a, c.b); });
    if (cs.some((c) => c.e.bad)) return { err: 'A hyperref option list has unbalanced braces. Fix it in the source first' };
    const find = (k) => { let r = null; cs.forEach((c) => c.e.forEach((e) => { if (e.key.toLowerCase() === k) r = { ...e, c }; })); return r; };
    const rd = (k) => { const e = find(k); if (!e) return ''; const v = t.slice(e.va, e.vb).trim(); return tbUnesc(v[0] === '{' ? v.slice(1, -1) : v); };
    const tb = tbRead(t), pub = tbCmd(mk, 'publishers'), cls = dc[1].trim();
    return { t, mk, bd, cls, cs, find, hyEnd, tb, pub, pubOk: PM_KOMA.test(cls) || pub.length > 0,
      f: { title: tb.err ? '' : tb.f.title, author: tb.err ? '' : tb.f.author, subject: rd('pdfsubject'), keywords: rd('pdfkeywords'), publisher: pub.length ? tbUnesc(t.slice(pub[pub.length - 1].a, pub[pub.length - 1].b)) : '', lang: rd('pdflang') } };
  }
  function pmApply(f1) {
    const ta = $('#codeInput'); if (!ta) return false; const refuse = (m) => (toast(m), false);
    let R = pmRead(ta.value); if (R.err) return refuse(R.err);
    const f0 = R.f, ch = (k) => f1[k].trim() !== f0[k].trim(); let did = false;
    if (ch('lang') && f1.lang.trim() && !PM_LANG.test(f1.lang.trim())) return refuse('Language must be a code such as en, en-US or fr-CA. Nothing was changed');
    if (ch('publisher') && !R.pubOk) return refuse('Publisher needs a KOMA class (scrartcl, scrreprt, scrbook). Nothing was changed');
    if (ch('title') || ch('author')) {
      if (R.tb.err) return refuse(R.tb.err);
      const r = tbApply(R.tb.f, { ...R.tb.f, title: f1.title, author: f1.author }); if (r === false) return false; if (r) did = true;
      R = pmRead(ta.value); if (R.err) return refuse(R.err);
    }
    const { t, mk, bd } = R, ed = [], add = [];
    const meta = [['pdfsubject', f1.subject, ch('subject')], ['pdfkeywords', f1.keywords, ch('keywords')], ['pdflang', f1.lang, ch('lang')],
      ['pdftitle', f1.title, ch('title') && !!R.find('pdftitle')], ['pdfauthor', f1.author, ch('author') && !!R.find('pdfauthor')]];
    meta.forEach(([k, v, c]) => {
      if (!c) return; v = v.replace(/\s*\n\s*/g, ' ').trim(); const e = R.find(k);
      if (e && v) ed.push({ a: e.va, b: e.vb, str: '{' + tbEsc(v) + '}' });
      else if (e) { let z = e.nc + 1; if (e.nc >= 0) { while (z < t.length && /[ \t]/.test(t[z])) z++; ed.push({ a: e.ea, b: z, str: '' }); } else ed.push({ a: e.pe >= 0 ? e.pe : e.ea, b: e.vb, str: '' }); }
      else if (v) add.push(k + '={' + tbEsc(v) + '}');
    });
    if (add.length) {
      const own = R.cs.filter((c) => c.hs && c.e.some((e) => /^pdf(title|author|subject|keywords|lang)$/i.test(e.key))).pop();
      if (own) { let p = own.b; while (p > own.a && /\s/.test(t[p - 1])) p--; ed.push({ a: p, b: p, str: (p > own.a && t[p - 1] !== ',' ? ',' : '') + add.join(',') }); }
      else {
        const line = '\n\\hypersetup{' + add.join(',') + '}';
        if (R.hyEnd >= 0) ed.push({ a: R.hyEnd, b: R.hyEnd, str: line });
        else { const pk = ensurePackage(t, 'hyperref'); if (!pk) return refuse('Could not add hyperref. Check the \\documentclass / preamble'); ed.push({ a: pk.pos, b: pk.pos, str: pk.str + line }); }
      }
    }
    if (ch('publisher')) {
      const v = f1.publisher.replace(/\s*\n\s*/g, ' ').trim(), c = R.pub[R.pub.length - 1];
      if (c && v) ed.push({ a: c.a, b: c.b, str: tbEsc(v) });
      else if (c) { const ls = t.lastIndexOf('\n', c.s - 1) + 1, nl = t.indexOf('\n', c.e), own = !t.slice(ls, c.s).trim() && !t.slice(c.e, nl < 0 ? t.length : nl).trim(); ed.push({ a: own ? ls : c.s, b: own ? (nl < 0 ? t.length : nl + 1) : c.e, str: '' }); }
      else if (v) { const ls = t.lastIndexOf('\n', bd - 1) + 1, own = !t.slice(ls, bd).trim(); ed.push({ a: own ? ls : bd, b: own ? ls : bd, str: (own ? '' : '\n') + '\\publishers{' + tbEsc(v) + '}\n' + (own ? '' : '\n') }); }
    }
    if (!ed.length) { if (!did) toast('Properties are already set that way'); return did; }
    ed.sort((x, y) => y.a - x.a);
    const mp = (p) => ed.reduce((n, e) => (p >= e.b ? n + e.str.length - (e.b - e.a) : p > e.a ? n - (p - e.a) : n), p), s0 = mp(ta.selectionStart), e0 = mp(ta.selectionEnd);
    ed.forEach((e) => fmtEdit(ta, e.a, e.b, e.str, s0, e0));
    return true;
  }
  function propsPanel(box, refresh) {
    const ta = $('#codeInput'), R = ta ? pmRead(ta.value) : { err: 'No document is open' };
    if (R.err) { box.insertAdjacentHTML('beforeend', `<p class="bs-note">${esc(R.err)}</p>`); return; }
    const fld = (k, l, ph, dis, why) => `<div class="field"><label class="field__label">${l}<input data-pm="${k}" value="${esc(R.f[k])}" placeholder="${esc(ph)}" ${dis ? 'disabled' : ''}></label>${why ? `<small class="muted">${why}</small>` : ''}</div>`;
    box.insertAdjacentHTML('beforeend', `<div class="pm">${fld('title', 'Title', '\\title', R.tb.err, R.tb.err ? esc(R.tb.err) : '')}${fld('author', 'Author', '\\author', R.tb.err)}${fld('subject', 'Subject', 'PDF subject')}${fld('keywords', 'Keywords', 'comma, separated')}${fld('publisher', 'Publisher', '\\publishers', !R.pubOk, R.pubOk ? '' : 'Available with KOMA classes (scrartcl, scrreprt, scrbook)')}${fld('lang', 'Language', 'e.g. en-US', false, 'PDF language tag (hyperref pdflang)')}</div><div class="pm__foot"><button class="btn btn--primary" data-pm-go>Apply to Source</button><button class="btn" data-pm-rev>Revert</button></div><p class="bs-note">Title and author are your document’s \\title / \\author; the other fields are written as hyperref PDF settings (Publisher as \\publishers). Applying edits the LaTeX source only: the compiled PDF keeps its old properties until you press Compile.</p>`);
    $('[data-pm-rev]', box).onclick = refresh;
    $('[data-pm-go]', box).onclick = () => { const f1 = {}; $$('[data-pm]', box).forEach((i) => { f1[i.dataset.pm] = i.disabled ? R.f[i.dataset.pm] : i.value; }); const r = pmApply(f1); if (r) { toast('Source updated. Recompile to refresh the PDF'); refresh(); } };
  }

  /* ---------- File backstage ---------- */
  const BS = {
    New: ['Start a new document.', [['file-plus-2', 'New Document', 'Blank document (default compiler)', 'newdoc'], ['layout-template', 'New from Template', 'Thesis, article, report', 'newtpl'], ['feather', 'Welcome Screen', 'First-launch welcome & recent projects', 'welcome']]],
    Open: ['Open a file or folder, or pick up a recent project.', [['file-code', 'Open File…', 'Open a single .tex or text file', 'openfile'], ['folder-open', 'Open Folder…', 'Open a LaTeX project folder', 'openfolder']]],
    Save: ['Save the current document.', [['save', 'Save', 'Ctrl+S', 'save'], ['file-down', 'Save As…', 'Ctrl+Shift+S', 'saveas']]],
    Templates: ['Browse the template catalogue and start a new document from one.', null],
    Properties: ['Title, author, subject, keywords, publisher and language of this document.', null, 1],
    Export: ['Export your work.', [['file-output', 'Export PDF', 'Compiled document', 'exportpdf'], ['folder-open', 'Export Project as ZIP', 'Source, figures and bibliography', 'exportzip'], ['file-code', 'Export Single .tex', 'Active source document', 'exporttex'], ['hard-drive', 'Open Output Folder', 'Where project ZIP exports are saved', 'openout']]],
    Preferences: ['Appearance and editor settings. Changes apply immediately and are remembered.', [['keyboard', 'Keyboard Shortcuts', 'View all shortcuts', 'shortcuts']], 2],
    Exit: ['Close the application.', [['x', 'Exit', 'Asks to save unsaved changes first', 'exit']]],
    About: ['', null, 3]
  };
  /* Preferences page (File ▸ Preferences): controls wired to persisted settings. */
  function prefsPanel(box) {
    const ctrl = (t) => { const lab = $$('label', box).find((l) => l.textContent.trim().startsWith(t)); return lab ? lab.closest('.bs-prefs-row').querySelector('.bs-prefs-row__ctrl') : null; };
    const inp = (t) => { const lab = $$('label', box).find((l) => l.textContent.trim().startsWith(t)); return lab ? lab.querySelector('input') : null; };
    const chips = $$('.chip', box), modes = ['light', 'dark', 'system'];
    const showT = () => chips.forEach((c, i) => { const on = modes[i] === PREFS.theme; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on); });
    chips.forEach((c, i) => { const go = () => { appearanceSet(modes[i]); showT(); $$('.theme-swatch', box).forEach((b) => { const on = b.dataset.uid === ''; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on); }); }; c.onclick = go; c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
    showT();
    /* Number inputs live in .bs-prefs-row__ctrl, found by aria-label */
    const numEl = (lbl) => box.querySelector(`input[aria-label="${lbl}"]`);
    const num = (lbl, key, lo, hi, int) => { const el = numEl(lbl); if (!el) return; el.min = lo; el.max = hi; el.step = int ? 1 : 0.5; el.value = PREFS[key];
      el.oninput = () => { const v = parseFloat(el.value), ok = Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v)); el.setAttribute('aria-invalid', !ok); if (ok) { prefSet(key, v); editorApply(); } };
      el.onblur = () => { el.value = PREFS[key]; el.removeAttribute('aria-invalid'); }; };
    num('Editor font size (px)', 'fs', 8, 32, false); num('Tab width (spaces)', 'tab', 1, 8, true);
    const ln = inp('Show line numbers'); if (ln) { ln.checked = PREFS.ln; ln.onchange = () => ACT.ln(ln.checked); }
    { const rr = $('#lxRerun', box); if (rr) rr.onclick = () => openWizard(1); lxStatusPaint(); }
    const dcLab = $$('label', box).find((l) => l.textContent.trim().startsWith('Default compiler'));
    const dc = dcLab ? dcLab.querySelector('select') : null;
    if (dc) { dc.selectedIndex = PREFS.compiler === 'lualatex' ? 1 : 0; setupCustomSelect(dc); dc.onchange = () => { const v = dc.selectedIndex ? 'lualatex' : 'xelatex'; prefSet('compiler', v); toast('Default compiler: ' + dc.value + ': used for new documents and documents that name no compiler'); }; }
    const bfCtrl = ctrl('Default body font');
    if (bfCtrl) {
      const btn = h(`<button type="button" class="c-select" aria-haspopup="menu" aria-expanded="false" aria-label="Default body font"><span class="c-select__text"></span><svg class="c-select__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>`);
      bfCtrl.append(btn);
    const txt = btn.querySelector('.c-select__text');
    const syncBtn = () => {
      const cur = PREFS.bodyFont;
      txt.textContent = cur || 'None (LaTeX default)';
      txt.style.fontFamily = cur ? `'${cur}', sans-serif` : '';
      txt.style.color = cur ? 'var(--text)' : 'var(--text-2)';
    };
    syncBtn();
    const openMenu = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      fontLoad().catch(() => {}).finally(() => {
        menu(btn, fontMenuItems({ includeNone: true, selected: PREFS.bodyFont }), (v) => {
          const nm = (v === 'None (LaTeX default)' ? '' : v).trim();
          prefSet('bodyFont', nm);
          syncBtn();
          toast(nm ? 'Default body font: ' + nm + ': used for new documents' : 'Default body font cleared');
        });
      });
    };
    btn.onclick = openMenu;
    btn.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu(e);
      }
    };
    }
    const ufCtrl = ctrl('Interface font');
    if (ufCtrl) {
      const btn = h(`<button type="button" class="c-select" aria-haspopup="menu" aria-expanded="false" aria-label="Interface font"><span class="c-select__text"></span><svg class="c-select__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>`);
      ufCtrl.append(btn);
      const txt = btn.querySelector('.c-select__text');
      const syncUf = () => { const cur = PREFS.uiFont; txt.textContent = cur || 'Default (Spline Sans)'; txt.style.fontFamily = cur ? `'${cur}', sans-serif` : ''; txt.style.color = cur ? 'var(--text)' : 'var(--text-2)'; };
      syncUf();
      const openUf = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        fontLoad().catch(() => {}).finally(() => {
          menu(btn, fontMenuItems({ includeNone: true, noneLabel: 'Default (Spline Sans)', selected: PREFS.uiFont }), (v) => {
            const nm = (v === 'Default (Spline Sans)' ? '' : v).replace(/[^\w .\-]/g, '').trim();
            prefSet('uiFont', nm); uiFontApply(); syncUf();
            toast(nm ? 'Interface font: ' + nm : 'Interface font reset to default');
          });
        });
      };
      btn.onclick = openUf;
      btn.onkeydown = (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUf(e); } };
    }
    const cs = inp('Compile on save'); if (cs) { cs.checked = PREFS.cos; cs.onchange = () => { prefSet('cos', cs.checked); toast('Compile on save ' + (cs.checked ? 'on: saving a document now recompiles it' : 'off')); }; }
    const as = inp('Autosave to disk'); if (as) { as.checked = PREFS.asd; as.onchange = () => { prefSet('asd', as.checked); toast('Autosave to disk ' + (as.checked ? 'on: files with a handle autosave every 30s' : 'off')); }; }
    const acp = inp('Auto-compile after pause'); if (acp) { acp.checked = PREFS.acp; acp.onchange = () => { prefSet('acp', acp.checked); toast('Auto-compile after pause ' + (acp.checked ? 'on: compiles 2s after you stop typing' : 'off')); }; }
    /* Interface theme picker, appended inside Appearance section */
    const appsec = box.querySelector('.bs-prefs-section');
    const picker = h('<div class="theme-picker"></div>');
    picker.innerHTML = '<div class="theme-picker__head">Interface Theme</div>'
      + ['Light', 'Dark'].map((grp) => {
        const dark = grp === 'Dark';
        const items = UI_THEMES.filter((t) => t.dark === dark);
        const swatches = items.map((t) => {
          const p = UI_THEME_PREVIEW[t.id] || ['#F5F6F8', '#FFFFFF', '#313A75', '#E8EAF5'];
          const active = PREFS.uiTheme === t.id;
          return `<button type="button" class="theme-swatch${active ? ' is-active' : ''}" data-uid="${t.id}" title="${esc(t.name)}" aria-pressed="${active}">`
            + `<span class="theme-swatch__palette">`
            + `<span style="background:${p[0]}"></span><span style="background:${p[1]}"></span>`
            + `<span style="background:${p[2]}"></span><span style="background:${p[3]}"></span>`
            + `</span><span class="theme-swatch__name">${esc(t.name)}</span></button>`;
        }).join('');
        return `<div class="theme-picker__group"><div class="theme-picker__group-label">${grp}</div><div class="theme-grid">${swatches}</div></div>`;
      }).join('');
    (appsec || box).append(picker);
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-swatch'); if (!btn) return;
      const id = btn.dataset.uid;
      uiThemeSet(id);
      $$('.theme-swatch', picker).forEach((b) => { const on = b.dataset.uid === id; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on); });
    });
  }
  function backstage(on, key) {
    const bs = $('#backstage'); bs.hidden = !on; if (!on) { closeCustomMenu(); return; }
    const panel = (k) => { $$('.bs-item', bs).forEach((b) => b.classList.toggle('is-active', b.dataset.k === k)); const p = BS[k]; if (p[2] === 2) { $('.bs-main', bs).innerHTML = `<div class="bs-panel"><h2>${k}</h2><p class="bs-lead">${p[0]}</p><div class="bs-prefs">${D.options().b}</div><div class="bs-cards" style="margin-top:20px">${p[1].map((c) => `<button class="bs-card" data-d="${c[3]}">${ic(c[0])}<span><b>${c[1]}</b><small>${c[2]}</small></span></button>`).join('')}</div></div>`; paint($('.bs-main', bs)); prefsPanel($('.bs-prefs', bs)); return; }
      if (p[2] === 3) { $('.bs-main', bs).innerHTML = `<div class="bs-panel bs-about"><div class="bs-about__hero"><div class="bs-about__logo"><span class="bs-about__icon" role="img" aria-label="Laurevine Plum"></span></div><h1 class="bs-about__name"><span class="bs-about__name-laurevine">LAUREVINE</span><span class="bs-about__name-plum">PLUM</span></h1><p class="bs-about__version">Version ${esc(APP_VERSION)}</p><p class="bs-about__tagline">A local LaTeX editor that runs in your browser,<br>compiled on this machine. Nothing sent to any third party.</p></div><div class="bs-about__tm"><strong>Laurevine</strong> is a trademark of BIOWESS. BIOWESS &copy; 2026. All rights reserved.</div><section class="bs-about__oss"><h3>Open-source components</h3><table class="bs-about__tbl"><thead><tr><th>Package</th><th>Version</th><th>License</th></tr></thead><tbody><tr><td>Lucide Icons</td><td>0.469.0</td><td>ISC</td></tr><tr><td>KaTeX</td><td>0.16.11</td><td>MIT</td></tr><tr><td>PDF.js</td><td>bundled</td><td>Apache 2.0</td></tr><tr><td>Poppins, Caveat, Inconsolata &amp; other bundled fonts</td><td>-</td><td>SIL Open Font License 1.1</td></tr><tr><td>TeX Gyre Termes</td><td>-</td><td>GUST Font License (GFL)</td></tr><tr><td>Node.js</td><td>runtime</td><td>MIT</td></tr></tbody></table></section></div>`; paint($('.bs-main', bs)); return; }
      if (p[2]) { $('.bs-main', bs).innerHTML = `<div class="bs-panel"><h2>${k}</h2><p class="bs-lead">${p[0]}</p></div>`; propsPanel($('.bs-panel', bs), () => panel(k)); return; } $('.bs-main', bs).innerHTML = `<div class="bs-panel"><h2>${k}</h2><p class="bs-lead">${p[0]}</p>${p[1] ? `<div class="bs-cards">${p[1].map((c) => `<button class="bs-card" data-d="${c[3] || ''}">${ic(c[0])}<span><b>${c[1]}</b><small>${c[2]}</small></span></button>`).join('')}</div>` : `<div class="bs-grid">${(window.LP_TEMPLATES || []).map((t) => `<div class="bs-tpl">${t.thumb.replace('width="34" height="44"', 'width="68" height="88"')}<b>${esc(t.name)}</b><small>${esc(t.desc)}</small><button class="btn bs-tpl__go" data-tpl="${esc(t.id)}">Create new document</button></div>`).join('') || '<p class="muted">No templates found</p>'}</div>`}${k === 'Open' ? '<div id="recList" class="bs-rec-list"></div>' : k === 'Save' || k === 'Templates' || k === 'Exit' || k === 'Export' ? '' : '<p class="bs-note">Preview only. Nothing is created, opened or saved.</p>'}</div>`; paint($('.bs-main', bs)); if (k === 'Open') recentPanel($('#recList')); };
    bs.innerHTML = `<nav class="bs-nav"><button class="bs-back" aria-label="Back">${ic('arrow-left')}</button>${Object.keys(BS).map((k) => `<button class="bs-item" data-k="${k}">${k}</button>`).join('')}</nav><div class="bs-main"></div>`;
    paint(bs); panel(BS[key] ? key : 'New');
    bs.onclick = (e) => { if (recentClick(e)) return; const b = e.target.closest('.bs-item'), c = e.target.closest('.bs-card'), tg = e.target.closest('.bs-tpl__go'); if (tg) { const t = (window.LP_TEMPLATES || []).find((x) => x.id === tg.dataset.tpl); if (t) { backstage(false); createFromTemplate(t); } } else if (e.target.closest('.bs-back')) backstage(false); else if (b) panel(b.dataset.k); else if (c) { if (c.dataset.d === 'newdoc') { backstage(false); newDocument(); } else if (c.dataset.d === 'newtpl') { backstage(false); newFromTemplate(); } else if (c.dataset.d === 'welcome') { backstage(false); showWelcome(true); } else if (c.dataset.d === 'openfolder') { backstage(false); openProjectFolder(); } else if (c.dataset.d === 'openfile') { backstage(false); openFile(); } else if (c.dataset.d === 'save') { backstage(false); saveDoc(); } else if (c.dataset.d === 'saveas') { backstage(false); saveAs(); } else if (c.dataset.d === 'exportpdf') { backstage(false); exportPdf(); } else if (c.dataset.d === 'exportzip') { backstage(false); exportZip(); } else if (c.dataset.d === 'exporttex') { backstage(false); exportTex(); } else if (c.dataset.d === 'exit') { backstage(false); exitApp(); } else if (c.dataset.d === 'openout') openOutputFolder(); else if (c.dataset.d) openD(c.dataset.d); else toast('Preview only'); } };
  }

  /* ---------- Compile: sends SRC to the local compile server (server/server.js), which runs
     XeLaTeX on this machine and returns either a compiled PDF or an error log. There is no mock
     result here, if the server isn't running or the compiler is missing, that failure is reported
     in the PDF pane rather than assumed away. ---------- */
  /* ---------- Compilation Diagnostics, Problems & PDF Viewer (js/pdf-viewer.js) ---------- */
  const {
    diagFill, diagDialog, recordCompile,
    PROB,
    parseProblems, probRender, probJump, probUpdateGutter, probBadgeSync,
    PV, PV_STEPS, PV_MIN, PV_MAX, PV_NOPDF,
    pvMsg, pvClear, pvLabels, pvCurrent, pvLayout, pvRender, pvSet, pvZoom, pvFit, pvMode, pvNav, pvAct, pvInit,
    renderThumbs, toggleThumbs, showCompiledPdf, showCompileError,
    exportPdf, exportZip, exportTex, openOutputFolder,
    setCompileStatus, markCompileStale, payloadSig
  } = window.RPE.pv;
  function cbtnLabel(btn, label, text) {   // swap the Compile button's text and glide the button to its new natural width ("Compiling…" is wider; it shrinks back afterwards)
    const w0 = btn.getBoundingClientRect().width; label.textContent = text; btn.style.width = ''; const w1 = btn.getBoundingClientRect().width;
    clearTimeout(btn._wt); if (!w0 || Math.abs(w0 - w1) < 0.5) return;
    btn.style.width = w0 + 'px'; void btn.offsetWidth; btn.style.width = w1 + 'px';
    btn._wt = setTimeout(() => { btn.style.width = ''; }, 300);
  }
  async function runCompile(opts) {
    if (RPE.pv.compiling || noDoc()) return;
    const wantBib = !!(opts && opts.bib === true), quiet = !!(opts && opts.quiet === true);
    RPE.pv.compiling = true; let sig = null;
    RPE.pv.compileAC = new AbortController();
    let payload = null;
    try { payload = await compilePayload(); } catch (e) { toast((e && e.message) || 'Could not gather the project files'); }
    if (!payload) { RPE.pv.compiling = false; RPE.pv.compileAC = null; return; }
    sig = payloadSig(payload); if (wantBib) payload.bib = true;
    try {
      const set = await fontLoad();
      if (set) {
        const docText = (payload.files || []).filter((f) => f.rel && f.rel.endsWith('.tex')).map((f) => f.data).join('\n') || SRC;
        const fontRe = /\\(?:fontspec|setmainfont|setsansfont|setmonofont|newfontfamily(?:\\[a-zA-Z]+)?)(?:\[[^\]]*\])?\{([^{}]+)\}/g;
        const used = new Set();
        let m;
        while ((m = fontRe.exec(docText)) !== null) {
          const fn = m[1].trim();
          if (fn && !fn.endsWith('.ttf') && !fn.endsWith('.otf')) used.add(fn);
        }
        const missing = [...used].filter((f) => !set.has(f.toLowerCase()));
        if (missing.length) {
          toast('Warning: font' + (missing.length > 1 ? 's ' : ' ') + missing.map((f) => '“' + f + '”').join(', ') + ' not available on server: compilation may fail');
        }
      }
    } catch (e) {}
    if (PV.doc && PV.wraps.length) {
      const sc = $('.pdf-scroll'), curP = pvCurrent(), curW = PV.wraps[curP - 1];
      PV.savedView = {
        page: curP,
        pageOffset: curW ? (sc.scrollTop - curW.offsetTop) : 0,
        top: sc.scrollTop,
        left: sc.scrollLeft,
        scale: PV.scale,
        fit: PV.fit
      };
    }
    const btn = $('#compileBtn'), label = $('#compileLabel'), cancelBtn = $('#cancelCompileBtn');
    const cbs = [[btn, label], [$('#pdfEmptyCompile'), $('#pdfEmptyLabel')]].filter((x) => x[0]);   // toolbar + empty-PDF-pane Compile buttons share one busy state and spinner phase
    cbs.forEach(([b, l]) => { b.disabled = true; b.classList.add('is-busy'); if (l) cbtnLabel(b, l, 'Compiling…'); });
    $$('.cbtn__spin').forEach((s) => s.getAnimations().forEach((a) => { a.startTime = 0; }));
    if (cancelBtn) cancelBtn.hidden = false;
    setCompileStatus('Compiling…', '#C9A23A', 'compiling');
    try {
      let res;
      try {
        res = await fetch('/api/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: RPE.pv.compileAC.signal });
      } catch (err) {
        if (err && err.name === 'AbortError') {
          setCompileStatus('Cancelled', '#888', 'idle');
          recordCompile(false, 'Compilation cancelled by user', '', null);
          return;
        }
        showCompileError('Could not reach the compile server. Start it with "node server/server.js" from the project folder, then reload this page.', String((err && err.message) || err));
        setCompileStatus('Server unreachable', '#A23B3B', 'error');
        recordCompile(false, 'Network error: ' + String((err && err.message) || err), '', null);
        return;
      }
      let data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON body, handled below */ }
      if (data && data.ok) {
        const bb = wantBib ? data.bib : null;
        if (wantBib && !(bb && bb.ok)) {   // the bibliography step itself failed: say so, with its log
          showCompileError('Bibliography update failed: ' + ((bb && bb.message) || 'the compile server did not report a bibliography result (is it up to date?)'), bb && bb.log);
          recordCompile(false, 'Bibliography update failed: ' + ((bb && bb.message) || 'no bibliography result reported'), (bb && bb.log) || '', data.exitCode);
          setCompileStatus('Bibliography failed', '#A23B3B', 'error');
          if (!quiet) toast('Bibliography update failed. See the PDF pane for details');
        } else {
          showCompiledPdf(data.pdfUrl); RPE.pv.lastPdf = { url: data.pdfUrl, sig };
          RPE.pv.lastCompiledSrc = SRC;
          const badge = $('#pdfStaleBadge'); if (badge) badge.hidden = true;
          recordCompile(true, bb ? 'Compiled; bibliography updated with ' + bb.tool : 'Compiled successfully', data.log, data.exitCode);
          setCompileStatus('Ready', '#6C8F6E', 'success');
          if (!quiet) toast(bb ? 'Bibliography updated with ' + bb.tool + (bb.warnings.length ? ': ' + bb.warnings.length + ' warning' + (bb.warnings.length === 1 ? '' : 's') + ': ' + bb.warnings[0] : '') : 'Compiled successfully');
        }
      } else if (data && data.code === 'NO_COMPILER') {   // friendly, non-blocking: editing and saving carry on; the toast offers the wizard
        showCompileError(LX_NO_COMPILER + ((data.saved || SETUP.storedBad) ? '\n\nThe compiler location saved in setup no longer exists:\n' + (data.saved || SETUP.storedBad) : ''));
        recordCompile(false, LX_NO_COMPILER, '', null);
        setCompileStatus('No LaTeX compiler', '#A23B3B', 'error');
        if (!quiet) lxNoCompilerToast();
      } else {
        const msg = (data && data.error) || (res.ok ? 'The compile server returned an unrecognised response.' : `The compile server returned an unexpected response (HTTP ${res.status}).`);
        showCompileError(msg, data && data.log);
        recordCompile(false, msg, data && data.log, data && data.exitCode);
        setCompileStatus('Compile failed', '#A23B3B', 'error');
        if (!quiet) toast('Compilation failed. See the PDF pane for details');
      }
    } finally {
      RPE.pv.compiling = false; RPE.pv.compileAC = null;
      cbs.forEach(([b, l]) => { b.disabled = false; b.classList.remove('is-busy'); if (l) cbtnLabel(b, l, 'Compile'); });
      if (cancelBtn) cancelBtn.hidden = true;
    }
  }

  /* ---------- boot ---------- */
  /* ---------- Command palette (title-bar search, Ctrl+K): indexes every ribbon button (from TABS), File actions and open project files.
     A ribbon hit switches to its tab and clicks the real button, so wire() does the dispatch (dialogs, menus, toggles all behave as usual). ---------- */
  const PAL_KEYS = { Undo: 'Mod+Z', Redo: 'Mod+Y / Mod+Shift+Z', Find: 'Mod+F', Replace: 'Mod+F' };
  const keyName = (k) => (k === 'Mod' ? (MAC ? '⌘' : 'Ctrl') : k === 'Shift' && MAC ? '⇧' : k);
  const keyHtml = (spec) => spec.split(' / ').map((c) => c.split('+').map((k) => `<kbd>${esc(keyName(k))}</kbd>`).join(' + ')).join(' <span class="muted">or</span> ');
  const PAL_FILE = [['New Document', 'file-plus-2', newDocument], ['New from Template', 'layout-template', newFromTemplate], ['Open File…', 'file-code', openFile], ['Open Folder…', 'folder-open', openProjectFolder],
    ['Save', 'save', saveDoc, 'Mod+S'], ['Save As…', 'file-down', saveAs, 'Mod+Shift+S'], ['Compile', 'play', runCompile, 'Mod+Enter'], ['Export PDF', 'file-output', exportPdf], ['Export Project as ZIP', 'folder-open', exportZip], ['Export Single .tex', 'file-code', exportTex], ['Open Output Folder', 'hard-drive', openOutputFolder],
    ['Auto-compile after pause', 'refresh-cw', () => { prefSet('acp', !PREFS.acp); toast('Auto-compile after pause ' + (PREFS.acp ? 'on' : 'off')); }],
    ['Toggle thumbnails sidebar', 'layout-grid', () => toggleThumbs()]];
  let palRows = [], palSel = 0;
  const palFuzz = (q, s) => {   // 0 = no match; whole > prefix > word start > substring > letters in order (fewer gaps = better)
    s = s.toLowerCase(); if (s === q) return 100; if (s.startsWith(q)) return 90;
    const i = s.indexOf(q); if (i >= 0) return (/[\s›/]/.test(s[i - 1]) ? 75 : 55) - Math.min(i, 20) / 4;
    let j = 0, gaps = 0, last = -1;
    for (const c of q) { j = s.indexOf(c, j); if (j < 0) return 0; if (last >= 0) gaps += j - last - 1; last = j++; }
    return Math.max(5, 40 - gaps);
  };
  function palIndex() {
    const out = [], files = (ns) => (ns || []).forEach((n) => (n.t === 'folder' ? files(n.c || []) : out.push({ grp: 'Project files', label: n.n, sub: n.path, icon: 'file-text', node: n })));
    PAL_FILE.forEach(([label, icon, fn, key]) => out.push({ grp: 'File', label, sub: 'File', icon, fn, key }));
    const walk = (tab, gr, it) => {
      if (it.k === 'st' || it.k === 'st3' || it.k === 'rw') it.a.forEach((x) => walk(tab, gr, x));
      else if ('LSI'.includes(it.k)) out.push({ grp: 'Commands', label: it.l, sub: tab + ' › ' + gr.l, icon: it.i || 'command', key: PAL_KEYS[it.l], it, tab });
    };
    Object.keys(TABS).forEach((tab) => TABS[tab].forEach((gr) => gr.items.forEach((it) => walk(tab, gr, it))));
    files((window.RPE.explorer && window.RPE.explorer.PROJECT) || PROJECT);
    return out;
  }
  function palClose() { const r = $('.search-results'); if (r) r.remove(); palRows = []; $('#cmdSearch').value = ''; }
  function palMark() { $$('.search-item').forEach((b, i) => { b.classList.toggle('is-cur', i === palSel); b.setAttribute('aria-selected', i === palSel); if (i === palSel) b.scrollIntoView({ block: 'nearest' }); }); }
  function palRender() {
    const inp = $('#cmdSearch'), ws = inp.value.toLowerCase().split(/\s+/).filter(Boolean); let box = $('.search-results');
    if (!ws.length) { if (box) box.remove(); palRows = []; return; }
    if (!box) {
      box = h('<div class="search-results" role="listbox" aria-label="Commands"></div>'); inp.closest('.search').append(box);
      box.onmousedown = (e) => e.preventDefault();   // keep focus in the input while clicking a result
      box.onclick = (e) => { const b = e.target.closest('.search-item'); if (b) palRun(palRows[+b.dataset.n]); };
    }
    const score = (r) => { let t = 0; for (const w of ws) { const s = Math.max(palFuzz(w, r.label), palFuzz(w, r.sub) / 2); if (!s) return 0; t += s; } return ws.length ? t : 1; };
    const groups = {};
    palIndex().forEach((r) => { r.s = score(r); if (r.s) (groups[r.grp] = groups[r.grp] || []).push(r); });
    const cap = ws.length ? 8 : 6, ordered = Object.keys(groups).map((g) => [g, groups[g].sort((a, b) => b.s - a.s).slice(0, cap)]).sort((a, b) => b[1][0].s - a[1][0].s);
    palRows = []; ordered.forEach(([, rs]) => rs.forEach((r) => { r.n = palRows.push(r) - 1; }));
    box.innerHTML = palRows.length ? ordered.map(([g, rs]) => `<div class="search-group">${esc(g)}</div>` + rs.map((r) => `<button class="search-item" role="option" data-n="${r.n}">${ic(r.icon)}<span class="search-item__label">${esc(r.label)}</span><span class="search-item__path">${esc(r.sub)}</span>${r.key ? keyHtml(r.key) : ''}</button>`).join('')).join('') : '<div class="search-empty">No commands found</div>';
    paint(box); palSel = 0; palMark();
  }
  function palRun(r) {
    if (!r) return; palClose(); $('#cmdSearch').blur();
    if (!$('#backstage').hidden) backstage(false);
    if (r.fn) r.fn();
    else if (r.node) openFileNode(r.node);
    else { showTab(r.tab); const b = $$('#ribbonBody .rbtn').find((x) => x._o === r.it); if (b) b.click(); }
  }
  function palWire() {
    const inp = $('#cmdSearch');
    inp.addEventListener('input', palRender); inp.addEventListener('blur', palClose);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); palClose(); inp.blur(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (palRows.length) { palSel = (palSel + (e.key === 'ArrowDown' ? 1 : palRows.length - 1)) % palRows.length; palMark(); } }
      else if (e.key === 'Enter') { e.preventDefault(); palRun(palRows[palSel]); }
    });
  }
  window.RPE.ctx = {
    get rootDirHandle() { return window.RPE.explorer ? window.RPE.explorer.rootDirHandle : null; },
    ensureWrite,
    existsIn,
    handleByRel,
    get PROJECT() { return window.RPE.explorer ? window.RPE.explorer.PROJECT : []; },
    refreshDir,
    findNode,
    renderExplorer,
    fmtEdit,
    syncFmtBtns,
    ensurePackage,
    listDir,
    get activePath() { return window.RPE.explorer ? window.RPE.explorer.activePath : null; },
    get fileCache() { return window.RPE.explorer ? window.RPE.explorer.fileCache : fileCache; },
    saveActiveFile,
    loadIntoEditor,
    get SRC() { return SRC; },
    set SRC(v) { SRC = v; },
    get LINES() { return LINES; },
    get LINE_START() { return LINE_START; },
    get PREFS() { return PREFS; },
    prefSet,
    saveDoc,
    saveExport,
    docDirty,
    openFileNode,
    TEXT_EXTS,
    extOf,
    relPath,
    toB64,
    ensureWindow,
    lineOf,
    indexSrc,
    histKey,
    historyRecord,
    histClear,
    backstage,
    SAMPLE_ARTICLE_TEX,
    D,
    COLORMAP,
    HD_STYLES,
    HD_NUMS,
    HD_SPACE,
    SECM,
    STYLES,
    get curStyle() { return curStyle; },
    set curStyle(v) { curStyle = v; },
    checkBibErrors,
    renderCode,
    renderOutline,
    historyUIUpdate,
    probUpdateGutter,
    syncSaveState,
    setCurLine,
    goToLine,
    tocGo,
    openViewer,
    openFile,
    runCompile,
    compilePayload,
    drawLines,
    get mainPath() { return window.RPE.explorer ? window.RPE.explorer.mainPath : null; },
    get PROJ_NAME() { return window.RPE.explorer ? window.RPE.explorer.PROJ_NAME : ''; }
  };
  // Desktop window controls. Shown only when a complete bridge exists at window.plumDesktop (the Electron preload);
  // in a normal browser they stay hidden and nothing is wired. The shell reports maximize/restore changes through
  // plumDesktop.onMaximizedChange, which drives RPE.windowControls.setMaximized(true|false).
  /* ---------- Setup wizard (shell + Screen A) ----------
     Opens over the app; art/layout live in css/components.css (.wiz). Setup state is stored through the
     preload bridge (window.plum.setup, main-process settings) when it exists, else in PREFS (localStorage). */
  const WIZ_STEPS = ['Welcome', 'Detect', 'Install', 'Verify', 'Done'];
  const WIZ_TITLES = ['Welcome to Laurevine Plum', 'Detect', 'Install LaTeX', 'Verify', 'Done'];
  const WIZ = { bd: null, el: null, step: 1, busy: false, prev: null, appInert: false, seq: 0, det: null, deferred: false, os: null, fam: null, lvl: 'min', ver: null, verified: false, verifying: false, poll: null, cur: null };   // ver = Verify result view state (kind: run|ok|fail|cancelled); det = last Detect result (kind: loading|found|none|error); seq drops outdated detect responses
  const desktopBridge = () => { const b = window.plumDesktop; return b && ['minimize', 'close', 'setWizardMode'].every((m) => typeof b[m] === 'function') ? b : null; };   // Electron shell only; null in a normal browser
  const wizDesktop = (on) => { const b = desktopBridge(); if (b) { try { Promise.resolve(b.setWizardMode(on)).catch(() => {}); } catch (e) { /* bridge gone */ } } };   // main.js turns the window into the compact, fixed-size wizard window (and back)
  const setupBridge = () => { const s = window.plum && window.plum.setup; return s && typeof s.getSetupState === 'function' && typeof s.saveSetupState === 'function' ? s : null; };
  async function setupIsCompleted() {
    const b = setupBridge();
    if (!b) return PREFS.setupCompleted === true;
    const r = await b.getSetupState();
    return !!(r && r.ok && r.state && r.state.setup && r.state.setup.completed === true);
  }
  async function setupSaveSkipped(latex) {   // latex (optional, e.g. { lastVerifiedOk: false }) is saved in the same call
    const b = setupBridge();
    if (b) { const r = await b.saveSetupState(Object.assign({ setup: { completed: true, deferred: true } }, latex ? { latex } : {})); if (!r || r.ok !== true) throw new Error((r && r.error) || 'Setup state could not be saved.'); return; }
    prefSet('setupCompleted', true); prefSet('setupDeferred', true);
    let ok = false; try { const j = JSON.parse(localStorage.getItem(PREF_KEY)); ok = !!j && j.setupCompleted === true && j.setupDeferred === true; } catch (e) { /* storage unavailable */ }
    if (!ok) throw new Error('Setup state could not be saved (browser storage unavailable).');
  }
  const wizTopmost = () => !!WIZ.bd && !$$('.dlg-backdrop').some((n) => n !== WIZ.bd && (WIZ.bd.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));   // false while another dialog (e.g. draft recovery) sits above
  function wizStatus(msg, isError) { const s = $('.wiz__status', WIZ.el); if (!s) return; s.setAttribute('aria-live', isError ? 'assertive' : 'polite'); s.textContent = msg || ''; s.classList.toggle('is-error', !!isError); }
  function wizBusy(on) {
    WIZ.busy = !!on; if (!WIZ.el) return;
    WIZ.el.setAttribute('aria-busy', String(WIZ.busy));
    $$('.wiz__foot button, .wiz__body button, .wiz__wc [data-wiz-wc="close"]', WIZ.el).forEach((b) => { b.disabled = WIZ.busy; });
    if (WIZ.busy && (!WIZ.el.contains(document.activeElement) || document.activeElement.disabled)) WIZ.el.focus();   // a disabled button must not keep focus
  }
  async function wizRun(fn) {   // the one entry for async work: blocks re-entry (double clicks) until it settles
    if (WIZ.busy || !WIZ.el) return;
    const el = WIZ.el;
    wizBusy(true); wizStatus('');
    try { await fn(); } catch (e) { if (WIZ.el === el) wizStatus((e && e.message) || 'Something went wrong.', true); }
    finally { if (WIZ.el === el) wizBusy(false); }
  }
  async function wizKeepSetup() { const s = await WIZ.cur; return !!(s && s.completed && !s.deferred); }   // a re-run over a finished setup: Skip/Escape only close, they never record "skipped"
  function wizSkip() { return wizRun(async () => { if (!(await wizKeepSetup())) await setupSaveSkipped(wizVerLatex()); closeWizard(); }); }
  // ---- Screen B: Detect LaTeX (window.plum.latex.detect; stored path via window.plum.setup) ----
  const WIZ_ENG = { xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX', pdflatex: 'pdfLaTeX' };
  const wizDefaultEngine = () => (PREFS.compiler === 'lualatex' ? 'lualatex' : 'xelatex');   // Preferences > Default compiler (xelatex when unset); success requires this engine
  const wizProg = (n) => `<code>% !TEX program = ${n}</code>`;
  async function wizDetectCall() {
    const b = window.plum && window.plum.latex;
    if (!b || typeof b.detect !== 'function') throw new Error('LaTeX detection is only available in the Plum desktop app. This window has no detection bridge (window.plum.latex.detect).');
    const r = await b.detect();
    if (!Array.isArray(r)) { const m = r && typeof r === 'object' && (r.error || r.message); throw new Error(typeof m === 'string' && m ? m : 'The detection bridge returned an unexpected response.'); }
    const list = r.filter((x) => x && typeof x === 'object' && WIZ_ENG[x.name]).map((x) => ({ name: x.name, path: x.found === true && typeof x.path === 'string' ? x.path : '', source: typeof x.source === 'string' ? x.source : '', error: typeof x.error === 'string' ? x.error : '' }));
    if (!list.length) throw new Error('The detection bridge returned no compiler entries.');
    const found = list.filter((x) => x.path);
    // found:false with an error means the lookup itself failed, which must never be shown as "not installed"
    if (!found.length && list.some((x) => x.error)) throw new Error(list.filter((x) => x.error).map((x) => WIZ_ENG[x.name] + ': ' + x.error).join('\n'));
    return { list, found };
  }
  async function wizStoredPath() {   // the compiler path saved in settings, or '' (no bridge / nothing saved / unreadable)
    const b = setupBridge(); if (!b) return '';
    try { const r = await b.getSetupState(), l = r && r.ok && r.state && r.state.latex; return l && typeof l.compilerPath === 'string' ? l.compilerPath : ''; } catch (e) { return ''; }
  }
  function wizWarning(def, found) {
    const D = WIZ_ENG[def], alt = found.find((f) => f.name !== 'pdflatex' && f.name !== def);
    if (alt) return `${D}, Plum's default compiler, wasn't found, but ${WIZ_ENG[alt.name]} was. Documents that set ${wizProg(alt.name)} will compile. New documents and documents that name no compiler use ${D}, so they won't compile until you install ${D} or change Default compiler in Preferences to ${WIZ_ENG[alt.name]}. Documents that name ${D} won't compile either.`;
    return `${D}, Plum's default compiler, wasn't found; only pdfLaTeX was. Design fonts, fontspec and Plum's templates need XeLaTeX or LuaLaTeX, so most Plum documents won't compile. pdfLaTeX only compiles documents that set ${wizProg('pdflatex')} and don't use fontspec.`;
  }
  function wizDetView() {
    const el = WIZ.el, d = WIZ.det; if (!el || !d) return;
    const note = (kind, icon, html) => `<p class="wiz__note wiz__note--${kind}">${ic(icon)}<span>${html}</span></p>`;
    const btn = (act, label, icon, primary) => `<button type="button" class="btn${primary ? ' btn--primary' : ''}" data-act="${act}">${icon ? ic(icon) : ''}${label}</button>`;
    let title, body, acts = '';
    if (d.kind === 'loading') {
      title = 'Checking for LaTeX';
      body = `<p class="wiz__load">${ic('refresh-cw')}<span>Looking for XeLaTeX, LuaLaTeX and pdfLaTeX…</span></p><p class="muted">This can take a few seconds.</p>`;
    } else if (d.kind === 'error') {
      title = "Couldn't check for LaTeX";
      body = `<p>Something went wrong while Plum was checking. This doesn't mean LaTeX is missing.</p><pre class="wiz__err" tabindex="0" role="region" aria-label="Error details">${esc(d.msg)}</pre>`;
      acts = btn('again', 'Retry', 'refresh-cw', true);
    } else {
      const stale = d.stored && !(d.kind === 'found' && d.found.some((f) => f.source === 'configured' && f.path === d.stored));
      const storedNote = stale ? note('warn', 'triangle-alert', `The compiler path saved in Plum's settings no longer works:<code class="wiz__path">${esc(d.stored)}</code>Plum isn't using it; the result below comes from a fresh search. Use Check again after fixing or reinstalling it.`) : '';
      if (d.kind === 'found') {
        const def = wizDefaultEngine(), hasDef = d.found.some((f) => f.name === def);
        title = 'LaTeX environment detected';
        const rows = d.list.filter((x) => x.path || x.error).map((x) => `<li class="wiz__comp"><div class="wiz__compname">${WIZ_ENG[x.name]}${x.name === def ? '<span class="wiz__tag">Plum default</span>' : ''}</div>${x.path ? `<code class="wiz__path">${esc(x.path)}</code>` : `<div class="wiz__path is-error">Couldn't be checked: ${esc(x.error)}</div>`}</li>`).join('');
        const miss = d.list.filter((x) => !x.path && !x.error && x.name !== def).map((x) => WIZ_ENG[x.name]);
        body = storedNote + `<ul class="wiz__list">${rows}</ul>`
          + (hasDef ? note('ok', 'circle-check', `${WIZ_ENG[def]}, Plum's default compiler, is available. Verify the installation to confirm it can compile a document.`) + (miss.length ? `<p class="muted">Not found: ${miss.join(', ')}. Documents that select one of these with ${wizProg('…')} won't compile until it is installed.</p>` : '') : note('warn', 'triangle-alert', wizWarning(def, d.found)));
        acts = btn('verify', 'Verify installation', 'arrow-right', true) + btn('again', 'Check again', 'refresh-cw');
      } else {
        title = "LaTeX isn't installed or couldn't be detected";
        body = storedNote + `<p>Plum can open and edit LaTeX projects without a TeX distribution, but compiling documents into PDFs requires a compatible compiler.</p><p class="muted">Plum looked for XeLaTeX, LuaLaTeX and pdfLaTeX on your PATH and in common install folders.</p><p class="muted">Already installed somewhere unusual? Add its <code>bin</code> folder to your PATH and press Check again. A program only sees PATH changes made before it started, so if Check again still finds nothing after you edited PATH (for example in a shell profile), restart Plum.</p>`;
        acts = btn('install', 'Install LaTeX', 'download', true) + btn('again', 'Check again', 'refresh-cw') + btn('defer', 'Continue without configuring LaTeX');
      }
    }
    $('.wiz__title', el).textContent = title;
    $('.wiz__body', el).innerHTML = body + (acts ? `<div class="wiz__actions">${acts}</div>` : '');
    const go = { verify: () => wizToVerify(), install: () => goToStep(3), again: () => wizDetect(), defer: () => wizDefer() };
    $$('.wiz__actions [data-act]', el).forEach((b) => { b.onclick = go[b.dataset.act]; b.disabled = WIZ.busy; });
    $('.wiz__body', el).scrollTop = 0; paint(el);
  }
  async function wizDetect() {
    await wizRun(async () => {
      const seq = ++WIZ.seq, el = WIZ.el;
      WIZ.det = { kind: 'loading' }; wizDetView(); wizStatus('Checking for LaTeX…');
      let det;
      try { const r = await wizDetectCall(); det = { kind: r.found.length ? 'found' : 'none', list: r.list, found: r.found, stored: await wizStoredPath() }; }
      catch (e) { det = { kind: 'error', msg: String((e && e.message) || e || 'Unknown error').slice(0, 2000) }; }
      if (seq !== WIZ.seq || el !== WIZ.el || WIZ.step !== 2) return;   // outdated response: ignore
      WIZ.det = det; wizDetView();
      wizStatus(det.kind === 'error' ? 'LaTeX detection failed.' : det.kind === 'none' ? 'LaTeX was not found.' : det.found.some((f) => f.name === wizDefaultEngine()) ? 'LaTeX detected.' : "LaTeX detected, but Plum's default compiler is missing.", det.kind === 'error');
    });
    if (WIZ.el && WIZ.step === 2 && !WIZ.busy) { const b = $('.wiz__actions .btn--primary', WIZ.el) || $('.wiz__actions button', WIZ.el); if (b) b.focus(); }
  }
  async function wizDefer() {   // "Continue without configuring LaTeX": saves completed + deferred, then the Done step (deferred variant)
    let ok = false, keep = false;
    await wizRun(async () => { if (await wizKeepSetup()) { keep = true; return; } await setupSaveSkipped(wizVerLatex()); ok = true; });
    if (keep) closeWizard(); else if (ok) { WIZ.deferred = true; goToStep(5); }
  }
  // ---- Screen C: Install LaTeX (window.plum.system.getOsInfo + openExternalSafe; shows commands, never runs them) ----
  const WIZ_URL = { miktex: 'https://miktex.org/download', miktexGuide: 'https://miktex.org/howto/install-miktex', texlive: 'https://tug.org/texlive/' };
  const WIZ_FAM = {   // package lists as supplied for this task; Check again verifies the real result
    debian: { name: 'Debian / Ubuntu family', mgr: 'apt', docs: ['https://wiki.debian.org/LaTeX', 'Open Debian LaTeX wiki'], docsNote: 'Ubuntu users can follow the Debian and TeX Live guidance.', disk: 'texlive-full can be 4\u20136+ GB; minimal TeX Live installations are often around 2 GB or less.',
      min: { req: [['texlive-latex-base', 'core LaTeX'], ['texlive-xetex', 'XeLaTeX'], ['texlive-luatex', 'LuaLaTeX']], opt: [], more: [['texlive-fonts-recommended', 'recommended fonts']], cmd: 'sudo apt update && sudo apt install texlive-latex-base texlive-xetex texlive-luatex' },
      full: { req: [['texlive-latex-base', 'core LaTeX'], ['texlive-xetex', 'XeLaTeX'], ['texlive-luatex', 'LuaLaTeX']], opt: [['texlive-latex-extra', 'templates and extra packages'], ['texlive-pictures', 'TikZ / PGF'], ['texlive-science', 'science and math'], ['texlive-bibtex-extra', 'BibLaTeX and bibliography tools']], more: [['texlive-fonts-recommended', 'recommended fonts']], cmd: 'sudo apt update && sudo apt install texlive-latex-base texlive-xetex texlive-luatex texlive-latex-extra texlive-pictures texlive-science texlive-bibtex-extra' } },
    fedora: { name: 'Fedora family', mgr: 'dnf', docs: ['https://docs.fedoraproject.org/en-US/neurofedora/latex/', 'Open Fedora LaTeX docs'], docsNote: 'Fedora offers the TeX Live schemes basic, medium and full.', disk: 'texlive-scheme-full can be several GB.',
      min: { req: [['texlive-scheme-basic', 'base TeX Live scheme'], ['texlive-collection-xetex', 'XeLaTeX'], ['texlive-collection-luatex', 'LuaLaTeX']], opt: [], more: [], alt: 'Alternative: texlive-scheme-small already includes XeTeX.', cmd: 'sudo dnf install texlive-scheme-basic texlive-collection-xetex texlive-collection-luatex' },
      full: { req: [['texlive-scheme-medium', 'larger base scheme, used instead of texlive-scheme-basic']], opt: [['texlive-collection-latexextra', 'templates and extra packages'], ['texlive-collection-pictures', 'TikZ / PGF'], ['texlive-collection-science', 'science and math'], ['texlive-collection-bibtexextra', 'BibLaTeX and bibliography tools']], more: [], alt: 'For everything, install texlive-scheme-full instead (several GB).', cmd: 'sudo dnf install texlive-scheme-medium texlive-collection-latexextra texlive-collection-pictures texlive-collection-science texlive-collection-bibtexextra' } },
    arch: { name: 'Arch family', mgr: 'pacman', docs: ['https://wiki.archlinux.org/title/TeX_Live', 'Open Arch TeX Live wiki'], docsNote: '', disk: 'texlive-meta can be several GB.',
      min: { req: [['texlive-basic', 'core'], ['texlive-latex', 'essential LaTeX'], ['texlive-xetex', 'XeLaTeX'], ['texlive-luatex', 'LuaLaTeX']], opt: [], more: [['texlive-latexrecommended', 'recommended LaTeX packages']], cmd: 'sudo pacman -S texlive-basic texlive-latex texlive-xetex texlive-luatex' },
      full: { req: [['texlive-meta', 'one package covering most of TeX Live (replaces the deprecated texlive-most group)']], opt: [], more: [], alt: 'Instead of texlive-meta you can add individual packages to the minimal command: texlive-latexextra, texlive-pictures, texlive-science, texlive-bibtexextra, texlive-fontsextra.', cmd: 'sudo pacman -S texlive-meta' } }
  };
  function wizFamOf(info) {   // /etc/os-release ID first, then ID_LIKE in order; '' when no family matches
    for (const t of [info.id].concat(info.idLike || [])) {
      if (t === 'debian' || t === 'ubuntu') return 'debian';
      if (t === 'fedora') return 'fedora';
      if (t === 'arch' || t === 'archlinux') return 'arch';
    }
    return '';
  }
  async function wizOsCall() {
    const s = window.plum && window.plum.system;
    if (!s || typeof s.getOsInfo !== 'function') throw new Error('Install instructions need the Plum desktop app to identify your operating system. This window has no system bridge (window.plum.system.getOsInfo).');
    const r = await s.getOsInfo();
    if (!r || typeof r !== 'object' || typeof r.platform !== 'string' || r.platform === 'unknown') throw new Error(r && typeof r.error === 'string' && r.error ? r.error : 'The system bridge returned an unexpected response.');
    const str = (v) => (typeof v === 'string' ? v : '');
    return { platform: r.platform, id: str(r.id).toLowerCase(), idLike: Array.isArray(r.idLike) ? r.idLike.filter((x) => typeof x === 'string').map((x) => x.toLowerCase()) : [], name: str(r.prettyName) || str(r.id), error: str(r.error) };
  }
  const wizLinks = (arr) => `<div class="wiz__links"><div class="wiz__actions">${arr.map((a) => `<button type="button" class="btn${a[2] ? ' btn--primary' : ''}" data-url="${esc(a[0])}">${ic('link')}${esc(a[1])}</button>`).join('')}</div><p class="wiz__linkmsg" hidden></p></div>`;
  async function wizOpen(btn) {   // openExternalSafe; on any failure the address is shown as selectable text
    const url = btn.dataset.url, msg = $('.wiz__linkmsg', btn.closest('.wiz__links'));
    await wizRun(async () => {
      const s = window.plum && window.plum.system; let r;
      try { r = s && typeof s.openExternalSafe === 'function' ? await s.openExternalSafe(url) : { ok: false, error: 'Opening links is only available in the Plum desktop app.' }; } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
      if (r && r.ok === true) { msg.hidden = true; msg.textContent = ''; wizStatus('Opened the link in your browser.'); return; }
      msg.innerHTML = `Couldn't open the link: ${esc(r && typeof r.error === 'string' && r.error ? r.error : 'Unknown error.')} Copy this address into your browser:<code class="wiz__url">${esc(url)}</code>`;
      msg.hidden = false; wizStatus("Couldn't open the link. The address is shown below.", true);
    });
    if (btn.isConnected && !btn.disabled) btn.focus();
  }
  async function wizCopy(btn, text) {   // navigator.clipboard, else a hidden textarea + execCommand; feedback on the button and in the aria-live status
    let ok = false;
    try { if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok && WIZ.el) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.readOnly = true; ta.setAttribute('aria-hidden', 'true'); ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      WIZ.el.append(ta); ta.focus(); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); btn.focus();
    }
    if (!WIZ.el) return;
    wizStatus('');   // clear first so a repeated copy is announced again
    setTimeout(() => wizStatus(ok ? 'Command copied to the clipboard.' : "Couldn't copy automatically. Select the command text and copy it manually.", !ok), 50);
    if (!ok) return;
    btn.innerHTML = ic('check') + 'Copied'; paint(btn); clearTimeout(btn._t);
    btn._t = setTimeout(() => { if (btn.isConnected) { btn.innerHTML = ic('copy') + 'Copy command'; paint(btn); } }, 2000);
  }
  function wizInstOpt() {   // the family/level-dependent part of the Linux screen
    const box = WIZ.el && $('#wizOpt', WIZ.el); if (!box) return;
    const fam = WIZ.fam !== null ? WIZ.fam : wizFamOf(WIZ.os), f = WIZ_FAM[fam];
    if (!f) {
      box.innerHTML = `<p class="muted">Choose a family above to see its commands. Otherwise the TeX Live documentation explains how to install it on any Linux distribution.</p>` + wizLinks([[WIZ_URL.texlive, 'Open TeX Live docs', true]]);
    } else {
      const l = f[WIZ.lvl === 'full' ? 'full' : 'min'];
      const pk = (a) => `<ul class="wiz__pkgs">${a.map((x) => `<li><code>${esc(x[0])}</code> <span class="muted">${esc(x[1])}</span></li>`).join('')}</ul>`;
      box.innerHTML = `<p class="muted">Disk space: TeX Live installations range from hundreds of MB to several GB, and a full installation often exceeds 4\u20136 GB. ${esc(f.disk)}</p>`
        + `<h3 class="wiz__h">Required: compiler packages</h3>${pk(l.req)}`
        + (l.opt.length ? `<h3 class="wiz__h">Optional extras (included in the command)</h3>${pk(l.opt)}` : '')
        + (l.more.length ? `<h3 class="wiz__h">Optional extras (not in the command)</h3>${pk(l.more)}` : '')
        + (l.alt ? `<p class="muted">${esc(l.alt)}</p>` : '')
        + `<h3 class="wiz__h">Command <span class="muted">(package names may differ by release)</span></h3><pre class="wiz__cmd" tabindex="0" role="region" aria-label="Install command"><code>${esc(l.cmd)}</code></pre>`
        + `<div class="wiz__actions"><button type="button" class="btn" data-copy>${ic('copy')}Copy command</button></div><p class="muted">Run this in your terminal; Plum never installs software for you.</p>`
        + wizLinks([[f.docs[0], f.docs[1]]]) + (f.docsNote ? `<p class="muted">${esc(f.docsNote)}</p>` : '');
      $('[data-copy]', box).onclick = (e) => wizCopy(e.currentTarget, l.cmd);
    }
    $$('[data-url]', box).forEach((b) => { b.onclick = () => wizOpen(b); });
    paint(box);
  }
  function wizInstView() {
    const el = WIZ.el, o = WIZ.os; if (!el || !o) return;
    const body = $('.wiz__body', el); let html = '';
    if (o.kind === 'loading') html = `<p class="wiz__load">${ic('refresh-cw')}<span>Checking your operating system\u2026</span></p>`;
    else if (o.kind === 'error') html = `<p>Plum couldn't identify your operating system, so it can't show install steps. This doesn't mean LaTeX is missing.</p><pre class="wiz__err" tabindex="0" role="region" aria-label="Error details">${esc(o.msg)}</pre>`;
    else if (o.platform === 'win32') {
      html = `<p>Plum compiles documents with a TeX distribution. On Windows we recommend <b>MiKTeX</b>.</p>`
        + `<ol class="wiz__ol"><li>Open the official MiKTeX download page and download the <b>Basic MiKTeX Installer</b>.</li><li>Run the installer.</li>`
        + `<li>Accept the defaults: choose a private (per-user) installation and keep the default install directory.</li>`
        + `<li>If the installer offers automatic installation of missing packages, enable it. Otherwise, in MiKTeX's Settings, set &ldquo;Install missing packages on-the-fly&rdquo; to &ldquo;Always&rdquo; or &ldquo;Yes&rdquo;.</li>`
        + `<li>Finish the installation.</li><li>Return to Plum and press &ldquo;Check again&rdquo;.</li></ol>`
        + `<p class="muted">Option names and wording may vary by MiKTeX version.</p>`
        + wizLinks([[WIZ_URL.miktex, 'Open miktex.org', true], [WIZ_URL.miktexGuide, 'Open MiKTeX install guide']])
        + `<details class="wiz__more"><summary>Prefer TeX Live instead?</summary><p>TeX Live is an alternative TeX distribution. You need only one distribution, so install either MiKTeX or TeX Live, not both.</p>${wizLinks([[WIZ_URL.texlive, 'Open TeX Live site']])}</details>`;
    } else if (o.platform === 'linux') {
      const det = wizFamOf(o), fam = WIZ.fam !== null ? WIZ.fam : det, d = WIZ_FAM[det];
      const intro = d ? `Detected <b>${esc(o.name)}</b>. Recommended: install TeX Live from your distribution's repositories with <code>${d.mgr}</code>. Choose another family below if that isn't right.`
        : o.name ? `Detected <b>${esc(o.name)}</b>, but Plum has no package lists for it. If it is based on one of the families below, choose that one; otherwise see the TeX Live documentation.`
        : `Plum couldn't identify your Linux distribution${o.error ? ' (' + esc(o.error) + ')' : ''}. Choose a family below, or see the TeX Live documentation.`;
      html = `<p>${intro}</p><div class="wiz__field"><label for="wizFam">Distribution family</label><select id="wizFam" class="select">${fam === '' || !WIZ_FAM[fam] ? '<option value="" selected>Choose a family\u2026</option>' : ''}${Object.keys(WIZ_FAM).map((k) => `<option value="${k}"${k === fam ? ' selected' : ''}>${esc(WIZ_FAM[k].name)}</option>`).join('')}</select></div>`
        + `<fieldset class="wiz__radios"${WIZ_FAM[fam] ? '' : ' hidden'}><legend>What to install</legend><label><input type="radio" name="wizLvl" value="min"${WIZ.lvl === 'full' ? '' : ' checked'}><span>Minimal (compile with XeLaTeX/LuaLaTeX)</span></label><label><input type="radio" name="wizLvl" value="full"${WIZ.lvl === 'full' ? ' checked' : ''}><span>Fuller (templates, TikZ/PGFPlots, bibliography)</span></label></fieldset><div id="wizOpt"></div>`;
    } else {
      html = `<p>Install steps for <b>${o.platform === 'darwin' ? 'macOS' : esc(o.platform)}</b> aren't included in Plum's setup yet. Plum works with any TeX distribution that provides XeLaTeX or LuaLaTeX; the TeX Live site lists options.</p>` + wizLinks([[WIZ_URL.texlive, 'Open TeX Live site', true]]);
    }
    body.innerHTML = html; body.scrollTop = 0;
    $$('[data-url]', body).forEach((b) => { b.onclick = () => wizOpen(b); });
    if (o.kind === 'ok' && o.platform === 'linux') {
      $('#wizFam', body).onchange = (e) => { WIZ.fam = e.target.value; $('.wiz__radios', body).hidden = !WIZ_FAM[WIZ.fam]; wizInstOpt(); if (WIZ_FAM[WIZ.fam]) wizStatus('Showing ' + WIZ_FAM[WIZ.fam].name + ' commands.'); };
      $$('input[name="wizLvl"]', body).forEach((r) => { r.onchange = () => { WIZ.lvl = r.value; wizInstOpt(); wizStatus('Showing the ' + (WIZ.lvl === 'full' ? 'fuller' : 'minimal') + ' command.'); }; });
      wizInstOpt();
    }
    paint(body);
  }
  async function wizInstall() {
    await wizRun(async () => {
      const seq = ++WIZ.seq, el = WIZ.el;
      WIZ.os = { kind: 'loading' }; wizInstView(); wizStatus('Checking your operating system\u2026');
      let os;
      try { os = Object.assign({ kind: 'ok' }, await wizOsCall()); } catch (e) { os = { kind: 'error', msg: String((e && e.message) || e || 'Unknown error').slice(0, 2000) }; }
      if (seq !== WIZ.seq || el !== WIZ.el || WIZ.step !== 3) return;   // outdated response: ignore
      WIZ.os = os; wizInstView();
      wizStatus(os.kind === 'error' ? "Couldn't identify your operating system." : os.platform === 'win32' ? 'Install steps for Windows.' : os.platform === 'linux' ? 'Install steps for Linux.' : "Install steps for this system aren't available yet.", os.kind === 'error');
    });
  }
  // ---- Screen D: Verify (window.plum.latex.verifyCompiler / cancelVerify / verifyStage / setDefaultCompiler; flags saved through window.plum.setup) ----
  const WIZ_STAGES = ['Locating compiler', 'Running version check', 'Compiling a test document', 'Checking the PDF'];
  const WIZ_STAGE_IDX = { resolve: 0, version: 1, compile: 2, pdf: 3 };   // verifyStage() values -> row
  const WIZ_STAT = { wait: 'Waiting', run: 'Running\u2026', done: 'Passed', fail: 'Failed', stop: 'Cancelled', skip: 'Not run' };
  const WIZ_MIKTEX = ' If you use MiKTeX, the first compile can download missing packages. Let that finish (MiKTeX Console shows progress), then retry.';
  const wizLatexBridge = () => { const b = window.plum && window.plum.latex; return b && typeof b.verifyCompiler === 'function' && typeof b.cancelVerify === 'function' && typeof b.setDefaultCompiler === 'function' ? b : null; };
  const wizVerLatex = () => (WIZ.ver && WIZ.ver.kind === 'fail' && WIZ.ver.r.reason !== 'save' ? { lastVerifiedOk: false } : null);   // a real failed check clears lastVerifiedOk when setup is deferred
  const wizVerifyTarget = () => { const def = wizDefaultEngine(), f = WIZ.det && WIZ.det.kind === 'found' && WIZ.det.found.find((x) => x.name === def && x.path); return f ? f.path : def; };   // success requires the default engine (see wizDefaultEngine)
  function wizNormVer(r) {   // any bridge reply -> the verifyCompiler result shape
    if (!r || typeof r !== 'object') return { ok: false, stage: 'start', reason: 'internal', message: 'The verification bridge returned an unexpected response.', shortLog: '', compilerPath: null };
    const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    return { ok: r.ok === true, stage: s(r.stage, 20), reason: s(r.reason, 20) || (r.ok === true ? 'ok' : 'internal'), message: s(r.message || r.error, 600), shortLog: s(r.shortLog, 4000), compilerPath: typeof r.compilerPath === 'string' && r.compilerPath ? r.compilerPath : null };
  }
  const wizFailAt = (r) => (r.reason === 'save' || r.stage === 'done' ? WIZ_STAGES.length : r.reason === 'no-pdf' ? 3 : WIZ_STAGE_IDX[r.stage] || 0);   // row that failed; WIZ_STAGES.length = every check passed but saving failed
  function wizExplain(r, at) {
    if (at >= WIZ_STAGES.length) return "The test passed, but Plum couldn't save the result, so your setup has not been marked as configured.";
    switch (r.reason) {
      case 'missing': return at === 0 ? "Plum couldn't find this compiler. It may have been moved or uninstalled, or it isn't on your PATH. Go back and check again, or install LaTeX." : 'The compiler could not be started. It may have been moved or uninstalled while Plum was testing it.';
      case 'permission': return "The compiler is there, but your system didn't let Plum run it. Check the file's permissions or your security software, then retry.";
      case 'timeout': return at === 1 ? "The compiler didn't answer its version check in time and was stopped." : 'The test compile took too long and was stopped.' + WIZ_MIKTEX;
      case 'exit': return at === 1 ? "The compiler started but couldn't report its version, so the installation may be broken or incomplete." : 'The compiler started but stopped with an error while compiling the test document. The log below usually shows the cause, such as a missing package.';
      case 'no-pdf': return 'The compiler finished without reporting an error, but it did not produce a PDF.';
      case 'output': return "The program ran, but what it printed doesn't look like a TeX engine, so Plum didn't trust it.";
      default: return r.message || 'Verification failed for an unknown reason.';
    }
  }
  function wizStageHtml(v) {
    const st = (i) => (v.kind === 'run' ? (i < v.idx ? 'done' : i === v.idx ? 'run' : 'wait') : v.kind === 'ok' ? 'done' : i < v.at ? 'done' : i === v.at ? (v.kind === 'cancelled' ? 'stop' : 'fail') : 'skip');
    return `<ol class="wiz__stages" aria-label="Verification steps">${WIZ_STAGES.map((s, i) => { const k = st(i); return `<li class="wiz__stage is-${k}"><span class="wiz__sticon" aria-hidden="true">${ic(k === 'run' ? 'refresh-cw' : k === 'done' ? 'check' : k === 'fail' || k === 'stop' ? 'x' : 'minus')}</span><span>${s}</span><span class="wiz__stat">${WIZ_STAT[k]}</span></li>`; }).join('')}</ol>`;
  }
  function wizStagesLive() { const box = WIZ.el && $('.wiz__stagebox', WIZ.el); if (box && WIZ.ver && WIZ.ver.kind === 'run') { box.innerHTML = wizStageHtml(WIZ.ver); paint(box); } }
  function wizPollStop() { if (WIZ.poll) { clearInterval(WIZ.poll); WIZ.poll = null; } }
  function wizPoll(b, seq) {   // real progress: asks the main process which stage is running
    wizPollStop(); if (typeof b.verifyStage !== 'function') return;
    let pending = false;
    WIZ.poll = setInterval(async () => {
      if (pending || seq !== WIZ.seq || !WIZ.ver || WIZ.ver.kind !== 'run') return;
      pending = true;
      try {
        const r = await b.verifyStage(), i = r && r.ok === true ? WIZ_STAGE_IDX[r.stage] : undefined;
        if (Number.isInteger(i) && i > WIZ.ver.idx && seq === WIZ.seq && WIZ.ver.kind === 'run') { WIZ.ver.idx = i; wizStagesLive(); wizStatus(WIZ_STAGES[i] + '\u2026'); }
      } catch (e) { /* progress is optional; the final result still arrives */ }
      pending = false;
    }, 250);
  }
  function wizVerView() {
    const el = WIZ.el, v = WIZ.ver; if (!el || !v) return;
    const note = (kind, icon, html) => `<p class="wiz__note wiz__note--${kind}">${ic(icon)}<span>${html}</span></p>`;
    const btn = (act, label, icon, primary) => `<button type="button" class="btn${primary ? ' btn--primary' : ''}" data-act="${act}">${icon ? ic(icon) : ''}${label}</button>`;
    const pathLine = (p) => (p ? `<code class="wiz__path">${esc(p)}</code>` : '');
    let title, body, acts;
    if (v.kind === 'run') {
      title = 'Verifying your LaTeX installation';
      body = `<p>Plum is compiling a small test document to make sure the compiler works.</p>${pathLine(v.target)}<div class="wiz__stagebox">${wizStageHtml(v)}</div>`;
      acts = btn('cancel', 'Cancel');
    } else if (v.kind === 'ok') {
      title = 'Your LaTeX environment is ready.';
      body = `${wizStageHtml(v)}<ul class="wiz__list"><li class="wiz__comp"><div class="wiz__compname">${esc(WIZ_ENG[v.name] || v.name || 'LaTeX compiler')}<span class="wiz__tag">Verified</span></div>${pathLine(v.path)}${v.info ? `<div class="muted">${esc(v.info)}</div>` : ''}</li></ul>`;
      acts = btn('next', 'Continue', 'arrow-right', true);
    } else if (v.kind === 'cancelled') {
      title = 'Verification cancelled';
      body = `<p>You cancelled the check. Nothing was saved.</p>${wizStageHtml(v)}`;
      acts = btn('retry', 'Retry', 'refresh-cw', true) + btn('defer', 'Continue without verifying');
    } else {
      const r = v.r, at = v.at, log = [r.message, r.shortLog].filter(Boolean).join('\n');
      title = 'Verification failed';
      body = note('err', 'triangle-alert', at === 0 && r.reason === 'missing' ? "We couldn't find the LaTeX executable." : at === 0 ? "We couldn't start the compilation test." : 'We found a LaTeX executable, but the compilation test failed.')
        + `<p><strong>Failed at:</strong> ${at < WIZ_STAGES.length ? WIZ_STAGES[at] : 'Saving your setup'}</p><p>${esc(wizExplain(r, at))}</p>${pathLine(r.compilerPath || v.target)}${wizStageHtml(v)}`
        + (log ? `<details class="wiz__more"><summary>Show log</summary><pre class="wiz__err" tabindex="0" role="region" aria-label="Verification log">${esc(log)}</pre></details>` : '');
      acts = btn('retry', 'Retry', 'refresh-cw', true) + btn('defer', 'Continue without verifying');
    }
    $('.wiz__title', el).textContent = title;
    $('.wiz__body', el).innerHTML = body + `<div class="wiz__actions">${acts}</div>`;
    const go = { cancel: (e) => wizCancel(e.currentTarget), retry: () => wizVerify(), next: () => { WIZ.verified = true; goToStep(5); }, defer: () => wizDefer() };
    $$('.wiz__actions [data-act]', el).forEach((b) => { b.onclick = go[b.dataset.act]; if (b.dataset.act !== 'cancel') b.disabled = WIZ.busy; });   // Cancel stays live while busy
    $('.wiz__skip', el).hidden = $('.wiz__back', el).hidden = v.kind === 'ok';   // once verified and saved, only Continue remains (no skip/back that would contradict the saved state)
    $('.wiz__body', el).scrollTop = 0; paint(el);
  }
  async function wizCancel(btn) {
    if (btn.getAttribute('aria-disabled') === 'true') return;
    btn.setAttribute('aria-disabled', 'true'); wizStatus('Cancelling\u2026');
    let r = null; try { r = await window.plum.latex.cancelVerify(); } catch (e) { /* the verify call still settles */ }
    if ((!r || r.ok !== true) && btn.isConnected) { btn.removeAttribute('aria-disabled'); wizStatus('Verifying your LaTeX installation\u2026'); }   // nothing was cancelled; the check is still running
  }
  async function wizPersistVerified(r) {   // setDefaultCompiler, then setup.completed=true, setup.deferred=false, latex.lastVerifiedOk=true
    const s = setupBridge(), fail = (message) => wizNormVer({ ok: false, stage: 'done', reason: 'save', message, compilerPath: r.compilerPath });
    if (!s || !r.compilerPath) return fail(!s ? 'Setup state can only be saved in the Plum desktop app.' : 'The verified compiler path was not reported.');
    let d, sv;
    try { d = await window.plum.latex.setDefaultCompiler(r.compilerPath); } catch (e) { return fail(String((e && e.message) || e || 'The default compiler could not be saved.')); }
    if (!d || d.ok !== true) return d && typeof d === 'object' ? wizNormVer(d) : fail('The default compiler could not be saved.');
    try { sv = await s.saveSetupState({ setup: { completed: true, deferred: false }, latex: { lastVerifiedOk: true } }); } catch (e) { return fail(String((e && e.message) || e || 'The setup state could not be saved.')); }
    if (!sv || sv.ok !== true) return fail((sv && sv.error) || 'The setup state could not be saved.');
    return { ok: true, name: typeof d.compilerName === 'string' ? d.compilerName : '', path: typeof d.compilerPath === 'string' ? d.compilerPath : r.compilerPath, message: r.message };
  }
  async function wizVerify() {
    await wizRun(async () => {
      const seq = ++WIZ.seq, el = WIZ.el, b = wizLatexBridge(), target = wizVerifyTarget();
      WIZ.ver = { kind: 'run', idx: b && typeof b.verifyStage === 'function' ? 0 : -1, target };   // -1: no progress API, so no row is shown as running
      wizVerView(); wizStatus('Verifying your LaTeX installation\u2026');
      if (!el.contains(document.activeElement) || document.activeElement === el) { const c = $('.wiz__actions [data-act="cancel"]', el); if (c) c.focus(); }
      let r;
      if (!b) r = wizNormVer({ ok: false, stage: 'start', reason: 'internal', message: 'Verification is only available in the Plum desktop app. This window has no verification bridge (window.plum.latex.verifyCompiler).' });
      else {
        WIZ.verifying = true; wizPoll(b, seq);
        try { r = wizNormVer(await b.verifyCompiler(target)); } catch (e) { r = wizNormVer({ ok: false, stage: 'start', reason: 'internal', message: String((e && e.message) || e || 'Verification failed.') }); }
        finally { WIZ.verifying = false; wizPollStop(); }
        if (r.ok) r = await wizPersistVerified(r);
      }
      if (seq !== WIZ.seq || el !== WIZ.el || WIZ.step !== 4) return;   // outdated: ignore
      WIZ.ver = r.ok ? { kind: 'ok', name: r.name, path: r.path, info: r.message } : { kind: r.reason === 'cancelled' ? 'cancelled' : 'fail', r, at: wizFailAt(r), target };
      wizVerView();
      wizStatus(r.ok ? 'LaTeX verified. Your setup was saved.' : r.reason === 'cancelled' ? 'Verification cancelled.' : 'Verification failed.', !r.ok && r.reason !== 'cancelled');
    });
    if (WIZ.el && WIZ.step === 4 && !WIZ.busy) { const b = $('.wiz__actions .btn--primary', WIZ.el) || $('.wiz__actions button', WIZ.el); if (b) b.focus(); }
  }
  // ---- Screen E: Done (verified or deferred; reached only through a verified Verify step or a saved "continue without ..." choice) ----
  const wizDoneHtml = (ok) => `<p>${ok ? 'Your LaTeX environment has been configured successfully.' : "Your LaTeX environment has not been configured yet. You can set it up later when you're ready to compile documents."}</p><div class="wiz__actions"><button type="button" class="btn btn--primary" data-act="start">Start using Plum</button></div>`;
  function wizRender() {
    const n = WIZ.step, el = WIZ.el;
    const okDone = n === 5 && WIZ.verified && !WIZ.deferred;
    $('.wiz__title', el).textContent = n === 5 ? (okDone ? "You're ready to write!" : 'Plum is ready to use.') : WIZ_TITLES[n - 1];
    $$('.wiz__steps li', el).forEach((li, i) => { li.classList.toggle('is-done', i + 1 < n); if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); $('.wiz__num', li).innerHTML = i + 1 < n ? ic('check') : String(i + 1); });
    $('.wiz__body', el).innerHTML = n === 1
      ? `<p>Let's make sure your LaTeX environment is ready. Plum lets you write and manage LaTeX projects, while a TeX distribution compiles your documents into PDFs.</p><p class="muted">If you already have a TeX distribution installed, you may already be ready.</p><div class="wiz__cur" aria-live="polite"></div>`
      : n >= 2 && n <= 4 ? ''
      : wizDoneHtml(okDone);
    $('.wiz__body', el).scrollTop = 0;
    $('.wiz__back', el).hidden = n === 1 || okDone; $('.wiz__skip', el).hidden = n === 5; $('.wiz__go', el).hidden = n !== 1; $('.wiz__again', el).hidden = n !== 3;
    const start = $('.wiz__actions [data-act="start"]', el); if (start) start.onclick = () => closeWizard();
    paint(el);
    if (n === 1) lxWelcomeFill();
    if (n === 2) wizDetect();   // loading view renders synchronously, then the real detect call runs
    else if (n === 3) wizInstall();
    else if (n === 4) wizVerify();
  }
  function goToStep(n) {
    n = Number(n);
    if (!WIZ.el || WIZ.busy || !Number.isInteger(n) || n < 1 || n > WIZ_STEPS.length) return;
    if (n === 5 && !WIZ.deferred && !WIZ.verified) return;   // Done only after a verified or deferred setup
    if (n !== 5) { WIZ.deferred = false; WIZ.verified = false; }
    WIZ.step = n; wizStatus('Step ' + n + ' of ' + WIZ_STEPS.length + ': ' + WIZ_STEPS[n - 1]); wizRender();
    $('.wiz__title', WIZ.el).focus();
  }
  function wizKey(e) {
    if (!WIZ.el || !wizTopmost()) return;
    if (e.key === 'Escape') {   // Escape = skip/defer, never while busy; on Done it just closes, and a verified Verify screen ignores it (state is already saved)
      e.preventDefault(); e.stopPropagation();
      if (WIZ.busy) return;
      if (WIZ.step === 5) closeWizard(); else if (!(WIZ.step === 4 && WIZ.ver && WIZ.ver.kind === 'ok')) wizSkip();
      return;
    }
    if (e.key === 'Tab') {
      const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', WIZ.el).filter((x) => !x.disabled && !x.hidden && x.getClientRects().length);
      if (!f.length) { e.preventDefault(); WIZ.el.focus(); return; }
      const a = f[0], z = f[f.length - 1], cur = document.activeElement;
      if (!WIZ.el.contains(cur) || (cur === WIZ.el)) { e.preventDefault(); (e.shiftKey ? z : a).focus(); }
      else if (e.shiftKey && cur === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && cur === z) { e.preventDefault(); a.focus(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) e.stopPropagation();   // keep app shortcuts (save, palette...) from firing behind the dialog
  }
  function wizCloseButton() {   // the wizard bar's Close does what Escape does (skip / defer setup), except that a Done or already-saved verified screen just closes
    if (!WIZ.el || WIZ.busy) return;
    if (WIZ.step === 5 || (WIZ.step === 4 && WIZ.ver && WIZ.ver.kind === 'ok')) closeWizard(); else wizSkip();
  }
  function openWizard(startStep) {
    if (WIZ.el) return;
    const n = Number.isInteger(startStep) && startStep >= 1 && startStep <= 4 ? startStep : 1;   // Done (5) is only reachable through goToStep
    closePop(); closeCustomMenu(); WIZ.prev = document.activeElement;
    const desk = !!desktopBridge();   // in the desktop shell the wizard is its own compact window with its own top bar (minimize + close only)
    const bd = h(`<div class="dlg-backdrop${desk ? ' wiz-win' : ''}"><div class="dlg wiz" role="dialog" aria-modal="true" aria-labelledby="wizTitle" tabindex="-1">${desk ? '<div class="wiz__drag" aria-hidden="true"></div>' : ''}<div class="wiz__panel">
      <div class="wiz__head"><h2 class="wiz__title" id="wizTitle" tabindex="-1"></h2><ol class="wiz__steps" aria-label="Setup progress">${WIZ_STEPS.map((s) => `<li><span class="wiz__num" aria-hidden="true"></span><span>${s}</span></li>`).join('')}</ol></div>
      <div class="wiz__body" tabindex="0" role="region" aria-labelledby="wizTitle"></div>
      <div class="wiz__status" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="wiz__foot"><button type="button" class="btn wiz__back">${ic('arrow-left')}Back</button><button type="button" class="btn wiz__skip">Skip setup</button><button type="button" class="btn btn--primary wiz__go">Get started${ic('arrow-right')}</button><button type="button" class="btn btn--primary wiz__again">${ic('refresh-cw')}Check again</button></div>
      ${desk ? `<div class="wiz__wc" role="group" aria-label="Window controls"><button type="button" class="tbtn wc__btn" data-wiz-wc="minimize" aria-label="Minimize" title="Minimize">${ic('minus')}</button><button type="button" class="tbtn wc__btn wc__btn--close" data-wiz-wc="close" aria-label="Close" title="Close">${ic('x')}</button></div>` : ''}
    </div></div></div>`);
    WIZ.bd = bd; WIZ.el = $('.wiz', bd); WIZ.busy = false; WIZ.step = n; WIZ.det = null; WIZ.deferred = false; WIZ.os = null; WIZ.fam = null; WIZ.lvl = 'min'; WIZ.ver = null; WIZ.verified = false; WIZ.verifying = false; WIZ.cur = lxStatusGet().catch(() => null);
    $('.wiz__back', bd).onclick = () => goToStep(WIZ.step >= 4 ? 2 : WIZ.step - 1);   // Verify and the deferred Done return to Detect
    $('.wiz__go', bd).onclick = () => goToStep(2);
    $('.wiz__again', bd).onclick = () => goToStep(2);   // Install > Check again: back to Detect, which re-runs detection
    $('.wiz__skip', bd).onclick = () => wizSkip();
    if (desk) {
      const br = desktopBridge();
      $('[data-wiz-wc="minimize"]', bd).onclick = () => { try { br.minimize(); } catch (e) { /* bridge gone */ } };
      $('[data-wiz-wc="close"]', bd).onclick = () => wizCloseButton();
      wizDesktop(true);
    }
    const app = $('.app'); if (app && !app.inert) { app.inert = true; WIZ.appInert = true; }
    document.addEventListener('keydown', wizKey, true);
    document.body.append(bd); wizRender();
    requestAnimationFrame(() => { bd.classList.add('is-open'); const g = $('.wiz__go', WIZ.el); (g && !g.hidden ? g : $('.wiz__title', WIZ.el)).focus(); });
  }
  function closeWizard() {
    if (!WIZ.el) return;
    document.removeEventListener('keydown', wizKey, true);
    wizPollStop(); WIZ.seq++;
    if (WIZ.verifying) { WIZ.verifying = false; try { Promise.resolve(window.plum.latex.cancelVerify()).catch(() => {}); } catch (e) { /* bridge gone */ } }   // never leave a check running behind a closed wizard
    WIZ.bd.remove(); const app = $('.app'); if (app && WIZ.appInert) app.inert = false;
    const prev = WIZ.prev; WIZ.bd = WIZ.el = WIZ.prev = null; WIZ.busy = false; WIZ.appInert = false; WIZ.ver = null;
    wizDesktop(false);   // back to the normal, resizable main window
    if (prev && prev !== document.body && prev.isConnected && prev.focus) prev.focus();
    else { const ed = $('#codeInput'); if (ed) ed.focus(); }   // nothing sensible to return to (e.g. auto-opened at startup): the editor
    lxStatusPaint(); setupCheckStored();   // Settings status and the launch-check flag follow whatever the wizard saved
  }
  // ---- Startup and re-entry (Settings > LaTeX Setup, Help > LaTeX Setup, compile without a compiler) ----
  const SETUP = { storedBad: '', nagAt: 0 };   // storedBad: saved compiler path that failed the cheap launch check; nagAt: time of the last "no compiler" toast
  const LX_NO_COMPILER = 'No LaTeX compiler is configured. You can continue editing your document or set up a TeX distribution now.';
  async function setupReadState() {   // { completed, deferred, latex } from the bridge (latex: null without one), else PREFS; throws when the bridge cannot read it
    const b = setupBridge();
    if (!b) return { completed: PREFS.setupCompleted === true, deferred: PREFS.setupDeferred === true, latex: null };
    const r = await b.getSetupState();
    if (!r || !r.ok || !r.state || !r.state.setup) throw new Error((r && r.error) || 'Setup state could not be read.');
    return { completed: r.state.setup.completed === true, deferred: r.state.setup.deferred === true, latex: r.state.latex || {} };
  }
  async function setupCheckStored() {   // cheap launch check: does latex.compilerPath still exist? One stat in main; nothing is started or written
    const lb = window.plum && window.plum.latex;
    if (!lb || typeof lb.checkStored !== 'function') return;
    try { const r = await lb.checkStored(); SETUP.storedBad = r && r.ok === true && r.path && (r.status === 'missing' || r.status === 'notfile') ? r.path : ''; } catch (e) { SETUP.storedBad = ''; }
  }
  async function wizSavedConflict(target) {   // the saved compiler { name, path } when it still works and differs from target, else null (a missing or unusable saved path is safe to replace)
    const st = setupBridge(), lb = window.plum && window.plum.latex;
    if (!st || !lb || typeof lb.checkStored !== 'function') return null;
    try {
      const r = await st.getSetupState(), l = r && r.ok && r.state && r.state.latex;
      if (!l || !l.compilerPath || l.compilerPath === target) return null;
      const c = await lb.checkStored();
      return c && c.ok === true && c.status === 'ok' ? { name: l.compilerName, path: l.compilerPath } : null;
    } catch (e) { return null; }
  }
  function wizConfirm(title, body, yes) {   // existing dialog; true only for the last button, anything else (Keep, Escape, X, click outside) is false
    return new Promise((res) => {
      const d = dlg({ t: title, i: 'triangle-alert', w: 460, btns: ['Keep current', yes], b: body, ok: () => res(true) });
      const mo = new MutationObserver(() => { if (!d.el.isConnected) { mo.disconnect(); res(false); } });
      mo.observe(document.body, { childList: true });
    });
  }
  async function wizToVerify() {   // Detect > Verify: a re-run never replaces a working saved compiler (path or engine) without asking
    let go = true;
    await wizRun(async () => {
      const target = wizVerifyTarget(), c = await wizSavedConflict(target);
      if (!c) return;
      const code = (v) => `<code style="word-break:break-all">${esc(v)}</code>`;
      go = await wizConfirm('Replace your saved compiler?', `<p>Plum is set to use <b>${esc(WIZ_ENG[c.name] || 'a compiler')}</b> at ${code(c.path)}, and it still works.</p><p>If this check passes, Plum will use ${code(target)} instead.</p>`, 'Replace');
      if (!go) wizStatus('Kept your saved compiler. Nothing was changed.');
    });
    if (go && WIZ.el) goToStep(4);
    else if (WIZ.el && WIZ.step === 2) { const b = $('.wiz__actions [data-act="verify"]', WIZ.el); if (b && !b.disabled) b.focus(); }
  }
  async function setupSilentVerify(p) {   // true = verified and saved, with no UI; never replaces a working saved compiler
    const b = wizLatexBridge();
    if (!b || WIZ.el || await wizSavedConflict(p)) return false;
    let r; try { r = wizNormVer(await b.verifyCompiler(p)); } catch (e) { return false; }
    if (!r.ok || WIZ.el) return false;   // the wizard opened meanwhile: it owns the setup state now
    return (await wizPersistVerified(r)).ok === true;
  }
  async function setupStartup() {   // never blocks init; setup.completed === true never opens the wizard
    let st;
    try { st = await setupReadState(); } catch (e) { console.warn('[rpe] setup state unreadable:', e); openWizard(1); return; }
    if (st.completed) { setupCheckStored(); return; }   // an invalid saved path is surfaced only when the user compiles
    let det;
    try { det = await wizDetectCall(); } catch (e) { openWizard(2); return; }   // unexpected detection error: the Detect step shows State 3
    const f = det.found.find((x) => x.name === wizDefaultEngine());
    if (f && await setupSilentVerify(f.path)) { toast('LaTeX detected'); return; }
    if (!WIZ.el) openWizard(1);
  }
  async function lxStatusGet() {   // what Settings and the Welcome step show
    const st = await setupReadState(), l = st.latex || {}, lb = window.plum && window.plum.latex;
    let ps = 'none';
    if (l.compilerPath && lb && typeof lb.checkStored === 'function') { try { const r = await lb.checkStored(); ps = r && r.ok === true ? r.status : 'error'; } catch (e) { ps = 'error'; } }
    return { desktop: !!st.latex, completed: st.completed, deferred: st.deferred, name: l.compilerName || '', path: l.compilerPath || '', ps, ok: l.lastVerifiedOk === true, at: l.lastVerifiedAt || null };
  }
  const LX_PS = { missing: 'file not found', notfile: 'not a file', permission: 'cannot be run: permission denied', error: 'could not be checked' };
  function lxStatusHtml(s) {
    const row = (k, v) => `<span>${k}</span><span>${v}</span>`;
    if (!s.desktop) return row('Compiler', 'Status is only available in the Plum desktop app.');
    const when = s.at && !isNaN(Date.parse(s.at)) ? esc(new Date(s.at).toLocaleString()) + (s.ok ? '' : ' (a later check failed)') : 'Never';
    return row('Compiler', s.path ? esc(WIZ_ENG[s.name] || s.name) : 'Not configured' + (s.deferred ? ' (setup was skipped)' : ''))
      + row('Path', s.path ? `<code>${esc(s.path)}</code>${s.ps !== 'ok' ? ' (' + (LX_PS[s.ps] || LX_PS.error) + ')' : ''}` : 'None saved (Plum uses a compiler on your PATH, if there is one)')
      + row('Last verified', when);
  }
  async function lxStatusPaint() {   // Settings > LaTeX Setup; a no-op while that page is not showing
    const box = $('#lxStatus'); if (!box) return;
    box.innerHTML = '<span>Status</span><span>Checking\u2026</span>';
    let html; try { html = lxStatusHtml(await lxStatusGet()); } catch (e) { html = '<span>Status</span><span>Could not be read.</span>'; }
    if (box.isConnected) box.innerHTML = html;
  }
  function lxWelcomeFill() {   // re-run: show the current state on the Welcome step
    const el = WIZ.el; if (!el || !WIZ.cur) return;
    WIZ.cur.then((s) => { const box = el === WIZ.el && WIZ.step === 1 ? $('.wiz__cur', el) : null; if (box && s && s.desktop && (s.completed || s.path)) box.innerHTML = `<p><strong>Current setup</strong></p><div class="lx-stat">${lxStatusHtml(s)}</div>`; });
  }
  function lxNoCompilerToast() {   // non-blocking, with an action; one at a time and at most one per 30 s
    const now = Date.now(); if (now - SETUP.nagAt < 30000 || $('.toast--lx')) return; SETUP.nagAt = now;
    const t = h(`<div class="toast toast--warn toast--lx is-in" role="status"><span class="toast__icon">${ic('triangle-alert')}</span><span class="toast__msg">${esc(LX_NO_COMPILER)}</span><button type="button" class="toast__action">Set up LaTeX</button><button type="button" class="toast__x" aria-label="Dismiss">${ic('x')}</button></div>`);
    $('#toasts').append(t); paint(t);
    $('.toast__action', t).onclick = () => { t.remove(); openWizard(2); };
    $('.toast__x', t).onclick = () => t.remove();
    setTimeout(() => t.remove(), 12000);
  }
  window.RPE.wizard = { openWizard, closeWizard, goToStep, run: wizRun, status: wizStatus, get busy() { return WIZ.busy; } };

  function initWindowControls() {
    const box = $('#winControls'), max = $('#wcMax');
    if (!box || !max) return;
    const NS = 'width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ic"';
    const ICON = { max: `<svg ${NS}><rect x="5" y="5" width="14" height="14"></rect></svg>`, restore: `<svg ${NS}><rect x="4" y="8" width="12" height="12"></rect><path d="M8 8V4h12v12h-4"></path></svg>` };
    const METHODS = ['minimize', 'toggleMaximize', 'close'];
    const bridge = () => { const b = window.plumDesktop; return b && METHODS.every((m) => typeof b[m] === 'function') ? b : null; };
    function setMaximized(on) {
      on = !!on;
      max.innerHTML = on ? ICON.restore : ICON.max;
      max.setAttribute('aria-label', on ? 'Restore' : 'Maximize'); max.title = on ? 'Restore' : 'Maximize';
      max.dataset.maximized = String(on);
    }
    function refresh() {
      const ok = !!bridge();
      box.hidden = !ok;
      if (ok && !max.firstChild) setMaximized(false);
      return ok;
    }
    box.querySelectorAll('[data-wc]').forEach((b) => {
      b.onclick = () => { const br = bridge(); if (!br) { refresh(); return; } try { if (b.dataset.wc === 'close') exitApp(() => br.close()); else br[b.dataset.wc](); } catch (e) { console.warn('[rpe] window control failed:', b.dataset.wc, e); } };
    });
    window.RPE.windowControls = { refresh, setMaximized };
    refresh(); paint(box);
    { const br = bridge();   // the shell reports every maximize/restore (button, double-click on the bar, snap, keyboard), so the icon always matches the window
      if (br) { try { if (typeof br.onMaximizedChange === 'function') br.onMaximizedChange(setMaximized); if (typeof br.isMaximized === 'function') Promise.resolve(br.isMaximized()).then((m) => { if (typeof m === 'boolean') setMaximized(m); }).catch(() => {}); } catch (e) { console.warn('[rpe] window state unavailable:', e); } } }
  }

  function init() {
    appearanceApply(); uiFontApply(); proofApply(); document.documentElement.style.setProperty('--ed-fs', PREFS.fs + 'px'); document.documentElement.style.setProperty('--ed-tab', PREFS.tab);
    $$('.appname').forEach((n) => (n.textContent = APP_NAME));   // document.title is kept current by syncTitle(), called below via syncSaveState()
    const tl = $('#tablist'); const f = h('<button class="tab tab--file" role="tab">File</button>'); f.onclick = () => backstage(true); tl.append(f);
    Object.keys(TABS).forEach((n) => { const t = h(`<button class="tab" role="tab">${n}</button>`); t.onclick = () => showTab(n); tl.append(t); });
    SRC = ''; renderCode(); showTab('Home'); paint(); showWelcome(true);   // a reload opens NO document: the editor stays empty and locked until one is created or opened
    { const ta = $('#codeInput'); ta.readOnly = true; $('#srcName').textContent = 'No document open'; }
    pkCat().then(j => { j.forEach(p => PK_NAMES.add(p.name)); renderCode(); }).catch(() => {});   // add JSON packages to PK_NAMES and re-render so (i) buttons appear for them
    renderExplorer(); renderOutline(); wireEditorInput(); $('#cmtClose').onclick = () => cmtShow(false); { const f = $('#cmtHideDone'); f.checked = !!PREFS.cmtHideDone; f.onchange = () => { prefSet('cmtHideDone', f.checked); cmtRender(); }; } $('#trkClose').onclick = () => { $('#trkPanel').hidden = true; };
    $('#probClose').onclick = () => { $('#probPanel').hidden = true; };
    $('#probBadge').onclick = () => { const p = $('#probPanel'); p.hidden = !p.hidden; if (!p.hidden) probRender(); };
    { const toggle = (id, key) => { const b = $('#' + id); b.onclick = () => { PROB[key] = !PROB[key]; b.setAttribute('aria-pressed', String(PROB[key])); probRender(); probUpdateGutter(); }; };
      toggle('probErr', 'showErr'); toggle('probWarn', 'showWarn'); }
    /* restoreProject() intentionally not called: a reload lands on the welcome screen, with Recent Projects to reopen from */
    // restoreProject();   // async: silently reattaches to the last-opened folder where the browser allows it, else leaves the explorer's empty state in place
    $('#sidebarToggle').onclick = () => toggleSidebar();
    initWindowControls();
    $('#docTitle').onclick = startRename;
    $('#docFileName').textContent = PROJ_NAME;
    $$('[data-d]').forEach((b) => { if (!b.closest('#backstage')) b.onclick = () => openD(b.dataset.d); });
    pvInit(); showApply();
    if ($('#pdfEmptyCompile')) $('#pdfEmptyCompile').onclick = runCompile;
    if (window.ResizeObserver && $('#ribbon')) new ResizeObserver(updateRibbonOverflow).observe($('#ribbon'));
    window.addEventListener('resize', updateRibbonOverflow);
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    if (isMac && $('#pdfEmptyHint')) $('#pdfEmptyHint').innerHTML = 'or press <kbd>⌘</kbd>+<kbd>Enter</kbd>';
    const wp = $('#welcomePanel');
    if (wp) {
      $('#welcomeNewDoc').onclick = () => newDocument();   // the welcome screen only closes once a document actually exists (newDocFrom / openFileNode unlock the editor)
      $('#welcomeOpenFolder').onclick = () => openProjectFolder();
      $('#welcomeNewTpl').onclick = () => newFromTemplate();
      $('#welcomeDismiss').onclick = () => newDocument();
      wp.onclick = (e) => {
        const rm = e.target.closest('.welcome-rec__rm');
        if (rm) { e.stopPropagation(); recentRemove(rm.dataset.rm); return; }
        const row = e.target.closest('.welcome-rec');
        if (row) reopenRecent(row.dataset.rid);
      };
    }
    $('#codeInput').addEventListener('keydown', (e) => {   // Tab inserts "Tab width" spaces (native undo kept); with a selection Tab keeps its normal behaviour so nothing is replaced
      const ta = e.target; if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || ta.selectionStart !== ta.selectionEnd) return;
      e.preventDefault(); const sp = ' '.repeat(PREFS.tab); if (!document.execCommand('insertText', false, sp)) { ta.setRangeText(sp, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    });
    $('#codeInput').addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const ta = $('#codeInput'), s = ta.selectionStart, z = ta.selectionEnd, hasSel = s !== z;
      const at = { getBoundingClientRect: () => ({ left: Math.min(e.clientX, window.innerWidth - 220), top: e.clientY, bottom: e.clientY }), classList: { add() {}, remove() {}, contains() {} }, setAttribute() {} };
      const items = [
        { l: 'Undo', icon: 'undo-2', sub: 'Ctrl+Z', disabled: !histGet().past.length, val: 'undo' },
        { l: 'Redo', icon: 'redo-2', sub: 'Ctrl+Y', disabled: !histGet().future.length, val: 'redo' },
        '-',
        { l: 'Cut', icon: 'scissors', sub: 'Ctrl+X', disabled: !hasSel, val: 'cut' },
        { l: 'Copy', icon: 'copy', sub: 'Ctrl+C', disabled: !hasSel, val: 'copy' },
        { l: 'Paste', icon: 'clipboard-paste', sub: 'Ctrl+V', val: 'paste' },
        { l: 'Paste as Plain Text', icon: 'file-text', sub: 'Ctrl+Shift+V', val: 'paste-plain' },
        { l: 'Select All', icon: 'check-square', sub: 'Ctrl+A', val: 'select-all' },
        '-',
        { l: 'Bold', icon: 'bold', sub: 'Ctrl+B', val: 'bold' },
        { l: 'Italic', icon: 'italic', sub: 'Ctrl+I', val: 'italic' },
        { l: 'Toggle Comment', icon: 'hash', sub: 'Ctrl+/', val: 'comment-line' },
        '-',
        { l: 'Find & Replace…', icon: 'search', sub: 'Ctrl+F', val: 'find' },
        { l: 'New Comment…', icon: 'message-square', val: 'comment' },
        { l: 'Insert Cross-reference…', icon: 'corner-down-right', val: 'xr' },
        '-',
        { l: 'Compile Document', icon: 'play', sub: 'Ctrl+Enter', val: 'compile' }
      ];
      menu(at, items, async (val) => {
        ta.focus();
        if (val === 'undo') docUndo();
        else if (val === 'redo') docRedo();
        else if (val === 'cut' || val === 'copy') {
          const txt = ta.value.slice(ta.selectionStart, ta.selectionEnd);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(txt).catch(() => {});
            if (val === 'cut') fmtEdit(ta, ta.selectionStart, ta.selectionEnd, '', ta.selectionStart, ta.selectionStart);
          } else {
            document.execCommand(val);
          }
        }
        else if (val === 'paste') clipPaste('paste');
        else if (val === 'paste-plain') clipPaste('plain');
        else if (val === 'select-all') ta.select();
        else if (val === 'bold') fmtToggle('textbf');
        else if (val === 'italic') fmtToggle('textit');
        else if (val === 'comment-line') toggleLineComment();
        else if (val === 'find') toggleFindPanel(true);
        else if (val === 'comment') commentDialog();
        else if (val === 'xr') xrDialog('all');
        else if (val === 'compile') runCompile();
      });
    });
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('#codeInput')) return;
      e.preventDefault();
    }, false);
    $('#codeInput').addEventListener('scroll', rulerSync); $('#codeInput').addEventListener('input', rulerSync); new ResizeObserver(rulerSync).observe($('#code'));
    $$('[data-q]').forEach((b) => { b.onclick = () => toast(b.dataset.q + ': preview only'); });
    $('[data-q="Save"]').onclick = saveDoc;
    const qUndo = $('[data-q="Undo"]'); if (qUndo) qUndo.onclick = docUndo;
    const qRedo = $('[data-q="Redo"]'); if (qRedo) qRedo.onclick = docRedo;
    $('#compileBtn').onclick = runCompile;
    const cancelBtn = $('#cancelCompileBtn'); if (cancelBtn) cancelBtn.onclick = () => { if (window.RPE && RPE.pv && RPE.pv.compileAC) RPE.pv.compileAC.abort(); };
    /* ---- Find & Replace panel wiring ---- */
    $('#findClose').onclick = () => toggleFindPanel(false);
    $('#findInput').oninput = () => runFind();
    $('#findNext').onclick = () => stepMatch(1);
    $('#findPrev').onclick = () => stepMatch(-1);
    ['findCase', 'findWord', 'findRe'].forEach((id) => {   // option buttons share their id with the pref key, so they are remembered across sessions
      const b = $('#' + id);
      b.classList.toggle('is-on', PREFS[id]); b.setAttribute('aria-pressed', PREFS[id]);
      b.onclick = () => { const on = !b.classList.contains('is-on'); b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); prefSet(id, on); runFind(); };
    });
    $('#findSel').onclick = (e) => {   // "In selection": limit find/replace to the editor selection captured now
      const b = e.currentTarget, ta = $('#codeInput'), on = !b.classList.contains('is-on');
      if (on && ta.selectionStart === ta.selectionEnd) return toast('Select some text in the editor first');
      FIND.sel = on ? [ta.selectionStart, ta.selectionEnd] : null;
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); runFind();
    };
    $('#findInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); } });
    $('#replaceInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); } });
    palWire();
    $('#replaceOne').onclick = replaceCurrent;
    $('#replaceAll').onclick = replaceAllMatches;
    document.addEventListener('keydown', (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && !e.altKey && e.key.toLowerCase() === 'z') {
        const inInput = e.target && (e.target.matches('input') || (e.target.matches('textarea') && e.target.id !== 'codeInput'));
        if (!inInput) {
          e.preventDefault();
          if (e.shiftKey) docRedo(); else docUndo();
          return;
        }
      }
      if (isMod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'y') {
        const inInput = e.target && (e.target.matches('input') || (e.target.matches('textarea') && e.target.id !== 'codeInput'));
        if (!inInput) {
          e.preventDefault();
          docRedo();
          return;
        }
      }
      if (e.key === 'Escape' && FP && !$('.dlg')) { fpSet(null); toast('Format Painter cancelled'); return; }
      if (e.key === 'Escape') { if (!$('#findPanel').hidden) { toggleFindPanel(false); return; } closePop(); if (!$('#backstage').hidden && !$('.dlg')) backstage(false); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); const i = $('#cmdSearch'); i.focus(); i.select(); }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFindPanel(true); }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); toggleFindPanel(true); $('#replaceInput').focus(); $('#replaceInput').select(); }
      if (e.key === 'F3') { e.preventDefault(); if ($('#findPanel').hidden) toggleFindPanel(true); else stepMatch(e.shiftKey ? -1 : 1); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCompile(); }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else saveDoc(); }
    });
    syncSaveState();
    historyUIUpdate();
    const dv = $('#divider'), main = $('#main');
    dv.onpointerdown = (e) => { dv.setPointerCapture(e.pointerId); const mv = (ev) => { const r = main.getBoundingClientRect(), stk = main.classList.contains('stack'), p = Math.min(75, Math.max(25, stk ? (ev.clientY - r.top) / r.height * 100 : (ev.clientX - r.left) / r.width * 100)); document.documentElement.style.setProperty('--src-w', p + '%'); }; dv.addEventListener('pointermove', mv); dv.addEventListener('pointerup', () => dv.removeEventListener('pointermove', mv), { once: true }); };
    window.addEventListener('focus', () => checkExternalFsChanges());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkExternalFsChanges(); });
    checkDraftRecovery();
    setupStartup().catch(() => {}).then(() => {   // silent detect + verify first; the wizard opens only while setup.completed is not true and that did not settle it
      if (!WIZ.el) wizDesktop(false);   // no wizard after all: the window leaves its compact first-run size before it is shown
      const br = window.plumDesktop;   // tell the shell the app is ready (after the is-ready fade), so the splash never hands over to a blank or half-built window
      if (br && typeof br.ready === 'function') setTimeout(() => { try { br.ready(); } catch (e) { /* bridge gone */ } }, 250);
    });
    setInterval(async () => {
      if (!PREFS.asd) return;
      const ap = window.RPE.explorer && window.RPE.explorer.activePath;
      const n = ap && findNode(ap);
      if (!n || !n.handle || typeof n.handle.createWritable !== 'function') return;
      if (await docDirty()) await saveActiveFile();
    }, 30000);
    setTimeout(() => document.body.classList.add('is-ready'), 0); window.addEventListener('load', () => paint());
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();