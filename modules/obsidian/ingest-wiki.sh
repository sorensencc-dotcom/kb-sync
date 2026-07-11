#!/usr/bin/env bash
# ==============================================================================
# Obsidian Wiki Ingest Orchestrator
# Validates staged raw sources and orchestrates Claude-driven wiki synthesis.
# Implements Karpathy LLM-wiki pattern: Phase 1-8 workflow (Ingest → Commit)
# ==============================================================================
set -uo pipefail

# Unset git environment overrides
unset GIT_DIR
unset GIT_WORK_TREE
unset GIT_INDEX_FILE

# --- CONSTANTS & SETUP -------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIGS_DIR="$REPO_ROOT/configs"
MODULE_CONFIG="$CONFIGS_DIR/obsidian.yaml"

# Log helpers
log_info() {
  printf '\e[32m[WIKI-INGEST] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[WIKI-INGEST] [ERROR] %s\e[0m\n' "$*" >&2
}

log_warn() {
  printf '\e[33m[WIKI-INGEST] [WARN] %s\e[0m\n' "$*" >&2
}

# Parse config value (simple key=value or key: value)
get_config_value() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 1
  fi
  grep -E "^\s*${key}\s*[:=]" "$file" | head -1 | \
    sed -E "s/^\s*${key}\s*[:=]\s*//; s/#.*$//; s/^['\"]//; s/['\"]$//; s/\s*$//" || true
}

# --- PRE-FLIGHT CHECKS -------------------------------------------------------
log_info "Initializing Obsidian wiki ingest orchestrator..."

# Verify we're in a git repo
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.git" ]; then
  log_error "Not inside a valid git repository."
  exit 1
fi

# Verify config exists
if [ ! -f "$MODULE_CONFIG" ]; then
  log_error "Obsidian config not found: $MODULE_CONFIG"
  exit 1
fi

log_info "Module config located."

# --- LOAD MODULE CONFIG & ENVIRONMENT ----------------------------------------
OBSIDIAN_VAULT_ROOT="${OBSIDIAN_VAULT_ROOT:-}"
if [ -z "$OBSIDIAN_VAULT_ROOT" ]; then
  OBSIDIAN_VAULT_ROOT=$(get_config_value "$MODULE_CONFIG" "vault_root")
fi

# Normalize paths (handle Windows backslashes → forward slashes)
normalize_path() {
  local path="$1"
  # Convert backslashes to forward slashes
  path="${path//\\//}"
  # If running in WSL, convert C: to /mnt/c, etc.
  if [ -f /etc/wsl.conf ] || grep -q microsoft /proc/version 2>/dev/null; then
    path="${path//C:/\/mnt\/c}"
    path="${path//D:/\/mnt\/d}"
    path="${path//E:/\/mnt\/e}"
  fi
  echo "$path"
}

OBSIDIAN_VAULT_ROOT=$(normalize_path "$OBSIDIAN_VAULT_ROOT")

if [ -z "$OBSIDIAN_VAULT_ROOT" ]; then
  log_error "OBSIDIAN_VAULT_ROOT not set. Set via env var or vault_root in $MODULE_CONFIG"
  exit 1
fi

if [ ! -d "$OBSIDIAN_VAULT_ROOT" ]; then
  log_error "Obsidian vault directory does not exist: $OBSIDIAN_VAULT_ROOT"
  exit 1
fi

log_info "Obsidian vault root: $OBSIDIAN_VAULT_ROOT"

# Load staging/wiki directories from config
STAGING_DIR=$(get_config_value "$MODULE_CONFIG" "staging_dir")
WIKI_DIR=$(get_config_value "$MODULE_CONFIG" "wiki_dir")

if [ -z "$STAGING_DIR" ]; then
  log_error "staging_dir not found in $MODULE_CONFIG"
  exit 1
fi

if [ -z "$WIKI_DIR" ]; then
  log_error "wiki_dir not found in $MODULE_CONFIG"
  exit 1
fi

log_info "Staging directory: $STAGING_DIR"
log_info "Wiki directory: $WIKI_DIR"

# --- PARSE ARGUMENTS ---------------------------------------------------------
ACTION="${1:-validate}"  # validate (default), log-entry, prompt
STAGING_PATH="${2:-}"

# If no staging path provided, find latest
if [ -z "$STAGING_PATH" ]; then
  log_info "No staging path provided. Finding latest staging..."
  LATEST_STAGING=$(find "$OBSIDIAN_VAULT_ROOT/$STAGING_DIR" -maxdepth 3 -type d -name "[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]" 2>/dev/null | sort -r | head -1)
  if [ -z "$LATEST_STAGING" ]; then
    log_error "No staged sources found. Run: npm run kb:sync:obsidian"
    exit 1
  fi
  STAGING_PATH="$LATEST_STAGING"
fi

# Normalize path
STAGING_PATH="${STAGING_PATH%/}"

log_info "Staging path: $STAGING_PATH"

# --- VALIDATE STAGING --------------------------------------------------------
log_info "========================================================================"
log_info "Validating staged sources..."
log_info "========================================================================"

if [ ! -d "$STAGING_PATH" ]; then
  log_error "Staging directory not found: $STAGING_PATH"
  exit 1
fi

MANIFEST_FILE="$STAGING_PATH/FILES.manifest.txt"
if [ ! -f "$MANIFEST_FILE" ]; then
  log_error "Manifest not found: $MANIFEST_FILE"
  log_error "Staging directory may be corrupted or not created by ingest-obsidian.sh"
  exit 1
fi

FILE_COUNT=$(wc -l < "$MANIFEST_FILE")
log_info "Manifest validated: $FILE_COUNT files in staging."

# --- DETERMINE ACTION --------------------------------------------------------
case "$ACTION" in
  validate)
    log_info "Validation complete. Staging ready for wiki ingest."
    exit 0
    ;;

  log-entry)
    # Log entry written by Claude after synthesis completes
    # Called from git hook or wrapper script
    log_info "Action: log-entry (not yet implemented)"
    exit 0
    ;;

  prompt)
    # Generate operator prompt for Claude Code
    log_info "Generating Claude Code prompt..."
    cat << EOF

=== OBSIDIAN WIKI INGEST PROMPT ===

You are about to ingest staged raw sources into the Obsidian wiki using an 8-phase workflow.

**Staging Path:** $STAGING_PATH
**Vault Root:** $OBSIDIAN_VAULT_ROOT
**Schema Document:** docs/targets/obsidian.md

**Workflow Phases:**
1. **Ingest** — Identify new entities and concepts from staged sources
2. **Lint** — Verify current wiki for structural/semantic issues
3. **Update** — Create/modify entity and concept pages
4. **Cross-Ref** — Establish bidirectional links
5. **Lint** — Re-verify after updates
6. **Log** — Record session in Log.md
7. **Review** — Spot-check for accuracy
8. **Commit** — Git commit with change summary

**Schema Reference:** Read docs/targets/obsidian.md for:
- Entity page format (summary, purpose, operations, links)
- Concept page format (problem, solution, examples)
- Cross-reference conventions
- Index and Log.md templates

**Constraints:**
- Do NOT edit raw sources (they are immutable)
- Preserve existing wiki content (append, don't overwrite)
- All pages link back to staging path for traceability
- Use exact schema format from obsidian.md

After completing phases 1-7, reply with: ✓ Wiki synthesis complete and your change summary.

EOF
    exit 0
    ;;

  *)
    log_error "Unknown action: $ACTION"
    log_error "Usage: $0 [action|validate|log-entry|prompt] [staging_path]"
    exit 1
    ;;
esac
