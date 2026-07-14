import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync('docker-compose.yml', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const composeEnv = (name: string) => `$${`{${name}:-}`}`;

describe('realm admission cap deploy contract', () => {
  // The game service passes an explicit environment allowlist (no env_file), so a
  // value only reaches the container if it is listed here. MAX_PLAYERS_PER_REALM
  // caps fresh WS admissions (server/ws_auth.ts): without this passthrough line,
  // setting it in the host .env would populate compose interpolation but never
  // reach the process, silently leaving the realm on its built-in default.
  it('passes MAX_PLAYERS_PER_REALM through to the game server container', () => {
    expect(compose).toContain(`MAX_PLAYERS_PER_REALM: ${composeEnv('MAX_PLAYERS_PER_REALM')}`);
  });

  it('documents MAX_PLAYERS_PER_REALM in .env.example, commented out (default applies)', () => {
    expect(envExample).toContain('#MAX_PLAYERS_PER_REALM=');
  });
});
