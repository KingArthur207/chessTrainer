// Electron main process.
// Responsibilities: create the full-screen window, wire IPC for window
// controls, and host the native UCI engine bridge (see ./engine.cjs).
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('node:path');
const { registerEngineIpc } = require('./engine.cjs');
const { registerNetIpc } = require('./net.cjs');

const DEV_URL = process.env.ELECTRON_START_URL;
// Set CHESS_TRAINER_WINDOWED=1 to start in a normal window (used by e2e tests).
const WINDOWED = process.env.CHESS_TRAINER_WINDOWED === '1';
// Tests point this at a scratch folder so they never touch real user data.
if (process.env.CHESS_TRAINER_USER_DATA) app.setPath('userData', process.env.CHESS_TRAINER_USER_DATA);

/** @type {BrowserWindow | null} */
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    fullscreen: !WINDOWED,
    fullscreenable: true,
    show: false,
    backgroundColor: '#0f1115',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win && win.show());
  win.setFullScreenable(true);

  // Open external links in the system browser rather than inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  const notifyFullscreen = () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:fullscreen-changed', win.isFullScreen());
  };
  win.on('enter-full-screen', notifyFullscreen);
  win.on('leave-full-screen', notifyFullscreen);

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('closed', () => {
    win = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Toggle Full Screen',
          accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11',
          click: () => toggleFullscreen(),
        },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Fullscreen helpers ---------------------------------------------------
// Native macOS fullscreen (its own Space) is used whenever the window allows
// it; otherwise fall back to "simple" fullscreen, which just covers the screen.
function isFullscreen(w) {
  return w.isFullScreen() || w.isSimpleFullScreen();
}

function toggleFullscreen() {
  if (!win) return false;
  const w = win;
  const notify = () => {
    if (!w.isDestroyed()) w.webContents.send('window:fullscreen-changed', isFullscreen(w));
  };
  if (w.isFullScreen()) {
    w.setFullScreen(false); // emits leave-full-screen
    return false;
  }
  if (w.isSimpleFullScreen()) {
    w.setSimpleFullScreen(false);
    setTimeout(notify, 50);
    return false;
  }
  if (w.isFullScreenable()) {
    w.setFullScreen(true); // emits enter-full-screen
  } else {
    w.setSimpleFullScreen(true);
    setTimeout(notify, 50);
  }
  return true;
}

// ---- IPC: window controls -------------------------------------------------
// The macOS transition is asynchronous, so the toggle reports the requested
// state; the renderer tracks the real state through fullscreen-changed events.
ipcMain.handle('window:toggle-fullscreen', () => toggleFullscreen());
ipcMain.handle('window:is-fullscreen', () => (win ? isFullscreen(win) : false));
ipcMain.handle('app:version', () => app.getVersion());

registerEngineIpc(ipcMain, () => win);
registerNetIpc(ipcMain);

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
