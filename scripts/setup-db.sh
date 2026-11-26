#!/bin/zsh
# One-time database setup, safe to run again. Never prints the key.
#   ./scripts/setup-db.sh            a new install: Postgres + PostgREST, no Docker (about 80 MB)
#   ./scripts/setup-db.sh --native   move an existing Docker install off Docker (data copied)
#   ./scripts/setup-db.sh --docker   Docker (Colima, capped at 2 GB) and only the Supabase
#                                    services MarkOS uses
# Either way: ports open to this Mac only, keys signed by this install's own secret, and the
# database URL and key written into .env.local.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/MarkOS"
source "$REPO/scripts/lib-start.sh"
cd "$REPO"

# No Docker (the default for a new install): Postgres and PostgREST run directly, bound to
# this Mac. Moving an existing Docker install (--native) copies every row across first and
# leaves the Docker volume as it was. --docker sets up Docker and Supabase instead.
if want_native "$1"; then
  N=("$NODE" "$REPO/scripts/native-db.mjs")
  "${N[@]}" install
  moved=""
  if ! native_db && command -v docker >/dev/null && colima status >/dev/null 2>&1 && db_up; then
    echo "Copying your data out of Docker…"
    moved="$HOME/Library/Application Support/MarkOS/moved-from-docker-$(date +%Y%m%d-%H%M%S).sql.gz"
    pid="$(grep -m1 '^project_id' supabase/config.toml | cut -d'"' -f2)"
    (umask 077; docker exec "supabase_db_${pid:-markos}" pg_dump -U postgres --data-only --schema=public \
      --no-owner --no-privileges postgres | gzip > "$moved")
    supabase stop >> "$LOG/supabase.log" 2>&1 || true
  fi
  "${N[@]}" start
  [ -n "$moved" ] && "${N[@]}" restore "$moved" && echo "Moved your data out of Docker (copy kept at $moved)."
  "${N[@]}" keys
  echo "Database ready without Docker, on this Mac only, with this install's own keys in .env.local."
  exit 0
fi

if ! colima status >/dev/null 2>&1; then
  echo "Starting Docker (Colima, 2 GB)…"
  colima start --cpu 2 --memory "${MARKOS_VM_MEMORY:-2}" >> "$LOG/colima.log" 2>&1
fi
private_network
if ! db_up; then
  echo "Starting the database (first time: a few minutes to download)…"
  supabase start -x "$SUPABASE_UNUSED" >> "$LOG/supabase.log" 2>&1 || true
  wait_for db_up 300 || { echo "The database didn't start. Details: $LOG/supabase.log"; exit 1; }
fi
slim_db

own_keys || { echo "Couldn't set up the database keys. Details: $LOG/supabase.log"; exit 1; }
migrate || { echo "The database update failed. Details: $LOG/supabase.log"; exit 1; }
echo "Database ready, on this Mac only, with this install's own keys in .env.local."
