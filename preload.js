'use strict';
/*
 * preload.js: exposes the existing window.plum bridge (latex / setup / system) plus window.plumDesktop, and nothing else.
 * The channel names, argument validation and result shapes live in server/latex-detect.js, which
 * remains the single source of truth for this contract (main.js registers the matching handlers).
 *
 * window.plumDesktop is the only other thing exposed: a fixed set of window-control calls for the page's own title
 * bar (the window is frameless). Each method maps to one channel that main.js accepts only from this window's top
 * frame on our own origin; no ipcRenderer, no event object and no Electron API ever reaches the page.
 *
 * This preload requires a local module, which Electron only allows with sandbox: false (see main.js).
 * contextIsolation stays on and nodeIntegration stays off, so the page itself never sees Node.
 */
const { contextBridge, ipcRenderer } = require('electron');
const { exposeLatexBridge } = require('./server/latex-detect');

exposeLatexBridge(contextBridge, ipcRenderer);

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch(() => undefined);   // untrusted sender or window gone: nothing to report
contextBridge.exposeInMainWorld('plumDesktop', Object.freeze({
  minimize: () => call('plum:win:minimize'),
  toggleMaximize: () => call('plum:win:toggle-maximize'),   // resolves to the new maximized state (boolean)
  close: () => call('plum:win:close'),
  isMaximized: () => call('plum:win:is-maximized'),          // resolves to a boolean
  onMaximizedChange: (cb) => {                               // cb(boolean) on every maximize/restore, however it was caused; returns an unsubscribe function
    if (typeof cb !== 'function') return () => {};
    const handler = (event, maximized) => { try { cb(maximized === true); } catch (e) { /* page callback failed */ } };
    ipcRenderer.on('plum:win:maximized-changed', handler);
    return () => { ipcRenderer.removeListener('plum:win:maximized-changed', handler); };
  },
  setWizardMode: (on) => call('plum:win:wizard-mode', on === true),   // compact fixed-size window for the setup wizard on / off
  ready: () => call('plum:win:ready'),                                  // the page has finished starting up: the window may be shown
  getUpdate: () => call('plum:update:get'),                             // resolves to { version, name, releaseDate, notes } when a newer release was found, else null
  updateAction: (a) => call('plum:update:act', a === 'install' || a === 'later' || a === 'skip' ? a : ''),   // install: open the download page in the browser · later: ask again next launch · skip: never show this version again
  onUpdate: (cb) => {                                                   // cb(notice) when the check finds one; returns an unsubscribe function
    if (typeof cb !== 'function') return () => {};
    const handler = (event, notice) => { try { cb(notice); } catch (e) { /* page callback failed */ } };
    ipcRenderer.on('plum:update:available', handler);
    return () => { ipcRenderer.removeListener('plum:update:available', handler); };
  }
}));