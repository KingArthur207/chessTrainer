// Preload: the only bridge between the sandboxed renderer and Electron.
// Everything exposed here is typed in src/lib/platform.ts.
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Subscribe to a main -> renderer channel. Returns an unsubscribe function.
 * @param {string} channel
 * @param {(payload: unknown) => void} cb
 */
function on(channel, cb) {
  const listener = (_evt, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('chessTrainer', {
  platform: 'electron',
  os: process.platform,
  window: {
    toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
    isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
    onFullscreenChange: (cb) => on('window:fullscreen-changed', cb),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
  net: {
    fetchText: (url, options) => ipcRenderer.invoke('net:fetch-text', url, options),
  },
  engine: {
    defaultPath: () => ipcRenderer.invoke('engine:default-path'),
    start: (binaryPath) => ipcRenderer.invoke('engine:start', binaryPath),
    send: (line) => ipcRenderer.invoke('engine:send', line),
    stop: () => ipcRenderer.invoke('engine:stop'),
    onLine: (cb) => on('engine:line', cb),
    onExit: (cb) => on('engine:exit', cb),
  },
});
