#!/usr/bin/env bash
# ==============================================================================
# Core Chunk: File Chunking & Line-Safe Splitting
# Shared by NotebookLM, Obsidian, and future sync targets
# ==============================================================================
set -euo pipefail

# --- FUNCTIONS ---------------------------------------------------------------
log_info() {
  printf '\e[32m[CHUNK] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[CHUNK] [ERROR] %s\e[0m\n' "$*" >&2
}

log_warn() {
  printf '\e[33m[CHUNK] [WARN] %s\e[0m\n' "$*" >&2
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
OUTPUT_DIR=""
GLOBAL_CONFIG=""
CHUNK_PREFIX="repo_knowledge_pack_part_"
CHUNK_SIZE="4M"

while [ $# -gt 0 ]; do
  case "$1" in
    --file)
      PACK_FILE="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --global-config)
      GLOBAL_CONFIG="$2"
      shift 2
      ;;
    --prefix)
      CHUNK_PREFIX="$2"
      shift 2
      ;;
    *)
      log_error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Validate required arguments
if [ -z "$PACK_FILE" ] || [ -z "$OUTPUT_DIR" ]; then
  log_error "Missing required arguments: --file PATH --output-dir DIR"
  exit 1
fi

# Verify file exists
if [ ! -f "$PACK_FILE" ]; then
  log_error "Pack file not found: $PACK_FILE"
  exit 1
fi

# --- CONFIG LOADING ----------------------------------------------------------
if [ -n "$GLOBAL_CONFIG" ] && [ -f "$GLOBAL_CONFIG" ]; then
  log_info "Loading chunk size from config: $GLOBAL_CONFIG"

  chunk_sz=$(get_config_value "$GLOBAL_CONFIG" "chunk_size")
  [ -n "$chunk_sz" ] && CHUNK_SIZE="$chunk_sz"
fi

log_info "Chunk size: $CHUNK_SIZE"

# --- CHUNKING ----------------------------------------------------------------
log_info "Splitting $PACK_FILE into $CHUNK_SIZE chunks..."

# Ensure output dir exists
mkdir -p "$OUTPUT_DIR"

# Split the file into chunks, keeping line boundaries intact (-C option)
split -C "$CHUNK_SIZE" "$PACK_FILE" "$OUTPUT_DIR/$CHUNK_PREFIX"

# Remove original file to keep pack dir clean
rm -f "$PACK_FILE"

log_info "Original pack file removed."

# Add .txt extension to all split parts so they're recognized as text files
for part in "$OUTPUT_DIR"/"$CHUNK_PREFIX"*; do
  if [ -f "$part" ] && [[ "$part" != *.txt ]]; then
    mv "$part" "$part.txt"
    log_info "Renamed chunk: $(basename "$part") → $(basename "$part.txt")"
  fi
done

# Output list of chunk files (one per line to stdout)
log_info "Listing generated chunk files:"
find "$OUTPUT_DIR" -type f -name "${CHUNK_PREFIX}*.txt" -print0 2>/dev/null | \
  xargs -0 ls -1 | while read -r chunk_file; do
    echo "$chunk_file"
    log_info "  - $(basename "$chunk_file")"
  done

chunk_count=$(find "$OUTPUT_DIR" -type f -name "${CHUNK_PREFIX}*.txt" 2>/dev/null | wc -l)
log_info "Codebase chunked into $chunk_count part files."

exit 0
