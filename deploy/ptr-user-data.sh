#!/bin/bash
# World of Claudecraft PTR realm -- first-boot setup (cloud-init user data).
#
# Same standalone stack as deploy/user-data.sh, pinned to the canonical PTR
# release branch. Fill the dedicated PTR DOMAIN, then paste into the
# host's user-data / run as root on any Ubuntu 24.04 arm64 box with Docker.
# Full walkthrough: DEPLOY.md.
#
# PTR realm note: this is a throwaway test realm on a dedicated disposable
# host and database. It ships with
# ALLOW_DEV_COMMANDS=1 so testers can /dev level and jump characters to the
# row unlocks. NEVER run it on a production host or attach production data.

# ---------------------------------------------------------------------------
# REQUIRED CONFIG
# ---------------------------------------------------------------------------
# The dedicated PTR game domain with an A record at this box's static IP.
# A dedicated DNS label named "ptr", beginning with "ptr-", or ending with
# "-ptr" is required so the reset guard cannot mistake the production origin
# for this disposable environment.
DOMAIN=""
ADMIN_DOMAIN=""

# ---------------------------------------------------------------------------
REPO="https://github.com/levy-street/world-of-claudecraft.git"
BRANCH="release/v0.24.0-ptr"
APP_DIR="/opt/eastbrook-ptr"
MARKER_FILE="/etc/world-of-claudecraft/ptr-environment"
COMPOSE_PROJECT="eastbrook-ptr"
POSTGRES_DB="eastbrook_ptr"

set -euo pipefail
exec > >(tee -a /var/log/eastbrook-setup.log) 2>&1

PTR_DOMAIN_OK=0
IFS='.' read -ra DOMAIN_LABELS <<< "${DOMAIN,,}"
for label in "${DOMAIN_LABELS[@]}"; do
  if [ "$label" = "ptr" ] || [[ "$label" == ptr-* ]] || [[ "$label" == *-ptr ]]; then
    PTR_DOMAIN_OK=1
    break
  fi
done
if [ -z "$DOMAIN" ] || [ "$PTR_DOMAIN_OK" -ne 1 ] || [ "$DOMAIN" = "worldofclaudecraft.com" ]; then
  echo "Refusing PTR bootstrap: DOMAIN must be a dedicated PTR hostname." >&2
  exit 1
fi
PUBLIC_ORIGIN="https://$DOMAIN"

# --- packages: docker, compose v2, git, caddy ------------------------------
apt-get update
apt-get install -y docker.io docker-compose-v2 git curl gnupg apt-transport-https openssl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

systemctl enable --now docker

# --- clone the PTR branch + secrets ----------------------------------------
if [ ! -d "$APP_DIR" ]; then
  git clone --branch "$BRANCH" --single-branch "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
if [ "$(git remote get-url origin)" != "$REPO" ]; then
  echo "Refusing PTR update: origin is not the canonical repository." >&2
  exit 1
fi
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
  echo "Refusing PTR update: local branch is not the exact fetched remote commit." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "Refusing PTR update: source worktree has nonignored changes." >&2
  exit 1
fi

# Compose reads .env automatically; never commit this file. An existing
# pre-identity environment is refused rather than silently relabeled as PTR.
if [ ! -f .env ]; then
  PTR_ENVIRONMENT_ID="$(openssl rand -hex 16)"
  umask 077
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT"
    echo "POSTGRES_DB=$POSTGRES_DB"
    echo "DEPLOY_ENV=ptr"
    echo "REALM_NAME=PTR"
    echo "PBE_BOOST_ACCOUNTS=1"
    echo "ALLOW_DEV_COMMANDS=1"
    echo "PTR_RESET_ALLOWED=1"
    echo "PTR_ENVIRONMENT_ID=$PTR_ENVIRONMENT_ID"
    echo "PUBLIC_ORIGIN=$PUBLIC_ORIGIN"
  } > .env
  chmod 600 .env
  install -d -m 700 "$(dirname "$MARKER_FILE")"
  {
    echo "PTR_ENVIRONMENT_ID=$PTR_ENVIRONMENT_ID"
    echo "PUBLIC_ORIGIN=$PUBLIC_ORIGIN"
    echo "APP_DIR=$APP_DIR"
    echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT"
    echo "POSTGRES_DB=$POSTGRES_DB"
  } > "$MARKER_FILE"
  chmod 600 "$MARKER_FILE"
else
  for expected in \
    "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT" \
    "POSTGRES_DB=$POSTGRES_DB" \
    "DEPLOY_ENV=ptr" \
    "REALM_NAME=PTR" \
    "PBE_BOOST_ACCOUNTS=1" \
    "PTR_RESET_ALLOWED=1" \
    "PUBLIC_ORIGIN=$PUBLIC_ORIGIN"; do
    if ! grep -qxF "$expected" .env; then
      echo "Refusing PTR bootstrap: existing .env lacks the dedicated PTR identity." >&2
      exit 1
    fi
  done
  PTR_ENVIRONMENT_ID="$(sed -n 's/^PTR_ENVIRONMENT_ID=//p' .env)"
  if ! [[ "$PTR_ENVIRONMENT_ID" =~ ^[a-fA-F0-9]{32,128}$ ]]; then
    echo "Refusing PTR bootstrap: existing PTR_ENVIRONMENT_ID is missing or weak." >&2
    exit 1
  fi
  if [ ! -f "$MARKER_FILE" ] || \
     ! grep -qxF "PTR_ENVIRONMENT_ID=$PTR_ENVIRONMENT_ID" "$MARKER_FILE" || \
     ! grep -qxF "PUBLIC_ORIGIN=$PUBLIC_ORIGIN" "$MARKER_FILE" || \
     ! grep -qxF "APP_DIR=$APP_DIR" "$MARKER_FILE" || \
     ! grep -qxF "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT" "$MARKER_FILE" || \
     ! grep -qxF "POSTGRES_DB=$POSTGRES_DB" "$MARKER_FILE" || \
     [ "$(stat -c '%u:%a' "$MARKER_FILE")" != "0:600" ]; then
    echo "Refusing PTR bootstrap: root-owned PTR marker does not match .env." >&2
    exit 1
  fi
fi

# --- build + run the stack --------------------------------------------------
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ptr.yml -p "$COMPOSE_PROJECT")
"${COMPOSE[@]}" up -d --build --wait postgres
docker exec eastbrook-ptr-postgres psql \
  --username eastbrook \
  --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --command "COMMENT ON DATABASE $POSTGRES_DB IS '$PTR_ENVIRONMENT_ID'"
"${COMPOSE[@]}" up -d --build

# --- Caddy: TLS when DOMAIN set, else plain HTTP by IP ----------------------
if [ -n "$DOMAIN" ]; then
  SITE="$DOMAIN"
else
  SITE=":80"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$SITE {
  reverse_proxy 127.0.0.1:8877
}
CADDY
if [ -n "$ADMIN_DOMAIN" ]; then
  cat >> /etc/caddy/Caddyfile <<CADDY
$ADMIN_DOMAIN {
  reverse_proxy 127.0.0.1:8877
}
CADDY
fi
systemctl reload caddy

echo "PTR realm boot complete."
echo "Branch: $BRANCH @ $(git -C "$APP_DIR" rev-parse --short HEAD)"
echo "Status: $(curl -s --max-time 5 http://localhost:8877/api/status || echo 'not up yet -- docker compose logs game')"
