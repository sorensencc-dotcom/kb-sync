#!/usr/bin/env bash
# ==============================================================================
# NotebookLM Sync Orchestrator (v2: core-modular)
# Calls shared core/ pipeline + NotebookLM-specific CLI operations
# ==============================================================================
set -euo pipefail

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
MODULE_CONFIG="$CONFIGS_DIR/notebooklm.yaml"

# Log helpers
log_info() {
  printf '\e[32m[NLM-INGEST] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[NLM-INGEST] [ERROR] %s\e[0m\n' "$*" >&2
}

log_warn() {
  printf '\e[33m[NLM-INGEST] [WARN] %s\e[0m\n' "$*" >&2
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
log_info "Initializing NotebookLM sync orchestrator..."

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
  log_error "NotebookLM config not found: $MODULE_CONFIG"
  exit 1
fi

log_info "Core scripts and configs located."

# --- LOAD MODULE CONFIG & ENVIRONMENT ----------------------------------------
PACK_DIR=$(get_config_value "$MODULE_CONFIG" "output_dir")
PACK_FILE=$(get_config_value "$MODULE_CONFIG" "pack_filename")
# Note: include_extensions is a multi-line YAML list; not currently parsed
# Core scripts include all non-skip-pattern files by default
INCLUDE_EXTENSIONS=""

# Set defaults if config parsing failed
: ${PACK_DIR:="./.nlm_pack"}
: ${PACK_FILE:="repo_knowledge_pack"}

# Make paths absolute (handle both Unix / and Windows \ separators)
if [[ ! "$PACK_DIR" =~ ^[/A-Za-z]: ]]; then
  # Relative path: prepend REPO_ROOT
  PACK_DIR="$REPO_ROOT/$PACK_DIR"
fi
# Convert backslashes to forward slashes for consistency in bash
PACK_DIR="${PACK_DIR//\\//}"

log_info "Pack directory: $PACK_DIR"
log_info "Pack filename: $PACK_FILE"

# Load .env (hardened parser)
if [ -f "$REPO_ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip comments and empty lines
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    # Trim carriage returns (Windows compatibility)
    line="${line%$'\r'}"
    # Skip lines with no =
    [[ "$line" != *"="* ]] && continue
    # Split on first = only
    env_key="${line%%=*}"
    env_val="${line#*=}"
    # Skip if key empty or invalid chars
    [[ -z "$env_key" ]] && continue
    [[ "$env_key" =~ [^a-zA-Z0-9_] ]] && continue
    # Strip surrounding quotes
    env_val="${env_val#\"}" ; env_val="${env_val%\"}"
    env_val="${env_val#\'}" ; env_val="${env_val%\'}"
    # Only set if not already present in environment
    if [ -z "${!env_key+x}" ]; then
      export "$env_key"="$env_val"
    fi
  done < "$REPO_ROOT/.env"
fi

# Verify credentials & NOTEBOOK_ID
NOTEBOOK_ID="${NOTEBOOK_ID:-}"
NLM_CLI="${NLM_CLI:-notebooklm-mcp}"

if [ -z "${NOTEBOOKLM_COOKIE:-}" ] && [ -z "${NOTEBOOKLM_TOKEN:-}" ]; then
  log_error "Missing credentials: set NOTEBOOKLM_COOKIE or NOTEBOOKLM_TOKEN in .env"
  exit 1
fi

if [ -z "$NOTEBOOK_ID" ]; then
  log_error "NOTEBOOK_ID not set in .env"
  exit 1
fi

log_info "Credentials & NOTEBOOK_ID verified."

# --- ARGUMENT PARSING --------------------------------------------------------
RUN_ROLLBACK=false
if [ "${1:-}" = "--rollback" ] || [ "${1:-}" = "-r" ]; then
  RUN_ROLLBACK=true
fi

# --- ROLLBACK PATH -----------------------------------------------------------
if [ "$RUN_ROLLBACK" = true ]; then
  log_info "Executing ROLLBACK strategy..."

  # Restore backups
  if ! "$CORE_DIR/rollback.sh" restore --dir "$PACK_DIR"; then
    log_error "Rollback restore failed."
    exit 1
  fi

  # Get list of restored files
  UPLOAD_FILES=()
  while IFS= read -r file; do
    # Remove .bak.txt to get original filename
    upload_file="${file%.bak.txt}"
    [ -f "$upload_file" ] && UPLOAD_FILES+=("$upload_file")
  done < <("$CORE_DIR/rollback.sh" list --dir "$PACK_DIR" 2>/dev/null || true)

  if [ ${#UPLOAD_FILES[@]} -eq 0 ]; then
    log_error "No files to upload after rollback."
    exit 1
  fi

  log_info "Found ${#UPLOAD_FILES[@]} file(s) to re-upload."

  # Purge old sources
  log_info "Purging current sources from notebook $NOTEBOOK_ID..."
  if command -v "$NLM_CLI" >/dev/null 2>&1; then
    if ! "$NLM_CLI" sources delete --notebook "$NOTEBOOK_ID" --all; then
      log_warn "Failed to purge old sources. Continuing anyway..."
    fi
  else
    log_info "CLI tool '$NLM_CLI' not installed. Skipping programmatic purge."
  fi

  # Re-upload
  log_info "Re-uploading ${#UPLOAD_FILES[@]} files..."
  UPLOAD_SUCCESS=true
  for file in "${UPLOAD_FILES[@]}"; do
    log_info "Uploading: $file"
    if command -v "$NLM_CLI" >/dev/null 2>&1; then
      if ! "$NLM_CLI" sources add --notebook "$NOTEBOOK_ID" "$file"; then
        log_error "Upload failed: $file"
        UPLOAD_SUCCESS=false
      fi
    else
      log_info "CLI not installed. Manual upload needed: $file"
    fi
  done

  if [ "$UPLOAD_SUCCESS" = true ]; then
    log_info "NotebookLM rollback completed successfully!"
    exit 0
  else
    log_error "Rollback completed with upload failures."
    exit 1
  fi
fi

# --- NORMAL SYNC PATH (INGEST) -----------------------------------------------
log_info "Starting normal sync pipeline..."

# Clean old pack files
mkdir -p "$PACK_DIR"
# Clean via wrapper that handles immutable files
"$REPO_ROOT/modules/notebooklm/cleanup-pack-dir.sh" "$PACK_DIR"
log_info "Cleaned old pack files."

# Step 1: Flatten
log_info "Step 1/5: Flattening repository..."
if ! "$CORE_DIR/flatten.sh" \
  --output "$PACK_DIR" \
  --pack-name "$PACK_FILE.txt" \
  --global-config "$GLOBAL_CONFIG" \
  --include-extensions "$INCLUDE_EXTENSIONS" \
  --repo-root "$REPO_ROOT"; then
  log_error "Flatten step failed."
  exit 1
fi

PACK_FILE_PATH="$PACK_DIR/$PACK_FILE.txt"
log_info "Flatten completed: $PACK_FILE_PATH"

# Step 2: Validate
log_info "Step 2/5: Validating pack file size..."
SIZE_STATUS=$("$CORE_DIR/validate.sh" \
  --file "$PACK_FILE_PATH" \
  --global-config "$GLOBAL_CONFIG")

log_info "Size status: $SIZE_STATUS"

UPLOAD_FILES=()

# Step 3: Chunk if needed
if [ "$SIZE_STATUS" = "HARD" ]; then
  log_info "Step 3/5: Chunking oversized pack file..."
  if ! "$CORE_DIR/chunk.sh" \
    --file "$PACK_FILE_PATH" \
    --output-dir "$PACK_DIR" \
    --global-config "$GLOBAL_CONFIG" > /tmp/chunks.txt 2>&1; then
    log_error "Chunk step failed."
    exit 1
  fi

  # Gather chunk files: find the generated parts
  while IFS= read -r -d '' chunk; do
    [ -n "$chunk" ] && [ -f "$chunk" ] && UPLOAD_FILES+=("$chunk")
  done < <(find "$PACK_DIR" -type f -name 'repo_knowledge_pack_part_*.txt' -print0 2>/dev/null || true)

  log_info "Codebase chunked into ${#UPLOAD_FILES[@]} parts."
else
  log_info "Step 3/5: Pack size OK, no chunking needed."
  UPLOAD_FILES+=("$PACK_FILE_PATH")
fi

# Step 4: Backup
log_info "Step 4/5: Creating backup files..."
if ! "$CORE_DIR/rollback.sh" create --dir "$PACK_DIR" "${UPLOAD_FILES[@]}"; then
  log_error "Backup creation failed."
  exit 1
fi
log_info "Backups created."

# Step 5: Purge & Upload
log_info "Step 5/5: Purging old sources and uploading new ones..."

# Purge
if command -v "$NLM_CLI" >/dev/null 2>&1; then
  log_info "Purging sources from notebook $NOTEBOOK_ID..."
  if ! "$NLM_CLI" sources delete --notebook "$NOTEBOOK_ID" --all; then
    log_warn "Failed to purge old sources. Continuing to upload..."
  fi
else
  log_info "CLI tool '$NLM_CLI' not installed. Skipping programmatic purge."
fi

# Upload
UPLOAD_SUCCESS=true
for file in "${UPLOAD_FILES[@]}"; do
  log_info "Uploading: $(basename "$file")"
  if command -v "$NLM_CLI" >/dev/null 2>&1; then
    if ! "$NLM_CLI" sources add --notebook "$NOTEBOOK_ID" "$file"; then
      log_error "Upload failed: $file"
      UPLOAD_SUCCESS=false
    fi
  else
    log_info "CLI not installed. Manual action required: upload $file"
  fi
done

if [ "$UPLOAD_SUCCESS" = true ]; then
  log_info "NotebookLM sync completed successfully!"
  exit 0
else
  log_error "Sync completed with upload failures."
  exit 1
fi
