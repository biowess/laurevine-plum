# Documentation

**Laurevine Plum** is a Word-style ribbon editor for LaTeX. You edit LaTeX source on the left, press **Compile**, and see the real PDF on the right. Ribbon buttons write ordinary LaTeX into your source, so nothing is hidden and nothing locks you in.

New here? Start with [Getting Started](getting-started.md). Unsure about the language itself? See [LaTeX Basics](latex-basics.md).

## How it works

- The **source pane** holds plain LaTeX. Ribbon buttons, dialogs and styles insert or edit that text.
- **Compile** sends your project to the local compile server, which runs a real TeX engine and returns a PDF.
- The **PDF pane** shows the result, or the compiler log if the build failed.
- Your files stay on your machine. The only network traffic is to the local compile server (plus fonts and icons when available).

## Requirements

| Need | For |
| ---- | --- |
| Node.js | Running `server/server.js` (no `npm install` needed) |
| A TeX distribution (TeX Live, MacTeX or MiKTeX) | Compiling. `xelatex` must be on your PATH; `lualatex`, `pdflatex`, `bibtex` and `biber` are used when your document asks for them |
| Chrome, Edge or another Chromium browser | Opening real project folders and saving back to disk |
| Python 3 with Matplotlib | Only the Insert ▸ Chart feature |

Start the server with `node server/server.js` and open `http://localhost:5174`. Use `node server/server.js 8080` or `PORT=8080` for another port. Opening `index.html` directly gives you the interface but **Compile will not work**.

## The interface

| Area | What it does |
| ---- | ------------ |
| Title bar | Project name (click to rename the label), undo/redo, sidebar toggle, command search (Ctrl/⌘ + K) and Compile |
| Ribbon | Eight tabs: Home, Insert, Layout, Design, References, Review, View, Help |
| Sidebar | **Project Explorer** (file tree) and **Document Navigation** (outline of your headings), each collapsible |
| Source pane | The LaTeX editor with syntax colours, optional line numbers and a gutter for errors and comments |
| PDF pane | Compiled preview with zoom, thumbnails and view modes |
| Status bar | Compile state, problem count and document information |

Drag the divider between the panes to resize them. Panes and the sidebar can be hidden from the View tab.

## Working with projects and files

- **Open a folder** with File ▸ Open (or *Open Folder…* in the sidebar). Folders load lazily and hidden entries (starting with `.`) are skipped.
- Click a `.tex`, `.bib`, `.sty`, `.cls`, `.bst`, `.txt` or `.md` file to edit it. Images and PDFs cannot be opened in the text editor.
- **Main file:** Compile builds the project's main file. If the folder has several files with `\documentclass`, you are asked once; change it any time with *Set as main file* in the explorer's context menu. The main file shows a badge.
- **Save** (Ctrl/⌘ + S) writes to disk; **Save As** (Ctrl/⌘ + Shift + S) saves a copy. Browsers without folder access fall back to downloading a `.tex` file.
- **Unsaved changes** are guarded by a Save / Don't Save / Cancel prompt before any action that would replace your document.
- **Crash recovery:** drafts are kept in the browser, and on next launch you are offered *Restore unsaved work*. An optional **Autosave to disk** (off by default, every 30 s) is in Preferences.
- Renames and deletions made outside the app are detected and the tree refreshes.
- **New document** and **New from template** are in the File menu and the Welcome panel. Recent projects are listed there too.

## Compiling

Press **Compile** or Ctrl/⌘ + Enter.

- **Engine:** chosen by a first-lines comment such as `% !TEX program = xelatex`. Supported: `xelatex`, `lualatex`, `pdflatex`. If absent, your *Default compiler* preference is used.
- **Passes:** repeated automatically until references and the table of contents settle (up to 4).
- **Bibliography:** BibTeX or Biber is detected from your preamble and run for you.
- **Safety:** shell escape is disabled, so packages that need it (such as `minted`) will not work. Use `listings` instead.
- **Cancel** an in-progress build with the Cancel button. After an edit, the PDF is marked **Out of date**.
- **Auto-compile after pause** (Preferences) rebuilds about 2 seconds after you stop typing.
- **On failure** the PDF pane shows the log and the **Problems panel** opens, listing errors, warnings and overfull boxes. Click a row to jump to that file and line; gutter markers flag the lines. Filter errors and warnings with the toggles. Help ▸ Compilation Diagnostics gives the raw details.

## The PDF viewer

Zoom in or out, fit page or width, jump between pages, and toggle page thumbnails. Modes: **PDF View**, **Print Layout** and **Reading View**. Ctrl/⌘ + scroll (or pinch) zooms. Scroll position and zoom are kept across recompiles.

## Exporting

From the File menu: **Export PDF** (reuses a fresh compile or builds one), **Export Project ZIP** (sources, `.bib`, figures and assets, without build files) and **Export single .tex**. ZIPs are also saved to `~/Laurevine Plum Exports` (change with the `LAUREVINE_PLUM_OUTPUT` environment variable).

## Ribbon tour

Every ribbon control writes real LaTeX, opens a dialog, or changes the view. Packages are added to the preamble once, automatically.

| Tab | Main groups | Notes |
| --- | ----------- | ----- |
| **Home** | Undo, Clipboard, Font, Paragraph, Styles, Editing | Bold, italic, underline, strikethrough, sub/superscript, colour, highlight, font and size, change case, clear formatting, Format Painter, lists, alignment, indents, line spacing, Find/Replace, Select All, Proofing |
| **Insert** | Breaks, Links, Footnote, Comments, Tables, Illustrations, Contents, Header & Footer, Equations, Symbols, Charts & Diagrams | Page, column and section breaks; hyperlinks; table builder; pictures and figures; equation editor; symbol picker; charts; flow diagrams |
| **Layout** | Page Setup, Columns & Breaks, Paragraph, Pagination, Source Display | Margins, orientation, paper size, columns, numeric paragraph spacing, keep-with-next, widow/orphan control |
| **Design** | Document Classes, Templates, Colors, Fonts, Page Decoration, Heading Design, Document Identity | Document class gallery, templates, colour roles, font roles, borders, page colour, watermark, heading styles, numbering, title block |
| **References** | Contents, Lists, Footnotes, Citations, Bibliography, Cross-references | Table of contents and depth, lists of figures and tables, citation picker, source manager, importer, bibliography style, labels and references |
| **Review** | Proofing, Comments, Changes, Comparison | Spelling, language, word count, comments, track changes, side-by-side compare |
| **View** | Workspace, PDF View, Zoom, Show, Appearance | Pane toggles, stack panes, PDF modes, ruler, line numbers, light/dark mode |
| **Help** | Learn, Reference, Support, About | These guides, package reference, shortcuts, troubleshooting, diagnostics |

Many buttons act on the **current selection** or on the **paragraph at the cursor**. Paragraph commands are tagged with a trailing `%lp` comment so the app can find and change them later; leave those comments in place.

## Key features in detail

### Styles and themes
The **Styles** gallery on Home applies Normal, Title, Subtitle, Chapter, Section, Subsection, Subsubsection, Paragraph, Quote or Code. **Design** changes the whole document: document class, colour roles (body, heading, accent), body/heading/display fonts, heading appearance and numbering, page colour, borders and watermarks. *Reset to Template* restores the preamble of the template you started from.

### Equations and symbols
**Equation** inserts inline `$…$`, display `\[…\]` or `align`. The **Equation Editor** builds formulas visually and inserts LaTeX. The **Symbol** dialog inserts a Unicode glyph in text, or the proper command (such as `\alpha` or `\leq`) inside math; symbols with no math command are refused rather than inserted wrongly.

### Tables, pictures and figures
The **Table** dialog supports Booktabs rules and a header row, and converts selected tab-separated text. Put the cursor in an existing table and the dialog reopens as *Edit Table*. **Picture** and **Figure** import PNG, JPEG or PDF files into `figures/` (25 MB limit, verified by file signature), reuse identical files, and offer placement choices. A project folder must be open to copy files.

### Charts
**Insert ▸ Chart** uses Matplotlib to draw line, scatter, bar, histogram, box and heatmap charts from a spreadsheet grid (CSV import detects delimiters, quotes and decimal commas). Options include variants (for example stacked bars or a regression fit), colour palettes, themes and axis ranges. Output is saved as `figures/<name>.png`/`.pdf` with a `.chart.json` sidecar. Put the cursor on such a figure to edit it again with *Update in document*.

### Flow diagrams
**Insert ▸ Flow Diagram** is a visual editor (shapes, connectors with labels, resize, snap-to-grid, zoom, pan, undo/redo, duplicate) that generates **TikZ**. Copy the code or insert it with the needed TikZ libraries added. Diagrams save as `figures/<name>.diagram.json`; hand-edited code is flagged as *Manually edited (locked)* until you clear the lock.

### Citations and bibliographies
Manage sources in a **Citation Library** with required-field checks, duplicate detection and a key generator. Import `.bib`, CSL JSON or RIS files, or resolve a DOI. **Insert Citation** produces `\cite`, `\citep` or `\textcite` to match your package (natbib or biblatex). The **Style** box edits `style=` for biblatex or `\bibliographystyle` for BibTeX. **Update Bibliography** runs BibTeX/Biber for you.

### Cross-references, contents and footnotes
Insert labels, then pick targets for `\ref`, `\eqref` or `\autoref` from a list (all, figures, tables, equations). Table of contents (with depth setting), lists of figures/tables and footnotes are one click each.

### Find and Replace
A floating panel (Ctrl/⌘ + F, or Ctrl/⌘ + H) with case, whole-word and regex options, an "n of m" counter, *In selection*, and `$1`/`$&` groups in regex mode. Replace All is a single undo step. Shortcuts: Enter / Shift + Enter for next/previous, F3 / Shift + F3, Esc to close.

### Comments, track changes and compare
- **Comments** attach to text, can be resolved, reopened and filtered, and are stored in the browser (not inside your `.tex`). If their text disappears they show as *Detached* and re-attach if it returns.
- **Track Changes** snapshots a baseline and shows word-level changes in a review pane with Accept/Reject (per change or all). Display modes: All, Simple, No Markup. Reject restores the baseline text as one undo step.
- **Compare** shows a side-by-side diff of the open file against its saved copy or another project `.tex`, with next/previous difference, *Ignore whitespace* and per-change *Use other side*. The other file is never modified.

### Document navigation
The sidebar outline lists `\part` through `\subparagraph` (ignoring comments and verbatim blocks), follows your cursor, supports filtering, and jumps to a heading when clicked.

### Command search
Ctrl/⌘ + K searches every ribbon command, File action and project file. Selecting a ribbon result switches tab and runs the real button.

### Word count
Review ▸ Word Count reports words, characters (with and without spaces) and paragraphs. LaTeX commands, comments and math are ignored; you can limit it to the selection.

## Preferences and appearance

File ▸ Preferences (backstage) and View ▸ Appearance: light, dark or system theme, editor font size, tab width, line numbers, compile on save, autosave to disk, auto-compile after pause, default compiler and default body font. Defaults apply to **new** documents only; a document that names its own compiler or `\setmainfont` is never changed. Preferences are remembered in the browser.

## Templates

Design ▸ Templates and File ▸ New from Template provide: **Simple Homework**, **Academic Article**, **Sample Article**, **Laboratory Report**, **Research Manuscript** (double-spaced, line-numbered) and **Book / Long Report**. Add your own by dropping a `.tex` file into `templates/` and registering it in `templates/templates.js`.

## Keyboard shortcuts

| Action | Shortcut |
| ------ | -------- |
| Save / Save As | Ctrl/⌘ + S / Ctrl/⌘ + Shift + S |
| Compile | Ctrl/⌘ + Enter |
| Command search | Ctrl/⌘ + K |
| Find / Replace | Ctrl/⌘ + F / Ctrl/⌘ + H |
| Undo / Redo | Ctrl/⌘ + Z / Ctrl/⌘ + Y or Ctrl/⌘ + Shift + Z |
| Close dialog, menu or panel | Esc |
| Add or save a comment | Ctrl/⌘ + Enter |

Help ▸ Keyboard Shortcuts lists them all and is searchable.

## Limitations

- Compile needs the local server and a TeX installation; the browser alone cannot compile.
- Real folder access (open, save back to disk) needs a Chromium browser.
- Chart needs Python 3 with Matplotlib; Flow Diagrams and everything else do not.
- Shell escape is off, so `minted` and similar packages are unavailable.
- Comments and track-changes baselines live in the browser, not in your files.
- SVG images cannot be included directly with XeLaTeX; convert them to PDF or PNG.

## Getting help

- **Help ▸ Troubleshooting:** searchable fixes for compile errors, missing packages, fonts, citations and server problems.
- **Help ▸ Package Reference:** short descriptions of about a hundred common packages.
- **Help ▸ Compilation Diagnostics:** details of the last compile.
