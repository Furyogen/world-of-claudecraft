# X Integration

Generic X OAuth for World of ClaudeCraft accounts. Players link X from an
existing signed-in account, then expose a public X profile handle to the game
client and companion tooling such as woclive/Yuumi.

## Goals

- Link X using OAuth 2.0 authorization code with PKCE. X is not a login provider.
- Keep the provider model account-bound: a full World of ClaudeCraft session is
  required before starting X OAuth, and the stable X user id links to one account.
- Hide the in-game X linking prompt with an account flag so dismissal follows
  the player across browsers and devices.
- Broadcast only public identity flair: X user id stays server-side; username,
  display name, avatar URL, and verification fields can ride entity identity.
- Let woclive include nearby linked X handles in Yuumi's state timeline so the AI
  can identify real people in game context.

## Architecture

| Concern | Where |
|---|---|
| OAuth helpers | `server/x_oauth.ts` |
| Link and OAuth persistence | `server/x_db.ts` |
| HTTP routes | `server/x.ts` wired from `server/main.ts` |
| Entity identity | `server/game.ts`, `src/net/online.ts`, `src/sim/types.ts` |
| Account portal and in-game Community UI | `index.html`, `play.html`, `src/main.ts`, `hudChrome.x.*` strings |
| Companion export | `woclive/woc-grinder.user.js`, `woclive/src/agent/state-timeline.mjs` |

The sim treats X data like Discord and wallet flair: cosmetic server-set fields
that are never read for deterministic gameplay.

## Endpoints

- `POST /api/auth/x/start?mode=link` returns an X authorize URL. A full session
  is required. Other modes are rejected.
- `GET /api/auth/x/callback?code&state` exchanges the code, fetches
  `/2/users/me`, then bounces back to the opener.
- `GET /api/x` returns the current account's X link status.
- `POST /api/x/prompt/dismiss` stores the account-level hidden flag for the
  below-minimap link prompt.
- `DELETE /api/x` unlinks X. If X is the only login method, the request must also
  set a password.

## Security Decisions

- PKCE S256 and a single-use server-stored state row protect the authorization
  callback.
- X access tokens are used only during callback exchange and profile fetch. They
  are not stored.
- The app requests only the `users.read` scope. Do not request `offline.access`
  unless a future feature needs long-lived X API access.
- X identity never auto-links by username or display name. The stable X user id
  is the only link key.
- `x_links.x_user_id` is unique, and link races are handled as conflicts.
- Accounts without a password must set one before unlinking X, matching the
  Discord account-safety pattern.

## X Developer Setup

1. Create or open an X developer project and app at the X Developer Portal.
2. Enable OAuth 2.0 for the app and choose a confidential web app/client type.
3. Set app permissions to read-only. The game needs only `users.read`.
4. Add callback URLs:
   - Production: `https://your-domain.example/api/auth/x/callback`
   - Local dev: `http://localhost:8787/api/auth/x/callback`
5. Add website/app URLs required by the portal, for example the public game
   origin.
6. Copy the OAuth 2.0 client id and client secret into the game server
   environment:

```bash
WOC_X_CLIENT_ID=...
WOC_X_CLIENT_SECRET=...
PUBLIC_ORIGIN=https://your-domain.example
```

`PUBLIC_ORIGIN` is used to build the callback URL. In multi-realm deployments the
matching `REALMS` origin can also provide the public origin.

Use the `WOC_X_*` names for the game server. The woclive repo may also have
`X_CLIENT_ID` and `X_CLIENT_SECRET` for its own X API features; those are separate
credentials and are intentionally not read by World of ClaudeCraft.

## Verification

1. Start the database and server with the X env vars set.
2. Sign in with a regular account, enter the game, and confirm the below-minimap
   X prompt appears when the account has not linked X and has not dismissed it.
3. Click `Link X`, authorize with X, and confirm the prompt hides and the account
   portal X card shows the linked handle.
4. Press `U` in game and confirm the Community panel shows both Discord and X,
   with link/unlink/open actions where available.
5. Dismiss the X prompt on a second account, reload in another browser session,
   and confirm it stays hidden from the account flag.
6. In another client, inspect the linked player and confirm the X handle appears.
7. Run woclive with the updated userscript and confirm nearby player entries
   include `X @handle` in the state timeline.
