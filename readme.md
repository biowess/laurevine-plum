# Laurevine Plum: frontend prototype

Interface-only prototype of a Word-style ribbon LaTeX editor (XeLaTeX), built on the geometry and CSS of the
supplied PowerPoint-style frontend (title bar 40 px, tabs 32 px, ribbon 96 px, status bar 26 px).
Plain HTML/CSS/vanilla JS, no build step, no dependencies to install.

## Run
**With real compilation (recommended):** `node server/server.js` from this folder, then visit http://localhost:5174
(set a different port with `node server/server.js 8080` or `PORT=8080 node server/server.js`). This requires a LaTeX
distribution (TeX Live, MacTeX or MiKTeX) with `xelatex` on your PATH; no npm install is needed, `server/server.js`
has no dependencies beyond Node's built-ins.

**Interface only, no Compile:** open `index.html` directly in a browser (works from `file://`), or
`python3 -m http.server 8000` and visit http://localhost:8000. Compile needs `server/server.js` running and will
report that it can't reach the compile server if you use either of these instead.

Spline Sans loads from the bundled `fonts/` folder, and Lucide (unpkg) loads from the network when available; otherwise system fonts and the bundled
`js/icons-fallback.js` are used.

## NOT implemented (by design)
No real file *writing* yet: Compile and the Project Explorer (see below) are the only two features that touch
real files/processes on your machine, and the explorer is read-only (opening a file reads it; there is no way yet
to write changes back to disk, so Save still only shows a "preview only" notice). No network requests to any
service beyond fonts/icons/the local compile server. Export and most ribbon Insert/Apply actions still only show
a "preview only" notice. The document outline and Styles gallery still run on frontend mock data, not a real
filesystem or a real compiled document.

## Compile (real)
Compile sends the editor's current LaTeX source to `server/server.js`, which writes it to a private, per-compile
temp directory (outside this repository) and runs `xelatex -interaction=nonstopmode -halt-on-error -no-shell-escape
-output-directory=<dir> main.tex` there (a second pass runs automatically if the log asks for one, to resolve
references/citations). The resulting PDF is streamed into the existing PDF preview pane and the preview refreshes on
every recompile; a failed compile shows the compiler's log in that pane instead, and the source editor is never
touched. Missing/timed-out compiles and an unreachable server are all reported the same way rather than left to
crash or hang the interface.

## Working interface behaviours
Tab switching, File backstage, menus/dropdowns/popovers (click to open, click again or outside or Esc to close,
flip near screen edges), dialogs (Esc / × / backdrop to close), Package Information modal, pane divider drag,
show/hide source/PDF pane, line-number toggle, light/dark mode, plus (this pass):
- **Styles gallery** (Home ribbon): a real dropdown with a typographically distinct preview per style (Normal,
  Title, Subtitle, Chapter, Section, Subsection, Subsubsection, Paragraph, Quote, Code/Listing). Selecting a style
  updates the ribbon trigger. Previews are generic CSS approximations, not a compiled rendering of any document
  class, the data shape is ready for a backend to swap in document-aware previews later.
- **Font color icon**: corrected to a plain "A" with a single color swatch underneath (no stray underline); the
  swatch updates when a color is chosen from the menu.
- **Sidebar** (Project Explorer + Document Navigation): toggle from the title bar or View ▸ Navigation Pane.
  The Project Explorer is a real file tree now (see "Project Explorer (real filesystem)" below); the document
  outline is still mock chapter/section data tied to the sample source. The two sections are independently
  collapsible with a draggable divider between them. Selecting an outline entry scrolls/selects the matching
  line in whichever source is currently open, when a matching line exists.
- **Find & Replace**: a compact floating panel (not a modal) anchored to the bottom of the source pane. Real
  search/replace against the in-memory sample LaTeX source: case-sensitive and whole-word toggles, match count,
  next/previous navigation, replace current/replace all, Enter/Shift+Enter/Esc/Ctrl+F shortcuts. Matches are
  highlighted at the line level using the editor's existing line-decoration classes (no HTML is injected into the
  tokenized source markup).

- **Layout**: sidebar (Project Explorer + Document Navigation) is the far-left column; the source editor and PDF preview sit side by side in the main area to its right, with a draggable divider. Hiding either pane lets the other fill the area.
- **Project rename**: click the project name in the title bar to edit it inline (Enter/blur saves, Esc cancels). This only relabels the title bar, the root row in the Project Explorer and the PDF pane header, it's a display label, not a real rename of anything on disk.

## File access (no browser permission prompt)
When the app is run through `node server/server.js` (the recommended way, see "Run"), opening and saving files works the way it does in
Word or PowerPoint: **Open Folder**, **Open File**, **Save As** and the diagram importer show Plum's own picker dialog, and the app reads and
writes your files directly through the local server. The browser's "Allow localhost to edit files in this folder?" prompt never appears,
the reconnect step after a reload is gone, and it works in any browser (Firefox and Safari included), not only Chromium.
- **How it works:** `js/fs-bridge.js` replaces `showDirectoryPicker` / `showOpenFilePicker` / `showSaveFilePicker` with the in-app picker and returns
  handles with the same methods the app already used (`getFile`, `createWritable`, `entries`, `getFileHandle`, `getDirectoryHandle`, `removeEntry`, …),
  so the Project Explorer, editor, citations and diagrams code is unchanged. The handles talk to the `/api/fs/*` endpoints in `server/server.js`.
- **What the app can touch:** the picker can *browse* any folder on your computer (names only), but reading, writing, creating and deleting are limited to
  folders and files you have chosen through the app. Those choices ("grants") are remembered in `~/.laurevine-plum/fs-grants.json`, so recent projects reopen
  without asking again. Delete that file, or use *Clear list* in Recent Projects and remove its entries from the file, to revoke access.
- **Protection:** the file API only answers requests from the machine running the server, with a localhost `Host` header and the app's `X-Plum` header, so web
  pages opened in your browser can't use it.
- **Without the server** (`index.html` opened from `file://` or a plain static server) the browser's own File System Access pickers and permission prompts are used
  as before, in Chromium browsers only.

## Project Explorer (real filesystem)
The Project Explorer is backed by the browser's File System Access API (`showDirectoryPicker`,
`FileSystemDirectoryHandle`/`FileSystemFileHandle`), it's a Chromium-only API (Chrome, Edge, Opera, etc.); other
browsers get a one-line "not supported" message in the sidebar instead of a fake tree. No backend involvement and
no new dependency: this is entirely client-side JavaScript.
- **Opening a project**: click "Open Folder…" in the empty sidebar state, or File ▸ Open ▸ "Open…". Folders load
  lazily (contents are only read when a folder is expanded, or when the root is first opened); hidden entries
  (names starting with `.`) are skipped. If the opened folder has a `.tex` file at its top level, the first one
  (alphabetically) is opened into the editor automatically.
- **Opening a file**: clicking a `.tex`/`.bib`/`.sty`/`.cls`/`.bst`/`.txt`/`.md`/other text-like file reads its
  real contents into the editor (reusing the existing `wireEditorInput`/`renderCode` pipeline). Clicking an image,
  PDF, or other non-text file shows a toast explaining it can't be opened in the text editor, rather than silently
  doing nothing or faking a preview.
- **Switching between files**: each file's latest in-editor text is kept in an in-memory cache
  (`fileCache`, keyed by path) for the rest of the session, so clicking between files doesn't lose edits you've
  made since opening the project. This cache is **not** written to disk, there's no Save-to-real-file wiring in
  this pass (see "NOT implemented" above), so a full page reload loses any unsaved edits, same as before.
- **Reopening the app**: the app starts on the welcome screen with Recent Projects to reopen from. The chosen directory handle is persisted in IndexedDB (`lplum-fs` database; a one-time
  migration copies it over from the older `latex-studio-fs` database if that's still what's on disk), and
  on reload the app silently reattaches if the browser still reports read permission as granted. If the browser
  needs a fresh user gesture to reconfirm permission (common after a reload), the sidebar shows a "Reconnect"
  button naming the previously-opened folder instead of silently failing or re-prompting unprompted.

## Update notifications (not an updater)

On every launch, a few seconds after the window appears, the app fetches `plum.json` (repository root, raw GitHub URL set as
`MANIFEST_URL` in `server/update-check.js`) and, if it describes a newer compatible release, shows an *Update available* dialog:
**Install now** (opens the download page in your browser), **Remind me later** (asks again next launch), **Not now** (never
shown again for that version; a newer version is). Nothing is downloaded or installed. Any failure (offline, bad JSON, a missing
field, no link for this platform) silently shows nothing. The per-user choice lives in `<userData>/update-state.json`.

**Publishing a release:** upload the installers, then edit `plum.json` and commit it:

```json
{
  "version": "1.2.0",
  "name": "Laurevine Plum",
  "releaseDate": "2026-11-14",
  "minimumSupportedVersion": "1.0.0",
  "releaseNotes": "### What's new\n- **Markdown** release notes\n- Another change",
  "downloads": {
    "linux": "https://github.com/biowess-dev/LPLUM/releases/tag/v1.2.0",
    "windows": "https://github.com/biowess-dev/LPLUM/releases/tag/v1.2.0"
  }
}
```

`version` must be higher than the installed `package.json` version (semantic versioning). Installed versions *older* than
`minimumSupportedVersion` are not notified, so raise it only deliberately. Links must be https on `github.com` or
`biowess-dev.github.io` (`ALLOWED_HOSTS`). Release notes accept basic Markdown (headings, bold, italic, code, lists, quotes,
https links); HTML is shown as text. Keep `plum.json` at the previous release's values until its installers are published.

## Files
- `index.html` shell · `css/styles.css`, `css/components.css` (reference design system, recoloured to indigo `#50466F`) · `css/latex.css` (editor, PDF page, dark theme, paragraph-group/Styles/Find/sidebar/Compile additions)
- `js/app.js`: product name and version (`APP_NAME`, `APP_VERSION`), ribbon definition (`TABS`), dialogs (`D`), package data (`PK`), mutable sample source (`SRC`), PDF markup (`PAGE`), styles gallery (`STYLES`), real Project Explorer backed by the File System Access API (`PROJECT`, `listDir`, `openProjectFolder`, `loadProjectFromHandle`, `openFileNode`, `toggleFolder`, `restoreProject`/`reconnectProject`, the tiny `idbOpen`/`idbGet`/`idbSet` IndexedDB helpers), mock document outline (`OUTLINE`), Find & Replace (`FIND`, `runFind`, `replaceCurrent`, `replaceAllMatches`), real editing (`wireEditorInput`), Compile (`runCompile`)
- `server/server.js`: dependency-free Node backend: serves this folder and exposes `POST /api/compile` / `GET /api/pdf/:id`, running `xelatex` via `child_process.execFile` in a temp working directory per compile, plus the local file API (`/api/fs/*`, see "File access")
- `js/fs-bridge.js`: in-app Open/Save picker and server-backed file handles (see "File access")

## Help docs

`Help > Learn` (Documentation, Getting Started, LaTeX Basics) renders the Markdown files in `docs/` with a small built-in renderer (`mdRender` in `js/app.js`). Edit those files to change the content; relative links and image paths resolve against the Markdown file's own folder.