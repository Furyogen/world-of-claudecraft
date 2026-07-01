const { app, BrowserWindow, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'app://worldofclaudecraft';
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const desktopLoginOrigin = (
  process.env.VITE_DESKTOP_LOGIN_ORIGIN ||
  process.env.VITE_DESKTOP_API_ORIGIN ||
  'https://worldofclaudecraft.com'
).replace(/\/+$/, '');
const deepLinkProtocol = 'worldofclaudecraft';
let mainWindow = null;
let pendingLoginCode = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function fileInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function registerAppProtocol() {
  const distDir = path.join(__dirname, '..', 'dist');
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const candidate = path.normalize(path.join(distDir, requestedPath));
    if (!fileInside(distDir, candidate)) {
      return new Response('not found', { status: 404 });
    }
    const hasExtension = path.extname(candidate) !== '';
    const filePath = fs.existsSync(candidate)
      ? candidate
      : hasExtension
        ? candidate
        : path.join(distDir, 'index.html');
    if (!fs.existsSync(filePath) || !fileInside(distDir, filePath)) {
      return new Response('not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// Deny-by-default: only the two permissions the game legitimately uses are granted
// (pointerLock for mouselook, fullscreen for the game view); everything else is
// refused. Both gates are set because they answer different call paths: the check
// handler is synchronous and returns a boolean, the request handler is asynchronous
// and answers via callback exactly once. Neither inspects webContents (it can be
// null in the check handler). Device access (WebHID / Web Serial / WebUSB) is denied
// outright via a third handler.
function lockDownPermissions() {
  const allowed = new Set(['pointerLock', 'fullscreen']);
  const { defaultSession } = session;
  defaultSession.setPermissionCheckHandler((_webContents, permission) => allowed.has(permission));
  defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowed.has(permission));
  });
  defaultSession.setDevicePermissionHandler(() => false);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'World of ClaudeCraft',
    backgroundColor: '#05070a',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openDesktopLogin() {
  const url = new URL('/desktop-login', desktopLoginOrigin);
  shell.openExternal(url.toString());
}

function deliverLoginCode(code) {
  pendingLoginCode = code;
  if (!mainWindow) return;
  mainWindow.webContents.send('desktop-login-code', code);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function handleDeepLink(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'worldofclaudecraft:' || parsed.hostname !== 'desktop-login') return;
  const code = parsed.searchParams.get('code');
  if (!code) return;
  deliverLoginCode(code);
}

ipcMain.handle('desktop-login-open-browser', () => {
  openDesktopLogin();
});

ipcMain.handle('desktop-login-take-code', () => {
  const code = pendingLoginCode;
  pendingLoginCode = null;
  return code;
});

if (process.defaultApp) {
  app.setAsDefaultProtocolClient(deepLinkProtocol, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(deepLinkProtocol);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${deepLinkProtocol}://`));
    if (url) handleDeepLink(url);
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  lockDownPermissions();
  createMainWindow();
  const initialDeepLink = process.argv.find((arg) => arg.startsWith(`${deepLinkProtocol}://`));
  if (initialDeepLink) handleDeepLink(initialDeepLink);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
