// Pure helpers for the OUTBOUND X OAuth2 flow. The game server is the
// OAuth client to x.com, mirroring server/discord_oauth.ts.
import { createHash } from 'node:crypto';

export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const X_API_BASE = 'https://api.x.com/2';
export const DEFAULT_X_SCOPES = ['users.read'] as const;

export type XLinkMode = 'link';

export function isXLinkMode(value: unknown): value is XLinkMode {
  return value === 'link';
}

export function isXUserId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{1,21}$/.test(value);
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function pkceChallengeFromVerifier(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: (opts.scopes ?? DEFAULT_X_SCOPES).join(' '),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${X_AUTHORIZE_URL}?${params.toString()}`;
}

export function buildTokenRequestBody(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): string {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  }).toString();
}

export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const user = encodeURIComponent(clientId);
  const pass = encodeURIComponent(clientSecret);
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

export interface XTokenResult {
  accessToken: string;
  tokenType: string;
  scope: string;
  expiresIn: number;
}

export function parseTokenResponse(value: unknown): XTokenResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const accessToken = typeof v.access_token === 'string' ? v.access_token : '';
  if (!accessToken) return null;
  return {
    accessToken,
    tokenType: typeof v.token_type === 'string' ? v.token_type : 'bearer',
    scope: typeof v.scope === 'string' ? v.scope : '',
    expiresIn: typeof v.expires_in === 'number' ? v.expires_in : 0,
  };
}

export interface XUser {
  id: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
  verified: boolean;
  verifiedType: string | null;
}

export function parseXUser(value: unknown): XUser | null {
  if (!value || typeof value !== 'object') return null;
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return null;
  const v = data as Record<string, unknown>;
  if (!isXUserId(v.id)) return null;
  const username = typeof v.username === 'string' ? v.username.trim() : '';
  if (!username) return null;
  const verifiedType = typeof v.verified_type === 'string' ? v.verified_type : null;
  return {
    id: v.id,
    username,
    name: typeof v.name === 'string' ? v.name.trim() : '',
    profileImageUrl: typeof v.profile_image_url === 'string' ? v.profile_image_url : null,
    verified: v.verified === true,
    verifiedType,
  };
}

export function xDisplayName(user: Pick<XUser, 'name' | 'username'>): string {
  return user.name.trim() || user.username || 'X user';
}

export function xProfileUrl(username: string | null | undefined): string | null {
  const clean = (username ?? '').trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(clean) ? `https://x.com/${clean}` : null;
}
