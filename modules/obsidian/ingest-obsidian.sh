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
GLOBAL_CONFIG="${GLOBAL_CONFIG:-$CONFIGS_DIR/global.yaml}"
MODULE_CONFIG="${MODULE_CONFIG:-$CONFIGS_DIR/obsidian.yaml}"

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
# Strips surrounding quotes, inline comments, CRLF
get_config_value() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  if command -v node >/dev/null 2>&1 && [ -f "$CORE_DIR/config-loader.mjs" ]; then
    node "$CORE_DIR/config-loader.mjs" --file "$file" --key "$key" || true
  else
    grep -E "^\s*${key}\s*[:=]" "$file" | head -1 | tr -d '\r' | \
      sed -E "s/^\s*${key}\s*[:=]\s*//; s/#.*$//; s/^\s*//; s/\s*$//; s/^['\"]//; s/['\"]$//; s/\s*$//" || true
  fi
}

# --- TIMEOUT & RETRY CONFIGURATION -------------------------------------------
TIMEOUT_MS="${WORKSPACE_TIMEOUT_MS:-$(get_config_value "$GLOBAL_CONFIG" "timeout_ms")}"
TIMEOUT_MS="${TIMEOUT_MS:-90000}"

RETRY_ATTEMPTS="${WORKSPACE_RETRY_ATTEMPTS:-$(get_config_value "$GLOBAL_CONFIG" "retry_attempts")}"
RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-3}"

RETRY_BACKOFF_MS=(5000 15000 30000)

run_with_retry() {
  local attempt=1
  local timeout_sec=$((TIMEOUT_MS / 1000))
  [ "$timeout_sec" -lt 1 ] && timeout_sec=1

  while [ "$attempt" -le "$RETRY_ATTEMPTS" ]; do
    log_info "Attempt $attempt/$RETRY_ATTEMPTS: $*"

    if command -v timeout >/dev/null 2>&1 && timeout --version 2>&1 | grep -q "GNU coreutils"; then
      timeout --foreground "$timeout_sec" "$@" && return 0
    else
      "$@" && return 0
    fi

    if [ "$attempt" -lt "$RETRY_ATTEMPTS" ]; then
      local backoff_idx=$((attempt - 1))
      local backoff_ms=${RETRY_BACKOFF_MS[$backoff_idx]:-5000}
      local backoff_sec=$((backoff_ms / 1000))
      [ "$backoff_sec" -lt 1 ] && backoff_sec=1
      log_warn "Attempt $attempt failed/timed out. Retrying in ${backoff_sec}s..."
      sleep "$backoff_sec"
    fi

    attempt=$((attempt + 1))
  done

  log_error "Command failed after $RETRY_ATTEMPTS attempts: $*"
  return 1
}

# --- ARGUMENT PARSING & MODE RESOLUTION -------------------------------------
MODE_ARG=""
HAS_INCREMENTAL=false
HAS_FULL=false

for arg in "$@"; do
  case "$arg" in
    --incremental)
      HAS_INCREMENTAL=true
      ;;
    --full)
      HAS_FULL=true
      ;;
  esac
done

if [ "$HAS_INCREMENTAL" = true ] && [ "$HAS_FULL" = true ]; then
  log_error "Conflicting flags: cannot specify both --incremental and --full"
  exit 2
fi

if [ "$HAS_FULL" = true ]; then
  MODE_ARG="--full"
elif [ "$HAS_INCREMENTAL" = true ]; then
  MODE_ARG=""
elif [ "${INCREMENTAL_SYNC:-}" = "0" ] || [ "${INCREMENTAL_SYNC:-}" = "false" ]; then
  MODE_ARG="--full"
fi

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
if [ -f "$REPO_ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    line="${line%$'\r'}"
    [[ "$line" != *"="* ]] && continue
    env_key="${line%%=*}"
    env_val="${line#*=}"
    [[ -z "$env_key" ]] && continue
    [[ "$env_key" =~ [^a-zA-Z0-9_] ]] && continue
    env_val="${env_val#\"}" ; env_val="${env_val%\"}"
    env_val="${env_val#\'}" ; env_val="${env_val%\'}"
    if [ -z "${!env_key+x}" ]; then
      export "$env_key"="$env_val"
    fi
  done < "$REPO_ROOT/.env"
fi

# Try env var first, fall back to config
OBSIDIAN_VAULT_ROOT="${OBSIDIAN_VAULT_ROOT:-}"
if [ -z "$OBSIDIAN_VAULT_ROOT" ]; then
  OBSIDIAN_VAULT_ROOT=$(get_config_value "$MODULE_CONFIG" "vault_root")
fi

# Convert Windows paths to WSL mount format (C:\... → /mnt/c/...) if running in WSL, or normalize /mnt/c/ to /c/ if in Git Bash
convert_to_wsl_path() {
  local path="$1"
  # Remove backslashes
  path="${path//\\//}"
  # Convert to /mnt/<drive>/ if running under WSL
  if grep -qi microsoft /proc/version 2>/dev/null; then
    if [[ "$path" =~ ^([A-Za-z]):/(.*) ]]; then
      local drive="${BASH_REMATCH[1]}"
      local rest="${BASH_REMATCH[2]}"
      drive=$(echo "$drive" | tr '[:upper:]' '[:lower:]')
      path="/mnt/${drive}/${rest}"
    fi
  else
    # If not running under WSL, but path starts with /mnt/<drive>/ (WSL format), convert to /<drive>/ if /mnt/<drive> doesn't exist
    if [[ "$path" =~ ^/mnt/([A-Za-z])/(.*) ]]; then
      local drive="${BASH_REMATCH[1]}"
      local rest="${BASH_REMATCH[2]}"
      drive=$(echo "$drive" | tr '[:upper:]' '[:lower:]')
      if [ ! -d "/mnt/${drive}" ] && [ -d "/${drive}" ]; then
        path="/${drive}/${rest}"
      fi
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
if ! run_with_retry bash "$CORE_DIR/flatten.sh" \
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

# --- STEP 2: MATERIALIZE STAGING TREE VIA DETECT-DRIFT ENGINE ----------------
log_info "========================================================================"
log_info "Materializing staging tree (Incremental Delta Engine)..."
log_info "========================================================================"

MAT_OUTPUT=$(node "$REPO_ROOT/modules/wiki/detect-drift.js" --materialize-staging --manifest "$MANIFEST_FILE" $MODE_ARG 2>&1)
MAT_EXIT=$?

if [ $MAT_EXIT -ne 0 ]; then
  log_error "Materialization failed with exit code $MAT_EXIT:"
  log_error "$MAT_OUTPUT"
  rm -rf "$TEMP_PACK_DIR"
  exit $MAT_EXIT
fi

STAGING_PATH=$(echo "$MAT_OUTPUT" | grep -E "^STAGING_DIR:" | cut -d':' -f2-)
RUN_MODE=$(echo "$MAT_OUTPUT" | grep -E "^MODE:" | cut -d':' -f2-)
REUSED_COUNT=$(echo "$MAT_OUTPUT" | grep -E "^REUSED:" | cut -d':' -f2-)
ADDED_COUNT=$(echo "$MAT_OUTPUT" | grep -E "^ADDED:" | cut -d':' -f2-)
MODIFIED_COUNT=$(echo "$MAT_OUTPUT" | grep -E "^MODIFIED:" | cut -d':' -f2-)
DELETED_COUNT=$(echo "$MAT_OUTPUT" | grep -E "^DELETED:" | cut -d':' -f2-)

log_info "Staging materialization completed successfully (Mode: ${RUN_MODE:-FULL})."
log_info "Stats: ${ADDED_COUNT:-0} Added, ${MODIFIED_COUNT:-0} Modified, ${DELETED_COUNT:-0} Deleted, ${REUSED_COUNT:-0} Reused (Unchanged)."

# --- STEP 3: PRINT OPERATOR PROMPT -------------------------------------------
log_info "========================================================================"
log_info "Obsidian Sync Staging Complete"
log_info "========================================================================"

DELTA_SUMMARY=$(node "$REPO_ROOT/modules/wiki/generate-delta-summary.ts" 2>/dev/null || npx tsx "$REPO_ROOT/modules/wiki/generate-delta-summary.ts" 2>/dev/null || echo "📦 Delta Summary: Not available.")

cat >&2 << EOF

📦 Raw sources staged successfully.
$DELTA_SUMMARY

Next step: Run a Claude Code session to ingest staged sources into your wiki.

1. Open Claude Code
2. Reference this schema document: docs/targets/obsidian.md
3. Point it to your staging directory:

   STAGING_PATH: ${STAGING_PATH}

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

