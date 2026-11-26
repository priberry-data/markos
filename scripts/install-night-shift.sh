#!/bin/zsh
# Schedules the night shift with launchd: every day at 02:00. If the Mac is
# asleep then, launchd runs it as soon as the Mac wakes.
#   ./scripts/install-night-shift.sh            install or update
#   ./scripts/install-night-shift.sh remove     uninstall
# Optional, so the Mac wakes itself for it (needs your password):
#   sudo pmset repeat wake MTWRFSU 01:55:00
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="local.markos.night-shift"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HOUR="${MARKOS_NIGHT_HOUR:-2}"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "$1" = "remove" ]; then
  rm -f "$PLIST"
  echo "Night shift removed."
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/MarkOS"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>$REPO/scripts/night-shift.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/MarkOS/launchd-night.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/MarkOS/launchd-night.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Night shift scheduled for ${HOUR}:00 every day ($PLIST)."
