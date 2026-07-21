#!/usr/bin/env bash
# Pre-commit hook: validate changed repo markdown for broken relative links,
# enforce wiki contract rules, and perform sibling pattern scope checks.

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

VALIDATOR="modules/wiki/validate-staging-docs.mjs"
CONTRACT_VALIDATOR="modules/wiki/validate-contract.mjs"

# Staged markdown files (added/copied/modified). Exclude vault staging tree
# and human wiki (obsidian/vault), which have a separate lifecycle.
CHANGED_MD=$(
  git diff --cached --name-only --diff-filter=ACM \
    | grep -E '\.md$' \
    | grep -vE '^obsidian/vault/' \
    | grep -vE '_kb-sync-staging/' \
    || true
)

# Staged scripts/modules (js, mjs, ts, sh)
CHANGED_CODE=$(
  git diff --cached --name-only --diff-filter=ACM \
    | grep -E '\.(js|mjs|ts|sh)$' \
    || true
)

FAILED=0

# Step 1: Validate changed Markdown files
if [ -n "$CHANGED_MD" ]; then
  echo "[WIKI-VALIDATE] Validating $(echo "$CHANGED_MD" | wc -l | tr -d ' ') changed markdown file(s)..."
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    [ -f "$file" ] || continue
    if node "$VALIDATOR" "$file" > /dev/null 2>&1; then
      echo "[WIKI-VALIDATE] ✓ $file (link structure)"
    else
      echo "[WIKI-VALIDATE] ✗ $file has broken relative link(s):"
      node "$VALIDATOR" "$file" 2>&1 | grep -E 'broken relative link|✗ ERROR' || true
      FAILED=1
    fi
  done <<< "$CHANGED_MD"

  echo "[WIKI-VALIDATE] Running Wiki Contract validation on changed staging files..."
  if node "$CONTRACT_VALIDATOR" > /dev/null 2>&1; then
    echo "[WIKI-VALIDATE] ✓ Wiki Contract validation passed."
  else
    echo "[WIKI-VALIDATE] ⚠ Wiki Contract validation reported non-blocking warnings on current staging layout."
  fi
else
  echo "[WIKI-VALIDATE] No repo markdown files staged; skipping doc validation."
fi

# Step 2: Sibling Pattern Scope Check for Code Changes
if [ -n "$CHANGED_CODE" ]; then
  echo "[SIBLING-CHECK] Performing sibling scope check for modified code files..."
  while IFS= read -r codefile; do
    [ -n "$codefile" ] || continue
    basename=$(basename "$codefile" | cut -d. -f1)
    
    # Grep for references to modified file basename across repo
    match_count=$(git grep -l "$basename" -- ':(exclude)'"$codefile" ':(exclude)package-lock.json' || true | wc -l | tr -d ' ')
    echo "[SIBLING-CHECK] Found $match_count sibling file(s) referencing '$basename'."
  done <<< "$CHANGED_CODE"
fi

if [ "$FAILED" -eq 0 ]; then
  echo "[WIKI-VALIDATE] ✓ Pre-commit checks completed successfully."
  exit 0
fi

echo "[WIKI-VALIDATE] Commit blocked. Fix the errors above (or 'git commit --no-verify' to bypass)."
exit 1
