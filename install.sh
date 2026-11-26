#!/bin/sh
# MarkOS in one command on Mac or Linux (Windows: install.ps1). Checks this computer, installs,
# sets up the database (no Docker) and puts MarkOS on your Desktop. Safe to run again.
#   ./install.sh            the usual install
#   ./install.sh --docker   Mac only: database in Docker (needs Colima, Docker, Supabase CLI)
set -e
cd "$(dirname "$0")"
if [ "$(uname)" = "Darwin" ]; then exec zsh ./scripts/install-mac.sh "$@"; fi

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "MarkOS needs Node 22 or newer: https://nodejs.org (or your package manager)"; exit 1; }
major="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 22 ] || { echo "MarkOS needs Node 22 or newer; this is $("$NODE" --version). https://nodejs.org"; exit 1; }
[ "$(id -u)" != "0" ] || { echo "Run the installer as your own user, not with sudo: the database refuses root."; exit 1; }

echo "Installing (a minute or two)…"
npm install --no-audit --no-fund --loglevel=error
exec "$NODE" scripts/markos.mjs install
