#!/usr/bin/env bash
# Husky pre-commit hook: validate changed wiki markdown files before commit

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Get staged + unstaged markdown files
CHANGED_MD=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.md$' || true)

if [ -z "$CHANGED_MD" ]; then
  echo "[WIKI-VALIDATE] No markdown files staged; skipping validation."
  exit 0
fi

echo "[WIKI-VALIDATE] Validating $(echo "$CHANGED_MD" | wc -l) changed markdown file(s)..."

# Run validator in diff mode
if npm run wiki:validate-staging -- --diff > /dev/null 2>&1; then
  echo "[WIKI-VALIDATE] ✓ All validations passed."
  exit 0
else
  echo "[WIKI-VALIDATE] ✗ Validation failed. Fix errors before committing:"
  npm run wiki:validate-staging -- --diff
  exit 1
fi
