# PTR database reset runbook

This procedure resets only the disposable PostgreSQL data for the dedicated v0.24 PTR. It must
never run on production, a shared Docker host, a host with production credentials, or a host that
can route to the production database. It does not reset, remove, or restore MediaWiki, Wiki image,
or game media volumes.

## Prerequisites

- Use the dedicated host provisioned by `deploy/ptr-user-data.sh` at `/opt/eastbrook-ptr`.
- Confirm the host firewall and Docker networks cannot reach production PostgreSQL.
- Confirm the deployed branch is `release/v0.24.0-ptr` and obtain approval for the exact full SHA.
- Confirm `/etc/world-of-claudecraft/ptr-environment` is root-owned, mode 600, and matches `.env`.
- Confirm the Compose project is `eastbrook-ptr`, the database is `eastbrook_ptr`, and the public
  origin is the dedicated PTR hostname.
- Schedule a PTR maintenance window. Do not proceed while release approval is ambiguous.

## Dry run

Run from the dedicated checkout as root. Dry-run is the default and performs no reset commands.

```bash
cd /opt/eastbrook-ptr
sudo node scripts/reset_ptr.mjs --commit "$(git rev-parse HEAD)"
```

The command fetches the canonical PTR branch, verifies the clean approved SHA, inspects the live
container and volume labels, verifies the database identity and database inventory, then prints an
argv-only command plan.

## Human review checkpoint

Review every printed argv array before approving execution. The exact plan must:

1. Stop only the PTR game service. The Discord bot may remain running and reconnect afterward.
2. Create a custom-format `pg_dump` inside `eastbrook-ptr-postgres`.
3. Copy the dump to the root-owned `0700` `/var/backups/eastbrook-ptr/` directory and force the
   dump to mode `0600`.
4. Verify the dump with `pg_restore --list` before any container or volume removal.
5. Remove only `eastbrook-ptr-postgres` and `eastbrook-ptr_eastbrook_ptr_pgdata`.
6. Recreate only PTR PostgreSQL, restore its database identity comment, and start the PTR game.

Reject the plan if it contains production names, `docker compose down`, `-v`, MediaWiki, Wiki,
image, or media-cache removal targets.

## Execute

Read the environment id from the root-owned marker and pass it together with the approved SHA:

```bash
cd /opt/eastbrook-ptr
PTR_ID="$(sudo sed -n 's/^PTR_ENVIRONMENT_ID=//p' \
  /etc/world-of-claudecraft/ptr-environment)"
sudo node scripts/reset_ptr.mjs \
  --execute \
  --commit "<approved-full-sha>" \
  --confirm "$PTR_ID"
```

The CLI aborts on the first failed step. Volume removal cannot begin unless dump creation, host
copy, and `pg_restore --list` all succeed.

## Post-reset verification and reseed smoke

1. Verify `docker compose -f docker-compose.yml -f docker-compose.ptr.yml -p eastbrook-ptr ps`
   reports healthy PostgreSQL and a running game.
2. Verify `/readyz` on `127.0.0.1:8877` is ready.
3. Query `accounts` and `characters` in `eastbrook_ptr`; both must be zero before the canary.
4. Register one PTR canary account through the normal game API.
5. Verify it receives exactly the ordered nine-class roster at level 20 and every character loads.
6. Create one manual tenth character and verify it succeeds. Verify an eleventh is rejected by the
   unchanged per-account cap of 10.
7. Exercise one save, logout, and relogin for the winning Warrior before reopening PTR access.
8. Record the approved SHA, environment id, dump path, dump checksum, operator, and post-reset
   counts in the maintenance record.

## PTR-only rollback

Use only the dump written and verified by this reset. First re-run `pg_restore --list` against the
selected dump. Stop the PTR game, copy the dump into `eastbrook-ptr-postgres`, and restore it into
`eastbrook_ptr` with `pg_restore --clean --if-exists --no-owner --exit-on-error`. Reapply the
database identity comment from the root-owned marker, start the PTR game, then repeat readiness,
count, login, save, and relogin checks.

Rollback is PTR-only. Never restore this dump to production, never import a production dump into
PTR, never attach production volumes, and never use `docker compose down -v`.
