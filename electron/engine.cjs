// Native UCI engine bridge (main-process side).
//
// This lets the renderer talk to any UCI chess engine binary (Stockfish,
// Leela, etc.) installed on the machine. The renderer-side adapter lives in
// src/engine/nativeUci.ts. Nothing is spawned until the renderer explicitly
// asks for a specific binary path, so the app works fine without an engine.
//
// Protocol (all via ipcRenderer.invoke unless noted):
//   engine:default-path ()     -> string | null  bundled Stockfish, if present
//   engine:start  (binaryPath) -> { ok: true } | { ok: false, error }
//   engine:send   (line)       -> void          write one UCI command line
//   engine:stop   ()           -> void          kill the process
//   engine:line   (event, line)                 main -> renderer, one stdout line
//   engine:exit   (event, code)                 main -> renderer
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// Official Stockfish release binaries, per platform, expected in ./stockfish
// (see scripts/fetch-stockfish.mjs). Packaged builds copy that folder into
// the app's resources directory (package.json -> build.extraResources).
const BUNDLED_BINARY = {
  darwin: 'stockfish-macos-universal',
  linux: 'stockfish-ubuntu-x86-64-avx2',
  win32: 'stockfish-windows-x86-64-avx2.exe',
}[process.platform];

/** Absolute path of the bundled Stockfish binary, or null when absent. */
function bundledEnginePath() {
  if (!BUNDLED_BINARY) return null;
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const candidate = path.join(base, 'stockfish', BUNDLED_BINARY);
  return fs.existsSync(candidate) ? candidate : null;
}

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let proc = null;

function stopEngine() {
  if (proc) {
    try {
      proc.stdin.write('quit\n');
    } catch {
      /* ignore */
    }
    proc.kill();
    proc = null;
  }
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {() => import('electron').BrowserWindow | null} getWin
 */
function registerEngineIpc(ipcMain, getWin) {
  ipcMain.handle('engine:default-path', () => bundledEnginePath());

  ipcMain.handle('engine:start', (_evt, binaryPath) => {
    stopEngine();
    if (typeof binaryPath !== 'string' || !fs.existsSync(binaryPath)) {
      return { ok: false, error: `Engine binary not found: ${binaryPath}` };
    }
    try {
      proc = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return { ok: false, error: String(err) };
    }

    let buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        const win = getWin();
        if (win && !win.isDestroyed()) win.webContents.send('engine:line', line);
      }
    });
    proc.on('exit', (code) => {
      proc = null;
      const win = getWin();
      if (win && !win.isDestroyed()) win.webContents.send('engine:exit', code);
    });
    return { ok: true };
  });

  ipcMain.handle('engine:send', (_evt, line) => {
    if (proc && typeof line === 'string') proc.stdin.write(line + '\n');
  });

  ipcMain.handle('engine:stop', () => stopEngine());
}

module.exports = { registerEngineIpc, stopEngine, bundledEnginePath };
