'use strict';
/*
 * main.js: Electron main process for Laurevine Plum (thin shell around the existing local server).
 *
 *  1. Starts server/server.js IN THIS PROCESS, bound to 127.0.0.1:5174.
 *     If that port is taken, the app stops with a message. It never attaches to whatever is listening there:
 *     the window is only ever pointed at a server this process bound itself.
 *  2. Opens one BrowserWindow (frameless: the page draws its own title bar) on http://localhost:5174, the origin the README documents, with
 *     contextIsolation on and nodeIntegration off. "localhost" is pinned to 127.0.0.1 inside Chromium
 *     (host-resolver-rules), so it can never resolve to ::1 and reach a different program on that port; a
 *     response-IP tripwire (configureSession) stops the app if it ever does.
 *  3. Registers the existing plum:* IPC handlers (server/latex-detect.js) for that window's top frame only.
 *  4. Sends http(s) links to the OS browser and blocks every other navigation or popup.
 *  5. Stops the server cleanly on quit.
 *  6. Packaged builds only: shows assets/splash.png (via assets/splash.html, loaded from app.asar.unpacked) while the server
 *     starts. The main window is created only after the server is listening, stays hidden until it has painted AND the page
 *     reports it is ready (plum:win:ready), and the splash is closed only after the main window is visible and the splash
 *     has been on screen for SPLASH_MIN_MS (timed from when it was shown). Every wait has a timeout.
 *  7. Window controls (plumDesktop bridge, see preload.js): minimize / maximize-restore / close and the maximized state,
 *     plus a "wizard mode" in which the same window becomes a compact, fixed-size, non-resizable, non-maximizable window
 *     for the setup wizard. Every channel is accepted only through trusted() below.
 *  8. Release notice (server/update-check.js): once per launch, a few seconds after the window is shown, plum.json is fetched from GitHub and,
 *     if it describes a newer compatible release, the page is told (plum:update:available) and shows a dialog. Never an updater.
 *
 * The origin is fixed on purpose: localStorage / IndexedDB (prefs, recents, citation library, comments,
 * draft recovery) are per-origin AND per Electron profile. The profile folder is named after productName in
 * package.json ("Laurevine Plum"), so keep both stable. The Electron window cannot read a normal browser's copy
 * of this data, whatever the origin.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, net, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const HOST = '127.0.0.1';          // what the server binds to
const NAME = 'localhost';          // what the page's origin is called
const PORT = 5174;
const ORIGIN = `http://${NAME}:${PORT}`;
const APP_ID = 'com.biowess.laurevineplum';   // Windows AppUserModelID: must equal build.appId in package.json (the installer's shortcuts carry it)
const WINDOW_ICON_PX = 256;                   // runtime window/taskbar icon size; the 2560px source is far too large to hand to the window system as is
const LOOPBACK_IPS = new Set(['127.0.0.1', '::ffff:127.0.0.1']);
const SPLASH_W = 640, SPLASH_H = 380;   // splash.png is 2560x1519 (same aspect), so it is never stretched
const SPLASH_BG = '#182159';            // the artwork's edge colour, so nothing lighter shows before it paints
const SPLASH_MIN_MS = 2500;             // shortest time the splash stays up, counted from the moment it is shown
const SPLASH_LOAD_MS = 4000;            // give up on the splash (and start anyway) if it has not painted by then
const SERVER_START_MS = 30000;          // the built-in server must be listening by then
const MAIN_LOAD_MS = 30000;             // the main window must have painted by then
const APP_READY_MS = 12000;             // if the page never reports "ready", the window is shown anyway this long after it painted
const MAIN_W = 1440, MAIN_H = 900, MAIN_MIN_W = 900, MAIN_MIN_H = 600;   // main window
const WIZARD_W = 920, WIZARD_H = 575;   // setup-wizard window (8:5, like assets/wizard-bg.png); fixed size
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);   // Paste / Copy buttons; everything else is denied

app.commandLine.appendSwitch('host-resolver-rules', `MAP ${NAME} ${HOST}`);   // must be set before the app is ready
// Windows: without this the running window is not tied to the installed shortcut, so the taskbar can group it under a different identity.
// Linux identity (desktop entry / app_id / WM_CLASS) comes from "desktopName" in package.json, which Electron applies at startup.
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

if (process.platform === 'darwin') {   // apps started from Finder get a minimal PATH; xelatex needs xdvipdfmx, and the server calls bibtex/biber/python3/fc-list by name
  const have = (process.env.PATH || '').split(':').filter(Boolean);
  const extra = ['/Library/TeX/texbin', '/opt/homebrew/bin', '/usr/local/bin'].filter((d) => !have.includes(d));
  if (extra.length) process.env.PATH = have.concat(extra).join(':');   // appended, so the user's own PATH order still wins
}

const { registerLatexIpc, getSetupState } = require('./server/latex-detect');
const plumServer = require('./server/server');
const updater = require('./server/update-check').create({ app, net, shell });   // release notice only: never downloads or installs (see server/update-check.js)
const UPDATE_DELAY_MS = 3000;   // the check starts this long after the main window is shown, so it never competes with startup

let win = null;
let serverDown = false;
let forceQuit = false;   // SIGINT/SIGTERM: quit without the unsaved-changes prompt
let tainted = false;     // the origin answered from somewhere other than our own socket: trust nothing
let splash = null;       // startup splash (packaged builds only)
let splashSince = 0;     // when the splash became visible
let starting = true;     // until the main window exists, closing the splash must not count as "all windows closed"
let quitting = false;    // the app is on its way out (also set if the user closes the splash): do not start anything new
let failed = false;      // fatal() already ran
let mainShown = false;
let mainTimer = null;
let readyTimer = null;   // failsafe for appReady
let paintReady = false;  // the main window has painted (ready-to-show)
let appReady = false;    // the page reported that it finished starting up (or APP_READY_MS passed)
let revealQueued = false;
let wizardMode = false;  // the window is currently the compact setup-wizard window
let wizardSaved = null;  // { bounds, maximized } of the main window while wizardMode is on

const originOf = (url) => { try { return new URL(url).origin; } catch (e) { return null; } };

let windowIcon;   // cached: undefined = not tried yet, null = unavailable
function getWindowIcon() {   // the existing artwork (assets/appicon.png), scaled down for the window / taskbar / task switcher
  if (windowIcon !== undefined) return windowIcon || undefined;
  windowIcon = null;
  try {
    const img = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, 'assets', 'appicon.png')));   // fs (not createFromPath) so it also reads from inside app.asar
    if (!img.isEmpty()) windowIcon = img.resize({ width: WINDOW_ICON_PX, height: WINDOW_ICON_PX, quality: 'best' });
  } catch (e) { /* no icon rather than no app */ }
  return windowIcon || undefined;
}

function openExternal(url) {   // OS browser, http(s) only (never file:, javascript:, custom schemes)
  let u; try { u = new URL(url); } catch (e) { return; }
  if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== ORIGIN) shell.openExternal(u.href).catch(() => {});
}

function fatal(message) {   // hide the windows, show why, release the port, exit
  if (failed) return;
  failed = true;
  clearTimeout(mainTimer);
  closeSplash();
  if (win && !win.isDestroyed()) win.hide();
  dialog.showErrorBox('Laurevine Plum cannot start', message);
  plumServer.stop().catch(() => {}).finally(() => app.exit(1));
}

// ---- Startup splash (packaged builds only) ----
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function closeSplash() {
  const s = splash;
  splash = null;   // cleared first, so the 'closed' handler below can tell our own close from the user's
  if (s && !s.isDestroyed()) s.destroy();
}

function splashPage() {   // packaged: the page and its image sit OUTSIDE app.asar (package.json asarUnpack), so both load as plain files
  const rel = path.join('assets', 'splash.html');
  try {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', rel);
    if (fs.existsSync(unpacked) && fs.existsSync(path.join(path.dirname(unpacked), 'splash.png'))) return unpacked;
  } catch (e) { /* fall back to the copy inside the asar */ }
  return path.join(__dirname, rel);
}

function showSplash() {   // resolves once the splash is on screen, or has been given up on; never rejects
  if (splash) return Promise.resolve();   // never two splash windows
  return new Promise((resolve) => {
    let timer = null, settled = false, loaded = false, ready = false;
    const settle = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
    let s;
    try {
      s = new BrowserWindow({
        width: SPLASH_W, height: SPLASH_H, useContentSize: true, center: true,
        frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, show: false, title: 'Laurevine Plum', backgroundColor: SPLASH_BG, icon: getWindowIcon(),
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false, webSecurity: true, webviewTag: false, devTools: false, spellcheck: false }
      });
    } catch (e) { return settle(); }
    splash = s;
    const wc = s.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.on('will-attach-webview', (event) => event.preventDefault());
    const reveal = () => {   // only once the page has loaded (image included) AND painted: no blank or half-drawn splash
      if (s.isDestroyed() || splash !== s) return settle();
      if (!loaded || !ready) return;   // wait for the other event
      s.show(); splashSince = Date.now(); settle();   // the minimum-time clock starts when the splash is shown
    };
    wc.once('did-finish-load', () => { loaded = true; reveal(); });
    s.once('ready-to-show', () => { ready = true; reveal(); });
    wc.once('did-fail-load', () => { if (splash === s) closeSplash(); settle(); });
    s.on('closed', () => {
      if (splash !== s) return;   // closed by us
      splash = null; settle();    // closed by the user while the app is still starting: that means "cancel"
      if (!win) { quitting = true; app.quit(); }
    });
    timer = setTimeout(() => { if (splash === s && !s.isVisible()) closeSplash(); settle(); }, SPLASH_LOAD_MS);
    s.loadFile(splashPage()).catch(() => { if (splash === s) closeSplash(); settle(); });
  });
}

function maybeReveal() {   // show the main window only once it has painted AND the page is ready; then (after the splash's minimum time) drop the splash
  if (!paintReady || !appReady || mainShown || revealQueued) return;
  revealQueued = true;
  clearTimeout(mainTimer); clearTimeout(readyTimer);
  const wait = splash && splashSince ? Math.max(0, SPLASH_MIN_MS - (Date.now() - splashSince)) : 0;
  setTimeout(() => {
    if (tainted || failed || mainShown || !win || win.isDestroyed()) return;
    mainShown = true;
    if (wizardMode) centerWizard(win);   // the window system may have moved it while hidden
    win.show();
    closeSplash();   // after show(), so the screen is never empty in between
    setTimeout(() => { try { updater.start(pushUpdate); } catch (e) { /* the update check must never affect the app */ } }, UPDATE_DELAY_MS);
  }, wait);
}

// ---- IPC: the latex-detect handlers, accepted only from this window's top frame on our own origin ----
function trusted(event) {
  try {
    const f = event.senderFrame;
    return !tainted && !!win && event.sender === win.webContents && !!f && f.parent === null && originOf(f.url) === ORIGIN;
  } catch (e) { return false; }
}

// ---- Window controls and wizard mode (window.plumDesktop in preload.js) ----
const winAlive = () => !!win && !win.isDestroyed();
const maximizedNow = () => winAlive() && (win.isMaximized() || win.isFullScreen());
function pushMaximized() {   // tell the page, whatever caused the change (button, double-click on the bar, snap, keyboard, ...)
  if (winAlive() && !win.webContents.isDestroyed()) win.webContents.send('plum:win:maximized-changed', maximizedNow());
}
function setupPending() {   // same test as the page's setupStartup(): the wizard can only open while setup.completed is not true
  try { const st = getSetupState(); return !(st && st.setup && st.setup.completed === true); } catch (e) { return false; }
}
function centerWizard(w) {   // exact centre of the work area of the screen the app was launched from (the one under the cursor), set after the size is locked
  try {
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    w.setBounds({ x: Math.round(wa.x + (wa.width - WIZARD_W) / 2), y: Math.round(wa.y + (wa.height - WIZARD_H) / 2), width: WIZARD_W, height: WIZARD_H });
  } catch (e) { w.center(); }
}
function setWizardMode(on) {   // the wizard is shown in the same window, which becomes compact, fixed-size and non-maximizable at the BrowserWindow level
  if (!winAlive() || on === wizardMode) return;
  const w = win;
  wizardMode = on;
  if (on) {
    wizardSaved = { bounds: w.getNormalBounds(), maximized: w.isMaximized() };
    const lock = () => {
      if (!wizardMode || w.isDestroyed()) return;
      w.setMaximizable(false); w.setFullScreenable(false);
      w.setResizable(true); w.setMinimumSize(0, 0); w.setMaximumSize(0, 0);   // so the OS accepts the new size first
      w.setSize(WIZARD_W, WIZARD_H);
      w.setMinimumSize(WIZARD_W, WIZARD_H); w.setMaximumSize(WIZARD_W, WIZARD_H); w.setResizable(false);
      centerWizard(w);
    };
    let ran = false; const run = () => { if (ran) return; ran = true; lock(); };
    if (w.isFullScreen()) { w.once('leave-full-screen', run); setTimeout(run, 1000); w.setFullScreen(false); }
    else if (w.isMaximized()) { w.once('unmaximize', run); setTimeout(run, 500); w.unmaximize(); }
    else run();
  } else {
    w.setResizable(true); w.setMaximumSize(0, 0); w.setMinimumSize(MAIN_MIN_W, MAIN_MIN_H); w.setMaximizable(true); w.setFullScreenable(true);
    const saved = wizardSaved; wizardSaved = null;
    if (saved) { w.setBounds(saved.bounds); if (saved.maximized) w.maximize(); }
    pushMaximized();
  }
}

function pushUpdate(notice) {   // main -> page: a newer release is available (the page also asks once, in case this fired before it was listening)
  if (winAlive() && !win.webContents.isDestroyed()) win.webContents.send('plum:update:available', notice);
}

function registerIpc() {
  const guarded = { handle: (channel, fn) => ipcMain.handle(channel, (event, ...args) => { if (!trusted(event)) throw new Error('Untrusted IPC sender.'); return fn(event, ...args); }) };
  registerLatexIpc(guarded, { shell });
  guarded.handle('plum:win:minimize', () => { if (winAlive()) win.minimize(); });
  guarded.handle('plum:win:toggle-maximize', () => {
    if (winAlive() && !wizardMode && !win.isFullScreen()) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }   // the wizard window can never be maximized
    return maximizedNow();
  });
  guarded.handle('plum:win:close', () => { if (winAlive()) win.close(); });   // goes through the normal close path (unsaved-changes prompt included)
  guarded.handle('plum:win:is-maximized', () => maximizedNow());
  guarded.handle('plum:win:wizard-mode', (event, on) => { if (!quitting) setWizardMode(on === true); });
  guarded.handle('plum:win:ready', () => { appReady = true; maybeReveal(); });
  guarded.handle('plum:update:get', () => updater.getNotice());   // { version, name, releaseDate, notes } or null
  guarded.handle('plum:update:act', (event, action) => ['install', 'later', 'skip'].includes(action) ? updater.act(action) : { ok: false });
}

function configureSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(ALLOWED_PERMISSIONS.has(permission) && originOf(details && details.requestingUrl) === ORIGIN));
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => ALLOWED_PERMISSIONS.has(permission) && requestingOrigin === ORIGIN);
  // Tripwire: every response from our origin must come from the loopback socket we own.
  ses.webRequest.onResponseStarted({ urls: [ORIGIN + '/*'] }, (details) => {
    if (tainted || !details.ip || LOOPBACK_IPS.has(details.ip)) return;
    tainted = true;
    fatal(`${ORIGIN} was answered from ${details.ip}, not by this app's own server on ${HOST}. Another program is using port ${PORT}.\n\nLaurevine Plum has stopped instead of loading it.`);
  });
}

function buildMenu() {
  // The app has its own ribbon, shortcuts and undo history, so no default menu (its Reload / DevTools / Undo accelerators
  // would fight the page). macOS needs a minimal one for Cmd+Q / Cmd+C / Cmd+V; Undo/Redo are left out on purpose.
  if (process.platform !== 'darwin') return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { role: 'windowMenu' }
  ]));
}

function createWindow() {
  if (win || quitting) return;   // never two main windows
  win = new BrowserWindow({
    width: MAIN_W, height: MAIN_H, minWidth: MAIN_MIN_W, minHeight: MAIN_MIN_H,
    frame: false,   // no native title bar: the page draws its own (index.html .titlebar, plumDesktop bridge)
    show: false, title: 'Laurevine Plum', backgroundColor: '#ffffff',
    icon: getWindowIcon(),   // window / taskbar / task-switcher icon (the packaged .exe and Linux desktop-entry icons come from the build config)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: false,   // required: the preload require()s server/latex-detect.js (a sandboxed preload cannot load local modules)
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });
  starting = false;
  const wc = win.webContents;
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, pushMaximized);
  if (setupPending()) setWizardMode(true);   // first run: start directly in the compact wizard window (still hidden), so nothing resizes on screen

  // Only our own origin may be shown in this window; links go to the OS browser.
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  const guardNav = (event, url) => { if (originOf(url) !== ORIGIN) { event.preventDefault(); openExternal(url); } };
  wc.on('will-navigate', guardNav);
  wc.on('will-redirect', guardNav);
  wc.on('will-attach-webview', (event) => event.preventDefault());

  // The page asks for a confirmation when there are unsaved changes (beforeunload). Electron would otherwise
  // block the window from closing with no prompt at all, so show one. File ▸ Exit in the app has its own Save / Don't Save flow.
  wc.on('will-prevent-unload', (event) => {
    if (forceQuit) return event.preventDefault();   // terminated by signal: do not block on a dialog
    const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1, title: 'Unsaved changes', message: 'You have unsaved changes.', detail: 'If you leave now, they will be lost.' });
    if (choice === 0) event.preventDefault();   // ignore the page's beforeunload veto and close
  });

  win.once('ready-to-show', () => {   // stays hidden until it has painted AND the page says it is ready (no blank flash)
    paintReady = true; clearTimeout(mainTimer);
    readyTimer = setTimeout(() => { appReady = true; maybeReveal(); }, APP_READY_MS);
    maybeReveal();
  });
  mainTimer = setTimeout(() => { if (!mainShown) fatal('The app window did not finish loading ' + ORIGIN + ' within ' + (MAIN_LOAD_MS / 1000) + ' seconds.'); }, MAIN_LOAD_MS);
  win.on('closed', () => { win = null; });
  win.loadURL(ORIGIN + '/').catch((err) => fatal('The app window could not load ' + ORIGIN + '.\n\n' + ((err && err.message) || err)));
}

async function boot() {
  if (app.isPackaged) await showSplash();   // visible before the server starts, so it is on screen while the server comes up
  if (quitting) return;
  try {
    await withTimeout(plumServer.start(PORT, HOST), SERVER_START_MS, 'The server did not start listening within ' + (SERVER_START_MS / 1000) + ' seconds.');
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') return fatal(`Port ${PORT} on ${HOST} is already in use by another program (possibly another copy of Laurevine Plum, or "node server/server.js").\n\nLaurevine Plum will not connect to a server it did not start. Close that program and open Laurevine Plum again.`);
    return fatal(`The built-in server could not start on ${HOST}:${PORT}.\n\n${(err && err.message) || err}`);
  }
  const a = plumServer.server.address();   // we bound it ourselves; confirm it is exactly the socket we are about to talk to
  if (!a || typeof a !== 'object' || a.address !== HOST || a.port !== PORT) return fatal(`The built-in server is not listening on ${HOST}:${PORT}.`);
  if (quitting) return;
  configureSession(); registerIpc(); buildMenu(); createWindow();
}

if (!app.requestSingleInstanceLock()) {   // a second copy could not bind the port anyway; focus the first one instead
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!starting) app.quit(); });   // while starting, the splash alone coming and going must not quit the app
  app.on('will-quit', (event) => {   // after every window has really closed (so a "Stay" on unsaved work cancels the quit before this runs)
    if (serverDown) return;
    event.preventDefault();
    plumServer.stop().catch(() => {}).finally(() => { serverDown = true; app.quit(); });   // app.quit() (not exit) so Chromium flushes localStorage / IndexedDB
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { forceQuit = true; app.quit(); });
  app.whenReady().then(boot);
}