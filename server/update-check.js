'use strict';
/*
 * update-check.js: "a newer release exists" notice for Laurevine Plum. It is NOT an updater: nothing is downloaded or installed.
 * Runs in the main process only; the page never sees the network or the manifest, just the sanitised notice (version, name, date, notes).
 *
 * REMOTE MANIFEST: plum.json at the repository root, fetched from MANIFEST_URL once per launch.
 *   {
 *     "version": "1.2.0",                    semver of the newest release
 *     "name": "Laurevine Plum",
 *     "releaseDate": "2026-11-01",           ISO 8601
 *     "minimumSupportedVersion": "1.0.0",    installed versions older than this are not notified (see docs in README.md)
 *     "releaseNotes": "Markdown text",       shown as Markdown (HTML in it is shown as text)
 *     "downloads": { "linux": "https://github.com/...", "windows": "https://github.com/..." }
 *   }
 * Every field above is required, and downloads must hold a valid https URL (host in ALLOWED_HOSTS) for the platform the app runs on.
 * If anything is missing or invalid, or the request fails in any way, the check is silently skipped: no notice, no error.
 *
 * LOCAL STATE (separate from the manifest): <userData>/update-state.json
 *   { "dismissedVersion": "", "lastCheckedVersion": "" }   dismissedVersion = "Not now" was chosen for that version, never shown again
 *
 * Notice actions: install (open the download page in the OS browser, shown again next launch), later (nothing saved: shown again
 * next launch), skip ("Not now": saved, that version is never shown again; a newer one is).
 */
const fs = require('fs');
const path = require('path');

const MANIFEST_URL = 'https://raw.githubusercontent.com/biowess/laurevine-plum/main/plum.json';   // CONFIGURE: raw URL of plum.json in the GitHub repository
const ALLOWED_HOSTS = new Set(['github.com', 'biowess-dev.github.io']);                      // hosts a download link may point to
const TIMEOUT_MS = 8000;
const MAX_MANIFEST_CHARS = 65536;
const MAX_NOTES_CHARS = 4000;
const STATE_FILE = 'update-state.json';
const PLATFORM_KEY = { win32: 'windows', linux: 'linux' };   // anything else (e.g. macOS) has no download entry, so no notice

// ---- semantic versions (semver.org precedence; build metadata ignored) ----
const SEMVER = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
function parseVersion(v) {
  const m = typeof v === 'string' ? SEMVER.exec(v.trim()) : null;
  return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
}
function compareVersions(a, b) {   // -1 | 0 | 1; both must already be parsed
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] < b.n[i] ? -1 : 1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;   // a release outranks its pre-releases
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { if (+x !== +y) return +x < +y ? -1 : 1; }
    else if (nx !== ny) return nx ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function safeUrl(u) {   // https only, no credentials, expected hosts only; returns the normalised URL or ''
  if (typeof u !== 'string' || u.length > 2048) return '';
  try {
    const p = new URL(u.trim());
    return p.protocol === 'https:' && !p.username && !p.password && ALLOWED_HOSTS.has(p.hostname) ? p.href : '';
  } catch (e) { return ''; }
}

function validate(m, installed) {   // -> { version, name, releaseDate, notes, url } or null
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const rv = parseVersion(m.version), min = parseVersion(m.minimumSupportedVersion);
  if (!rv || !min || compareVersions(min, rv) > 0) return null;
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 100) return null;
  if (typeof m.releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(m.releaseDate) || Number.isNaN(Date.parse(m.releaseDate))) return null;
  if (typeof m.releaseNotes !== 'string' || !m.releaseNotes.trim()) return null;
  const key = PLATFORM_KEY[process.platform];
  const url = key && m.downloads && typeof m.downloads === 'object' ? safeUrl(m.downloads[key]) : '';
  if (!url) return null;
  if (compareVersions(rv, installed) <= 0 || compareVersions(installed, min) < 0) return null;   // not newer, or not compatible with this install
  return { version: m.version.trim().replace(/^v/, ''), name: m.name.trim(), releaseDate: m.releaseDate.trim(), notes: m.releaseNotes.trim().slice(0, MAX_NOTES_CHARS), url };
}

function create({ app, net, shell }) {
  let notice = null, started = false;
  const statePath = () => path.join(app.getPath('userData'), STATE_FILE);

  function readState() {   // missing, unreadable or malformed file: defaults
    const s = { dismissedVersion: '', lastCheckedVersion: '' };
    try {
      const j = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
      if (j && typeof j === 'object') for (const k of Object.keys(s)) if (typeof j[k] === 'string' && j[k].length < 100) s[k] = j[k];
    } catch (e) { /* defaults */ }
    return s;
  }
  function writeState(patch) {
    try {
      const file = statePath(), tmp = file + '.tmp';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(Object.assign(readState(), patch), null, 2));
      fs.renameSync(tmp, file);
    } catch (e) { /* nothing to save to: the notice just shows again next launch */ }
  }

  async function fetchManifest() {
    const res = await net.fetch(MANIFEST_URL, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > MAX_MANIFEST_CHARS ? null : JSON.parse(text);
  }

  async function start(onFound) {   // once per launch; never throws, never retries
    if (started) return;
    started = true;
    try {
      const installed = parseVersion(app.getVersion());
      if (!installed) return;
      const found = validate(await fetchManifest(), installed);
      if (!found) return;
      const st = readState();
      writeState({ lastCheckedVersion: found.version });
      const dismissed = parseVersion(st.dismissedVersion);
      if (dismissed && compareVersions(parseVersion(found.version), dismissed) <= 0) return;   // this version was dismissed; a newer one is not
      notice = found;
      if (typeof onFound === 'function') onFound(publicNotice());
    } catch (e) { /* offline, DNS, HTTP, JSON, timeout...: silently no notice */ }
  }

  const publicNotice = () => notice ? { version: notice.version, name: notice.name, releaseDate: notice.releaseDate, notes: notice.notes } : null;   // the URL stays in this process

  function act(action) {
    const n = notice;
    if (!n) return { ok: false };
    if (action === 'install') {
      const url = safeUrl(n.url);
      if (url) shell.openExternal(url).catch(() => {});   // the user's real browser; nothing is saved, so the notice returns next launch until they update
      notice = null;
      return { ok: !!url };
    }
    if (action === 'skip') { writeState({ dismissedVersion: n.version }); notice = null; return { ok: true }; }
    if (action === 'later') { notice = null; return { ok: true }; }   // nothing saved
    return { ok: false };
  }

  return { start, getNotice: publicNotice, act };
}

module.exports = { create, parseVersion, compareVersions, MANIFEST_URL };