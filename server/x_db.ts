// X integration persistence (SQL only). Query functions take the shared pool so
// this module stays cycle-free, mirroring discord_db.ts.
import type { Pool } from 'pg';
import { isUniqueViolation } from './http_util';

export const X_SCHEMA = `
CREATE TABLE IF NOT EXISTS x_links (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL UNIQUE,
  x_username TEXT NOT NULL,
  x_display_name TEXT,
  x_profile_image_url TEXT,
  x_verified BOOLEAN NOT NULL DEFAULT FALSE,
  x_verified_type TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS x_oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  mode TEXT NOT NULL,
  account_id INT REFERENCES accounts(id) ON DELETE CASCADE,
  redirect_to TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS x_oauth_states_expires ON x_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS x_pending_logins (
  token TEXT PRIMARY KEY,
  x_user_id TEXT NOT NULL,
  x_username TEXT NOT NULL,
  x_display_name TEXT,
  x_profile_image_url TEXT,
  x_verified BOOLEAN NOT NULL DEFAULT FALSE,
  x_verified_type TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS x_pending_logins_expires ON x_pending_logins(expires_at);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS x_link_prompt_hidden BOOLEAN NOT NULL DEFAULT FALSE;
`;

export interface XLinkRow {
  account_id: number;
  x_user_id: string;
  x_username: string;
  x_display_name: string | null;
  x_profile_image_url: string | null;
  x_verified: boolean;
  x_verified_type: string | null;
  linked_at: Date | string;
}

export async function xForAccount(pool: Pool, accountId: number): Promise<XLinkRow | null> {
  const res = await pool.query(
    `SELECT account_id, x_user_id, x_username, x_display_name, x_profile_image_url,
            x_verified, x_verified_type, linked_at
       FROM x_links WHERE account_id = $1`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

export async function accountForX(pool: Pool, xUserId: string): Promise<number | null> {
  const res = await pool.query('SELECT account_id FROM x_links WHERE x_user_id = $1', [xUserId]);
  return res.rows[0]?.account_id ?? null;
}

export async function linkXToAccount(
  pool: Pool,
  accountId: number,
  info: {
    xUserId: string;
    username: string;
    displayName: string | null;
    profileImageUrl: string | null;
    verified: boolean;
    verifiedType: string | null;
  },
): Promise<boolean> {
  const owner = await accountForX(pool, info.xUserId);
  if (owner !== null && owner !== accountId) return false;
  try {
    await pool.query(
      `INSERT INTO x_links
         (account_id, x_user_id, x_username, x_display_name, x_profile_image_url, x_verified, x_verified_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (account_id) DO UPDATE SET
         x_user_id = EXCLUDED.x_user_id,
         x_username = EXCLUDED.x_username,
         x_display_name = EXCLUDED.x_display_name,
         x_profile_image_url = EXCLUDED.x_profile_image_url,
         x_verified = EXCLUDED.x_verified,
         x_verified_type = EXCLUDED.x_verified_type,
         linked_at = now()`,
      [
        accountId,
        info.xUserId,
        info.username,
        info.displayName,
        info.profileImageUrl,
        info.verified,
        info.verifiedType,
      ],
    );
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
  return true;
}

export async function unlinkX(pool: Pool, accountId: number): Promise<void> {
  await pool.query('DELETE FROM x_links WHERE account_id = $1', [accountId]);
}

export interface XOAuthStateRow {
  state: string;
  code_verifier: string;
  mode: string;
  account_id: number | null;
  redirect_to: string | null;
}

export async function createXOAuthState(
  pool: Pool,
  params: {
    state: string;
    codeVerifier: string;
    mode: string;
    accountId: number | null;
    redirectTo: string | null;
    ttlMinutes: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO x_oauth_states (state, code_verifier, mode, account_id, redirect_to, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [
      params.state,
      params.codeVerifier,
      params.mode,
      params.accountId,
      params.redirectTo,
      String(params.ttlMinutes),
    ],
  );
}

export async function consumeXOAuthState(
  pool: Pool,
  state: string,
): Promise<XOAuthStateRow | null> {
  const res = await pool.query(
    `DELETE FROM x_oauth_states
      WHERE state = $1 AND expires_at > now()
      RETURNING state, code_verifier, mode, account_id, redirect_to`,
    [state],
  );
  return res.rows[0] ?? null;
}

export async function pruneXOAuthStates(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM x_oauth_states WHERE expires_at <= now()');
}

export interface XPendingLoginRow {
  token: string;
  x_user_id: string;
  x_username: string;
  x_display_name: string | null;
  x_profile_image_url: string | null;
  x_verified: boolean;
  x_verified_type: string | null;
}

export async function createXPendingLogin(
  pool: Pool,
  params: {
    token: string;
    xUserId: string;
    username: string;
    displayName: string | null;
    profileImageUrl: string | null;
    verified: boolean;
    verifiedType: string | null;
    ttlMinutes: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO x_pending_logins
       (token, x_user_id, x_username, x_display_name, x_profile_image_url, x_verified, x_verified_type, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' minutes')::interval)`,
    [
      params.token,
      params.xUserId,
      params.username,
      params.displayName,
      params.profileImageUrl,
      params.verified,
      params.verifiedType,
      String(params.ttlMinutes),
    ],
  );
}

export async function peekXPendingLogin(
  pool: Pool,
  token: string,
): Promise<XPendingLoginRow | null> {
  const res = await pool.query(
    `SELECT token, x_user_id, x_username, x_display_name, x_profile_image_url, x_verified, x_verified_type
       FROM x_pending_logins WHERE token = $1 AND expires_at > now()`,
    [token],
  );
  return res.rows[0] ?? null;
}

export async function consumeXPendingLogin(
  pool: Pool,
  token: string,
): Promise<XPendingLoginRow | null> {
  const res = await pool.query(
    `DELETE FROM x_pending_logins
      WHERE token = $1 AND expires_at > now()
      RETURNING token, x_user_id, x_username, x_display_name, x_profile_image_url, x_verified, x_verified_type`,
    [token],
  );
  return res.rows[0] ?? null;
}

export async function pruneXPendingLogins(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM x_pending_logins WHERE expires_at <= now()');
}

export interface XFlair {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  verified: boolean;
  verifiedType: string | null;
}

export async function xFlairForAccount(pool: Pool, accountId: number): Promise<XFlair | null> {
  const link = await xForAccount(pool, accountId);
  return link
    ? {
        username: link.x_username,
        displayName: link.x_display_name,
        avatarUrl: link.x_profile_image_url,
        verified: link.x_verified,
        verifiedType: link.x_verified_type,
      }
    : null;
}

export async function xPromptHiddenForAccount(pool: Pool, accountId: number): Promise<boolean> {
  const res = await pool.query('SELECT x_link_prompt_hidden FROM accounts WHERE id = $1', [
    accountId,
  ]);
  return res.rows[0]?.x_link_prompt_hidden === true;
}

export async function setXPromptHidden(
  pool: Pool,
  accountId: number,
  hidden: boolean,
): Promise<void> {
  await pool.query('UPDATE accounts SET x_link_prompt_hidden = $2 WHERE id = $1', [
    accountId,
    hidden,
  ]);
}
