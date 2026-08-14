#!/usr/bin/env bash
### Pre-push hook v2: enforce Sibling Pattern Checking gates before pushing
### utilizing local Graft call-graph queries and static DAG backups.
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

SIBLING_CHECKER="modules/wiki/run-sibling-check.mjs"

if [ -f "$SIBLING_CHECKER" ]; then
  echo "[SIBLING-CHECK] Running Graft-enhanced Sibling Pattern verification gate..."
  
  # Run sibling check with pre-push strict enforcement mode
  if node "$SIBLING_CHECKER" --mode=pre-push; then
    echo "[SIBLING-CHECK] ✓ Sibling verification passed. Gate cleared."
    exit 0
  else
    echo "[SIBLING-CHECK] ✗ Sibling verification failed. Push transaction aborted."
    exit 1
  fi
else
  echo "[SIBLING-CHECK] Warning: Sibling check utility missing; bypassing pre-push guard."
  exit 0
fi
