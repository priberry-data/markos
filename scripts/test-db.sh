#!/bin/zsh
# Start (or check) the separate TEST database. Tests run against it, never
# against the founder's live data, calendar or settings.
#   ./scripts/test-db.sh          start it if needed and print its keys
#   ./scripts/test-db.sh reset    rebuild it from the schema
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Native mode (MARKOS_DB=native, from .env.local): a Docker-free test database, on its
# own ports so it never collides with the Docker one. Also used when Docker isn't installed
# or isn't running.
if [ "$MARKOS_DB" = "native" ] || ! docker info >/dev/null 2>&1; then
  export MARKOS_NATIVE_DIR="$REPO/test-db/.native" MARKOS_PG_PORT=56332 MARKOS_REST_PORT=56331
  export MARKOS_SECRET_FILE="$REPO/test-db/.native/jwt-secret"
  NODE="$HOME/.local/node-arm64/bin/node"; [ -x "$NODE" ] || NODE="$(command -v node)"
  if [ "$1" = "reset" ]; then "$NODE" "$REPO/scripts/native-db.mjs" stop >&2 || true; rm -rf "$MARKOS_NATIVE_DIR/data"; fi
  "$NODE" "$REPO/scripts/native-db.mjs" install >&2
  "$NODE" "$REPO/scripts/native-db.mjs" start >&2
  "$NODE" "$REPO/scripts/native-db.mjs" env
  exit 0
fi
cd "$REPO/test-db"
if [ "$1" = "reset" ]; then supabase db reset --workdir . >/dev/null; fi
if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:56321/rest/v1/; then
  # Bind the ports to this Mac only (see private_network in lib-start.sh).
  NET=supabase_network_markos-test
  if [ "$(docker network inspect $NET --format '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}' 2>/dev/null)" != "127.0.0.1" ]; then
    supabase stop --workdir . >/dev/null 2>&1 || true
    docker network rm $NET >/dev/null 2>&1 || true
    docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 $NET >/dev/null
  fi
  supabase start --workdir . -x studio,imgproxy,edge-runtime,logflare,vector,mailpit,realtime,storage-api,postgres-meta,supavisor >/dev/null 2>&1 || true
  for i in $(seq 1 90); do curl -s -o /dev/null --max-time 2 http://127.0.0.1:56321/rest/v1/ && break; sleep 2; done
fi
# Apply schema changes the test database doesn't have yet.
supabase migration up --workdir . --local >/dev/null 2>&1 || true
supabase status --workdir . -o env 2>/dev/null | grep -E "^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)="
