// X integration HTTP shell (DB + network IO). Pure helpers live in
// server/x_oauth.ts and SQL lives in server/x_db.ts.
import type http from 'node:http';
import { hashPassword, newToken, validPassword } from './auth';
import { accountById, pool, updatePasswordHash } from './db';
import { json } from './http_util';
import { discordRateLimited } from './ratelimit';
import { publicOriginFromRequest } from './realm';
import {
  consumeXOAuthState,
  createXOAuthState,
  linkXToAccount,
  setXPromptHidden,
  unlinkX,
  xForAccount,
  xPromptHiddenForAccount,
} from './x_db';
import {
  basicAuthHeader,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  isXLinkMode,
  parseTokenResponse,
  parseXUser,
  pkceChallengeFromVerifier,
  X_API_BASE,
  X_TOKEN_URL,
  type XLinkMode,
  type XUser,
  xDisplayName,
  xProfileUrl,
} from './x_oauth';

const STATE_TTL_MINUTES = 10;

export interface XConfig {
  clientId: string;
  clientSecret: string;
}

export function xConfig(): XConfig | null {
  const clientId = process.env.WOC_X_CLIENT_ID ?? '';
  const clientSecret = process.env.WOC_X_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function xEnabled(): boolean {
  return xConfig() !== null;
}

function redirectUriFor(req: http.IncomingMessage): string {
  return `${publicOriginFromRequest(req)}/api/auth/x/callback`;
}

export async function handleXStart(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: { mode: XLinkMode; accountId: number },
): Promise<void> {
  const url = await createXAuthorizeUrl(req, res, opts);
  if (!url) return;
  return json(res, 200, { url });
}

async function createXAuthorizeUrl(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: { mode: XLinkMode; accountId: number },
): Promise<string | null> {
  const cfg = xConfig();
  if (!cfg) {
    json(res, 503, { error: 'X integration is not configured' });
    return null;
  }
  if (discordRateLimited(req, opts.accountId ?? 0)) {
    json(res, 429, { error: 'rate limited' });
    return null;
  }
  const state = newToken();
  const codeVerifier = newToken();
  const codeChallenge = pkceChallengeFromVerifier(codeVerifier);
  await createXOAuthState(pool, {
    state,
    codeVerifier,
    mode: opts.mode,
    accountId: opts.accountId,
    redirectTo: null,
    ttlMinutes: STATE_TTL_MINUTES,
  });
  return buildAuthorizeUrl({
    clientId: cfg.clientId,
    redirectUri: redirectUriFor(req),
    state,
    codeChallenge,
  });
}

export async function handleXCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const cfg = xConfig();
  if (!cfg) return bouncePage(res, 503, { ok: false, mode: 'link', error: 'not_configured' });
  const u = new URL(req.url ?? '/', 'http://localhost');
  const code = u.searchParams.get('code') ?? '';
  const state = u.searchParams.get('state') ?? '';
  if (u.searchParams.get('error')) {
    return bouncePage(res, 200, { ok: false, mode: 'link', error: 'cancelled' });
  }
  if (!code || !state)
    return bouncePage(res, 400, { ok: false, mode: 'link', error: 'bad_request' });
  const stateRow = await consumeXOAuthState(pool, state);
  if (!stateRow) return bouncePage(res, 400, { ok: false, mode: 'link', error: 'expired' });
  const mode: XLinkMode = isXLinkMode(stateRow.mode) ? stateRow.mode : 'link';
  const user = await exchangeCodeForIdentity(
    code,
    redirectUriFor(req),
    stateRow.code_verifier,
    cfg,
  );
  if (!user) return bouncePage(res, 502, { ok: false, mode, error: 'x_error' });
  try {
    return await completeLink(res, stateRow.account_id, user, mode);
  } catch (err) {
    console.error('x callback error:', err);
    return bouncePage(res, 500, { ok: false, mode, error: 'server_error' });
  }
}

async function completeLink(
  res: http.ServerResponse,
  accountId: number | null,
  user: XUser,
  mode: XLinkMode,
): Promise<void> {
  if (accountId === null) return bouncePage(res, 400, { ok: false, mode, error: 'no_session' });
  const linked = await linkXToAccount(pool, accountId, xLinkInfo(user));
  if (!linked) return bouncePage(res, 409, { ok: false, mode, error: 'already_linked' });
  return bouncePage(res, 200, { ok: true, mode, username: xDisplayName(user) });
}

export async function handleXStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const [link, acct, promptHidden] = await Promise.all([
    xForAccount(pool, accountId),
    accountById(accountId),
    xPromptHiddenForAccount(pool, accountId),
  ]);
  return json(res, 200, {
    enabled: xEnabled(),
    linked: link !== null,
    promptHidden,
    passwordSet: acct?.password_set ?? true,
    username: link?.x_username ?? null,
    displayName: link?.x_display_name ?? null,
    avatar: link?.x_profile_image_url ?? null,
    verified: link?.x_verified ?? false,
    verifiedType: link?.x_verified_type ?? null,
    profileUrl: link ? xProfileUrl(link.x_username) : null,
  });
}

export async function handleXUnlink(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found' });
  if (!acct.password_set) {
    const body = await readJsonBody(req);
    const next = typeof body.password === 'string' ? body.password : '';
    if (!validPassword(next)) return json(res, 400, { error: 'password_required' });
    await updatePasswordHash(accountId, await hashPassword(next));
  }
  await unlinkX(pool, accountId);
  return json(res, 200, { unlinked: true });
}

export async function handleXPromptDismiss(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  await setXPromptHidden(pool, accountId, true);
  return json(res, 200, { promptHidden: true });
}

async function exchangeCodeForIdentity(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  cfg: XConfig,
): Promise<XUser | null> {
  const tokenJson = await fetchJsonWithTimeout(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(cfg.clientId, cfg.clientSecret),
    },
    body: buildTokenRequestBody({ code, redirectUri, codeVerifier }),
  });
  const token = parseTokenResponse(tokenJson);
  if (!token) return null;
  const fields = 'profile_image_url,verified,verified_type';
  return parseXUser(
    await fetchJsonWithTimeout(`${X_API_BASE}/users/me?user.fields=${fields}`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    }),
  );
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function xLinkInfo(user: XUser): Parameters<typeof linkXToAccount>[2] {
  return {
    xUserId: user.id,
    username: user.username,
    displayName: xDisplayName(user),
    profileImageUrl: user.profileImageUrl,
    verified: user.verified,
    verifiedType: user.verifiedType,
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return {};
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface BouncePayload {
  ok: boolean;
  mode: XLinkMode;
  username?: string;
  error?: string;
}

function bouncePage(res: http.ServerResponse, status: number, payload: BouncePayload): void {
  const data = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>World of ClaudeCraft</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{background:#14100a;color:#fff6df;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{text-align:center;padding:24px}</style>
</head><body><main><p id="m">Connecting X...</p></main><script>
(function(){
  var p = ${data};
  try {
    localStorage.removeItem('woc_x_choice');
  } catch (e) {}
  var msg = { source: 'woc-x', ok: p.ok, mode: p.mode, error: p.error || null };
  if (window.opener) {
    try { window.opener.postMessage(msg, location.origin); } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch (e) {} location.replace('/'); }, 200);
  } else {
    location.replace('/');
  }
})();
</script></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
