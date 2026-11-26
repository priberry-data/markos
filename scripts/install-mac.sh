#!/bin/zsh
# MarkOS in one command: checks this Mac, installs, sets up the database (no Docker),
# and puts MarkOS on your Desktop. Safe to run again.
#   ./install.sh            the usual install
#   ./install.sh --docker   database in Docker instead (needs Colima, Docker, Supabase CLI)
set -e
cd "$(dirname "$0")/.."
NODE="$HOME/.local/node-arm64/bin/node"; [ -x "$NODE" ] || NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "MarkOS needs Node 22 or newer: https://nodejs.org"; exit 1; }
export PATH="$(dirname "$NODE"):$PATH"

echo "1/4  Checking this Mac…"
./scripts/preflight.sh "$@"
echo "\n2/4  Installing (a minute or two)…"
npm install --no-audit --no-fund --loglevel=error
echo "\n3/4  Setting up the database…"
./scripts/setup-db.sh "$@"
echo "\n4/4  Putting MarkOS on your Desktop…"
./scripts/make-desktop-app.sh

print "\nDone. MarkOS is on your Desktop (the first start builds it, about a minute)."
print "First stop: Settings → Test AI connection."
# Open it now, like an app after it installs: only for a person at a terminal, never in CI.
if [ -t 1 ] && [ -z "$CI" ] && [ -z "$MARKOS_NO_OPEN" ]; then
  print "\nOpening MarkOS…"
  open "${MARKOS_APP:-$HOME/Desktop/MarkOS.app}"
fi
