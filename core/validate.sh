#!/usr/bin/env bash
# ==============================================================================
# Core Validate: Size Validation & Classification
# Shared by NotebookLM, Obsidian, and future sync targets
# ==============================================================================
set -euo pipefail

# --- FUNCTIONS ---------------------------------------------------------------
log_info() {
  printf '\e[32m[VALIDATE] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[VALIDATE] [ERROR] %s\e[0m\n' "$*" >&2
}

log_warn() {
  printf '\e[33m[VALIDATE] [WARN] %s\e[0m\n' "$*" >&2
}

# Parse config value from simple key=value or key: value format
# Strips inline comments (anything after #)
get_config_value() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  grep -E "^\s*${key}\s*[:=]" "$file" | head -1 | \
    sed -E "s/^\s*${key}\s*[:=]\s*//; s/#.*$//; s/\s*$//" || true
}

# --- ARGUMENT PARSING --------------------------------------------------------
PACK_FILE=""
GLOBAL_CONFIG=""
WARNING_LIMIT=5000000  # 5MB default
HARD_LIMIT=8000000     # 8MB default

while [ $# -gt 0 ]; do
  case "$1" in
    --file)
      PACK_FILE="$2"
      shift 2
      ;;
    --global-config)
      GLOBAL_CONFIG="$2"
      shift 2
      ;;
    *)
      log_error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Validate required arguments
if [ -z "$PACK_FILE" ]; then
  log_error "Missing required argument: --file PATH"
  exit 1
fi

# Verify file exists
if [ ! -f "$PACK_FILE" ]; then
  log_error "Pack file not found: $PACK_FILE"
  exit 1
fi

# --- CONFIG LOADING ----------------------------------------------------------
if [ -n "$GLOBAL_CONFIG" ] && [ -f "$GLOBAL_CONFIG" ]; then
  log_info "Loading size thresholds from config: $GLOBAL_CONFIG"

  w_limit=$(get_config_value "$GLOBAL_CONFIG" "warning_bytes")
  [ -n "$w_limit" ] && WARNING_LIMIT="$w_limit"

  h_limit=$(get_config_value "$GLOBAL_CONFIG" "hard_bytes")
  [ -n "$h_limit" ] && HARD_LIMIT="$h_limit"
fi

log_info "Warning limit: $WARNING_LIMIT bytes ($(( WARNING_LIMIT / 1000000 )) MB)"
log_info "Hard limit: $HARD_LIMIT bytes ($(( HARD_LIMIT / 1000000 )) MB)"

# --- VALIDATION ---------------------------------------------------------------
FILE_SIZE=$(wc -c < "$PACK_FILE" | awk '{print $1}')
log_info "Pack file size: $FILE_SIZE bytes"

if [ "$FILE_SIZE" -gt "$HARD_LIMIT" ]; then
  log_warn "Pack file size ($FILE_SIZE bytes) exceeds hard limit ($HARD_LIMIT bytes)."
  log_warn "Chunking required before upload."
  echo "HARD"
  exit 0
elif [ "$FILE_SIZE" -gt "$WARNING_LIMIT" ]; then
  log_warn "Pack file size ($FILE_SIZE bytes) approaches warning limit ($WARNING_LIMIT bytes)."
  log_warn "Upload may slow down. Chunking recommended."
  echo "WARN"
  exit 0
else
  log_info "Pack file size within acceptable range."
  echo "OK"
  exit 0
fi
