# CODEMAP: Laurevine Plum
Vanilla JS, no build. Locate by function name (`grep -rn "function NAME" js/`); line numbers drift.
Layout: index.html · js/ui.js (RPE.ui) · js/docs.js (RPE.docs) · js/flow.js (RPE.flow) · js/citations.js (RPE.bib) · js/symbols.js (RPE.symbols) · js/pdf-viewer.js (RPE.pv) · js/editor.js (RPE.editor) · js/explorer.js (RPE.explorer) · js/icons*.js · js/vendor/pdf*.js · js/app.js ·
css/ · server/server.js (+chart.py) · templates/ · docs/. Script order in index.html: icons-fallback, icons, pdf.min, symbols, templates, ui, docs, flow, citations, pdf-viewer, editor, explorer, app.

## Global state & Context Bridge (window.RPE.ctx)
- `SRC`: the LaTeX source string of the ACTIVE file (editor text mirrors it; `loadIntoEditor()` swaps it).
- `PROJECT`: tree nodes `{t:'folder'|'file', n, path, open, c, handle}` once a folder is open (owned by `js/explorer.js`).
- `rootDirHandle`: FileSystemDirectoryHandle of the project root. `PROJ_NAME`, title-bar project name.
- `activePath`: path of the file loaded in the editor. `mainPath`, project main file (what Compile builds; per-folder in IDB).
- `fileCache`: Map path→in-memory text (unsaved edits live here). `scratchBase`, text of the scratch/untitled doc baseline (docDirty).
- Others: `PREFS`/`prefSet` (localStorage prefs), `LIB` (citation library), `FLOW` (diagram), `FIND`, `CMT` (comments), `PV` (PDF viewer),
  `HIST_MAP`/`docUndo`/`docRedo` (editor-wide history), `FP` (format painter), `STYLES`/`curStyle`, `ACT` (toggle actions by `o.a`), `D` (dialog catalogue), `TABS` (ribbon data).
- `window.RPE.ctx` bridges shared closure state and methods across modules via reactive Proxy.

## Modularized files
- `js/ui.js`: DOM helpers (`$`, `$$`, `esc`, `ic`, `h`, `paint`, `toast`), popover menus (`menu`, `closePop`, `colorPanel`), custom selects, and the dialog shell (`dlg`, `F`, `G`). Exposes `window.RPE.ui`.
- `js/docs.js` (~220 lines): Markdown parser (`mdInline`, `mdRender`, `mdDialog`) and Help reference panels (`refPanel`, `refPackages`, `refShortcuts`, `refTrouble`, `openDoc`, `pkCat`). Exposes `window.RPE.docs`.
- `js/flow.js` (~410 lines): SVG Flow Diagram editor (`flowDialog`), shape and connector models (`FLOW`), TikZ LaTeX generator (`flowTikz`), library detector (`tikzLibs`), and `.diagram.json` loader. Exposes `window.RPE.flow`.
- `js/citations.js` (~740 lines): Citation Library store (`LIB`), BibTeX parser/formatter (`parseBib`, `bibEntry`), DOI resolver, PDF metadata extractor (`pdfMeta`), dialogs (`bibDialog`, `citeDialog`, `bibImportDialog`), and Bibliography insertion (`bibSys`, `bibInsert`, `bibUpdate`). Exposes `window.RPE.bib`.
- `js/symbols.js` (~1,170 lines): Curated symbol catalog & Unicode database. Exposes `window.RPE.symbols`.
- `js/pdf-viewer.js` (~560 lines): PDF.js multi-page canvas viewer (`pvInit`, `pvRender`, `pvLayout`, `pvZoom`, `pvFit`, `pvMode`, `showCompiledPdf`), compile diagnostics (`diagFill`, `diagDialog`, `recordCompile`), problems log parser (`parseProblems`, `PROB`, `probRender`, `probJump`, `probUpdateGutter`), and exports (`exportPdf`, `exportZip`, `exportTex`, `openOutputFolder`). Exposes `window.RPE.pv`.
- `js/editor.js` (~2,660 lines): Formatting engine: character formatting (`fmtLayers`, `fmtEdit`, `fmtToggle`, `fmtColor`, `fmtFont`, `fmtSize`, `fmtCase`, `stripFormatting`, `fmtClear`, `clipPaste`, `fpToggle`, `fpApply`), paragraph formatting (`fmtPara`, `paBuild`, `paApply`, `pagAct`, `fmtList`, `fmtLevel`, `fmtMulti`), headings & styles (`headingApply`, `headingDialog`, `themeApply`), document dialogs (`eqDialog`, `symbolDialog`, `hfDialog`, `pdDialog`, `tbDialog`, `pageDialog`, `tocInsert`, `listInsert`, `fnInsert`, `lblDialog`, `xrDialog`, `linkDialog`, `pictureDialog`, `chartDialog`, `tableDialog`), review & diff (`TRK`, `trkSchedule`, `trkToggle`, `compareDialog`), comments store (`CMT`, `cmtLoad`, `cmtSave`, `cmtShow`, `cmtGo`, `cmtRender`, `cmtSync`), and find & replace (`FIND`, `runFind`, `findReplace`, `toggleFindPanel`). Exposes `window.RPE.editor`.
- `js/explorer.js` (~1,210 lines): Project Explorer & File System Access API: directory tree (`PROJECT`, `rootDirHandle`, `listDir`, `toggleFolder`, `openFileNode`, `findNode`, `refreshDir`, `renderExplorer`), IndexedDB draft recovery (`idbOpen`, `idbDraftSet`, `checkDraftRecovery`), recent projects (`recentAdd`, `recentPanel`, `reopenRecent`, `showWelcome`), main file resolution (`scanAllTexNodes`, `findMainCandidates`, `defaultMain`, `resolveMain`, `setMain`), file actions (`saveActiveFile`, `saveDoc`, `saveAs`, `docDirty`, `guardDirty`, `newDocument`, `newFromTemplate`, `createFromTemplate`, `resetTemplate`, `docClassGallery`), compile bundle builder (`compilePayload`). Exposes `window.RPE.explorer`.

## js/app.js sections (~1,530 lines; in file order; first function names)
- Package information: `pkgDlgFocus`, `D` dialog catalogue + `G()` builder.
- Unpacked sub-modules: destructures from `window.RPE.docs`, `window.RPE.flow`, `window.RPE.bib`, `window.RPE.editor`, `window.RPE.explorer`, and `window.RPE.pv`.
- Ribbon (data-driven): `L S I st rw CB NM SP g` item builders, `TABS`, `openD` (opens D dialog), `wire`, `build`, `showTab`.
- Styles gallery & prefs: `styleSupport applyStyle selectStyle openStylesMenu`, `appearanceApply editorApply pane rulerSync showApply`, `ACT`.
- Editor core & windowed renderer: `SRC`, `tok` (tokenizer), `indexSrc`, `metrics checkBibErrors drawLines paintFind ensureWindow renderCode setCurLine goToLine loadIntoEditor histGet docUndo docRedo wireEditorInput` (transparent textarea under highlighted layer).
- Outline navigation: `parseOutline`, `outRows`, `outFlatten`, `renderOutline`, `paintOutline`, `scheduleOutline`, `outJump`, `outSyncCursor`, `toggleSidebar`.
- Project rename & backstage: `startRename`, `applyProjectName`, `pmScan`, `pmRead`, `pmApply`, `propsPanel`, `prefsPanel`, `backstage`.
- Compile orchestrator: `runCompile` (orchestrates `/api/compile` HTTP call, handles aborts/errors, connects to `RPE.pv` for diagnostics, problems, and PDF rendering).
- Command palette: `PAL_FILE`, `PAL_KEYS`, `palFuzz`, `palIndex`, `palRender`, `palRun`, `palClose`, `palMark`, `palWire`.
- Context bridge & boot: `window.RPE.ctx` declaration followed by `init()`.

## Ribbon model
`TABS = { Home, Insert, Layout, Design, References, Review, View, Help }`, each an array of groups `g(label, ...items)`.
Item kinds (`k`): `L` large btn, `S` small btn, `I` icon btn, `st`/`rw` stack/row, `cb` combo, `nm` number box, `sp` separator, `sty` styles, `doc`, `tpl`.
Item opts: `l` label, `i` lucide icon, `m` menu array, `t` toggle (2 = radio), `a` ACT key, `d` dialog id (D.*), `f`/`c` char format/colour, `sel` execCommand id (cut/copy/selectAll).
`showTab(name)` clears `#ribbonBody` and `build()`s each item; `build()` calls `wire(el, o)`.
`wire()` sets state classes, then `el.onclick` dispatches on the FIRST matching opt, in order:
`undo/redo pv pvm brk cmt trk sel paste fp rst fsz cas clr proof lang wc pa pag ml toc tu bib/bibu lof/lou/fn/lbl/xr tocd hf pcol pg col ls pal pk eq frole hd role f d m(+sw colour menu) t` → else toast "preview only".
Add a button: put an opt on the item in `TABS`, add one `if (o.x) return handler()` line in `wire()` BEFORE the generic `o.d`/`o.m` lines.
Full control inventory (every tab/group, status, LaTeX output): `docs/RIBBON_MATRIX.md`.

## Server (server/server.js, Node built-ins only, default port 5174)
- `POST /api/compile`: bundle `{main, files[]}` (or legacy `{source}`), optional `bib` → `{ok, pdfUrl, log, errors[], bib}`; engine from `% !TEX program` (xelatex/lualatex/pdflatex); multi-pass loop (stop when stable, max 4); bibtex/biber auto-detected; job dirs cleaned up after 5 min.
- `POST /api/export-zip`: same bundle + `name` → zip (also saved to OUTPUT_DIR, default `~/Laurevine Plum Exports`; env `LAUREVINE_PLUM_OUTPUT`, legacy `LATEX_STUDIO_OUTPUT` fallback). `POST /api/open-output`, open export folder (localhost only).
- `GET /api/pdf/:jobId`: compiled PDF. `POST /api/chart`, Matplotlib via server/chart.py (missing Python/matplotlib/Python 2 → `{ok:false, setup:true, error}` friendly text). `GET /api/fonts`, bundled font list. Other GET → `serveStatic`.
- Helpers: `compileJob runCompiler bibPass parseBundle safeRel buildZip chartJob bundledFonts`.

## CSS (load order styles → components → latex; all colours via CSS vars, dark = `[data-theme="dark"]`)
- `css/styles.css`: design tokens (`:root` vars), shell grid, sidebar, title bar, tabs, ribbon, panes, status bar, backstage, responsive, recent projects.
- `css/components.css`: popovers/menus, dialogs/forms, toasts/tooltips, scientific dialogs, comments/results, chart + flow editors, markdown/reference panels.
- `css/latex.css`: editor/PDF split, dark-theme var overrides, syntax colours, Styles gallery, Find panel, compile preview/log, file viewer,
  find/comment highlights, source-display options, PDF viewer controls, View ▸ Show.

## Data files
`templates/templates.js` (window.LP_TEMPLATES → `.tex` files here), `docs/*.md|json` (fetched by Help panels), `fonts/fonts.txt`, `fonts/README.md`.
