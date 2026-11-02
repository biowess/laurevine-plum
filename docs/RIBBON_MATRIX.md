# Ribbon Matrix: Laurevine Plum

Legend:
- **Real**: wired, edits LaTeX source or performs a real action
- **Native-browser**: delegates to the browser/OS (clipboard, execCommand, keyboard shortcuts)
- **Preview-only**: falls through to `toast(…': preview only')` in `wire()`; no LaTeX change
- **Dialog**: opens a real dialog (`openD`/`d` opt) with its own implementation
- **UI-toggle**: toggles a UI state (pane visibility, theme, ACT flags); no LaTeX output
- **Gallery**: special `build()` case (doc/tpl/sty); not routed through `wire()`

Status column uses abbreviations: **R** Real · **NB** Native-browser · **PO** Preview-only · **D** Dialog · **UI** UI-toggle · **G** Gallery

---

## Per-tab control counts

| Tab | Controls | Real | NB | Dialog | UI-toggle | Gallery | Preview-only |
|---|---|---|---|---|---|---|---|
| Home | 40 | 34 | 3 | 2 | 0 | 1 | 0 |
| Insert | 19 | 8 | 0 | 11 | 0 | 0 | 0 |
| Layout | 18 | 16 | 0 | 0 | 2 | 0 | 0 |
| Design | 18 | 13 | 0 | 3 | 0 | 2 | 0 |
| References | 19 | 15 | 0 | 4 | 0 | 0 | 0 |
| Review | 11 | 7 | 1 | 1 | 2 | 0 | 0 |
| View | 19 | 0 | 0 | 1 | 18 | 0 | 0 |
| Help | 8 | 0 | 0 | 8 | 0 | 0 | 0 |
| **Total** | **152** | **91** | **4** | **30** | **20** | **3** | **4** |

> Note: combo-box (`cb`) and number-input (`nm`) controls are wired in `build()`, not `wire()`. They are counted as Real.

---

## Home (40 controls)

### Group: Undo (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Undo | S | `o.undo` → `docUndo()` | R | Reverts last source edit |
| Redo | S | `o.redo` → `docRedo()` | R | Re-applies reverted edit |

### Group: Clipboard (4)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Paste | L | `o.paste`+`o.m` → `menu()` → `clipPaste()` | R | Inserts clipboard text: raw LaTeX, plain text (formatting stripped), or escaped LaTeX |
| Cut | S | `o.sel` → `clipboard.writeText` / `execCommand('cut')` | NB | OS cuts selected source text (clipboard API with fallback) |
| Copy | S | `o.sel` → `clipboard.writeText` / `execCommand('copy')` | NB | OS copies selected source text (clipboard API with fallback) |
| Format Painter | S | `o.fp` → `fpToggle()` | R | Copies/applies `\textbf`/`\textit`/`\underline`/`\sout`/`\textcolor`/`{\fontspec{…}}` wrappers |

### Group: Font (14)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Font (combo) | cb | `build()` → `fmtFont(v)` | R | `{\fontspec{Name}…}` + `\usepackage{fontspec}` |
| Size (combo) | cb | `build()` → `fmtSize(v)` | R | `{\size …}` or `\size ` |
| Increase font size | I | `o.fsz` → `fmtSize(1)` | R | Steps size up in `\tiny`…`\Huge` scale |
| Decrease font size | I | `o.fsz` → `fmtSize(-1)` | R | Steps size down in `\tiny`…`\Huge` scale |
| Change case | I | `o.cas`+`o.m` → `menu()` → `fmtCase()` | R | Changes case (Sentence case / lowercase / UPPERCASE) protecting LaTeX commands and math |
| Bold | I | `o.f` → `fmtToggle('textbf')` | R | `\textbf{…}` |
| Italic | I | `o.f` → `fmtToggle('textit')` | R | `\textit{…}` |
| Underline | I | `o.t`+`o.f` → `fmtToggle('underline')` | R | `\underline{…}` |
| Strikethrough | I | `o.t`+`o.f` → `fmtToggle('sout')` | R | `\sout{…}` + `\usepackage[normalem]{ulem}` |
| Subscript | I | `o.f` → `fmtToggle('textsubscript')` | R | `\textsubscript{…}` |
| Superscript | I | `o.f` → `fmtToggle('textsuperscript')` | R | `\textsuperscript{…}` |
| Text highlight | I | `o.m`+`o.sw`+`o.c='hl'` → `fmtColor('hl',…)` | R | `{\sethlcolor{name}\hl{…}}` + `\usepackage{soul,xcolor}` |
| Font color | I | `o.m`+`o.sw`+`o.c='textcolor'` → `fmtColor('textcolor',…)` | R | `\textcolor[HTML]{RRGGBB}{…}` + `\usepackage{xcolor}` |
| Clear formatting | I | `o.clr` → `fmtClear()` | R | Strips formatting wrappers (`\textbf`, `\textit`, `\emph`, `\underline`, `\sout`, `\textcolor`, `\hl`, `\fontspec`, size commands) |

> **Note on Size combo**: `build()` wires the dropdown button and Enter key to `fmtSize(v)`, updating the size wrapper/command and syncing the display.

### Group: Paragraph (15)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Bulleted list | I | `o.ls`+`o.m` → `menu()` → `fmtList('bul', idx)` | R | `\begin{itemize}…\end{itemize}` |
| Numbered list | I | `o.ls`+`o.m` → `menu()` → `fmtList('num', idx)` | R | `\begin{enumerate}…\end{enumerate}` |
| Multilevel list | I | `o.ml`+`o.m` → `menu()` → `fmtMulti(l)` | R | Adjusts list level (`\item`, nested envs) |
| Decrease indent | I | `o.pa` → `fmtPara({dIndent:-1})` | R | `\setlength{\leftskip}{…cm}%lp` |
| Increase indent | I | `o.pa` → `fmtPara({dIndent:1})` | R | `\setlength{\leftskip}{…cm}%lp` |
| Align left | I | `o.pa` → `fmtPara({al:'l'})` | R | `\raggedright%lp` |
| Center | I | `o.pa` → `fmtPara({al:'c'})` | R | `\centering%lp` |
| Align right | I | `o.pa` → `fmtPara({al:'r'})` | R | `\raggedleft%lp` |
| Justify | I | `o.pa` → `fmtPara({al:'j'})` | R | (removes alignment command) |
| Line spacing | I | `o.pk`+`o.m` → `menu()` → `fmtPara({ls:…})` | R | `\setstretch{…}%lp` |
| Spacing before | I | `o.pk`+`o.m` → `menu()` → `fmtPara({bef:…})` | R | `\vspace{…pt}%lp` |
| Spacing after | I | `o.pk`+`o.m` → `menu()` → `fmtPara({aft:…})` | R | `\vspace{…pt}%lp` |
| First-line indent | I | `o.pa` → `fmtPara({first:0.6})` | R | `\setlength{\parindent}{0.6cm}%lp` |
| Hanging indent | I | `o.pa` → `fmtPara({hang:1})` | R | `\setlength{\parindent}{-1cm}\setlength{\leftskip}{1cm}%lp` |
| No indent | I | `o.pa` → `fmtPara({noind:1})` | R | `\noindent%lp` |

### Group: Styles (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Styles gallery | sty | `build()` → `openStylesMenu()` → `applyStyle(id)` | G | `\section{…}` / `\begin{quote}…` / etc. |

### Group: Editing & Proofing (4)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Find | S | `o.d` → `openD('find')` | D | none (UI: opens Find & Replace panel) |
| Replace | S | `o.d` → `openD('find')` | D | none (UI: opens Find & Replace panel) |
| Select All | S | `o.sel` → `ta.select()` / `execCommand('selectAll')` | NB | Selects all textarea text |
| Proofing | L | `o.proof`+`o.m` → `menu()` | R | Spelling toggles native spellcheck, Language opens the language menu, Word Count opens the Word Count dialog (same handlers as Review ▸ Proofing) |

---

## Insert (19 controls: none preview-only)

### Group: Pages & Breaks (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Page Break | S | `o.brk` → `fmtBreak('page', el)` | R | `\newpage` on its own line |
| Column Break | S | `o.brk` → `fmtBreak('col', el)` | R | `\columnbreak` on its own line |
| Section Break | S | `o.brk`+`o.m` → `fmtBreak('sec', el)` | R | `\newpage` / geometry section boundary |

### Group: Links (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Link | L | `o.d` → `openD('link')` | D | `\href{url}{text}` + `\usepackage{hyperref}` (added once) |
| Cross-reference | L | `o.xr` → `xrDialog('all')` | R | `\ref{…}` / `\eqref{…}` / `\autoref{…}` |

### Group: Footnotes (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Footnote | L | `o.fn` → `fnInsert()` | R | `\\footnote{…}` wrapping the selection, or empty at the cursor |

### Group: Comments (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| New Comment | L | `o.d` → `openD('comment')` | D | none (stored in localStorage, not in source) |

### Group: Tables (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Table | L | `o.d` → `openD('table')` | D | `\begin{tabular}…\end{tabular}` |

### Group: Illustrations (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Picture | L | `o.d` → `openD('picture')` | D | `\includegraphics[…]{file}` + `\usepackage{graphicx}` |
| Figure | L | `o.d` → `openD('figure')` | D | `\begin{figure}…\includegraphics…\caption{}\end{figure}` |

### Group: Contents (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Table of Contents | L | `o.toc`+`o.m` → `menu()` → `tocInsert(l)` | R | `\tableofcontents` (Classic/Compact options) or opens `@toc` dialog |

### Group: Header & Footer (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Header | S | `o.d` → `openD('hfh')` (focuses a header field) | D | managed `fancyhdr` block: `\fancyhead`, rules, text style, blank first page |
| Footer | S | `o.d` → `openD('hff')` (focuses a footer field) | D | managed `fancyhdr` block: `\fancyfoot`, rules, text style, blank first page |
| Page Number | S | `o.hf`+`o.m` → `menu()` → `hfQuick(l)`; “Format Page Numbers…” → `openD('hfn')` | R | `\thepage`, `\pagestyle{fancy}`, etc. |

### Group: Equations (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Equation | L | `o.eq`+`o.m` → `menu()` → `eqInsert(l)` | R | `$…$` / `\[…\]` / `\begin{align}…` |
| Equation Editor | L | `o.d` → `openD('equation')` | D | Visual equation → inserts LaTeX math |

### Group: Symbols (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Symbol | L | `o.d` → `openD('symbols')` | D | Text: the Unicode glyph (XeLaTeX/LuaLaTeX). Inside math: the real command (`\\alpha`, `\\leq`, `\\mathbb{R}`…) + `amssymb`/`amsmath` added once; symbols with no math command are refused |

### Group: Charts & Diagrams (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Chart | L | `o.d` → `openD('chart')` | D | Matplotlib chart (6 types); saves `figures/<name>.png|pdf` + `.chart.json` sidecar, inserts `\includegraphics{figures/…}`; cursor on such a figure → re-edit |
| Flow Diagram | L | `o.d` → `openD('flow')` | D | TikZ `\begin{tikzpicture}…\end{tikzpicture}` |

---

## Layout (18 controls)

### Group: Page Setup (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Margins | L | `o.pg`+`o.m` → `menu()` → `pageQuick('m', l)` | R | `\geometry{margin=…}` |
| Orientation | L | `o.pg`+`o.m` → `menu()` → `pageQuick('o', l)` | R | `\geometry{landscape}` or removes it |
| Size | L | `o.pg`+`o.m` → `menu()` → `pageQuick('s', l)` | R | `\geometry{a4paper}` / `letterpaper` / etc. |

### Group: Columns & Breaks (4)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Columns | L | `o.col`+`o.m` → `menu()` → `colsApply(l)` | R | `twocolumn` doc class opt or `\begin{multicols}{n}` |
| Page Break | S | `o.brk` → `fmtBreak('page', el)` | R | `\newpage` |
| Column Break | S | `o.brk` → `fmtBreak('col', el)` | R | `\columnbreak` |
| Section Break | S | `o.brk`+`o.m` → `fmtBreak('sec', el)` | R | `\newpage` / section boundary |

### Group: Paragraph (8)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Left indent (nm) | nm | `build()` → `paLayoutCommit(i)` on change | R | `\setlength{\leftskip}{…cm}%lp` |
| Right indent (nm) | nm | `build()` → `paLayoutCommit(i)` on change | R | `\setlength{\rightskip}{…cm}%lp` |
| First line (nm) | nm | `build()` → `paLayoutCommit(i)` on change | R | `\setlength{\parindent}{…cm}%lp` |
| Before (nm) | nm | `build()` → `paLayoutCommit(i)` on change | R | `\vspace{…pt}%lp` |
| After (nm) | nm | `build()` → `paLayoutCommit(i)` on change | R | `\vspace{…pt}%lp` |
| Hanging (nm) | nm | `build()` → `paLayoutCommit(i)` on change | R | `\setlength{\parindent}{-…cm}%lp` |
| Line Spacing | L | `o.pk`+`o.m` → `menu()` → `fmtPara({ls:…})` | R | `\setstretch{…}%lp` |
| Alignment | L | `o.pal`+`o.m` → `menu()` → `fmtPara({al:…})` | R | `\centering` / `\raggedright` / etc. |

### Group: Pagination (4)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Keep with Next | S | `o.pag` → `pagAct('kwn', el)` | R | `\nopagebreak[4]%lp` |
| Keep Together | S | `o.pag` → `pagAct('ktg', el)` | R | Wraps block in `\begin{samepage}…` |
| Widow/Orphan Control | S | `o.pag` → `pagAct('wo', el)` | R | `\widowpenalties 3 10000 10000 150` in preamble |
| Break Options | L | `o.pag`+`o.m` → `menu()` → `pagAct('brk',…)` | R | `\newpage%lp` / `\nopagebreak%lp` / `\clearpage` |

### Group: Source Display (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Line Numbers | S | `o.t`+`o.a='ln'` → ACT.ln (prefSet + UI) | UI | none (editor display only) |
| Break Markers | S | `o.t`+`o.a='brk'` → ACT.brk (prefSet + UI) | UI | none (editor display only) |

---

## Design (18 controls)

### Group: Document Classes (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Document Classes gallery | doc | `build()` → `docClassGallery()` → `applyNewDocDefaults()` | G | `\documentclass{…}` |

### Group: Templates (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Templates gallery (first 4 + drop-down with all) | tpl | `build()` → `tplGallery()` → `applyTemplate()` / `tplMenu()` | G | Full template `.tex` loaded as new document |

### Group: Colors (4)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Theme Colors | L | `o.role`+`o.m` → `menu()` → `themeMenu('theme')(l)` | R | `\definecolor{lpAccent/lpBody/…}{HTML}{…}` in preamble |
| Body Text Color | S | `o.role`+`o.m` → `menu()` → `themeMenu('body')(l)` | R | `\definecolor{lpBody}{HTML}{…}` |
| Heading Color | S | `o.role`+`o.m` → `menu()` → `themeMenu('heading')(l)` | R | `\definecolor{lpSection}{HTML}{…}` etc. |
| Accent Color | S | `o.role`+`o.m` → `menu()` → `themeMenu('accent')(l)` | R | `\definecolor{lpAccent}{HTML}{…}` |

### Group: Fonts (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Body Font | S | `o.frole`+`o.m` → `menu()` → `fontRole('body', l)` | R | `\setmainfont{…}` + `\usepackage{fontspec}` |
| Heading Font | S | `o.frole`+`o.m` → `menu()` → `fontRole('heading', l)` | R | `\newfontfamily\headingfont{…}` |
| Display Font | S | `o.frole`+`o.m` → `menu()` → `fontRole('display', l)` | R | `\newfontfamily\displayfont{…}` |

### Group: Page Decoration (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Page Borders | S | `o.d` → `openD('decor:bd')` → `pdDialog('bd')` | R | eso-pic + tikz border layer in the managed `lplum:pd` block |
| Page Color | S | `o.d` → `openD('decor:bg')` → `pdDialog('bg')` | R | eso-pic filled-page layer + `\definecolor` (xcolor) in the same block |
| Watermark | S | `o.d` → `openD('decor:wm')` → `pdDialog('wm')` | R | eso-pic + tikz text node (`\lpWm`, `text opacity`, `rotate`, optional `\fontspec`) in the managed `lplum:pd` block |

### Group: Heading Design (4)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Heading Styles | L | `o.hd`+`o.m` → `menu()` → `headingApply({style:l})` | R | `\titleformat{\section}…` (titlesec) |
| Numbering | S | `o.hd`+`o.m` → `menu()` → `headingApply({num:l})` | R | `\setcounter{secnumdepth}{…}` |
| Heading Color (Design) | S | `o.role`+`o.m` → `menu()` → `themeMenu('heading')(l)` | R | `\definecolor{lpSection}{HTML}{…}` |
| Spacing | S | `o.hd`+`o.m` → `menu()` → `headingApply({space:l})` | R | `\titlespacing{\section}{…}` (titlesec) |

### Group: Document Identity (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Title Block | L | `o.d` → `openD('titleblock')` | D | `\title{…}\author{…}\date{…}\maketitle` |
| Author & Affiliation | S | `o.d` → `openD('titleblock')` | D | Same dialog as Title Block |
| Reset to Template | S | `o.rst` → `resetTemplate()` | R | Reverts preamble to embedded template baseline |

---

## References (19 controls)

### Group: Table of Contents (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Table of Contents | L | `o.toc`+`o.m` → `menu()` → `tocInsert(l)` | R | `\tableofcontents` |
| Update Table | S | `o.tu` → `tocUpdate()` | R | Re-runs `\tableofcontents` placeholder update in source |
| Configure Depth | S | `o.tocd`+`o.m` → `menu()` → `tocDepth(l)` | R | `\setcounter{tocdepth}{…}` |

### Group: Lists (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Insert List of Figures | S | `o.lof` → `listInsert('figures')` | R | `\listoffigures` |
| Insert List of Tables | S | `o.lof` → `listInsert('tables')` | R | `\listoftables` |
| Update Lists | S | `o.lou` → `listUpdate()` | R | Refreshes `\listoffigures`/`\listoftables` markers |

### Group: Footnotes (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Insert Footnote | L | `o.fn` → `fnInsert()` | R | `\footnote{…}` at cursor |
| Show Footnotes | L | `o.d` → `openD('footnotes')` | D | Panel listing footnotes; no direct LaTeX output |

### Group: Citations (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Insert Citation | L | `o.d` → `openD('cite')` | D | `\cite{key}` (or natbib/biblatex variant) |
| Manage Sources | S | `o.d` → `openD('bib')` | D | Bibliography manager; no direct LaTeX |
| Import references | S | `o.d` → `openD('bibimport')` | D | Multi-format reference importer (.bib, CSL JSON, RIS); merges into project .bib |
| Style (combo) | cb | `build()` → `citeStyle(label)` | R | biblatex: `\usepackage[style=apa\|vancouver\|chicago-authordate\|ieee]{biblatex}`; BibTeX: `\bibliographystyle{apalike\|unsrt\|chicago\|IEEEtran}`; refuses mixed/manual/no bibliography |

### Group: Bibliography (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Bibliography | L | `o.bib`+`o.m` → `menu()` → `bibMenu(l)` | R | `\bibliography{refs}` / `\printbibliography` |
| Update Bibliography | S | `o.bibu` → `bibUpdate()` | R | Runs BibTeX/biber and patches `.bbl` |
| Open Manager | S | `o.d` → `openD('bib')` | D | Same as Manage Sources |

### Group: Cross-references (5)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Insert Label | L | `o.lbl` → `lblDialog()` | R | `\label{…}` at cursor |
| Cross-reference | L | `o.xr` → `xrDialog('all')` | R | `\ref{…}` / `\eqref{…}` / `\autoref{…}` |
| Reference Figures | S | `o.xr` → `xrDialog('fig')` | R | `\ref{fig:…}` |
| Reference Tables | S | `o.xr` → `xrDialog('tab')` | R | `\ref{tab:…}` |
| Reference Equations | S | `o.xr` → `xrDialog('eq')` | R | `\eqref{eq:…}` |

---

## Review (11 controls)

### Group: Proofing (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Spelling | L | `o.t` + `o.a='spell'` → `ACT.spell` (saved pref `spell`) | NB | none (sets native `spellcheck` on the source editor; browser underlines misspellings) |
| Language | S | `o.lang` → `langMenu()` → `langSet()` (saved pref `lang`) | R | Sets the editor `lang` attribute; offers `\usepackage[opt]{babel}` (added via `ensurePackage`, or `opt` made the last/main option of an existing babel line). Arabic: `lang` only |
| Word Count | S | `o.wc` → `wordCountDialog()` / `wcStats()` | R | none (words, characters with/without spaces, paragraphs; ignores commands, comments, math; selection-only option) |

### Group: Comments (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| New Comment | L | `o.d` → `openD('comment')` | D | none (localStorage only) |
| Show Comments | S | `o.cmt` → `cmtShow(true)` | R | Shows comment markers in gutter (UI + CMT state) |
| Hide Comments | S | `o.cmt` → `cmtShow(false)` | R | Hides comment markers |

### Group: Changes (4)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Track Changes | L | `o.trk:'on'` → `trkToggle()` (baseline snapshot + Review pane) | UI | none (text unchanged until Reject) |
| Display Markup | S | `o.trk:'mode'` → `trkPick()` (All / Simple / No Markup, Reviewing Pane) | UI | none |
| Accept | S | `o.trk:'acc'` → `trkPick()` / `trkAct()` | R | none (baseline advances) |
| Reject | S | `o.trk:'rej'` → `trkPick()` / `trkAct()` | R | restores baseline text (one undo step) |

### Group: Comparison (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Compare | L | `o.d` → `openD('compare')` → `compareDialog()` | R | none (side-by-side line diff of the open file vs its saved copy or another project .tex file; Previous/Next difference, Ignore whitespace, per-hunk “Use other side” copies into the editor as one undo step; the other file is never written) |

---

## View (19 controls)

### Group: Workspace (4)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Stack Panes (was Split View) | L | `o.t`+`o.a='stack'` → ACT.stack → `prefSet`+`showApply()` | UI | none (source above PDF vs side by side; saved pref; divider drags vertically) |
| Source Pane | S | `o.t`+`o.a='src'` → ACT.src → `pane('.src', on)` | UI | none |
| PDF Pane | S | `o.t`+`o.a='pdf'` → ACT.pdf → `pane('.pdf', on)` | UI | none |
| Navigation Pane | S | `o.t`+`o.a='sidebar'` → ACT.sidebar → `toggleSidebar(on)` | UI | none |

> Split View was cosmetic-only, so it became **Stack Panes** (real layout toggle). Source/PDF pane buttons are unchanged.

### Group: PDF View (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| PDF View | S | `o.pv` → `pvAct('pdf', el)` | UI | none (PDF viewer mode) |
| Print Layout | S | `o.pv` → `pvAct('print', el)` | UI | none |
| Reading View | S | `o.pv` → `pvAct('read', el)` | UI | none |

### Group: Zoom (5)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Zoom In | S | `o.pv` → `pvAct('in', el)` | UI | none |
| Zoom Out | S | `o.pv` → `pvAct('out', el)` | UI | none |
| Fit Page | S | `o.pv` → `pvAct('page', el)` | UI | none |
| Fit Width | S | `o.pv` → `pvAct('width', el)` | UI | none |
| Page Navigation | S | `o.pvm`+`o.m` → `menu()` → `pvNav(l)` | UI | none |

### Group: Show (5)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Ruler | S | `o.t`+`o.a='ruler'` → ACT.ruler → `prefSet`+`showApply()` | UI | none |
| Page Boundaries | S | `o.t`+`o.a='pgb'` → ACT.pgb → `prefSet`+`showApply()` | UI | none |
| Break Markers | S | `o.t`+`o.a='brk'` → ACT.brk → `prefSet`+`ensureWindow()` | UI | none |
| Source Line Numbers | S | `o.t`+`o.a='ln'` → ACT.ln → `prefSet`+`rulerSync()` | UI | none |
| Find and Replace | S | `o.d` → `openD('find')` | D | none |

### Group: Appearance (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Light Mode | L | `o.t`+`o.a='light'` → ACT.light → `appearanceSet('light')` | UI | none |
| Dark Mode | L | `o.t`+`o.a='dark'` → ACT.dark → `appearanceSet('dark')` | UI | none |

---

## Help (8 controls)

### Group: Learn (3)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Documentation | L | `o.d` → `openD('docs')` | D | none |
| Getting Started | L | `o.d` → `openD('start')` | D | none |
| LaTeX Basics | L | `o.d` → `openD('basics')` | D | none |

### Group: Reference (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Package Reference | L | `o.d` → `openD('pkgref')` | D | none |
| Keyboard Shortcuts | L | `o.d` → `openD('shortcuts')` | D | none |

### Group: Support (2)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| Troubleshooting | L | `o.d` → `openD('trouble')` | D | none |
| Compilation Diagnostics | L | `o.d` → `openD('diag')` | D | none |

### Group: About (1)
| Label | Kind | Handler branch in wire() | Status | Resulting LaTeX |
|---|---|---|---|---|
| About | L | `o.d` → `openD('about')` | D | none |

---

## One-line wiring fixes applied (this session)

| Control | Old state | Fix | New handler opt |
|---|---|---|---|
| Home ▸ Clipboard ▸ Cut | PO (no opt) | Added `sel:'cut'` to TABS entry + `if(o.sel)` branch in `wire()` | `execCommand('cut')` on `#codeInput` |
| Home ▸ Clipboard ▸ Copy | PO (no opt) | Added `sel:'copy'` to TABS entry | `execCommand('copy')` on `#codeInput` |
| Home ▸ Editing & Proofing ▸ Select All | PO (no opt) | Added `sel:'selectAll'` to TABS entry | `execCommand('selectAll')` on `#codeInput` |

## Controls intentionally left as Preview-only (too complex for one line)

| Control | Reason |
|---|---|
| Home ▸ Font ▸ Increase/Decrease font size | Needs parse of `\fontsize{…}` or `\documentclass` size option; non-trivial |
| Home ▸ Font ▸ Underline | `\underline{…}` conflicts with word-wrap; requires `ulem` or `soul` + selection logic |
| Home ▸ Font ▸ Strikethrough | Needs `\sout{…}` from `ulem` package + fmtToggle-like wrapper |
| Home ▸ Font ▸ Clear formatting | Needs `fmtRange` multi-layer strip (remove all `\textbf`, `\textcolor`, etc.) |
| Home ▸ Font ▸ Change case | Multi-step regex; context-sensitive (protect math, commands) |
| Home ▸ Clipboard ▸ Paste | Async Clipboard API; needs `Paste Special` branch to strip LaTeX commands |
| Review ▸ Proofing ▸ Thesaurus / Translate / Previous Issue / Next Issue | Removed: no in-app thesaurus, translation or spell-check issue-navigation engine (Spelling uses the browser's native checker) |