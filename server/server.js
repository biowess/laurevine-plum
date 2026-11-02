/*
 * server.js, minimal, dependency-free backend for Laurevine Plum.
 *
 * Serves the static frontend (index.html, css/, js/) and adds two endpoints that compile the
 * current editor source with the XeLaTeX installation available on this machine:
 *
 *   POST /api/compile        body: { "main": "path/to/main.tex", "files": [{ "path", "text" | "b64" }, ...] }
 *                             (or the legacy { "source": "<latex source>" } for a single unsaved document)
 *                             optional "bib": true also runs bibtex/biber + re-pass loop and adds bib: { ok, tool, message, warnings, log } to the reply
 *                             -> 200 { ok: true,  pdfUrl: "/api/pdf/<id>", log: "<tail of the run>", errors: ["<! lines>"] }
 *                             -> 200 { ok: false, error: "<message>", log: "<tail of the run>", errors: ["<! lines>"] }
 *   POST /api/export-zip     body: same bundle as /api/compile plus "name" -> application/zip (also copied to the output folder)
 *   POST /api/open-output    opens the output folder (LAUREVINE_PLUM_OUTPUT, or the legacy LATEX_STUDIO_OUTPUT, or ~/Laurevine Plum Exports) in the OS file manager (localhost only)
 *   GET  /api/pdf/:jobId      -> the compiled PDF (application/pdf), or 404 if it isn't there
 *   POST /api/chart          body: { spec: {type (line|scatter|bar|histogram|box|heatmap), title, xlabel, ylabel, legend, grid, bins, columns, rows}, format: "png"|"svg"|"pdf", dpi }
 *                             -> 200 { ok: true, format, b64 } | { ok: false, error }   (runs server/chart.py with Python 3 + Matplotlib)
 *
 * No npm dependencies, only Node's built-in http/fs/child_process modules. Uses execFile with an
 * argument array (never a shell string), so nothing in the LaTeX source can be interpreted as a
 * shell command. Each compile writes its own copy of the source into a fresh, uniquely-named
 * directory under the OS temp folder (kept separate from this repository and from any file the
 * user has open), runs the compiler there with a hard timeout, and is torn down independently of
 * every other compile.
 *
 * Run with:  node server/server.js [port]      (defaults to 5174, or $PORT)
 * Embedded: the Electron shell (main.js) require()s this file and calls start(port, host) / stop(); nothing listens at load time.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { compileArgs, resolveCompiler, locateCompiler } = require('./latex-detect');

const ROOT = path.join(__dirname, '..');                                   // the frontend folder (index.html, css/, js/)
// Packaged Electron app: child processes (python, xelatex) cannot read inside app.asar. For files handed to them, use the
// `app.asar.unpacked` twin when packaging unpacked it (asarUnpack: server/chart.py, fonts/**). Unchanged when not packaged.
function diskPath(p) { const u = p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2'); return u !== p && fsExists(u) ? u : p; }
// Bundled fonts folder. Packaged, asarUnpack puts fonts/ in app.asar.unpacked (XeLaTeX needs real files), so the catalogue is read from that
// real folder with plain fs, never through the asar emulation (fs.accessSync() on a DIRECTORY inside app.asar reports ENOENT, which made
// bundledFonts() conclude there was no fonts/ folder and report every bundled family as missing). Found relative to this file, not the cwd.
const FONTS_DIR = diskPath(path.join(ROOT, 'fonts'));
function fontFileOk(p) { try { const s = fs.statSync(p); return s.isFile() && s.size > 0; } catch (e) { return false; } }   // accessible, a real file, not an empty placeholder
const TMP_ROOT = path.join(os.tmpdir(), 'laurevine-plum-compiles');       // never inside the repo or the user's document
const COMPILER = 'xelatex';                                                // fallback engine; a document's `% !TEX program` line or the client's Default Compiler preference can pick LuaLaTeX instead
const ENGINES = { xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX', pdflatex: 'pdfLaTeX' };
const PROGRAM_RE = /^[ \t]*%\s*!TEX\s+(?:TS-)?program\s*=\s*(\S+)/im;
// Engine for one compile: the main file's own `% !TEX program` line wins (an unsupported value keeps the old XeLaTeX behaviour);
// only a main file that names no program uses the client's Default Compiler preference.
function pickEngine(mainData, preferred) {
  const m = PROGRAM_RE.exec(mainData.toString('utf8').split('\n').slice(0, 30).join('\n'));
  if (m) { const v = m[1].toLowerCase(); return ENGINES[v] ? v : COMPILER; }
  return ENGINES[String(preferred).toLowerCase()] ? String(preferred).toLowerCase() : COMPILER;
}
const COMPILE_TIMEOUT_MS = 90000;
const MAX_BODY_BYTES = 60 * 1024 * 1024;                                    // ceiling for a whole project bundle (images are base64-encoded)
const MAX_FILES = 500;
const JOB_ID_RE = /^[a-f0-9]{32}$/;
const PY_CANDIDATES = process.env.PYTHON ? [process.env.PYTHON] : (process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']);
const CHART_TIMEOUT_MS = 20000;
const PY_MISSING = 'Charts need Python 3 with Matplotlib, but Python 3 was not found. Install Python 3, run “pip install matplotlib”, make sure it is on your PATH (or set the PYTHON environment variable), then restart the server.';
const PY_OLD = 'Charts need Python 3, but the Python found on this computer is too old. Install Python 3 or set the PYTHON environment variable to it, then restart the server.';
const OUTPUT_DIR = process.env.LAUREVINE_PLUM_OUTPUT || process.env.LATEX_STUDIO_OUTPUT || path.join(os.homedir(), 'Laurevine Plum Exports');   // where export copies are saved and what "Open Output Folder" opens (LATEX_STUDIO_OUTPUT kept as a legacy fallback)
const PORT = Number(process.argv[2] || process.env.PORT || 5174);

// Bundled fonts (fonts/fonts.css is the catalog). XeTeX resolves system fonts by name only on some platforms, so for the
// COMPILE COPY of each .tex file, \fontspec{Bundled Family} is rewritten to load the family's font files by relative path
// (copied into the job folder). The user's source is never touched, and fonts that aren't bundled resolve as system fonts.
function bundledFonts() {   // family -> [{ file, lo, hi, it }]
  const m = new Map(), fdir = FONTS_DIR;
  try { if (!fs.statSync(fdir).isDirectory()) return m; } catch (e) { return m; }
  let css = '';
  try { css = fs.readFileSync(path.join(fdir, 'fonts.css'), 'utf8'); } catch (e) {}
  if (css) {
    for (const b of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
      const f = /font-family:\s*'([^']+)'/.exec(b), u = /url\('\.\/([^']+)'\)/.exec(b), w = /font-weight:\s*(\d+)(?:\s+(\d+))?/.exec(b);
      if (!f || !u || !fontFileOk(path.join(fdir, u[1]))) continue;
      if (!m.has(f[1])) m.set(f[1], []);
      m.get(f[1]).push({ file: u[1], lo: +(w ? w[1] : 400), hi: +(w ? w[2] || w[1] : 400), it: /font-style:\s*italic/.test(b) });
    }
  }
  try {
    const known = new Set();
    for (const arr of m.values()) for (const x of arr) known.add(x.file);
    const scan = (d, rel) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        if (ent.name.startsWith('.')) continue;
        const subRel = rel ? rel + '/' + ent.name : ent.name;
        if (ent.isDirectory()) scan(path.join(d, ent.name), subRel);
        else if (/\.(ttf|otf)$/i.test(ent.name) && !known.has(subRel) && fontFileOk(path.join(d, ent.name))) {
          const base = path.basename(ent.name, path.extname(ent.name)), clean = base.replace(/\[[^\]]*\]/g, '');
          const it = /italic|slnt/i.test(base), isBd = /bold|black/i.test(base);
          const wt = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 }[clean.split('-').pop().replace(/italic$/i, '').toLowerCase()];   // static instance named for its weight: exact weight, so Regular (400) is never tied with Medium and Bold (700) never with SemiBold
          const lo = wt || (isBd ? 700 : 400), hi = wt || (isBd ? 900 : (/\[/.test(base) ? 900 : 400));
          let fam = rel ? rel.split('/')[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
          if (!fam) fam = clean.split('-')[0].replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
          if (fam) {
            let key = fam;
            for (const k of m.keys()) { if (k.toLowerCase() === fam.toLowerCase()) { key = k; break; } }
            if (!m.has(key)) m.set(key, []);
            m.get(key).push({ file: subRel, lo, hi, it });
            known.add(subRel);
          }
        }
      }
    };
    scan(fdir, '');
  } catch (e) {}
  return m;
}
function useBundledFonts(data, job) {
  const text = data.toString('utf8'); if (!/\\(?:fontspec|setmainfont|setsansfont|setmonofont|newfontfamily)/.test(text)) return data;
  const fam = bundledFonts(), copied = job.fontCopied || (job.fontCopied = new Map());   // per job, not per file: every .tex/.sty/.cls shares the same __fonts/ folder, so the f0, f1... names must not restart for each file
  const out = text.replace(/\\(fontspec|setmainfont|setsansfont|setmonofont|newfontfamily\\[a-zA-Z]+)(?:\[([^\]]*)\])?\{([^{}]+)\}/g, (all, cmd, userOpts, name) => {
    const family = fam.get(name.trim()); if (!family) return all;
    const faces = family.filter((x) => !/\[[^\]]*\]/.test(x.file));   // variable-axis files (Family[wght].ttf) are never handed to TeX: only the static instances are used
    const pick = (it, want) => faces.filter((x) => x.it === it).sort((x, y) => Math.abs(x.lo - want) - Math.abs(y.lo - want) || (y.lo <= want && want <= y.hi) - (x.lo <= want && want <= x.hi) || x.file.length - y.file.length)[0];   // ties (the catalog mislabels some weights): shortest file name = the plain style
    const up = pick(false, 400), bd = pick(false, 700), it = pick(true, 400), bi = pick(true, 700);
    if (!up) throw new Error('The bundled font "' + name.trim() + '" has no static upright font file in fonts/ (variable font files are not used for LaTeX), so it cannot be loaded.');
    const use = (f) => {   // copy to a bracket-free name so fontspec can take it as a plain file name
      if (!copied.has(f.file)) {
        fs.mkdirSync(path.join(job.src, '__fonts'), { recursive: true });
        const n = 'f' + copied.size + path.extname(f.file); fs.copyFileSync(diskPath(path.join(ROOT, 'fonts', f.file)), path.join(job.src, '__fonts', n)); copied.set(f.file, n);
      }
      return copied.get(f.file);
    };
    const o = ['Path=./__fonts/'];
    if (bd && bd !== up) o.push('BoldFont=' + use(bd)); else o.push('AutoFakeBold=1.5');   // no separate static bold file
    if (it) { o.push('ItalicFont=' + use(it)); if (bi && bi !== it) o.push('BoldItalicFont=' + use(bi)); } else o.push('AutoFakeSlant=0.2');
    if (userOpts && userOpts.trim()) o.push(userOpts.trim());   // the document's own options (e.g. Scale=MatchLowercase) are kept, and come last so they win
    return '\\' + cmd + '[' + o.join(',') + ']{' + use(up) + '}';
  });
  return Buffer.from(out, 'utf8');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8', '.gif': 'image/gif', '.webp': 'image/webp'
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers || {}));
  res.end(body);
}
function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { code: 'TOO_LARGE' })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fsExists(p) { try { fs.accessSync(p); return true; } catch (e) { return false; } }

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const full = path.normalize(path.join(ROOT, rel));
  const relToRoot = path.relative(ROOT, full);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return send(res, 403, 'Forbidden');
  try {
    const stat = await fsp.stat(full);
    if (stat.isDirectory()) return serveStatic(req, res, path.posix.join(rel, 'index.html'));
    const data = await fsp.readFile(full);
    send(res, 200, data, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
  } catch (e) {
    send(res, 404, 'Not found');
  }
}

function tail(text, maxChars) {
  text = String(text || '');
  return text.length > maxChars ? '…(truncated)…\n' + text.slice(-maxChars) : text;
}

// Pull the lines LaTeX engines actually flag as problems out of a (often very long, very verbose)
// compiler log, so the panel in the UI shows something a person can read instead of the full log.
function extractUsefulLog(raw) {
  if (!raw) return '';
  const lines = String(raw).split(/\r?\n/);
  const interesting = lines.filter((l) => /^!|^l\.\d+|Emergency stop|Fatal error|Undefined control sequence|Error:|Warning:/.test(l));
  return tail((interesting.length ? interesting : lines.slice(-40)).join('\n'), 4000);
}

// Reject anything that could escape the job folder or be mistaken for a compiler option.
function safeRel(p) {
  if (typeof p !== 'string' || !p || p.length > 300 || /[\0\\]/.test(p)) return null;
  const n = path.posix.normalize(p);
  if (n === '..' || n.startsWith('../') || path.posix.isAbsolute(n) || n.startsWith('-') || /^[a-zA-Z]:/.test(n)) return null;
  return n;
}

// Sources live in <job>/src (preserving the project's relative paths); every compiler artifact
// (aux/log/out/pdf) goes to <job>/build, so nothing the compiler writes can overwrite a user file.
function runCompiler(job, mainRel) {
  const args = compileArgs(job.build, mainRel);   // shared with verifyCompiler in latex-detect.js
  return new Promise((resolve) => {
    try {   // spawn failures (ENOENT/EACCES) arrive in the callback; a synchronous throw must not escape either
      execFile(job.bin, args, { cwd: job.src, timeout: COMPILE_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ error, stdout: stdout || '', stderr: stderr || '', exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0 });
      });
    } catch (error) { resolve({ error, stdout: '', stderr: '', exitCode: null }); }
  });
}

// Bibliography pass (only when the client asks for it via { bib: true }): runs bibtex (BibTeX documents) or biber (biblatex
// documents, which write main.bcf) in the build folder, then the caller re-runs XeLaTeX. Reports a real outcome, never assumed.
function runTool(cmd, args, cwd, env) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, env, timeout: COMPILE_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function bibPass(job, mainRel) {
  const auxPath = path.join(job.build, 'main.aux');
  let tool = null, mainText = '';
  try { mainText = await fsp.readFile(path.join(job.src, mainRel), 'utf8'); } catch (e) { /* best-effort */ }
  const bl = /\\usepackage(?:\[([^\]]*)\])?\{[^}]*\bbiblatex\b[^}]*\}/m.exec(mainText);
  if (bl) {
    const bk = bl[1] && /\bbackend\s*=\s*(bibtex|biber)\b/i.exec(bl[1]);
    tool = bk ? bk[1].toLowerCase() : 'biber';
  } else if (/\\(bibliography|bibliographystyle)\b/m.test(mainText) || /\\usepackage(?:\[[^\]]*\])?\{[^}]*\bnatbib\b[^}]*\}/m.test(mainText)) {
    tool = 'bibtex';
  }
  if (!tool) {
    if (fsExists(path.join(job.build, 'main.bcf'))) tool = 'biber';
    else if (fsExists(auxPath) && /\\bibdata\{/.test(await fsp.readFile(auxPath, 'utf8'))) tool = 'bibtex';
  }
  if (!tool) return { ok: false, tool: null, message: 'The compiled document has no bibliography commands (\\bibliography / \\printbibliography) for BibTeX or biber to process.', warnings: [], log: '' };
  const dirs = [job.src, path.join(job.src, path.dirname(mainRel))].join(path.delimiter) + path.delimiter;   // trailing delimiter keeps the TeX default paths
  const env = Object.assign({}, process.env, { BIBINPUTS: dirs, BSTINPUTS: dirs });
  const r = tool === 'bibtex' ? await runTool('bibtex', ['main'], job.build, env)
    : await runTool('biber', ['--input-directory', job.build, '--output-directory', job.build, 'main'], job.src, env);
  const out = r.stdout + '\n' + r.stderr; let blg = '';
  try { blg = await fsp.readFile(path.join(job.build, 'main.blg'), 'utf8'); } catch (e) { /* no log written */ }
  const log = tail(blg || out, 3000);
  if (r.error && r.error.code === 'ENOENT') return { ok: false, tool, message: `${tool} was not found. Install it (it ships with TeX Live / MacTeX / MiKTeX) and make sure it is on your PATH.`, warnings: [], log: '' };
  if (r.error && r.error.killed) return { ok: false, tool, message: `${tool} timed out.`, warnings: [], log };
  const code = r.error ? r.error.code : 0;
  const warnings = (blg + '\n' + out).split(/\r?\n/).filter((l) => /^Warning--|WARN - /.test(l)).map((l) => l.replace(/^.*?(Warning--|WARN - )/, '').trim()).filter((l, i, a) => a.indexOf(l) === i);
  const failed = tool === 'bibtex' ? code >= 2 : code !== 0;   // bibtex exits 1 on warnings only; biber exits 0 unless it hit errors
  if (failed) {
    const why = (blg + '\n' + out).split(/\r?\n/).filter((l) => /^(I couldn't open|I found no|---|! |ERROR - )|error message/.test(l)).slice(0, 3).join(' ').trim();
    return { ok: false, tool, message: `${tool} reported errors${why ? ': ' + why : ''}`, warnings, log };
  }
  return { ok: true, tool, message: '', warnings, log };
}

const RERUN_RE = /Rerun to get (cross-references|citations|the bar|outlines)|There were undefined references|rerunfilecheck/i;
const MAX_PASSES = 4;
const JOB_TTL_MS = 5 * 60 * 1000;   // PDF served from disk; clean up after 5 min

async function compileJob(files, mainRel, wantBib, preferred) {
  const id = crypto.randomBytes(16).toString('hex');
  const job = { dir: path.join(TMP_ROOT, id) };
  job.src = path.join(job.dir, 'src'); job.build = path.join(job.dir, 'build');
  const mainFile = files.find((f) => f.rel === mainRel); job.compiler = pickEngine(mainFile ? mainFile.data : Buffer.alloc(0), preferred);   // engine choice is unchanged: the document / client preference, never the saved default
  const ENG = ENGINES[job.compiler];

  // Which binary runs that engine: the saved default path (latex.compilerPath) when it is set, valid and for this engine, else the bare name on PATH as before.
  const rc = await resolveCompiler(job.compiler);
  if (!rc.ok) return { ok: false, code: rc.code, saved: rc.saved, error: `${ENG} was not found: the saved location (${rc.saved}) no longer exists and ${job.compiler} is not on PATH or in the usual install locations. Install a LaTeX distribution (TeX Live, MacTeX or MiKTeX) or choose the compiler again in setup, then try again.`, log: '', errors: [] };
  job.bin = rc.bin;

  // Spawn errors become structured results (never thrown): ENOENT -> NO_COMPILER, EACCES/EPERM -> COMPILER_PERMISSION.
  const spawnFailure = (err) => {
    if (!err) return null;
    if (err.code === 'ENOENT') return { ok: false, code: 'NO_COMPILER', error: `${ENG} (${job.bin === job.compiler ? job.compiler : job.bin}) was not found. Install a LaTeX distribution (TeX Live, MacTeX or MiKTeX) and make sure "${job.compiler}" is on your PATH, then try again.`, log: '', errors: [] };
    if (err.code === 'EACCES' || err.code === 'EPERM') return { ok: false, code: 'COMPILER_PERMISSION', error: `${ENG} (${job.bin}) exists but could not be run (permission denied).`, log: '', errors: [] };
    if (typeof err.code === 'string' && !err.killed && err.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { ok: false, code: 'COMPILER_START', error: `${ENG} (${job.bin}) could not be started (${err.code}). The file may be damaged or built for another system. Reinstall LaTeX or choose the compiler again in setup, then try again.`, log: '', errors: [] };   // e.g. ENOEXEC; never reported as "no PDF produced"
    return null;
  };

  // Fail fast before writing anything if the compiler is absent (a non-zero exit from --version is fine: it ran).
  const precheck = (bin) => new Promise((res) => { try { execFile(bin, ['--version'], { timeout: 5000 }, (e) => res(e)); } catch (e) { res(e); } });
  let pre = await precheck(job.bin);
  if (pre && pre.code === 'ENOENT' && job.bin === job.compiler) {   // not on this process's PATH: installed after Plum started, or in a usual folder outside PATH
    const found = await locateCompiler(job.compiler);
    if (found) { job.bin = found; pre = await precheck(job.bin); }
  }
  const preFail = spawnFailure(pre); if (preFail) return preFail;

  await fsp.mkdir(job.src, { recursive: true });
  await fsp.mkdir(job.build, { recursive: true });
  // Deferred cleanup: PDF must be readable until the client fetches it.
  setTimeout(() => fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {}), JOB_TTL_MS);

  for (const f of files) {
    const dest = path.join(job.src, f.rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (/\.(tex|sty|cls)$/i.test(f.rel)) f.data = useBundledFonts(f.data, job);
    await fsp.writeFile(dest, f.data);
    if (/\.tex$/i.test(f.rel)) await fsp.mkdir(path.join(job.build, path.dirname(f.rel)), { recursive: true });
  }

  function fail(msg, run) {
    const raw = run ? run.stdout + '\n' + run.stderr : '';
    const log = extractUsefulLog(raw);
    const errors = String(raw).split(/\r?\n/).filter((l) => /^!/.test(l)).map((l) => l.replace(/^!\s*/, '').trim()).filter(Boolean);
    return { ok: false, error: msg, log, errors };
  }

  // Pass 1
  let run = await runCompiler(job, mainRel);
  const sf1 = spawnFailure(run.error); if (sf1) return sf1;
  if (run.error && run.error.killed) return { ok: false, error: `Compilation timed out after ${Math.round(COMPILE_TIMEOUT_MS / 1000)} s.`, log: extractUsefulLog(run.stdout + '\n' + run.stderr), errors: [] };

  const pdfPath = path.join(job.build, 'main.pdf');
  if (!fsExists(pdfPath)) return fail(`${ENG} reported errors and did not produce a PDF.`, run);

  // Bibliography pass (optional).
  let bib = null;
  if (wantBib) {
    bib = await bibPass(job, mainRel);
    if (!bib.ok) return Object.assign(fail(`${ENG} compiled successfully but the bibliography step failed: ${bib.message}`, run), { bib });
  }

  // Multi-pass stability loop: keep running until no Rerun signal or MAX_PASSES reached.
  for (let pass = 1; pass < MAX_PASSES; pass++) {
    const needsRerun = RERUN_RE.test(run.stdout) || (bib && bib.ok && pass === 1);
    if (!needsRerun) break;
    run = await runCompiler(job, mainRel);
    const sfN = spawnFailure(run.error); if (sfN) return sfN;
    if (run.error && run.error.killed) return { ok: false, error: `Compilation timed out on pass ${pass + 1}.`, log: extractUsefulLog(run.stdout + '\n' + run.stderr), errors: [] };
    if (!fsExists(pdfPath)) return fail(`${ENG} reported errors on pass ${pass + 1} and did not produce a PDF.`, run);
  }

  const log = extractUsefulLog(run.stdout + '\n' + run.stderr);
  const errors = String(run.stdout + '\n' + run.stderr).split(/\r?\n/).filter((l) => /^!/.test(l)).map((l) => l.replace(/^!\s*/, '').trim()).filter(Boolean);
  return { ok: true, id, log, errors, bib, exitCode: run.exitCode };
}


// Chart: writes the spec to its own temp folder and runs chart.py (Matplotlib) with execFile, an argument array, never a shell string.
function runPython(args, i) {
  i = i || 0;
  return new Promise((resolve) => {
    execFile(PY_CANDIDATES[i], args, { timeout: CHART_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && error.code === 'ENOENT' && i + 1 < PY_CANDIDATES.length) return resolve(runPython(args, i + 1));
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '').trim() });
    });
  });
}
async function chartJob(payload) {
  const spec = payload && payload.spec, format = payload && payload.format;
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.columns) || !Array.isArray(spec.rows)) return { ok: false, error: 'Malformed chart request.' };
  if (!['png', 'svg', 'pdf'].includes(format)) return { ok: false, error: 'Unsupported export format.' };
  const dpi = Math.min(600, Math.max(50, Math.round(Number(payload.dpi)) || 100));
  const dir = path.join(TMP_ROOT, 'chart-' + crypto.randomBytes(16).toString('hex')), out = path.join(dir, 'chart.' + format);
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'spec.json'), JSON.stringify(spec));
    const r = await runPython([diskPath(path.join(__dirname, 'chart.py')), path.join(dir, 'spec.json'), out, String(dpi)]);
    if ((r.error && r.error.code === 'ENOENT') || /Python was not found|Microsoft Store/i.test(r.stderr)) return { ok: false, setup: true, error: PY_MISSING };
    if (r.error && r.error.code === 3) return { ok: false, setup: true, error: 'Charts need Matplotlib, which is not installed for Python on this computer. Run “pip install matplotlib” (or “python3 -m pip install matplotlib”), then try again.' };
    if (r.error && /SyntaxError/.test(r.stderr)) return { ok: false, setup: true, error: PY_OLD };
    if (r.error && r.error.killed) return { ok: false, error: 'Drawing the chart timed out.' };
    if (r.error || !fsExists(out)) return { ok: false, error: tail(r.stderr, 400) || 'Python failed to draw the chart.' };
    return { ok: true, format, b64: (await fsp.readFile(out)).toString('base64') };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// Turns a request body into validated { rel, data } entries plus the main file's relative path.
function parseBundle(payload) {
  if (typeof payload.source === 'string' && !payload.files) {
    if (!payload.source.trim()) return { error: 'There is no document to compile.' };
    return { files: [{ rel: 'main.tex', data: Buffer.from(payload.source, 'utf8') }], main: 'main.tex' };
  }
  if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > MAX_FILES) return { error: 'There is no document to compile.' };
  const files = [], seen = new Set();
  for (const f of payload.files) {
    const rel = safeRel(f && f.path);
    if (!rel) return { error: 'The project contains a file path that can’t be compiled: ' + String(f && f.path).slice(0, 80) };
    if (seen.has(rel)) continue;
    seen.add(rel);
    files.push({ rel, data: typeof f.text === 'string' ? Buffer.from(f.text, 'utf8') : Buffer.from(String(f.b64 || ''), 'base64') });
  }
  const main = safeRel(payload.main);
  if (!main || !/\.tex$/i.test(main) || !seen.has(main)) return { error: 'The main file is missing from the compile request.' };
  return { files, main };
}


// Dependency-free ZIP writer (deflateRawSync + CRC-32). Entries: [{ name (posix, relative), data: Buffer }].
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function buildZip(entries) {
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), crc = crc32(e.data), deflated = zlib.deflateRawSync(e.data);
    const store = deflated.length >= e.data.length, body = store ? e.data : deflated, method = store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(e.data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, name, body); central.push(cen, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
// Not part of the user's project: build/temp dirs, caches, VCS data and LaTeX by-products.
const ZIP_SKIP_DIR = /(^|\/)(build|out|output|_build|tmp|temp|\.cache|__pycache__|node_modules|\.git|\.svn|\.vscode|\.idea|__fonts|latex\.out|_minted[^/]*|auto|\.aux)\//i;
const ZIP_SKIP_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex(\.gz)?|xdv|bcf|blg|run\.xml|nav|snm|vrb|idx|ind|ilg|glo|gls|glg|ist|acn|acr|alg|mw|bak|tmp|swp|dvi)$/i;
function exportName(n) { return String(n || 'project').replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').trim().slice(0, 80) || 'project'; }
function openFolder(dir) {
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]];
  return new Promise((resolve) => execFile(cmd, args, { timeout: 10000 }, (err) => resolve(!err || (process.platform === 'win32' && err.code === 1))));   // explorer.exe exits 1 even on success
}
function isLocal(req) { const a = req.socket.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; }

/* ---------- Local file access (what lets the app open/save files like Word does, with no browser permission prompt) ----------
   The in-app Open/Save pickers (js/fs-bridge.js) browse the disk through /api/fs/*. Listing folders for the picker is metadata only;
   reading, writing and deleting are limited to paths the user has opened or saved through the app (the "grants" below, remembered in
   ~/.laurevine-plum/fs-grants.json). Every request must come from this machine, carry the X-Plum header and have a localhost Host,
   so other websites open in your browser cannot reach it. */
const GRANT_FILE = path.join(os.homedir(), '.laurevine-plum', 'fs-grants.json');
const GRANTS = new Set();
try { JSON.parse(fs.readFileSync(GRANT_FILE, 'utf8')).forEach((g) => typeof g === 'string' && GRANTS.add(g)); } catch (e) { /* first run: no grants yet */ }
function saveGrants() { try { fs.mkdirSync(path.dirname(GRANT_FILE), { recursive: true }); fs.writeFileSync(GRANT_FILE, JSON.stringify([...GRANTS], null, 1)); } catch (e) { /* best-effort */ } }
const fsKey = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
function fsAllowed(abs) {
  const k = fsKey(abs);
  for (const g of GRANTS) {
    const gk = fsKey(g);
    if (k === gk) return true;
    const rel = path.relative(gk, k);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
}
function fsReqOk(req) {
  if (!isLocal(req) || req.headers['x-plum'] !== '1') return false;
  const host = String(req.headers.host || '').toLowerCase();
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  return !req.headers.origin || req.headers.origin.toLowerCase() === 'http://' + host;
}
const fsKind = (st) => (st.isDirectory() ? 'directory' : 'file');
async function fsEntries(dir, hidden, meta) {   // meta: also report size and modified time (picker listing)
  const out = [], all = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => hidden || !d.name.startsWith('.'));
  const one = async (d) => {
    let kind = d.isDirectory() ? 'directory' : d.isFile() ? 'file' : null, size = 0, mtime = 0;
    if (!kind || meta) {   // symlinks are followed (broken ones skipped)
      try { const st = await fsp.stat(path.join(dir, d.name)); kind = fsKind(st); size = st.size; mtime = st.mtimeMs; } catch (e) { if (!kind) return null; }
    }
    return meta ? { name: d.name, kind, size, mtime } : { name: d.name, kind };
  };
  for (let i = 0; i < all.length; i += 64) for (const r of await Promise.all(all.slice(i, i + 64).map(one))) if (r) out.push(r);   // 64 stats in flight at a time, order kept
  return out;
}
async function fsHandle(req, res, urlPath) {
  const u = new URL(req.url, 'http://localhost'), q = u.searchParams, op = urlPath.slice('/api/fs/'.length);
  const bad = (code, msg) => sendJSON(res, code, { ok: false, error: msg });
  const target = () => { const p = q.get('p'); return p && typeof p === 'string' && p.length < 4096 ? path.resolve(p) : null; };
  try {
    if (op === 'home') {
      const home = os.homedir(), places = [['Home', home]];
      ['Desktop', 'Documents', 'Downloads'].forEach((n) => { const d = path.join(home, n); if (fsExists(d)) places.push([n, d]); });
      const roots = [];
      if (process.platform === 'win32') for (let c = 65; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; if (fsExists(d)) roots.push([d, d]); }
      else roots.push(['Computer', '/']);
      return sendJSON(res, 200, { ok: true, home, sep: path.sep, places: places.map(([name, p]) => ({ name, path: p })), roots: roots.map(([name, p]) => ({ name, path: p })) });
    }
    if (op === 'browse') {   // picker listing: names and kinds only, never file contents
      const abs = target() || os.homedir();
      const st = await fsp.stat(abs);
      if (!st.isDirectory()) return bad(400, 'Not a folder.');
      const parent = path.dirname(abs);
      return sendJSON(res, 200, { ok: true, path: abs, parent: parent === abs ? null : parent, entries: await fsEntries(abs, false, true) });
    }
    if (op === 'grant' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}'), abs = body.path && path.resolve(String(body.path));
      if (!abs) return bad(400, 'Missing path.');
      let ok = false; try { await fsp.stat(abs); ok = true; } catch (e) { try { ok = (await fsp.stat(path.dirname(abs))).isDirectory(); } catch (e2) { /* parent missing */ } }
      if (!ok) return bad(404, 'That location does not exist.');
      if (!GRANTS.has(abs)) { GRANTS.add(abs); saveGrants(); }
      return sendJSON(res, 200, { ok: true, path: abs });
    }
    const abs = target();
    if (!abs) return bad(400, 'Missing path.');
    if (!fsAllowed(abs)) return bad(403, 'Open this location from the app first.');
    if (op === 'list') return sendJSON(res, 200, { ok: true, entries: await fsEntries(abs, true) });
    if (op === 'stat') { const st = await fsp.stat(abs); return sendJSON(res, 200, { ok: true, kind: fsKind(st), size: st.size, mtime: st.mtimeMs }); }
    if (op === 'read') {
      const st = await fsp.stat(abs);
      if (!st.isFile()) return bad(400, 'Not a file.');
      return send(res, 200, await fsp.readFile(abs), { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Mtime': String(Math.floor(st.mtimeMs)) });
    }
    if (op === 'write' && req.method === 'POST') {
      const data = await readBody(req, 512 * 1024 * 1024);
      if (q.get('create') !== '1') await fsp.stat(abs);
      await fsp.writeFile(abs, data);
      return sendJSON(res, 200, { ok: true });
    }
    if (op === 'mkdir' && req.method === 'POST') { await fsp.mkdir(abs, { recursive: true }); return sendJSON(res, 200, { ok: true }); }
    if (op === 'remove' && req.method === 'POST') {
      if ([...GRANTS].some((g) => fsKey(g) === fsKey(abs))) return bad(403, 'The opened project folder itself can’t be removed from here.');
      await fsp.rm(abs, { recursive: q.get('recursive') === '1', force: false });
      return sendJSON(res, 200, { ok: true });
    }
    if (op === 'rename' && req.method === 'POST') {   // rename in place (same parent folder); grants follow the renamed folder so the project stays open-able
      const to = String(q.get('to') || '');
      if (!to || to.length > 255 || to === '.' || to === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(to) || /[. ]$/.test(to)) return bad(400, 'That name isn’t valid for a folder.');
      const dest = path.join(path.dirname(abs), to);
      if (fsKey(dest) !== fsKey(abs) && fsExists(dest)) return bad(409, 'A file or folder named “' + to + '” already exists there.');
      await fsp.rename(abs, dest);
      for (const g of [...GRANTS]) {
        const rel = path.relative(fsKey(abs), fsKey(g));
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) { GRANTS.delete(g); GRANTS.add(rel === '' ? dest : path.join(dest, path.relative(abs, g))); }
      }
      saveGrants();
      return sendJSON(res, 200, { ok: true, path: dest });
    }
    return bad(404, 'Unknown file operation.');
  } catch (e) {
    const code = e && e.code === 'ENOENT' ? 404 : e && (e.code === 'EACCES' || e.code === 'EPERM') ? 403 : 500;
    return bad(code, (e && e.code) || (e && e.message) || 'File operation failed.');
  }
}

let fcFamilies = null;   // fc-list can take seconds on large font sets: run it once (warmed at startup) and reuse it; a failed run is retried next time
const fcList = () => fcFamilies || (fcFamilies = new Promise((resolve) => execFile('fc-list', [':', 'family'], { timeout: 15000, maxBuffer: 10 * 1024 * 1024 }, (err, out) => { if (err) fcFamilies = null; resolve(err ? '' : String(out)); })));
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = (req.url || '/').split('?')[0];

    if (urlPath.startsWith('/api/fs/')) {
      if (!fsReqOk(req)) return sendJSON(res, 403, { ok: false, error: 'File access is only available to the app on this machine.' });
      return fsHandle(req, res, urlPath);
    }

    if (req.method === 'POST' && urlPath === '/api/compile') {
      let raw;
      try { raw = await readBody(req, MAX_BODY_BYTES); }
      catch (e) { return sendJSON(res, 413, { ok: false, error: 'The project is too large to compile.' }); }
      let payload;
      try { payload = JSON.parse(raw.toString('utf8') || '{}'); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: 'Malformed request.' }); }
      const bundle = parseBundle(payload || {});
      if (bundle.error) return sendJSON(res, 400, { ok: false, error: bundle.error });
      try {
        const result = await compileJob(bundle.files, bundle.main, payload.bib === true, payload.compiler);
        if (!result.ok) return sendJSON(res, 200, result);
        return sendJSON(res, 200, { ok: true, pdfUrl: '/api/pdf/' + result.id, log: result.log, errors: result.errors, bib: result.bib, exitCode: result.exitCode });
      } catch (e) {
        return sendJSON(res, 500, { ok: false, error: 'The compile server hit an unexpected error: ' + ((e && e.message) || e) });
      }
    }


    if (req.method === 'POST' && urlPath === '/api/export-zip') {
      let payload;
      try { payload = JSON.parse((await readBody(req, MAX_BODY_BYTES)).toString('utf8') || '{}'); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: 'Malformed export request.' }); }
      const bundle = parseBundle(payload || {});
      if (bundle.error) return sendJSON(res, 400, { ok: false, error: bundle.error.replace('compile', 'export') });
      const entries = bundle.files.filter((f) => !ZIP_SKIP_DIR.test(f.rel) && !ZIP_SKIP_FILE.test(f.rel)).map((f) => ({ name: f.rel, data: f.data }));
      if (!entries.length) return sendJSON(res, 400, { ok: false, error: 'There are no project files to export.' });
      const zip = buildZip(entries), fname = exportName(payload.name) + '.zip';
      let saved = null;
      try { await fsp.mkdir(OUTPUT_DIR, { recursive: true }); await fsp.writeFile(path.join(OUTPUT_DIR, fname), zip); saved = path.join(OUTPUT_DIR, fname); } catch (e) { /* the download still works */ }
      return send(res, 200, zip, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="' + encodeURIComponent(fname) + '"', 'X-Saved-Path': saved ? encodeURIComponent(saved) : '', 'Cache-Control': 'no-store' });
    }

    if (req.method === 'POST' && urlPath === '/api/open-output') {
      if (!isLocal(req)) return sendJSON(res, 403, { ok: false, error: 'Opening folders is only allowed from the machine running the server.' });
      try { await fsp.mkdir(OUTPUT_DIR, { recursive: true }); } catch (e) { return sendJSON(res, 200, { ok: false, error: 'Could not create the output folder: ' + OUTPUT_DIR }); }
      const ok = await openFolder(OUTPUT_DIR);
      return sendJSON(res, 200, ok ? { ok: true, dir: OUTPUT_DIR } : { ok: false, dir: OUTPUT_DIR, error: 'Could not open a file manager on this machine.' });
    }

    if (req.method === 'POST' && urlPath === '/api/chart') {
      let payload;
      try { payload = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8') || '{}'); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: 'Malformed chart request.' }); }
      try { return sendJSON(res, 200, await chartJob(payload)); }
      catch (e) { return sendJSON(res, 500, { ok: false, error: 'The chart server hit an unexpected error: ' + ((e && e.message) || e) }); }
    }

    if (req.method === 'GET' && urlPath === '/api/fonts') {
      const out = await fcList(), bundled = [...bundledFonts().keys()], fonts = new Set(bundled);
      out.split('\n').forEach((l) => l.split(',').forEach((n) => { n = n.trim(); if (n) fonts.add(n); }));
      return sendJSON(res, 200, { ok: true, fonts: [...fonts], bundled });
    }

    if (req.method === 'GET' && urlPath === '/fonts/fonts.css') {
      const p = path.join(ROOT, 'fonts', 'fonts.css');
      if (fsExists(p)) return serveStatic(req, res, urlPath);
      const fam = bundledFonts(), css = [];
      for (const [name, faces] of fam) {
        for (const f of faces) {
          const fmt = path.extname(f.file).toLowerCase() === '.otf' ? 'opentype' : 'truetype';
          css.push(`@font-face {\n  font-family: '${name}';\n  src: url('/fonts/${f.file}') format('${fmt}');\n  font-weight: ${f.lo} ${f.hi};\n  font-style: ${f.it ? 'italic' : 'normal'};\n  font-display: swap;\n}`);
        }
      }
      return send(res, 200, css.join('\n\n'), { 'Content-Type': 'text/css; charset=utf-8' });
    }

    if (req.method === 'GET' && urlPath.startsWith('/api/pdf/')) {
      const id = urlPath.slice('/api/pdf/'.length);
      if (!JOB_ID_RE.test(id)) return send(res, 400, 'Invalid job id');
      const pdfPath = path.join(TMP_ROOT, id, 'build', 'main.pdf');
      if (!fsExists(pdfPath)) return send(res, 404, 'Not found');
      const data = await fsp.readFile(pdfPath);
      return send(res, 200, data, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="document.pdf"' });
    }

    if (req.method === 'GET') return serveStatic(req, res, urlPath);
    send(res, 405, 'Method not allowed');
  } catch (e) {
    send(res, 500, 'Internal server error');
  }
});

// Start from a clean temp folder each run, so PDFs from a previous server process never linger.
// start(port, host) resolves once the server is listening and the temp folder is clean; it rejects (e.g. EADDRINUSE) if it could not bind.
// The clean-up runs only AFTER a successful bind: a failed start (port held by another Plum server) must not wipe that server's compile folders.
// host omitted = Node's default (all interfaces, exactly as before); the Electron shell (main.js) passes '127.0.0.1'.
function start(port = PORT, host) {
  return new Promise((resolve, reject) => {
    if (server.listening) return reject(new Error('The server is already running.'));
    const onError = (err) => reject(err);
    server.once('error', onError);
    const onListening = () => {
      server.removeListener('error', onError);
      fs.rm(TMP_ROOT, { recursive: true, force: true }, () => { fcList(); resolve(server); });
    };
    try { if (host) server.listen(port, host, onListening); else server.listen(port, onListening); } catch (e) { server.removeListener('error', onError); reject(e); }
  });
}

// stop() stops accepting connections, drops open keep-alive sockets and always settles (default cap 3 s).
function stop(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    const t = setTimeout(resolve, timeoutMs);
    if (t.unref) t.unref();
    server.close(() => { clearTimeout(t); resolve(); });
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

module.exports = { start, stop, server };

if (require.main === module) {   // `node server/server.js [port]`: unchanged behaviour
  start().then(() => {
    console.log(`Laurevine Plum server running at http://localhost:${PORT}`);
    console.log(`Compiling with "${COMPILER}". Install a LaTeX distribution and ensure it is on PATH if compilation fails.`);
  }, (err) => {
    console.error(`Could not start the server on port ${PORT}: ${(err && err.message) || err}`);
    process.exit(1);
  });
}