#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/Applications/Cursor.app/Contents/Resources/app/resources/helpers:$ROOT/node_modules/.bin:$PATH"

cd "$ROOT"

if ! command -v vercel >/dev/null 2>&1; then
  echo "Installing Vercel CLI..."
  NODE="/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node"
  BOOT="$ROOT/.npm-bootstrap"
  "$NODE" "$BOOT/package/bin/npm-cli.js" exec --yes vercel@latest -- "$@"
else
  vercel "$@"
fi
