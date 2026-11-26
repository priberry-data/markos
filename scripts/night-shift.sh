#!/bin/zsh
# The night shift, run by launchd (see install-night-shift.sh) — or by hand:
#   ./scripts/night-shift.sh
# Starts MarkOS headless if it isn't running, asks it to run the night shift,
# waits for it to finish, then stops the server again unless the MarkOS
# window is open. The work itself happens inside the MarkOS server, exactly as
# it does during the day.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/MarkOS"
MARKOS_QUIET=1
mkdir -p "$LOG"
exec >> "$LOG/night-shift.log" 2>&1
echo "---- $(date) ----"
source "$REPO/scripts/lib-start.sh"

ensure_server
curl -sf --max-time 30 -X POST -H 'x-markos-trigger: schedule' -H "x-markos-token: $TOKEN" "$URL/api/night" || fail "Couldn't start the night shift."
echo
echo "night shift started"

# Wait for it: up to 6 hours (a usage-limit pause can wait for the reset).
for i in $(seq 1 1440); do
  sleep 15
  state="$(curl -s --max-time 5 "$URL/api/night" | grep -o '"status":"[a-z_]*"' | head -1 | cut -d'"' -f4)"
  [ "$state" != "running" ] && break
done
echo "night shift ended: ${state:-unknown}"

# Back up the data (git holds the code; this holds everything else).
"$REPO/scripts/backup-data.sh" || echo "backup failed"

stop_server_if_idle
