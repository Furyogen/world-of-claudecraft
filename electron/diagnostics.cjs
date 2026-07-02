'use strict';

// Pure, Node-testable diagnostics logic for the Electron shell's logging and
// crash handling (tests/electron_diagnostics.test.ts): renderer error payload
// validation, console-message normalization, renderer-exit classification, and
// the auto-reload-vs-dialog decision after a renderer crash. No electron
// imports; electron/main.cjs and electron/crash_guard.cjs are thin consumers.

// Upper bounds for anything a renderer (a compromised one included) can push
// into the main-process log over IPC: lengths are clamped, unknown keys are
// dropped, and the per-session forward cap is enforced on BOTH sides of the
// channel (preload counts too, but main never trusts the renderer's count).
const MAX_ERROR_TEXT = 4000;
const MAX_SOURCE_TEXT = 512;
const MAX_FORWARDED_ERRORS = 30;

function clampText(value, maxLength) {
  if (typeof value !== 'string') return '';
  // Strip control characters so a hostile payload cannot forge log lines
  // (\n injection) or emit terminal escapes; keep it single-line.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control chars is the point
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

// Best-effort redaction for log text that might embed a credential (the shell
// never logs tokens itself; this guards against a renderer error message or a
// console line quoting one). A cost-raising filter, not a guarantee.
function redactSecrets(text) {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(
      /\b(token|secret|password|authorization)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
      '$1$2[redacted]',
    );
}

// Validate and normalize a renderer error payload forwarded by the preload
// ('desktop-renderer-error'). Returns null for anything malformed; the caller
// logs nothing in that case. All fields optional except kind.
function rendererErrorLogEntry(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const kind =
    payload.kind === 'unhandledrejection'
      ? 'unhandledrejection'
      : payload.kind === 'error'
        ? 'error'
        : null;
  if (!kind) return null;
  const entry = { kind };
  entry.message = redactSecrets(clampText(payload.message, MAX_ERROR_TEXT));
  entry.stack = redactSecrets(clampText(payload.stack, MAX_ERROR_TEXT));
  entry.source = clampText(payload.source, MAX_SOURCE_TEXT);
  if (Number.isFinite(payload.line)) entry.line = Math.trunc(payload.line);
  if (Number.isFinite(payload.col)) entry.col = Math.trunc(payload.col);
  return entry;
}

// Normalize a webContents 'console-message' emit. Electron 43 emits the
// single-details Event form ({ level: 'info'|'warning'|'error'|'debug',
// message, lineNumber, sourceId }); the legacy positional form (event,
// level: 0-3, message, line, sourceId) is deprecated but still delivered to
// multi-parameter listeners, so accept both. Returns { level, message,
// source } or null when the shape is unrecognizable.
const LEGACY_CONSOLE_LEVELS = ['debug', 'info', 'warning', 'error'];
function normalizeConsoleMessage(details, legacyLevel, legacyMessage, legacyLine, legacySource) {
  if (details && typeof details === 'object' && typeof details.message === 'string') {
    const level = typeof details.level === 'string' ? details.level : 'info';
    const line = Number.isFinite(details.lineNumber) ? details.lineNumber : undefined;
    const sourceId = typeof details.sourceId === 'string' ? details.sourceId : '';
    return {
      level,
      message: redactSecrets(clampText(details.message, MAX_ERROR_TEXT)),
      source: clampText(line !== undefined ? `${sourceId}:${line}` : sourceId, MAX_SOURCE_TEXT),
    };
  }
  if (typeof legacyMessage === 'string') {
    const level = LEGACY_CONSOLE_LEVELS[legacyLevel] ?? 'info';
    const source = typeof legacySource === 'string' ? `${legacySource}:${legacyLine}` : '';
    return {
      level,
      message: redactSecrets(clampText(legacyMessage, MAX_ERROR_TEXT)),
      source: clampText(source, MAX_SOURCE_TEXT),
    };
  }
  return null;
}

// Only renderer warnings and errors go to the log file: the game's info-level
// console output is chatty and belongs to DevTools, not a rotating disk log.
function shouldLogConsoleLevel(level) {
  return level === 'warning' || level === 'error';
}

// Classify a render-process-gone reason. 'clean-exit' and 'killed' are normal
// lifecycle (window close, task manager, our own quit); everything else
// ('crashed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure',
// 'memory-eviction', and any future reason) is a crash the shell must react
// to. 'integrity-failure' is special-cased by the caller: it means the asar
// failed its integrity check, so reloading the same bundle is pointless.
function classifyRendererExit(reason) {
  return reason === 'clean-exit' || reason === 'killed' ? 'benign' : 'crash';
}

// Decide how to react to a renderer crash: silently reload up to
// maxAutoReloads times per windowMs, then stop guessing and ask the player
// (dialog). Pure: takes and returns the recent-crash timestamp list.
function rendererCrashAction(
  recentCrashTimes,
  nowMs,
  { windowMs = 60_000, maxAutoReloads = 2 } = {},
) {
  const times = recentCrashTimes.filter((t) => nowMs - t < windowMs);
  times.push(nowMs);
  return { action: times.length <= maxAutoReloads ? 'reload' : 'dialog', times };
}

module.exports = {
  MAX_ERROR_TEXT,
  MAX_FORWARDED_ERRORS,
  clampText,
  redactSecrets,
  rendererErrorLogEntry,
  normalizeConsoleMessage,
  shouldLogConsoleLevel,
  classifyRendererExit,
  rendererCrashAction,
};
