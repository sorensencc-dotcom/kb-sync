#!/usr/bin/env bash
# Pre-commit hook: validate changed repo markdown for broken relative links
# before commit. Catches root-relative doc links (the recurring class) at commit
# time instead of at ingestion/retro time.
#
# Validates each changed FILE individually (not its directory), so a clean doc
# is never blocked by a pre-existing error in a sibling file, and editing a
# root-level .md never triggers a whole-repo walk.

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

VALIDATOR="modules/wiki/validate-staging-docs.mjs"

# Staged markdown files (added/copied/modified). Exclude the vault staging tree
# and human wiki (obsidian/vault), which have a separate lifecycle.
CHANGED_MD=$(
  git diff --cached --name-only --diff-filter=ACM \
    | grep -E '\.md$' \
    | grep -vE '^obsidian/vault/' \
    | grep -vE '_kb-sync-staging/' \
    || true
)

if [ -z "$CHANGED_MD" ]; then
  echo "[WIKI-VALIDATE] No repo markdown files staged; skipping validation."
  exit 0
fi

echo "[WIKI-VALIDATE] Validating $(echo "$CHANGED_MD" | wc -l | tr -d ' ') changed markdown file(s)..."

FAILED=0
# Read newline-delimited paths (git quotes paths with spaces; repo uses none).
while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ -f "$file" ] || continue
  if node "$VALIDATOR" "$file" > /dev/null 2>&1; then
    echo "[WIKI-VALIDATE] ✓ $file"
  else
    echo "[WIKI-VALIDATE] ✗ $file has broken relative link(s):"
    node "$VALIDATOR" "$file" 2>&1 | grep -E 'broken relative link|✗ ERROR' || true
    FAILED=1
  fi
done <<< "$CHANGED_MD"

if [ "$FAILED" -eq 0 ]; then
  echo "[WIKI-VALIDATE] ✓ All validations passed."
  exit 0
fi

echo "[WIKI-VALIDATE] Commit blocked. Fix the errors above (or 'git commit --no-verify' to bypass)."
exit 1
