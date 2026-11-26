#!/bin/zsh
# Restore MarkOS's data from a backup made by backup-data.sh — e.g. on a new Mac.
#   ./scripts/restore-data.sh "~/Library/Mobile Documents/com~apple~CloudDocs/MarkOS Backups/markos-2026-10-17-0230.sql.gz"
# It rebuilds the database from the repo's schema first, so it REPLACES
# whatever data is in the local database now. It asks before doing that.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/MarkOS"
source "$REPO/scripts/lib-start.sh"   # Docker, and this install's database secret
DB="supabase_db_$(grep -m1 '^project_id' "$REPO/supabase/config.toml" | cut -d'"' -f2)"
FILE="$1"
[ -f "$FILE" ] || { echo "Usage: $0 <backup .sql.gz>"; exit 1; }
read "?This replaces all MarkOS data on this Mac with $FILE. Type yes to continue: " ok
[ "$ok" = "yes" ] || { echo "Cancelled."; exit 1; }
cd "$REPO"
if native_db; then
  "$NODE" "$REPO/scripts/native-db.mjs" start
  "$NODE" "$REPO/scripts/native-db.mjs" restore "$FILE"
  echo "Restored from $FILE"
  exit 0
fi
supabase db reset
# The schema seeds the settings row; the backup carries the real one.
docker exec -i "$DB" psql -U postgres -q -c "delete from profiles;"
# Load as the stack's superuser with constraint triggers paused, so rows that
# point at each other (sub-products, replies) load in any order.
{ echo "set session_replication_role = replica;"; gunzip -c "$FILE"; echo "set session_replication_role = default;"; } \
  | docker exec -i "$DB" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1
own_keys || echo "Restored, but couldn't write the database keys: run ./scripts/setup-db.sh"
echo "Restored from $FILE"
