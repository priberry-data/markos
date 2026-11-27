#!/bin/zsh
# Checks what MarkOS needs before you install it. Changes nothing.
ok=1
pass() { print -P "%F{green}✓%f $1"; }
miss() { print -P "%F{red}✗%f $1"; print "    $2"; ok=0; }
note() { print -P "%F{yellow}!%f $1"; print "    $2"; }   # worth knowing, doesn't stop the install

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

# An AI for the team. MarkOS installs and runs without one; it's picked in Settings → Your AI.
# Claude Code is looked for where MarkOS itself looks (lib/llm/providers/claude-code.ts).
claude_bin="$(command -v claude)"
for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
  [ -n "$claude_bin" ] && break
  [ -x "$c" ] && claude_bin="$c"
done
support="${MARKOS_HOME:-$HOME/Library/Application Support/MarkOS}"
if [ -n "$claude_bin" ]; then
  pass "AI: Claude Code ($("$claude_bin" --version 2>/dev/null | head -1))"
  print "    Make sure you're signed in: run \`claude\` and type /login if it asks."
elif { [ -n "$NODE" ] && "$NODE" -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(c.compat || c.ollama || c.geminiKey || c.anthropicKey ? 0 : 1)' "$support/ai.json" 2>/dev/null; } \
  || grep -qE '^(GEMINI_API_KEY|ANTHROPIC_API_KEY)=[^[:space:]]' "$REPO/.env.local" 2>/dev/null; then
  pass "AI: set up in Settings → Your AI"
elif command -v ollama >/dev/null || [ -d /Applications/Ollama.app ]; then
  pass "AI: Ollama is installed (free, on this Mac). Choose it in Settings → Your AI."
else
  note "No AI set up yet: the team needs one to work." "Pick one when MarkOS opens (or later in Settings → Your AI): your Claude plan (Claude Code),
    an API key (Gemini, OpenRouter, OpenAI, Groq, DeepSeek, Mistral and others), or a free model on
    this Mac with Ollama (https://ollama.com) or LM Studio (https://lmstudio.ai).
    For Claude Code: in a terminal run  curl -fsSL https://claude.ai/install.sh | bash   then run claude and type /login"
fi

# Supabase publishes container ports on every network interface by default, so anyone on
# the same Wi-Fi could reach the database. Check MarkOS's ports if they're open.
open="$(lsof -nP -iTCP:54321 -iTCP:54322 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 && $9 ~ /^\*:/ {print $9}' | sort -u | tr '\n' ' ')"
if (( docker_mode )) && [ -n "$open" ]; then
  miss "Database reachable from your network (${open% })" "Run ./scripts/setup-db.sh: it rebinds the database to this Mac only and keeps your data."
fi

(( ok )) && print "\nReady to install." || { print "\nFix the items above, then run this again."; exit 1; }
