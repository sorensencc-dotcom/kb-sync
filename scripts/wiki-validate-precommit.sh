#!/usr/bin/env bash
# Pre-commit hook: validate changed wiki markdown before commit.
#
# Two checks:
#   1. Staging snapshot (--diff): catches issues in the latest staged snapshot.
#   2. Repo docs: validates the parent dir of every changed repo .md file,
#      catching broken relative links (root-relative doc links, the recurring
#      class) at commit time instead of at ingestion/retro time.

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

VALIDATOR="modules/wiki/validate-staging-docs.mjs"

# Staged markdown files (added/copied/modified).
CHANGED_MD=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.md$' || true)

if [ -z "$CHANGED_MD" ]; then
  echo "[WIKI-VALIDATE] No markdown files staged; skipping validation."
  exit 0
fi

echo "[WIKI-VALIDATE] Validating $(echo "$CHANGED_MD" | wc -l | tr -d ' ') changed markdown file(s)..."

FAILED=0

# --- Check 1: staging snapshot (--diff mode) ---
if npm run wiki:validate-staging -- --diff > /dev/null 2>&1; then
  echo "[WIKI-VALIDATE] ✓ Staging snapshot check passed."
else
  echo "[WIKI-VALIDATE] ✗ Staging snapshot check failed:"
  npm run wiki:validate-staging -- --diff || true
  FAILED=1
fi

# --- Check 2: repo docs (broken relative links) ---
# Validate the unique parent directory of each changed repo .md file.
# Skip the vault staging tree (handled by check 1) and the human wiki
# (obsidian/vault) which has a separate lifecycle.
DIRS=$(echo "$CHANGED_MD" \
  | grep -vE '^obsidian/vault/' \
  | grep -vE '_kb-sync-staging/' \
  | xargs -r -n1 dirname 2>/dev/null \
  | sort -u || true)

for dir in $DIRS; do
  [ -d "$dir" ] || continue
  if node "$VALIDATOR" "$dir" > /dev/null 2>&1; then
    echo "[WIKI-VALIDATE] ✓ $dir"
  else
    echo "[WIKI-VALIDATE] ✗ $dir has broken relative link(s):"
    node "$VALIDATOR" "$dir" 2>&1 | grep -E 'broken relative link|✗ ERROR' || true
    FAILED=1
  fi
done

if [ "$FAILED" -eq 0 ]; then
  echo "[WIKI-VALIDATE] ✓ All validations passed."
  exit 0
fi

echo "[WIKI-VALIDATE] Commit blocked. Fix the errors above (or 'git commit --no-verify' to bypass)."
exit 1
