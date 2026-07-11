#!/usr/bin/env bash
# ==============================================================================
# Git Post-Commit Hook Example for NotebookLM Sync
# Copy to .git/hooks/post-commit and make executable (chmod +x)
# ==============================================================================
set -e

# Path to main sync script relative to repo root
SYNC_SCRIPT="modules/notebooklm/ingest-notebooklm.sh"
LOG_FILE=".nlm_pack/sync-background.log"

# Check if sync script exists
if [ ! -f "$SYNC_SCRIPT" ]; then
  exit 0
fi

# Detect if files with matching extensions were updated in the commit
CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD)
MATCHES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|js|py|md|json|yaml|yml|sh|ps1)$' || true)

if [ -n "$MATCHES" ]; then
  printf '\e[32m[NLM-HOOK] Changes detected in code/docs. Launching sync in background...\e[0m\n'
  mkdir -p .nlm_pack
  
  # Trigger the sync script asynchronously to avoid blocking git commits
  nohup bash "$SYNC_SCRIPT" > "$LOG_FILE" 2>&1 &
fi
