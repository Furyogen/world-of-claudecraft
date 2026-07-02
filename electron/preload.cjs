const { contextBridge, ipcRenderer } = require('electron');

// Forward every uncaught renderer error and unhandled promise rejection to the
// main-process log file. The preload runs before any page script, so the
// listeners exist before the first game frame executes; the payload is clamped
// here AND re-validated in main (electron/diagnostics.cjs rendererErrorLogEntry,
// which also enforces its own per-session cap without trusting this one).
const MAX_FORWARDED_ERRORS = 30;
const MAX_TEXT = 4000;
let forwardedErrors = 0;

const clampString = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function forwardRendererError(payload) {
  if (forwardedErrors >= MAX_FORWARDED_ERRORS) return;
  forwardedErrors += 1;
  try {
    ipcRenderer.send('desktop-renderer-error', payload);
  } catch {
    // Never let diagnostics break the page.
  }
}

window.addEventListener('error', (event) => {
  forwardRendererError({
    kind: 'error',
    message: clampString(event?.message, MAX_TEXT),
    stack: clampString(event?.error?.stack, MAX_TEXT),
    source: clampString(event?.filename, 512),
    line: typeof event?.lineno === 'number' ? event.lineno : undefined,
    col: typeof event?.colno === 'number' ? event.colno : undefined,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  forwardRendererError({
    kind: 'unhandledrejection',
    message: clampString(typeof reason === 'string' ? reason : reason?.message, MAX_TEXT),
    stack: clampString(reason?.stack, MAX_TEXT),
  });
});

contextBridge.exposeInMainWorld('wocDesktop', {
  openBrowserLogin: () => ipcRenderer.invoke('desktop-login-open-browser'),
  takeLoginCode: () => ipcRenderer.invoke('desktop-login-take-code'),
  onLoginCode: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, code) => {
      if (typeof code === 'string') callback(code);
    };
    ipcRenderer.on('desktop-login-code', listener);
    return () => ipcRenderer.removeListener('desktop-login-code', listener);
  },
  // Push the renderer's t()-rendered shell strings (crash dialog text) to the
  // main process, which has no i18n runtime of its own. Fire-and-forget.
  setShellStrings: (strings) => {
    if (!strings || typeof strings !== 'object') return Promise.resolve(null);
    return ipcRenderer.invoke('desktop-set-strings', strings);
  },
});
