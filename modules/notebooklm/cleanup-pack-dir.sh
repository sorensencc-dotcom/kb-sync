#!/bin/bash
# Cleanup function that handles immutable files in sandbox environments

PACK_DIR="${1:-.nlm_pack}"

if [ ! -d "$PACK_DIR" ]; then
    mkdir -p "$PACK_DIR"
    exit 0
fi

# Try standard rm first
if rm -f "$PACK_DIR"/repo_knowledge_pack* 2>/dev/null; then
    exit 0
fi

# If rm fails (immutable files), move to backup and create fresh
BACKUP_DIR="${PACK_DIR}.backup.$(date +%s)"
if mv "$PACK_DIR" "$BACKUP_DIR" 2>/dev/null; then
    mkdir -p "$PACK_DIR"
    exit 0
fi

# Last resort: fail gracefully but allow continuation
echo "Warning: Could not clean pack directory. Using existing directory." >&2
exit 0
