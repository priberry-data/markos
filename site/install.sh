#!/bin/sh
# MarkOS one-line install for Mac and Linux:
#   curl -fsSL https://markos.priberry.com/install.sh | sh
# Gets the code into ~/markos (git if you have it, else a download from GitHub), then runs its
# installer. Run it again to update. Source: https://github.com/priberry-data/markos
set -e
DIR="${MARKOS_DIR:-$HOME/markos}"
REPO="https://github.com/priberry-data/markos"
REF="${MARKOS_REF:-main}"   # a branch to test

command -v node >/dev/null 2>&1 || { echo "MarkOS needs Node 22 or newer: https://nodejs.org (or your package manager)"; exit 1; }

if [ -d "$DIR/.git" ]; then
  echo "Updating MarkOS in $DIR…"
  git -C "$DIR" pull --ff-only -q
elif [ -z "$MARKOS_NO_GIT" ] && command -v git >/dev/null 2>&1 && [ ! -e "$DIR" ]; then
  echo "Getting MarkOS into $DIR…"
  git clone -q -b "$REF" "$REPO" "$DIR"
else
  echo "Downloading MarkOS into $DIR…"
  mkdir -p "$DIR"
  curl -fsSL "$REPO/archive/refs/heads/$REF.tar.gz" | tar -xz -C "$DIR" --strip-components=1
  rm -f "$DIR/.next/markos-build-stamp"   # no git to compare against: rebuild on next open
fi

cd "$DIR"
exec sh ./install.sh "$@"
