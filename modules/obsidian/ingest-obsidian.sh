#!/usr/bin/env bash
# ==============================================================================
# Obsidian Vault Sync — Staging-Only Script
# Implements Karpathy LLM-wiki pattern: stages raw sources for human ingest
# Human runs Claude Code session against staged output + docs/targets/obsidian.md
# ==============================================================================
set -uo pipefail

# Unset git environment overrides
unset GIT_DIR
unset GIT_WORK_TREE
unset GIT_INDEX_FILE

# --- CONSTANTS & SETUP -------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$REPO_ROOT/core"
CONFIGS_DIR="$REPO_ROOT/configs"
GLOBAL_CONFIG="$CONFIGS_DIR/global.yaml"
MODULE_CONFIG="$CONFIGS_DIR/obsidian.yaml"

# Log helpers
log_info() {
  printf '\e[32m[OBSIDIAN-INGEST] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[OBSIDIAN-INGEST] [ERROR] %s\e[0m\n' "$*" >&2
}

log_warn() {
  printf '\e[33m[OBSIDIAN-INGEST] [WARN] %s\e[0m\n' "$*" >&2
}

# Parse config value (simple key=value or key: value)
# Strips surrounding quotes, inline comments
get_config_value() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  grep -E "^\s*${key}\s*[:=]" "$file" | head -1 | \
    sed -E "s/^\s*${key}\s*[:=]\s*//; s/#.*$//; s/^['\"]//; s/['\"]$//; s/\s*$//" || true
}

# --- PRE-FLIGHT CHECKS -------------------------------------------------------
log_info "Initializing Obsidian vault staging orchestrator..."

# Verify we're in a git repo
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.git" ]; then
  log_error "Not inside a valid git repository."
  exit 1
fi

# Verify core scripts exist
if [ ! -x "$CORE_DIR/flatten.sh" ]; then
  log_error "Core script not found: $CORE_DIR/flatten.sh"
  exit 1
fi

# Verify configs exist
if [ ! -f "$GLOBAL_CONFIG" ]; then
  log_error "Global config not found: $GLOBAL_CONFIG"
  exit 1
fi

if [ ! -f "$MODULE_CONFIG" ]; then
  log_error "Obsidian config not found: $MODULE_CONFIG"
  exit 1
fi

log_info "Core scripts and configs located."

# --- LOAD MODULE CONFIG & ENVIRONMENT ----------------------------------------
# Try env var first, fall back to config
OBSIDIAN_VAULT_ROOT="${OBSIDIAN_VAULT_ROOT:-}"
if [ -z "$OBSIDIAN_VAULT_ROOT" ]; then
  OBSIDIAN_VAULT_ROOT=$(get_config_value "$MODULE_CONFIG" "vault_root")
fi

# Convert Windows paths to WSL mount format (C:\... → /mnt/c/...) only if running in WSL
convert_to_wsl_path() {
  local path="$1"
  # Remove backslashes
  path="${path//\\//}"
  # Convert to /mnt/<drive>/ only if running under WSL
  if grep -qi microsoft /proc/version 2>/dev/null; then
    if [[ "$path" =~ ^([A-Za-z]):/(.*) ]]; then
      local drive="${BASH_REMATCH[1]}"
      local rest="${BASH_REMATCH[2]}"
      drive=$(echo "$drive" | tr '[:upper:]' '[:lower:]')
      path="/mnt/${drive}/${rest}"
    fi
  fi
  echo "$path"
}

OBSIDIAN_VAULT_ROOT=$(convert_to_wsl_path "$OBSIDIAN_VAULT_ROOT")

# Fail-fast if vault root not set or doesn't exist
if [ -z "$OBSIDIAN_VAULT_ROOT" ]; then
  log_error "OBSIDIAN_VAULT_ROOT not set. Set via env var or vault_root in $MODULE_CONFIG"
  exit 1
fi

if [ ! -d "$OBSIDIAN_VAULT_ROOT" ]; then
  log_warn "Obsidian vault directory does not exist: $OBSIDIAN_VAULT_ROOT"
  log_warn "Obsidian sync requires vault to be configured. Skipping this sync target."
  exit 0
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

# --- STEP 1: CALL CORE FLATTEN WITH --MANIFEST --------------------------------
# Use manifest mode to get file list (Obsidian reads raw files directly, not concatenated pack)

log_info "========================================================================"
log_info "Generating file manifest via core/flatten.sh..."
log_info "========================================================================"

TEMP_PACK_DIR=$(mktemp -d)
# Cleanup deferred until after manifest is used (see cleanup trap at end of script)

# Call core/flatten.sh --manifest to get newline-delimited file list
if ! bash "$CORE_DIR/flatten.sh" \
  --output "$TEMP_PACK_DIR" \
  --pack-name "unused.txt" \
  --global-config "$GLOBAL_CONFIG" \
  --repo-root "$REPO_ROOT" \
  --manifest; then
  log_error "core/flatten.sh --manifest failed."
  exit 1
fi

MANIFEST_FILE="$TEMP_PACK_DIR/pack.manifest.txt"
if [ ! -f "$MANIFEST_FILE" ]; then
  log_error "Manifest file not generated: $MANIFEST_FILE"
  exit 1
fi

log_info "Manifest generated: $(wc -l < "$MANIFEST_FILE") files found."

# --- STEP 2: STAGE RAW SOURCE FILES -------------------------------------------
# Create timestamped staging directory
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
REPO_NAME=$(basename "$REPO_ROOT")
STAGING_PATH="$OBSIDIAN_VAULT_ROOT/$STAGING_DIR/$REPO_NAME/$TIMESTAMP"

log_info "========================================================================"
log_info "Staging raw sources to: $STAGING_PATH"
log_info "========================================================================"

mkdir -p "$STAGING_PATH"

# Copy files from manifest, preserving relative directory structure
FILE_COUNT=0
COPY_ERRORS=0

# Read manifest into memory to avoid issues with temp directory cleanup
mapfile -t MANIFEST_LINES < "$MANIFEST_FILE"

for file in "${MANIFEST_LINES[@]}"; do
  [ -z "$file" ] && continue

  SOURCE_FILE="$REPO_ROOT/$file"
  TARGET_FILE="$STAGING_PATH/$file"

  # Verify source exists
  if [ ! -f "$SOURCE_FILE" ]; then
    log_warn "Source file not found (skipping): $file"
    continue
  fi

  # Create target directory
  TARGET_DIR=$(dirname "$TARGET_FILE")
  if ! mkdir -p "$TARGET_DIR" 2>/dev/null; then
    log_warn "Failed to create directory (skipping): $TARGET_DIR"
    ((COPY_ERRORS++))
    continue
  fi

  # Copy file verbatim
  if ! cp "$SOURCE_FILE" "$TARGET_FILE" 2>/dev/null; then
    log_warn "Failed to copy file (skipping): $file"
    ((COPY_ERRORS++))
    continue
  fi
  ((FILE_COUNT++))
done

if [ "$COPY_ERRORS" -gt 0 ]; then
  log_warn "Encountered $COPY_ERRORS copy errors during staging (files skipped)."
fi

log_info "Staged $FILE_COUNT files."

# --- STEP 3: COPY MANIFEST TO STAGING PATH ------------------------------------
# Copy manifest into staging root for reference
cp "$MANIFEST_FILE" "$STAGING_PATH/FILES.manifest.txt"
log_info "Manifest saved: $STAGING_PATH/FILES.manifest.txt"

# --- STEP 4: PRINT OPERATOR PROMPT -------------------------------------------
log_info "========================================================================"
log_info "Obsidian Sync Staging Complete"
log_info "========================================================================"

cat >&2 << 'EOF'

📦 Raw sources staged successfully.

Next step: Run a Claude Code session to ingest staged sources into your wiki.

1. Open Claude Code
2. Reference this schema document: docs/targets/obsidian.md
3. Point it to your staging directory:

   STAGING_PATH: STAGING_PATH_PLACEHOLDER

4. Let Claude (or you, manually) follow the schema doc to:
   - Read staged source files
   - Update/create entity and concept pages in: wiki_dir/
   - Update wiki/Index.md with new/changed entities
   - Append a dated entry to wiki/Log.md
   - Maintain cross-references

The schema doc (docs/targets/obsidian.md) defines:
- Page conventions (entity/concept/index/log formats)
- Cross-reference rules
- Workflow steps for ingest/query/lint operations
- How to structure your wiki hierarchy

All synthesis is human-triggered (you, or Claude in a Claude Code session reading the schema).
This script only stages sources — it does not edit your wiki.

Staged files are immutable and timestamped; your wiki will reference them via
absolute paths to enable safe updates when source versions change.

EOF

# Print actual staging path into the heredoc output
echo ""
echo "Staging directory: $STAGING_PATH" >&2
echo "Schema document: $REPO_ROOT/docs/targets/obsidian.md" >&2

log_info "Ingest staging completed successfully."

# Cleanup temporary directory (deferred from start)
rm -rf "$TEMP_PACK_DIR"

exit 0
