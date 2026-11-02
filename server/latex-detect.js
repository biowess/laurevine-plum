'use strict';
/*
 * LaTeX compiler detection (Node built-ins only). Used by the Electron main process:
 *   const { registerLatexIpc } = require('./server/latex-detect'); registerLatexIpc(ipcMain, { getConfigured });
 * and by the preload (contextIsolation on, no nodeIntegration):
 *   const { exposeLatexBridge } = require('./server/latex-detect'); exposeLatexBridge(contextBridge, ipcRenderer);
 *   -> window.plum.latex.detect()  (no arguments; the renderer cannot choose paths or commands)
 * Also here (same register/expose pair, one window.plum object):
 *   registerLatexIpc(ipcMain, { getConfigured, shell })   // shell = Electron's shell, used only by openExternalSafe
 *   -> window.plum.latex.verifyCompiler(pathOrName) / cancelVerify() / verifyStage()   (xelatex|lualatex|pdflatex, or the absolute path of one that detection reported; verifyStage = read-only progress: resolve|version|compile|pdf|null)
 *   -> window.plum.system.getOsInfo() / openExternalSafe(url)           (https + fixed host allowlist only)
 * Settings + default compiler (same pair; main-process state shared with server.js through this module):
 *   -> window.plum.setup.getSetupState() / saveSetupState(partial)   (partial = { setup:{completed,deferred}, latex:{lastVerifiedOk,lastVerifiedAt} } only)
 *   -> window.plum.latex.setDefaultCompiler(absPath)                 (only a path that passed verifyCompiler this session, else it re-verifies)
 *   Stored as JSON (defaults + typeof-checked merge, like renderer PREFS) at $LAUREVINE_PLUM_SETTINGS or <OS config dir>/Laurevine Plum/settings.json.
 * Nothing here runs sudo or a package manager; every child process is execFile with an argument array.
 * Result per compiler: { name, found, path, source, error }. `error` is null on a clean answer; a string means
 * detection itself failed for that compiler (never reported as "not found").
 * Order: configured path -> PATH -> common install locations. Windows also re-reads PATH from the registry.
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const NAMES = ['xelatex', 'lualatex', 'pdflatex'];   // pdfLaTeX is in server.js ENGINES, so the app can use it
const IS_WIN = process.platform === 'win32';
const CHANNEL = 'plum:latex:detect';

function isExecutable(p) {
  // resolves true/false for ordinary absence; rejects only on unexpected errors (EACCES on a parent, EIO, ...)
  return fsp.stat(p).then((st) => {
    if (!st.isFile()) return false;
    if (IS_WIN) return true;
    return fsp.access(p, fs.constants.X_OK).then(() => true, (e) => { if (e.code === 'EACCES') return false; throw e; });
  }, (e) => { if (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EACCES') return false; throw e; });
}

function exeNames(name) { return IS_WIN ? [name + '.exe'] : [name]; }

async function inDirs(name, dirs) {
  for (const d of dirs) {
    if (!d || !path.isAbsolute(d)) continue;
    for (const n of exeNames(name)) { const p = path.join(d, n); if (await isExecutable(p)) return p; }
  }
  return null;
}

function splitPath(value) {
  return String(value || '').split(path.delimiter).map((s) => s.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

// Windows: current machine + user PATH straight from the registry (`reg query`, argument array, read-only).
function regQuery(key) {
  return new Promise((resolve, reject) => {
    execFile('reg', ['query', key, '/v', 'Path'], { timeout: 5000, windowsHide: true }, (err, out) => {
      if (err) { if (typeof err.code === 'number') return resolve(''); return reject(err); }   // exit 1 = value/key absent; spawn failure rejects
      const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out);
      resolve(m ? m[1].trim() : '');
    });
  });
}
const expandVars = (s) => s.replace(/%([^%]+)%/g, (all, v) => process.env[v] !== undefined ? process.env[v] : all);
async function registryPathDirs() {
  const parts = await Promise.all([
    regQuery('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    regQuery('HKCU\\Environment')
  ]);
  return splitPath(expandVars(parts.join(path.delimiter)));
}

async function globDirs(base, segments) {
  // expands one level per '*' segment (no recursion beyond the fixed pattern)
  let cur = [base];
  for (const seg of segments) {
    const next = [];
    for (const dir of cur) {
      if (seg !== '*') { next.push(path.join(dir, seg)); continue; }
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); }
      catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EACCES') continue; throw e; }
      for (const ent of ents) if (ent.isDirectory()) next.push(path.join(dir, ent.name));
    }
    cur = next;
  }
  return cur;
}

async function commonDirs() {
  if (IS_WIN) {
    const env = process.env, roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'MiKTeX'), env.ProgramFiles && path.join(env.ProgramFiles, 'MiKTeX'), env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'MiKTeX')].filter(Boolean);
    const dirs = [];
    for (const r of roots) dirs.push(path.join(r, 'miktex', 'bin', 'x64'), path.join(r, 'miktex', 'bin'));
    const sysDrive = env.SystemDrive || 'C:';
    const tlRoots = [path.join(sysDrive + path.sep, 'texlive')];
    if (env.ProgramFiles) tlRoots.push(path.join(env.ProgramFiles, 'texlive'));
    for (const t of tlRoots) for (const arch of ['windows', 'win64']) dirs.push(...await globDirs(t, ['*', 'bin', arch]));
    return dirs;
  }
  const home = os.homedir(), dirs = ['/usr/bin', '/usr/local/bin'];
  if (process.platform === 'darwin') dirs.push('/Library/TeX/texbin', '/opt/homebrew/bin');   // apps started from Finder get a minimal PATH that lacks both
  dirs.push(...await globDirs('/usr/local/texlive', ['*', 'bin', '*']));
  if (home) { dirs.push(...await globDirs(path.join(home, 'texlive'), ['*', 'bin', '*'])); dirs.push(...await globDirs(path.join(home, '.TinyTeX', 'bin'), ['*'])); }
  return dirs;
}

/**
 * @param {{configured?: Object<string,string>}} [opts] configured: optional { xelatex: '/abs/path', ... } from Plum's settings
 * @returns {Promise<Array<{name:string, found:boolean, path:string|null, source:string|null, error:string|null}>>}
 */
async function detectCompilers(opts) {
  const configured = (opts && opts.configured && typeof opts.configured === 'object') ? opts.configured : {};
  const out = [];
  let regDirs = null, regErr = null, common = null, commonErr = null;
  const lazy = async () => {   // computed once, only if an earlier source did not already answer
    if (common === null && commonErr === null) { try { common = await commonDirs(); } catch (e) { commonErr = e; } }
    if (IS_WIN && regDirs === null && regErr === null) { try { regDirs = await registryPathDirs(); } catch (e) { regErr = e; } }
  };
  for (const name of NAMES) {
    const res = { name, found: false, path: null, source: null, error: null };
    try {
      const cfg = configured[name];
      if (typeof cfg === 'string' && cfg && path.isAbsolute(cfg) && await isExecutable(cfg)) { res.found = true; res.path = cfg; res.source = 'configured'; }
      if (!res.found) {
        const p = await inDirs(name, splitPath(process.env.PATH));
        if (p) { res.found = true; res.path = p; res.source = 'path'; }
      }
      if (!res.found) {
        await lazy();
        if (IS_WIN && regDirs) { const p = await inDirs(name, regDirs); if (p) { res.found = true; res.path = p; res.source = 'registry-path'; } }
        if (!res.found && common) { const p = await inDirs(name, common); if (p) { res.found = true; res.path = p; res.source = 'common-location'; } }
        // A failed lookup only becomes an error when nothing was found: "not found" must mean we really looked.
        if (!res.found && (commonErr || regErr)) res.error = String((commonErr || regErr).message || (commonErr || regErr));
      }
    } catch (e) { res.found = false; res.path = null; res.source = null; res.error = String(e && e.message || e); }
    out.push(res);
  }
  return out;
}

// ---- Compiler verification -------------------------------------------------------------------------------------------
// Same flags as server/server.js runCompiler (which imports this builder), so verification exercises the real invocation.
function compileArgs(buildDir, mainRel) {
  return ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', '-jobname=main', '-output-directory=' + buildDir, mainRel];
}

const VERSION_TIMEOUT_MS = 10000, COMPILE_TIMEOUT_MS = 60000, LOG_LINES = 15;
const TEST_DOC = '\\documentclass{article}\\begin{document}Plum test\\end{document}\n';
let activeVerify = null;   // one verification at a time
const sessionVerified = new Map();   // normalized absolute path -> 'size:mtimeMs' of a binary that passed verifyCompiler in this session

const verifyResult = (ok, stage, reason, message, compilerPath, shortLog) =>
  ({ ok, stage, reason, message, shortLog: shortLog || '', compilerPath: compilerPath || null });

function tailLog(text) {
  const lines = String(text || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').split('\n').map((l) => l.trimEnd().slice(0, 300)).filter(Boolean);
  return lines.slice(-LOG_LINES).join('\n');
}

function killTree(child) {
  if (!child) return;
  if (IS_WIN && child.pid) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => {});   // MiKTeX may spawn helpers
  try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
}

// execFile with an argument array, our own timer (so the whole tree can be killed) and the child exposed on `state` for cancel.
// Timeout and cancel settle the promise right away: a grandchild that keeps the pipes open must not delay the answer.
function runChild(state, cmd, args, opts, timeoutMs) {
  return new Promise((resolve) => {
    let timer = null, timedOut = false, settled = false;
    const finish = (error, stdout, stderr) => {
      if (settled) return;
      settled = true; clearTimeout(timer); state.child = null; state.release = null;
      resolve({ error, timedOut, stdout: stdout || '', stderr: stderr || '' });
    };
    state.release = () => finish(null, '', '');
    try {
      const child = execFile(cmd, args, Object.assign({ windowsHide: true, maxBuffer: 5 * 1024 * 1024 }, opts), finish);
      state.child = child;
      timer = setTimeout(() => { timedOut = true; killTree(child); finish(null, '', ''); }, timeoutMs);
    } catch (e) { finish(e, '', ''); }
  });
}

// Accepts only the three engine names, bare or as an absolute path whose file name is one of them (no UNC, no relative paths).
function parseCompilerInput(input) {
  if (typeof input !== 'string' || !input || input.length > 500 || /[\0\r\n]/.test(input) || input.startsWith('-')) return null;
  const engine = (file) => { const n = (IS_WIN ? file.replace(/\.exe$/i, '').toLowerCase() : file); return NAMES.includes(n) ? n : null; };
  if (!/[\\/]/.test(input)) { const name = engine(input); return name ? { name } : null; }
  if (!path.isAbsolute(input) || (IS_WIN && /^[\\/]{2}/.test(input))) return null;
  const name = engine(path.basename(input));
  return name ? { name, path: IS_WIN && !/\.exe$/i.test(input) ? input + '.exe' : input } : null;
}

// An absolute path is run only if this module's own detection (stored path, PATH, usual install folders) reports exactly that file
// for that engine, so a caller cannot make Plum execute an arbitrary file that merely has the right name.
async function isDetectedPath(target, configured) {
  const r = (await detectCompilers({ configured })).find((x) => x.name === target.name);
  return Boolean(r && r.found && r.path && vKey(r.path) === vKey(target.path));
}

async function checkExecutable(p) {   // -> 'ok' | 'missing' | 'notfile' | 'permission'
  try {
    const st = await fsp.stat(p);
    if (!st.isFile()) return 'notfile';
    if (!IS_WIN) await fsp.access(p, fs.constants.X_OK);
    return 'ok';
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return 'missing';
    if (e.code === 'EACCES' || e.code === 'EPERM') return 'permission';
    throw e;
  }
}

// Classifies a finished child that did not succeed; returns null when it exited 0 in time.
function classifyRun(state, run, stage, label, timeoutMs, timeoutHint) {
  const log = tailLog(run.stdout + '\n' + run.stderr);
  if (state.cancelled) return verifyResult(false, stage, 'cancelled', 'Verification was cancelled.', state.path, log);
  if (run.timedOut) return verifyResult(false, stage, 'timeout', label + ' timed out after ' + timeoutMs / 1000 + ' s.' + (timeoutHint || ''), state.path, log);
  const e = run.error;
  if (!e) return null;
  if (e.code === 'ENOENT') return verifyResult(false, stage, 'missing', 'The compiler could not be started because it was not found.', state.path, log);
  if (e.code === 'EACCES' || e.code === 'EPERM') return verifyResult(false, stage, 'permission', 'The compiler exists but could not be run (permission denied).', state.path, log);
  if (typeof e.code === 'number') return verifyResult(false, stage, 'exit', label + ' exited with code ' + e.code + '.', state.path, log);
  return verifyResult(false, stage, 'internal', label + ' failed: ' + String(e.message || e).slice(0, 300), state.path, log);
}

/**
 * @param {string} input  'xelatex' | 'lualatex' | 'pdflatex' | absolute path to a file with one of those names
 * @returns {Promise<{ok:boolean, stage:string, reason:string, message:string, shortLog:string, compilerPath:string|null}>} never rejects
 *   stage: start|resolve|version|compile|done. reason: ok|busy|invalid|missing|permission|timeout|exit|output|no-pdf|cancelled|internal.
 */
async function verifyCompiler(input, opts) {
  if (activeVerify) return verifyResult(false, 'start', 'busy', 'A compiler verification is already running.', null);
  const state = { stage: 'resolve', cancelled: false, child: null, release: null, path: null };
  activeVerify = state;
  let tmp = null;
  try {
    const target = parseCompilerInput(input);
    if (!target) return verifyResult(false, 'resolve', 'invalid', 'Choose xelatex, lualatex or pdflatex, or an absolute path to one of them.', null);

    // Stage 1: resolve + check
    if (target.path) {
      state.path = target.path;
      const c = await checkExecutable(target.path);
      if (c !== 'ok') return verifyResult(false, 'resolve', c === 'permission' ? 'permission' : 'missing',
        c === 'permission' ? 'Permission denied: ' + target.path + ' is not executable by Plum.' : c === 'notfile' ? target.path + ' is not a file.' : 'No file exists at ' + target.path + '.', target.path);
      const cfg = (opts && opts.configured && typeof opts.configured === 'object') ? opts.configured : {};
      if (!(await isDetectedPath(target, cfg))) return verifyResult(false, 'resolve', 'invalid', 'Only a compiler that Plum detected can be verified. Run detection again, then verify.', target.path);
    } else {
      const configured = (opts && opts.configured && typeof opts.configured === 'object') ? opts.configured : {};
      const res = (await detectCompilers({ configured })).find((r) => r.name === target.name);
      if (!res || res.error) return verifyResult(false, 'resolve', 'internal', 'Could not search for ' + target.name + ': ' + String(res && res.error || 'no result'), null);
      if (!res.found) return verifyResult(false, 'resolve', 'missing', target.name + ' was not found on PATH or in the usual install locations.', null);
      state.path = res.path;
    }
    if (state.cancelled) return classifyRun(state, { stdout: '', stderr: '' }, state.stage, '', 0);

    // Stage 2: <compiler> --version
    state.stage = 'version';
    const v = await runChild(state, state.path, ['--version'], {}, VERSION_TIMEOUT_MS);
    const vFail = classifyRun(state, v, 'version', 'Running --version', VERSION_TIMEOUT_MS);
    if (vFail) return vFail;
    const vOut = (v.stdout + '\n' + v.stderr).trim();
    if (!/TeX/i.test(vOut.slice(0, 2000))) return verifyResult(false, 'version', 'output', '--version printed output that does not look like a TeX engine.', state.path, tailLog(vOut));
    const versionLine = tailLog(vOut.split('\n')[0]);

    // Stage 3: compile a tiny document in a fresh temp folder with the real compile flags
    state.stage = 'compile';
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'plum-verify-'));
    const src = path.join(tmp, 'src'), build = path.join(tmp, 'build');
    await fsp.mkdir(src); await fsp.mkdir(build);
    await fsp.writeFile(path.join(src, 'main.tex'), TEST_DOC, { flag: 'wx' });
    if (state.cancelled) return classifyRun(state, { stdout: '', stderr: '' }, state.stage, '', 0);
    const c = await runChild(state, state.path, compileArgs(build, 'main.tex'), { cwd: src }, COMPILE_TIMEOUT_MS);
    const cFail = classifyRun(state, c, 'compile', 'The test compile', COMPILE_TIMEOUT_MS,
      ' If this is MiKTeX, it may be downloading missing packages on first run; let that finish (MiKTeX Console shows progress) and verify again.');
    if (cFail) return cFail;
    const log = tailLog(c.stdout + '\n' + c.stderr);
    state.stage = 'pdf';   // live progress only; results still report 'compile'
    let size = 0;
    try { size = (await fsp.stat(path.join(build, 'main.pdf'))).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!(size > 0)) return verifyResult(false, 'compile', 'no-pdf', 'The compiler exited normally but produced no PDF.', state.path, log);
    await rememberVerified(state.path);
    return verifyResult(true, 'done', 'ok', (versionLine ? versionLine + ': ' : '') + 'test document compiled to a PDF.', state.path, log);
  } catch (e) {
    return verifyResult(false, state.stage === 'pdf' ? 'compile' : state.stage, 'internal', 'Verification failed unexpectedly: ' + String(e && e.message || e).slice(0, 300), state.path);
  } finally {
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    activeVerify = null;
  }
}

function verifyStage() { return { ok: true, stage: activeVerify ? activeVerify.stage : null }; }

function cancelVerify() {
  const s = activeVerify;
  if (!s) return { ok: false, error: 'No verification is running.' };
  s.cancelled = true;
  killTree(s.child);
  if (s.release) s.release();
  return { ok: true };
}

// ---- Setup / compiler settings -----------------------------------------------------------------------------------------
// Same shape of handling as renderer PREFS: a defaults object, and a stored value is taken only when its type is right.
// latex.lastVerified* are informational (never proof); compilerPath is only ever written by setDefaultCompiler after verification.
const isBool = (v) => typeof v === 'boolean';
const isStamp = (v) => v === null || (typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v)));
const SETTINGS_DEFAULTS = { setup: { completed: false, deferred: false }, latex: { compilerPath: null, compilerName: '', lastVerifiedOk: false, lastVerifiedAt: null } };
const SETTING_OK = {
  'setup.completed': isBool, 'setup.deferred': isBool,
  'latex.compilerPath': (v) => v === null || (typeof v === 'string' && v.length <= 500 && path.isAbsolute(v)),
  'latex.compilerName': (v) => typeof v === 'string', 'latex.lastVerifiedOk': isBool, 'latex.lastVerifiedAt': isStamp
};
const SAVEABLE = new Map([['setup.completed', isBool], ['setup.deferred', isBool], ['latex.lastVerifiedOk', isBool], ['latex.lastVerifiedAt', isStamp]]);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const cloneSettings = (o) => JSON.parse(JSON.stringify(o));

function settingsFile() {
  if (process.env.LAUREVINE_PLUM_SETTINGS) return process.env.LAUREVINE_PLUM_SETTINGS;
  const home = os.homedir();
  const base = IS_WIN ? (process.env.APPDATA || path.join(home, 'AppData', 'Roaming')) : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : (process.env.XDG_CONFIG_HOME || path.join(home, '.config'));
  return path.join(base, 'Laurevine Plum', 'settings.json');
}

function normalizeSettings(raw) {
  const out = cloneSettings(SETTINGS_DEFAULTS);
  if (!raw || typeof raw !== 'object') return out;
  for (const g of Object.keys(out)) for (const k of Object.keys(out[g])) {
    const v = raw[g] && typeof raw[g] === 'object' && hasOwn(raw[g], k) ? raw[g][k] : undefined;
    if (v !== undefined && SETTING_OK[g + '.' + k](v)) out[g][k] = v;
  }
  const t = out.latex.compilerPath ? parseCompilerInput(out.latex.compilerPath) : null;
  if (!t || !t.path || t.name !== out.latex.compilerName) { out.latex.compilerPath = null; out.latex.compilerName = ''; }   // path and engine name must agree
  return out;
}

let settings = null;   // in-memory copy; replaced after every successful save, so the next compile sees it with no restart
function getSettings() {
  if (!settings) {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { /* missing, unreadable or corrupt: defaults */ }
    settings = normalizeSettings(raw);
  }
  return settings;
}

let saveChain = Promise.resolve();
// Applies `mutate` to a copy of the CURRENT settings, writes the file atomically, then swaps the in-memory copy. Never rejects.
function updateSettings(mutate) {
  const run = saveChain.then(async () => {
    try {
      const next = cloneSettings(getSettings());
      mutate(next);
      const file = settingsFile(), tmp = file + '.tmp';
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await fsp.rename(tmp, file);
      settings = next;
      return { ok: true, state: cloneSettings(next) };
    } catch (e) { return { ok: false, error: 'Could not save settings: ' + String(e && e.message || e).slice(0, 300) }; }
  });
  saveChain = run;
  return run;
}

function getSetupState() { return cloneSettings(getSettings()); }

async function saveSetupState(partial) {
  const bad = (m) => ({ ok: false, error: m });
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return bad('saveSetupState needs an object.');
  const entries = [];
  for (const g of Object.keys(partial)) {
    const grp = partial[g];
    if (!hasOwn(SETTINGS_DEFAULTS, g) || !grp || typeof grp !== 'object' || Array.isArray(grp)) return bad('Unknown settings group: ' + String(g).slice(0, 40));
    for (const k of Object.keys(grp)) {
      const key = g + '.' + k, ok = SAVEABLE.get(key);
      if (!ok) return bad(String(key).slice(0, 60) + ' is not a writable setting.');
      if (!ok(grp[k])) return bad(key + ' has the wrong type.');
      entries.push([g, k, grp[k]]);
    }
  }
  return updateSettings((next) => { for (const [g, k, v] of entries) next[g][k] = v; });
}

const vKey = (p) => IS_WIN ? path.normalize(p).toLowerCase() : path.normalize(p);
async function fingerprint(p) { try { const st = await fsp.stat(p); return st.size + ':' + st.mtimeMs; } catch (e) { return null; } }
async function rememberVerified(p) { const f = await fingerprint(p); if (f) sessionVerified.set(vKey(p), f); }

// Saves the app-default compiler. Accepts only an absolute path to xelatex|lualatex|pdflatex that passed verifyCompiler in this
// session (and is unchanged since); anything else is verified first. Never rejects.
async function setDefaultCompiler(input) {
  try {
    const t = parseCompilerInput(input);
    if (!t || !t.path) return verifyResult(false, 'resolve', 'invalid', 'Choose an absolute path to xelatex, lualatex or pdflatex.', null);
    const known = sessionVerified.get(vKey(t.path));
    if (!known || known !== await fingerprint(t.path)) {
      const v = await verifyCompiler(t.path, { configured: configuredFromSettings() });
      if (!v.ok) return v;
    }
    const r = await updateSettings((next) => {
      next.latex.compilerPath = t.path; next.latex.compilerName = t.name;
      next.latex.lastVerifiedOk = true; next.latex.lastVerifiedAt = new Date().toISOString();
    });
    return r.ok ? { ok: true, compilerPath: t.path, compilerName: t.name, state: r.state } : verifyResult(false, 'done', 'internal', r.error, t.path);
  } catch (e) { return verifyResult(false, 'start', 'internal', 'Could not set the default compiler: ' + String(e && e.message || e).slice(0, 300), null); }
}

// Binary for one real compile of `engine`. The stored path is used only for the engine it was verified as, and only while it is
// valid; otherwise the bare name is returned and the caller keeps its existing PATH behaviour. A stored path that no longer
// exists triggers ONE re-detection; if that finds nothing -> { ok:false, code:'NO_COMPILER' }. Never writes settings, never rejects.
async function resolveCompiler(engine) {
  const s = getSettings().latex;
  if (!s.compilerPath || s.compilerName !== engine) return { ok: true, bin: engine, source: 'path' };
  let c;
  try { c = await checkExecutable(s.compilerPath); } catch (e) { c = 'error'; }
  if (c === 'ok') return { ok: true, bin: s.compilerPath, source: 'configured' };
  if (c !== 'missing') return { ok: true, bin: engine, source: 'path' };   // unusable but present (permission, not a file): don't touch it, use PATH
  try {
    const r = (await detectCompilers({ configured: {} })).find((x) => x.name === engine);
    if (r && r.found) return { ok: true, bin: r.path, source: r.source };
    return { ok: false, code: 'NO_COMPILER', saved: s.compilerPath, detail: r && r.error || null };
  } catch (e) { return { ok: false, code: 'NO_COMPILER', saved: s.compilerPath, detail: String(e && e.message || e) }; }
}

// One fresh search for a single engine (PATH is re-read from this process; on Windows also from the registry), so a TeX installed
// while Plum is running is found without a restart. Never rejects; null when it really is not there.
async function locateCompiler(engine) {
  try { const r = (await detectCompilers({ configured: {} })).find((x) => x.name === engine); return r && r.found ? r.path : null; }
  catch (e) { return null; }
}

// Cheap launch-time check of latex.compilerPath: one stat, no process is started and nothing is written.
// -> { ok:true, path:null|string, status:'none'|'ok'|'missing'|'notfile'|'permission'|'error' }
async function checkStored() {
  const p = getSettings().latex.compilerPath;
  if (!p) return { ok: true, path: null, status: 'none' };
  try { return { ok: true, path: p, status: await checkExecutable(p) }; } catch (e) { return { ok: true, path: p, status: 'error' }; }
}

// ---- OS info (diagnostics only; read-only) ---------------------------------------------------------------------------
function parseOsRelease(text) {
  const kv = {};
  for (const line of String(text).split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
    kv[m[1]] = v.slice(0, 200);
  }
  return { id: kv.ID ? kv.ID.toLowerCase() : null, idLike: (kv.ID_LIKE || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10), prettyName: kv.PRETTY_NAME || null };
}

async function getOsInfo() {
  const appImage = process.platform === 'linux' && Boolean(process.env.APPIMAGE);
  if (process.platform !== 'linux') return { platform: process.platform, appImage };
  try {
    return Object.assign({ platform: 'linux' }, parseOsRelease((await fsp.readFile('/etc/os-release', 'utf8')).slice(0, 65536)), { appImage });
  } catch (e) {
    return { platform: 'linux', id: null, idLike: [], prettyName: null, appImage, error: 'Could not read /etc/os-release: ' + String(e && e.code || e && e.message || e) };
  }
}

// ---- External links ---------------------------------------------------------------------------------------------------
const EXTERNAL_HOSTS = ['miktex.org', 'tug.org', 'www.latex-project.org', 'docs.fedoraproject.org', 'wiki.archlinux.org', 'wiki.debian.org', 'help.ubuntu.com', 'packages.fedoraproject.org', 'archlinux.org'];

async function openExternalSafe(url, shell) {
  try {
    if (typeof url !== 'string' || !url || url.length > 2048) return { ok: false, error: 'Invalid URL.' };
    let u;
    try { u = new URL(url); } catch (e) { return { ok: false, error: 'Invalid URL.' }; }
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return { ok: false, error: 'Only plain https links are allowed.' };
    if (!EXTERNAL_HOSTS.includes(u.hostname)) return { ok: false, error: 'This site is not on the allowed list.' };
    if (!shell || typeof shell.openExternal !== 'function') return { ok: false, error: 'Opening links is not available.' };
    await shell.openExternal(u.href);
    return { ok: true, error: null };
  } catch (e) { return { ok: false, error: 'Could not open the link: ' + String(e && e.message || e).slice(0, 200) }; }
}

const CH_VERIFY = 'plum:latex:verify', CH_CANCEL = 'plum:latex:verify-cancel', CH_STAGE = 'plum:latex:verify-stage', CH_OS = 'plum:system:os-info', CH_OPEN = 'plum:system:open-external';
const CH_SETUP_GET = 'plum:setup:get', CH_SETUP_SAVE = 'plum:setup:save', CH_SET_DEFAULT = 'plum:latex:set-default', CH_STORED = 'plum:latex:stored-check';
const configuredFromSettings = () => { const l = getSettings().latex; return l.compilerPath ? { [l.compilerName]: l.compilerPath } : {}; };   // default for getConfigured

function registerLatexIpc(ipcMain, { getConfigured, shell } = {}) {
  if (typeof getConfigured !== 'function') getConfigured = configuredFromSettings;
  ipcMain.handle(CHANNEL, async (event, ...args) => {
    if (args.length) throw new Error('plum.latex.detect takes no arguments');
    let configured = {};
    try { configured = (typeof getConfigured === 'function' && getConfigured()) || {}; } catch (e) { configured = {}; }
    return detectCompilers({ configured });
  });
  // The handlers below never throw into the renderer: bad input and internal errors come back as { ok:false, ... }.
  ipcMain.handle(CH_VERIFY, async (event, ...args) => {
    if (args.length !== 1) return verifyResult(false, 'start', 'invalid', 'verifyCompiler takes exactly one argument.', null);
    let configured = {};
    try { configured = (typeof getConfigured === 'function' && getConfigured()) || {}; } catch (e) { configured = {}; }
    return verifyCompiler(args[0], { configured });
  });
  ipcMain.handle(CH_SETUP_GET, async (event, ...args) => args.length ? { ok: false, error: 'getSetupState takes no arguments.' } : { ok: true, state: getSetupState() });
  ipcMain.handle(CH_SETUP_SAVE, async (event, ...args) => args.length !== 1 ? { ok: false, error: 'saveSetupState takes exactly one argument.' } : saveSetupState(args[0]));
  ipcMain.handle(CH_SET_DEFAULT, async (event, ...args) => args.length !== 1 ? verifyResult(false, 'start', 'invalid', 'setDefaultCompiler takes exactly one argument.', null) : setDefaultCompiler(args[0]));
  ipcMain.handle(CH_STORED, async (event, ...args) => args.length ? { ok: false, error: 'checkStored takes no arguments.' } : checkStored());
  ipcMain.handle(CH_CANCEL, async (event, ...args) => args.length ? { ok: false, error: 'cancelVerify takes no arguments.' } : cancelVerify());
  ipcMain.handle(CH_STAGE, async (event, ...args) => args.length ? { ok: false, error: 'verifyStage takes no arguments.' } : verifyStage());
  ipcMain.handle(CH_OS, async (event, ...args) => {
    if (args.length) return { platform: 'unknown', appImage: false, error: 'getOsInfo takes no arguments.' };
    try { return await getOsInfo(); } catch (e) { return { platform: 'unknown', appImage: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle(CH_OPEN, async (event, ...args) => args.length !== 1 ? { ok: false, error: 'openExternalSafe takes exactly one argument.' } : openExternalSafe(args[0], shell));
}

function exposeLatexBridge(contextBridge, ipcRenderer) {
  // Validates in the preload as well as in main; failures resolve to { ok:false, ... } and never reject.
  const call = async (channel, bad, args) => { try { return await ipcRenderer.invoke(channel, ...args); } catch (e) { return Object.assign({}, bad, { message: String(e && e.message || e), error: String(e && e.message || e) }); } };
  const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const badVerify = verifyResult(false, 'start', 'invalid', 'Invalid compiler.', null);
  const badOs = { platform: 'unknown', appImage: false };
  contextBridge.exposeInMainWorld('plum', {
    latex: {
      detect: () => ipcRenderer.invoke(CHANNEL),
      verifyCompiler: (pathOrName) => str(pathOrName, 500) ? call(CH_VERIFY, badVerify, [pathOrName]) : Promise.resolve(badVerify),
      cancelVerify: () => call(CH_CANCEL, { ok: false }, []),
      verifyStage: () => call(CH_STAGE, { ok: false }, []),
      checkStored: () => call(CH_STORED, { ok: false }, []),
      setDefaultCompiler: (absPath) => str(absPath, 500) ? call(CH_SET_DEFAULT, badVerify, [absPath]) : Promise.resolve(badVerify)
    },
    setup: {
      getSetupState: () => call(CH_SETUP_GET, { ok: false }, []),
      saveSetupState: (partial) => partial && typeof partial === 'object' && !Array.isArray(partial) ? call(CH_SETUP_SAVE, { ok: false }, [partial]) : Promise.resolve({ ok: false, error: 'saveSetupState needs an object.' })
    },
    system: {
      getOsInfo: () => call(CH_OS, badOs, []),
      openExternalSafe: (url) => str(url, 2048) ? call(CH_OPEN, { ok: false }, [url]) : Promise.resolve({ ok: false, error: 'Invalid URL.' })
    }
  });
}

module.exports = { detectCompilers, registerLatexIpc, exposeLatexBridge, verifyCompiler, cancelVerify, verifyStage, getOsInfo, openExternalSafe, compileArgs, getSetupState, saveSetupState, setDefaultCompiler, resolveCompiler, locateCompiler, checkStored, CHANNEL };
