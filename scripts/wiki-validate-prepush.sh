#!/usr/bin/env bash
### Pre-push hook: enforce Sibling Pattern Checking gates and automatically
### synchronize & publish the GitHub Wiki repository on push.
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

SIBLING_CHECKER="modules/wiki/run-sibling-check.mjs"

if [ -f "$SIBLING_CHECKER" ]; then
  echo "[SIBLING-CHECK] Running Graft-enhanced Sibling Pattern verification gate..."
  
  # Run sibling check with pre-push strict enforcement mode
  if node "$SIBLING_CHECKER" --mode=pre-push; then
    echo "[SIBLING-CHECK] ✓ Sibling verification passed. Gate cleared."
  else
    echo "[SIBLING-CHECK] ✗ Sibling verification failed. Push transaction aborted."
    exit 1
  fi
fi

# Automatically sync and publish wiki to GitHub Wiki repository
if [ -f "scripts/sync-github-wiki.mjs" ]; then
  echo "[WIKI-SYNC] Automatically synchronizing and publishing wiki documentation to GitHub Wiki..."
  node scripts/sync-github-wiki.mjs || echo "[WIKI-SYNC] Warning: GitHub wiki sync encountered non-blocking warning."
fi

exit 0
