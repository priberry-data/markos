#!/bin/zsh
# Builds ~/Desktop/MarkOS.app — double-click to start everything and open MarkOS
# in its own window. Rerun this script after moving the repo.
#
# The app (start-up steps are shared with the night shift, scripts/lib-start.sh):
#   1. starts the local database if it isn't up,
#   2. builds MarkOS only when the code has changed, then starts the server,
#   3. opens MarkOS in a dedicated Chrome app window, on the morning brief,
#   4. when that window closes, stops the server it started (after letting any
#      in-progress work finish). The database stays up.
#
# Logs: ~/Library/Logs/MarkOS/
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="${MARKOS_APP:-$HOME/Desktop/MarkOS.app}"   # MARKOS_APP: somewhere else (tests)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# ---- launcher ---------------------------------------------------------------
cat > "$APP/Contents/MacOS/MarkOS" <<LAUNCH
#!/bin/zsh
REPO="$REPO"
LAUNCH
cat >> "$APP/Contents/MacOS/MarkOS" <<'LAUNCH'

# Apps opened from Finder get a minimal environment; lib-start.sh sets PATH
# (native arm64 Node first — the default /usr/local node is x86_64 under
# Rosetta) and DOCKER_HOST, and brings up Docker, the database and the server.
LOG="$HOME/Library/Logs/MarkOS"
PROFILE="$HOME/Library/Application Support/MarkOS/Chrome"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$LOG"
exec >> "$LOG/launcher.log" 2>&1
echo "---- $(date) ----"
source "$REPO/scripts/lib-start.sh"

ensure_server
[ -n "$STARTED" ] && note "Opening MarkOS…"

# A dedicated profile makes MarkOS its own app window (no tabs or address bar)
# and makes this call block until that window is closed.
if [ -x "$CHROME" ]; then
  "$CHROME" --user-data-dir="$PROFILE" --app="$URL" --no-first-run --no-default-browser-check >/dev/null 2>&1
else
  open -a Safari "$URL"
  exit 0
fi

# Window closed. Stop only a server this launcher started, and never in the
# middle of work — an agent run, a task or the night shift finishes first.
if [ -n "$STARTED" ] && [ "$(running)" != "0" ] && [ -n "$(running)" ]; then
  note "The team is still working. MarkOS will finish in the background."
fi
stop_server_if_idle
LAUNCH
chmod +x "$APP/Contents/MacOS/MarkOS"

# ---- Info.plist -------------------------------------------------------------
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MarkOS</string>
  <key>CFBundleDisplayName</key><string>MarkOS</string>
  <key>CFBundleIdentifier</key><string>local.markos.app</string>
  <key>CFBundleVersion</key><string>3.0</string>
  <key>CFBundleShortVersionString</key><string>3.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>MarkOS</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <!-- The Chrome window is the visible app; the launcher itself stays out of the Dock. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# ---- icon -------------------------------------------------------------------
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
SRC="$REPO/public/icon-1024.png"
for s in 16 32 64 128 256 512; do
  sips -z $s $s "$SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
touch "$APP"   # make Finder pick up the new icon

echo "Built: $APP"
