#!/usr/bin/env bash
# ==============================================================================
# Ingest-NotebookLM Sync Orchestrator
# Part of the Rewrite Labs & CIC Knowledge Base Sync Subsystem
# ==============================================================================
set -euo pipefail

# Unset git environment overrides to ensure local git operations run relative to cwd
unset GIT_DIR
unset GIT_WORK_TREE
unset GIT_INDEX_FILE

# --- CONFIG & LOCAL CONTEXT ---------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
PYRAGIFY_CONFIG="$REPO_ROOT/pyragify.yaml"
PACK_DIR="$REPO_ROOT/.nlm_pack"
PACK_FILE="$PACK_DIR/repo_knowledge_pack.txt"

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

# Load local environment if exists (robust line-by-line parser)
if [ -f "$REPO_ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip comments and empty lines
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    # Trim carriage returns (\r) for Windows compatibility
    line="${line%$'\r'}"
    # Export the variable
    export "$line"
  done < "$REPO_ROOT/.env"
fi

# NotebookLM & MCP default configurations
NOTEBOOK_ID="${NOTEBOOK_ID:-}"
NLM_CLI="${NLM_CLI:-notebooklm-mcp}"

# --- PRE-FLIGHT VALIDATIONS --------------------------------------------------
log_info "Initializing pre-flight validation checks..."

# Ensure we're in the repository
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.git" ]; then
  log_error "Not inside a valid git repository."
  exit 1
fi

# Ensure credentials exist in env
if [ -z "${NOTEBOOKLM_COOKIE:-}" ] && [ -z "${NOTEBOOKLM_TOKEN:-}" ]; then
  log_error "Missing environment credentials. Must set either NOTEBOOKLM_COOKIE or NOTEBOOKLM_TOKEN in .env."
  exit 1
fi

# Ensure NOTEBOOK_ID is set
if [ -z "$NOTEBOOK_ID" ]; then
  log_error "NOTEBOOK_ID environment variable is missing. Set NOTEBOOK_ID in your environment or .env file."
  exit 1
fi

# Verify CLI availability
if ! command -v "$NLM_CLI" >/dev/null 2>&1; then
  log_info "CLI wrapper '$NLM_CLI' not found directly. Checking for execution fallback..."
fi

# Create pack directory if not exists
mkdir -p "$PACK_DIR"

# --- ARGUMENT PARSING & ROLLBACK LOGIC ----------------------------------------
RUN_ROLLBACK=false
if [ "${1:-}" = "--rollback" ] || [ "${1:-}" = "-r" ]; then
  RUN_ROLLBACK=true
fi

if [ "$RUN_ROLLBACK" = true ]; then
  log_info "Executing ROLLBACK strategy. Restoring last known working backup to NotebookLM..."
  
  # Find all backup files
  BACKUP_FILES=()
  while IFS= read -r -d '' file; do
    BACKUP_FILES+=("$file")
  done < <(find "$PACK_DIR" -type f -name '*.bak.txt' -print0 2>/dev/null || true)

  if [ ${#BACKUP_FILES[@]} -eq 0 ]; then
    log_error "No backup files found in $PACK_DIR. Rollback aborted."
    exit 1
  fi

  log_info "Found ${#BACKUP_FILES[@]} backup files to restore."

  # Step 1: Purge stale sources
  log_info "Purging current sources from NotebookLM notebook ID: $NOTEBOOK_ID"
  if command -v "$NLM_CLI" >/dev/null 2>&1; then
    if ! "$NLM_CLI" sources delete --notebook "$NOTEBOOK_ID" --all; then
      log_warn "Failed to purge old sources. Continuing anyway..."
    fi
  else
    log_info "Skipping programmatic purge: CLI tool '$NLM_CLI' not installed."
  fi

  # Step 2: Upload backups
  for bak in "${BACKUP_FILES[@]}"; do
    # Rename bak.txt temporarily to .txt for clean NotebookLM source naming
    upload_file="${bak%.bak.txt}.txt"
    cp "$bak" "$upload_file"
    
    log_info "Uploading backup file: $upload_file"
    if command -v "$NLM_CLI" >/dev/null 2>&1; then
      if ! "$NLM_CLI" sources add --notebook "$NOTEBOOK_ID" "$upload_file"; then
        log_error "Failed to upload backup file: $upload_file"
        rm -f "$upload_file"
        exit 1
      fi
    else
      log_info "CLI not installed. Manual action required: upload $upload_file"
    fi
    # Cleanup temporary renamed file
    rm -f "$upload_file"
  done

  log_info "NotebookLM rollback completed successfully!"
  exit 0
fi

# --- STEP 1: FLATTEN REPOSITORY ----------------------------------------------
log_info "Step 1: Flattening repository codebase..."

# Clean old pack files and old chunk parts
rm -f "$PACK_DIR"/repo_knowledge_pack*

# Try to run pyragify if uv is installed and pyragify.yaml exists
if command -v uv >/dev/null 2>&1 && [ -f "$PYRAGIFY_CONFIG" ]; then
  log_info "Executing pyragify flattener via uv..."
  if ! uv run pyragify --config-file "$PYRAGIFY_CONFIG"; then
    log_info "pyragify failed or not installed. Falling back to manual git flattener..."
  fi
else
  log_info "uv or pyragify config not found. Falling back to manual git flattener..."
fi

# Fallback: Build combined repo knowledge pack file manually via git grep
log_info "Compiling repository files into consolidated knowledge pack..."
{
  echo "================================================================================"
  echo "REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK"
  echo "Generated: $(date)"
  echo "Repo Root: $REPO_ROOT"
  echo "================================================================================"
  echo ""

  git -C "$REPO_ROOT" grep -I --name-only -e "" | while read -r file; do
    case "$file" in
      package-lock.json|yarn.lock|pnpm-lock.yaml|*node_modules/*|*dist/*|*build/*|*.png|*.jpg|*.jpeg|*.gif|*.pdf|*.bin|*playwright-report/*|*coverage/*)
        continue
        ;;
    esac

    if [ -f "$REPO_ROOT/$file" ]; then
      echo -e "\n--- START FILE: $file ---"
      cat "$REPO_ROOT/$file"
      echo -e "--- END FILE: $file ---\n"
    fi
  done
} > "$PACK_FILE"

log_info "Knowledge pack compiled successfully."

# --- STEP 2: SIZE VALIDATION & CHUNKING FALLBACK -----------------------------
log_info "Step 2: Performing size validation checks..."
FILE_SIZE=$(wc -c < "$PACK_FILE" | awk '{print $1}')
log_info "Pack file size: $FILE_SIZE bytes"

UPLOAD_FILES=()
WARNING_LIMIT=5000000 # 5MB
HARD_LIMIT=8000000    # 8MB

if [ "$FILE_SIZE" -gt "$HARD_LIMIT" ]; then
  log_warn "Pack file size ($FILE_SIZE bytes) exceeds the hard limit of $HARD_LIMIT bytes."
  log_warn "Initiating automated line-safe chunk splitting..."
  
  # Split the file into chunks of max 4MB to stay safe, keeping line boundaries intact (-C option)
  split -C 4M "$PACK_FILE" "$PACK_DIR/repo_knowledge_pack_part_"
  
  # Remove original file to keep pack dir clean
  rm -f "$PACK_FILE"
  
  # Add .txt extension to the split parts so NotebookLM recognizes them as text files
  for part in "$PACK_DIR"/repo_knowledge_pack_part_*; do
    if [ -f "$part" ] && [[ "$part" != *.txt ]]; then
      mv "$part" "$part.txt"
    fi
  done

  # Gather all split files (which now have .txt extension)
  while IFS= read -r -d '' file; do
    UPLOAD_FILES+=("$file")
  done < <(find "$PACK_DIR" -type f -name 'repo_knowledge_pack_part_*.txt' -print0 2>/dev/null || true)
  
  log_info "Codebase chunked into ${#UPLOAD_FILES[@]} part files."
elif [ "$FILE_SIZE" -gt "$WARNING_LIMIT" ]; then
  log_warn "Pack file size ($FILE_SIZE bytes) is approaching the 5MB limit. Ingestion may slow down."
  UPLOAD_FILES+=("$PACK_FILE")
else
  UPLOAD_FILES+=("$PACK_FILE")
fi

# --- STEP 3: CREATE BACKUPS --------------------------------------------------
log_info "Step 3: Caching backup files for future rollback capability..."

# Remove any old backups
rm -f "$PACK_DIR"/*.bak.txt

# Create backup files
for file in "${UPLOAD_FILES[@]}"; do
  cp "$file" "$file.bak.txt"
done

# --- STEP 4: PURGE OLD SOURCES ------------------------------------------------
log_info "Step 4: Purging stale sources from NotebookLM notebook ID: $NOTEBOOK_ID"
if command -v "$NLM_CLI" >/dev/null 2>&1; then
  if ! "$NLM_CLI" sources delete --notebook "$NOTEBOOK_ID" --all; then
    log_error "Failed to purge old sources. Continuing to upload to prevent sync interruption..."
  fi
else
  log_info "Skipping programmatic purge: CLI tool '$NLM_CLI' not installed. Please perform manual purge on Web UI if needed."
fi

# --- STEP 5: UPLOAD FRESH SOURCE PACKS ----------------------------------------
log_info "Step 5: Uploading fresh packages to NotebookLM..."
UPLOAD_SUCCESS=true

for file in "${UPLOAD_FILES[@]}"; do
  log_info "Uploading: $file"
  if command -v "$NLM_CLI" >/dev/null 2>&1; then
    if ! "$NLM_CLI" sources add --notebook "$NOTEBOOK_ID" "$file"; then
      log_error "Upload failed for file: $file"
      UPLOAD_SUCCESS=false
    fi
  else
    log_info "Programmatic upload skipped: CLI tool '$NLM_CLI' not installed."
    log_info "Action Required: Manually upload '$file' to notebook: https://notebooklm.google.com"
  fi
done

if [ "$UPLOAD_SUCCESS" = true ]; then
  log_info "NotebookLM sync completed successfully!"
else
  log_error "Sync upload completed with failures."
  exit 1
fi

exit 0
