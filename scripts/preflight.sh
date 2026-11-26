#!/bin/zsh
# Checks what MarkOS needs before you install it. Changes nothing.
ok=1
pass() { print -P "%F{green}✓%f $1"; }
miss() { print -P "%F{red}✗%f $1"; print "    $2"; ok=0; }

[[ "$(uname)" == "Darwin" ]] && pass "macOS" || miss "macOS" "MarkOS runs on a Mac (its night shift, calendar and Desktop app use macOS)."

NODE="$HOME/.local/node-arm64/bin/node"; [ -x "$NODE" ] || NODE="$(command -v node)"
if [ -n "$NODE" ]; then
  major="$("$NODE" -p 'process.versions.node.split(".")[0]')"
  arch="$("$NODE" -p process.arch)"
  (( major >= 22 )) && pass "Node $("$NODE" --version) ($arch)" || miss "Node 22 or newer" "Found $("$NODE" --version). Install a newer Node from nodejs.org."
  [[ "$(uname -m)" == "arm64" && "$arch" != "arm64" ]] && print "    Note: this Node is x86 under Rosetta. It works, but an arm64 Node is much faster."
else
  miss "Node" "Install Node 22 or newer from nodejs.org."
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Docker is needed only with --docker, or for an install already set up on Docker.
docker_mode=0
if [[ "$1" == "--docker" ]]; then docker_mode=1
elif [[ "$1" != "--native" ]] && ! grep -qx 'MARKOS_DB=native' "$REPO/.env.local" 2>/dev/null \
  && grep -qE '^SUPABASE_SERVICE_ROLE_KEY=.+' "$REPO/.env.local" 2>/dev/null; then docker_mode=1; fi
if (( ! docker_mode )); then
  pass "Database: runs without Docker, nothing else to install"
else
  command -v colima >/dev/null && pass "Colima" || miss "Colima" "brew install colima docker   (or move off Docker: ./scripts/setup-db.sh --native)"
  command -v docker >/dev/null && pass "Docker CLI" || miss "Docker CLI" "brew install docker"
  command -v supabase >/dev/null && pass "Supabase CLI" || miss "Supabase CLI" "brew install supabase/tap/supabase"
fi

if command -v claude >/dev/null; then
  pass "Claude Code ($(claude --version 2>/dev/null | head -1))"
  print "    Make sure you're signed in: run \`claude\` and type /login if it asks."
else
  miss "Claude Code" "curl -fsSL https://claude.ai/install.sh | bash, then run claude and type /login"
fi

# Supabase publishes container ports on every network interface by default, so anyone on
# the same Wi-Fi could reach the database. Check MarkOS's ports if they're open.
open="$(lsof -nP -iTCP:54321 -iTCP:54322 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 && $9 ~ /^\*:/ {print $9}' | sort -u | tr '\n' ' ')"
if (( docker_mode )) && [ -n "$open" ]; then
  miss "Database reachable from your network (${open% })" "Run ./scripts/setup-db.sh: it rebinds the database to this Mac only and keeps your data."
fi

(( ok )) && print "\nReady to install." || { print "\nFix the items above, then run this again."; exit 1; }
