#!/bin/zsh
# Back up MarkOS's data (products, reports, meetings, customers, pipeline,
# everything in the local database) — the part git doesn't hold.
#
# Writes a compressed dump to iCloud Drive (MarkOS Backups), so it survives
# this Mac. Keeps the last 30. Runs after every night shift; run it by hand any
# time:  ./scripts/backup-data.sh
# Restore on a new Mac:  ./scripts/restore-data.sh <file>
set -e
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
if [ -d "$ICLOUD" ]; then DEST="$ICLOUD/MarkOS Backups"; else DEST="$HOME/Library/Application Support/MarkOS/backups"; fi
DEST="${MARKOS_BACKUP_DIR:-$DEST}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PID="$(grep -m1 '^project_id' "$REPO/supabase/config.toml" | cut -d'"' -f2)"
mkdir -p "$DEST"
FILE="$DEST/markos-$(date +%Y-%m-%d-%H%M).sql.gz"

# Data only, public schema: the schema itself comes from the repo's migration.
# social_tokens (the X / LinkedIn OAuth tokens) never leave this Mac: after a
# restore, reconnect the accounts in Settings.
if grep -qx 'MARKOS_DB=native' "$REPO/.env.local" 2>/dev/null; then
  NODE="$HOME/.local/node-arm64/bin/node"; [ -x "$NODE" ] || NODE="$(command -v node)"
  "$NODE" "$REPO/scripts/native-db.mjs" dump "$FILE.partial"
else
docker exec "supabase_db_${PID:-markos}" pg_dump -U postgres --data-only --schema=public --no-owner --no-privileges \
  --exclude-table=public.llm_calls --exclude-table=public.social_tokens postgres | gzip > "$FILE.partial"
fi
mv "$FILE.partial" "$FILE"
echo "Backed up to $FILE ($(du -h "$FILE" | cut -f1))"

# Keep the newest 30.
ls -1t "$DEST"/markos-*.sql.gz 2>/dev/null | tail -n +31 | while IFS= read -r old; do rm -f "$old"; done
