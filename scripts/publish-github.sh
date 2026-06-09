#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GH="$ROOT/.tools/gh_2.67.0_macOS_amd64/bin/gh"
GIT="$ROOT/.tools/dugite-setup/node_modules/dugite/git/bin/git"
export GIT_EXEC_PATH="$ROOT/.tools/dugite-setup/node_modules/dugite/git/libexec/git-core"

REPO_NAME="${1:-chromasound}"
VISIBILITY="${2:-public}"

cd "$ROOT"

if ! "$GH" auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated."
  echo "Run: $GH auth login"
  exit 1
fi

if "$GH" repo view "$REPO_NAME" >/dev/null 2>&1; then
  echo "Repository $REPO_NAME already exists on GitHub."
else
  "$GH" repo create "$REPO_NAME" \
    --source=. \
    --remote=origin \
    --public \
    --description "ChromaSound — turn colors into music with the Web Audio API"
fi

"$GIT" push -u origin main

echo ""
echo "GitHub repo ready:"
"$GH" repo view --web --json url -q .url 2>/dev/null || "$GH" repo view "$REPO_NAME" --json url -q .url
