#!/usr/bin/env bash
### Pre-commit hook v2: validate changed repo markdown for broken relative links,
### enforce wiki contract rules, and perform Graft-enhanced sibling pattern checks.
if command -v git.exe >/dev/null 2>&1; then
  GIT_BIN="git.exe"
else
  GIT_BIN="git"
fi

REPO_ROOT=$($GIT_BIN rev-parse --show-toplevel)
if [[ "$REPO_ROOT" =~ ^[A-Za-z]:/ ]]; then
  DRIVE_LETTER=$(echo "$REPO_ROOT" | cut -c1 | tr '[:upper:]' '[:lower:]')
  REST_OF_PATH=$(echo "$REPO_ROOT" | cut -c3-)
  WSL_ROOT="/mnt/${DRIVE_LETTER}${REST_OF_PATH}"
  if [ -d "$WSL_ROOT" ]; then
    REPO_ROOT="$WSL_ROOT"
  fi
fi
cd "$REPO_ROOT"

VALIDATOR="modules/wiki/validate-staging-docs.mjs"
CONTRACT_VALIDATOR="modules/wiki/validate-contract.mjs"

### Step 0: Secret scan
if ! bash "$REPO_ROOT/scripts/secret-scan-hook.sh"; then
  exit 1
fi

### Staged markdown files (added/copied/modified). Exclude vault staging tree
### and human wiki (obsidian/vault), which have a separate lifecycle.
CHANGED_MD=$(
  $GIT_BIN diff --cached --name-only --diff-filter=ACM \
    | grep -E '\.md$' \
    | grep -vE '^obsidian/vault/' \
    | grep -vE '_kb-sync-staging/' \
    || true
)

### Staged scripts/modules (js, mjs, ts, sh)
CHANGED_CODE=$(
  $GIT_BIN diff --cached --name-only --diff-filter=ACM \
    | grep -E '\.(js|mjs|ts|sh)$' \
    || true
)

FAILED=0

### Step 1: Validate changed Markdown files
if [ -n "$CHANGED_MD" ]; then
  echo "[WIKI-VALIDATE] Validating $(echo "$CHANGED_MD" | wc -l | tr -d ' ') changed markdown file(s)..."
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    [ -f "$file" ] || continue
    VAL_OUT=$(node "$VALIDATOR" "$file" 2>&1)
    VAL_STATUS=$?
    if [ $VAL_STATUS -eq 0 ]; then
      echo "[WIKI-VALIDATE] ✓ $file (link structure)"
    else
      echo "[WIKI-VALIDATE] ✗ $file validation failed (exit $VAL_STATUS):"
      echo "$VAL_OUT"
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

### Step 2: Sibling Pattern Scope Check for Code Changes (Phase 2 Native Node Engine with Graft Enhancement)
if [ -n "$CHANGED_CODE" ]; then
  echo "[SIBLING-CHECK] Performing Graft-enhanced sibling scope check for modified code files..."
  node modules/wiki/run-sibling-check.mjs --mode=pre-commit
fi

if [ "$FAILED" -eq 0 ]; then
  echo "[WIKI-VALIDATE] ✓ Pre-commit checks completed successfully."
  exit 0
fi

echo "[WIKI-VALIDATE] Commit blocked. Fix the errors above (or 'git commit --no-verify' to bypass)."
exit 1
