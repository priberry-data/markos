# Shared by the MarkOS.app launcher and the night shift: bring up Docker, the
# database and the MarkOS server, building first only when the code changed.
# Source it after setting REPO and LOG. Defines: note, fail, app_up, db_up,
# running, wait_for, ensure_server (sets STARTED=1 if it started the server).

export PATH="$HOME/.local/node-arm64/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"

URL="http://localhost:3001"          # keep localhost: social OAuth redirects depend on it
# A native arm64 Node in ~/.local/node-arm64 wins (Homebrew's can be x86 under Rosetta); else the first node on PATH.
NODE="$HOME/.local/node-arm64/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node || true)"
NEXT="$REPO/node_modules/next/dist/bin/next"
mkdir -p "$LOG"

# The local token: API changes from outside the MarkOS window (the night shift,
# scripts) must present it. Created once, readable only by this user.
# MARKOS_HOME moves MarkOS's files (as in scripts/paths.mjs); the default is the usual Mac folder.
SUPPORT="${MARKOS_HOME:-$HOME/Library/Application Support/MarkOS}"
TOKEN_FILE="$SUPPORT/local-token"
if [ ! -s "$TOKEN_FILE" ]; then
  mkdir -p "$(dirname "$TOKEN_FILE")"
  (umask 077; openssl rand -hex 32 > "$TOKEN_FILE")
fi
chmod 600 "$TOKEN_FILE"
TOKEN="$(cat "$TOKEN_FILE")"

# Each install signs its database keys with its own secret. Supabase's default secret is
# published, so with it anyone who can reach the database could use it. supabase/config.toml
# reads it from MARKOS_JWT_SECRET; every script that runs `supabase` sources this file.
SECRET_FILE="${MARKOS_SECRET_FILE:-$SUPPORT/jwt-secret}"
mkdir -p "$(dirname "$SECRET_FILE")"
[ -s "$SECRET_FILE" ] || (umask 077; openssl rand -hex 32 > "$SECRET_FILE")
chmod 600 "$SECRET_FILE"
export MARKOS_JWT_SECRET="$(cat "$SECRET_FILE")"

note() { osascript -e "display notification \"$1\" with title \"MarkOS\"" >/dev/null 2>&1 || true; }
fail() {
  echo "FAILED: $1"
  if [ -z "$MARKOS_QUIET" ]; then
    osascript -e "display dialog \"$1\" & return & return & \"Details are in ~/Library/Logs/MarkOS\" with title \"MarkOS\" buttons {\"OK\"} default button 1 with icon stop" >/dev/null 2>&1 || true
  else
    note "$1"
  fi
  exit 1
}
# MarkOS needs only the database, its REST API and the gateway, plus auth, without which
# the Supabase CLI won't print the keys. The other services (Studio, storage, realtime,
# mail, functions, analytics…) cost ~1 GB and are never used: the browser polls
# /api/pulse instead of holding a realtime connection.
SUPABASE_UNUSED="studio,imgproxy,edge-runtime,logflare,vector,mailpit,storage-api,postgres-meta,supavisor,realtime"
UNUSED_CONTAINERS=(studio imgproxy edge_runtime analytics vector inbucket storage pg_meta pooler realtime)
# Containers made by an older start keep coming back with Colima; stop them and keep them stopped.
slim_db() {
  local c pid
  pid="$(grep -m1 '^project_id' "$REPO/supabase/config.toml" 2>/dev/null | cut -d'"' -f2)"
  for c in "${UNUSED_CONTAINERS[@]}"; do
    c="supabase_${c}_${pid:-markos}"
    if docker ps -q --filter "name=^${c}$" | grep -q .; then
      docker update --restart=no "$c" >/dev/null 2>&1
      docker stop "$c" >/dev/null 2>&1
    fi
  done
}
# Supabase publishes its ports on every network interface, so anyone on the same Wi-Fi
# could reach the database. Its containers join a network named after the project and
# reuse it if it exists, so create that network first with ports bound to this Mac only.
# An older install has a network open to the LAN: stop the stack (data is kept) and redo it.
private_network() {
  local dir="${1:-$REPO}" pid net bind
  pid="$(grep -m1 '^project_id' "$dir/supabase/config.toml" 2>/dev/null | cut -d'"' -f2 || true)"
  net="supabase_network_${pid:-markos}"
  bind="$(docker network inspect "$net" --format '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}' 2>/dev/null || true)"
  [ "$bind" = "127.0.0.1" ] && return 0
  if docker network inspect "$net" >/dev/null 2>&1; then
    supabase stop --workdir "$dir" >/dev/null 2>&1 || true
    docker network rm "$net" >/dev/null 2>&1 || true
  fi
  docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 "$net" >/dev/null
}
# Native mode (no Docker): chosen by `setup-db.sh --native`, remembered in .env.local.
native_db() { grep -qx 'MARKOS_DB=native' "$REPO/.env.local" 2>/dev/null; }
# A new install runs without Docker. An install already set up on Docker stays there unless
# asked to move (--native). --docker forces Docker.
docker_install() { grep -qE '^SUPABASE_SERVICE_ROLE_KEY=.+' "$REPO/.env.local" 2>/dev/null && ! native_db; }
want_native() {
  case "$1" in --native) return 0 ;; --docker) return 1 ;; esac
  native_db && return 0
  docker_install && return 1
  return 0
}
status_val() { print -r -- "$1" | sed -nE "s/^$2=\"?([^\"]*)\"?\$/\\1/p"; }
key_works() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "apikey: $1" -H "Authorization: Bearer $1" "http://127.0.0.1:${API_PORT:-54321}/rest/v1/")" = 200 ]; }
# Make sure the database runs on this install's own keys and .env.local holds them. An
# older install still runs on the public default: restart it on its own secret (data is
# kept) and rewrite the two lines in .env.local. Never prints a key.
own_keys() {
  local env url key tmp
  env="$(supabase status -o env 2>/dev/null || true)"
  key="$(status_val "$env" SERVICE_ROLE_KEY)"
  if [ -n "$key" ] && ! key_works "$key"; then
    supabase stop >> "$LOG/supabase.log" 2>&1 || true
    private_network   # stopping removed the network; recreate it local-only
    supabase start -x "$SUPABASE_UNUSED" >> "$LOG/supabase.log" 2>&1 || true
    wait_for db_up 180 || return 1
    env="$(supabase status -o env 2>/dev/null || true)"
    key="$(status_val "$env" SERVICE_ROLE_KEY)"
  fi
  url="$(status_val "$env" API_URL)"
  [ -n "$url" ] && [ -n "$key" ] && key_works "$key" || return 1
  [ -f .env.local ] || cp .env.example .env.local
  chmod 600 .env.local
  grep -qxF "NEXT_PUBLIC_SUPABASE_URL=$url" .env.local && grep -qxF "SUPABASE_SERVICE_ROLE_KEY=$key" .env.local && return 0
  tmp="$(mktemp)"
  grep -v -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env.local > "$tmp" || true
  { print -r -- "NEXT_PUBLIC_SUPABASE_URL=$url"; print -r -- "SUPABASE_SERVICE_ROLE_KEY=$key"; cat "$tmp"; } > .env.local
  rm -f "$tmp"
}
# Apply schema changes that arrived with an update (only ones not applied yet).
migrate() { supabase migration up --local >> "$LOG/supabase.log" 2>&1; }
app_up()  { curl -sf --max-time 5 "$URL/api/health" >/dev/null 2>&1 || { sleep 2; curl -sf --max-time 8 "$URL/api/health" >/dev/null 2>&1; }; }
# Something is listening on MarkOS's port (it may just be too busy to answer quickly).
port_taken() { lsof -tiTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; }
# Any HTTP answer from the Supabase gateway means the stack is serving.
API_PORT="$(awk '/^\[api\]/{a=1;next} /^\[/{a=0} a && /^port *=/{print $3; exit}' "$REPO/supabase/config.toml" 2>/dev/null)"
db_up()   { [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${API_PORT:-54321}/rest/v1/")" =~ ^(200|401|404)$ ]]; }
running() { curl -s --max-time 3 "$URL/api/health" | grep -o '"running":[0-9]*' | cut -d: -f2; }
wait_for() { local fn=$1 secs=$2; for i in $(seq 1 $((secs * 2))); do $fn && return 0; sleep 0.5; done; return 1; }

ensure_server() {
  [ -n "$NODE" ] && [ -x "$NODE" ] || fail "Node wasn't found. Install Node 22 or newer (see README)."
  [ -f "$NEXT" ] || fail "MarkOS dependencies are missing. Run 'npm install' in $REPO."
  cd "$REPO"
  STARTED=""
  # A busy server can miss a quick health check; if the port is taken, treat it
  # as running and check its build — never start a second one on top of it.
  if app_up || port_taken; then
    # A server started before the last build serves files that changed under
    # it, and its pages break. Restart it — but never in the middle of work.
    local served="$(curl -s --max-time 3 "$URL/api/health" | grep -o '"build":"[^"]*"' | cut -d'"' -f4)"
    local onDisk="$(cat .next/BUILD_ID 2>/dev/null)"
    # (A server too old to report its build counts as stale.)
    if [ -n "$onDisk" ] && [ "$served" != "$onDisk" ] && [ "$(running)" = "0" ]; then
      echo "server is on an old build ($served, disk has $onDisk): restarting"
      local old="$(lsof -tiTCP:3001 -sTCP:LISTEN)"
      kill "$old" 2>/dev/null || true
      # Wait until the port is really free (open windows can slow the shutdown);
      # starting too early fails with the port in use.
      for i in $(seq 1 30); do lsof -tiTCP:3001 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
      lsof -tiTCP:3001 -sTCP:LISTEN >/dev/null 2>&1 && kill -9 "$old" 2>/dev/null && sleep 1
    else
      return 0
    fi
  fi

  # 1-2. Database. Native mode runs Postgres and PostgREST directly (about 80 MB);
  #      otherwise Docker (Colima) and Supabase.
  if native_db; then
    "$NODE" "$REPO/scripts/native-db.mjs" start >> "$LOG/database.log" 2>&1 || fail "The database didn't start."
  else
    # 1. Docker. The VM is capped (2 GB by default, MARKOS_VM_MEMORY to change it): left
    #    uncapped, Linux fills it with cache and an 8 GB Mac slows to a crawl.
    if ! colima status >/dev/null 2>&1; then
      note "Starting Docker…"
      colima start --cpu 2 --memory "${MARKOS_VM_MEMORY:-2}" >> "$LOG/colima.log" 2>&1 || fail "Docker (Colima) failed to start."
    fi

    # 2. Database. After Colima restarts, the Supabase containers come back on
    #    their own and 'supabase start' reports "already running" with a non-zero
    #    exit — so readiness is judged by polling, never by that exit code.
    private_network
    if ! db_up; then
      note "Starting database…"
      supabase start -x "$SUPABASE_UNUSED" >> "$LOG/supabase.log" 2>&1 || true
      wait_for db_up 180 || fail "The database didn't start."
    fi
    own_keys || fail "Couldn't set up this install's database keys."
    migrate || fail "The database update failed."
    slim_db
  fi

  # 3. Build only when the code changed since the last build.
  local stamp="$(git rev-parse HEAD 2>/dev/null)-$(git status --porcelain 2>/dev/null | shasum | cut -c1-12)"
  if [ ! -f .next/BUILD_ID ] || [ "$(cat .next/markos-build-stamp 2>/dev/null)" != "$stamp" ]; then
    note "Updating MarkOS — about a minute, only after changes…"
    "$NODE" "$NEXT" build >> "$LOG/build.log" 2>&1 || fail "MarkOS failed to build."
    echo "$stamp" > .next/markos-build-stamp
  fi

  # 4. Server
  # 127.0.0.1 only: nothing else on the network can reach MarkOS ("localhost" in
  # URL still resolves here, so the social OAuth redirects keep working).
  nohup "$NODE" "$NEXT" start -p 3001 -H 127.0.0.1 >> "$LOG/server.log" 2>&1 &
  echo $! > "$LOG/server.pid"
  STARTED=1
  wait_for app_up 120 || fail "The MarkOS server didn't start."
}

# Stop the server we started — but never under the founder's open window, and
# never in the middle of work.
stop_server_if_idle() {
  [ -n "$STARTED" ] || return 0
  while [ "$(running)" != "0" ] && [ -n "$(running)" ]; do sleep 20; done
  if pgrep -f "user-data-dir=$HOME/Library/Application Support/MarkOS/Chrome" >/dev/null 2>&1; then
    echo "MarkOS window is open; leaving the server running"
    return 0
  fi
  kill "$(cat "$LOG/server.pid")" 2>/dev/null || true
  rm -f "$LOG/server.pid"
  echo "server stopped"
}
