#!/usr/bin/env bash
# ==============================================================================
# Core Rollback: Backup Creation & Restoration
# Shared by NotebookLM, Obsidian, and future sync targets
# ==============================================================================
set -euo pipefail

# --- FUNCTIONS ---------------------------------------------------------------
log_info() {
  printf '\e[32m[ROLLBACK] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[ROLLBACK] [ERROR] %s\e[0m\n' "$*" >&2
}

log_warn() {
  printf '\e[33m[ROLLBACK] [WARN] %s\e[0m\n' "$*" >&2
}

# --- FUNCTIONS: CREATE MODE --------------------------------------------------
rollback_create() {
  local output_dir="$1"
  shift
  local files=("$@")

  if [ ${#files[@]} -eq 0 ]; then
    log_error "No files specified for backup."
    exit 1
  fi

  log_info "Creating backup files in: $output_dir"

  # Remove any old backups first
  rm -f "$output_dir"/*.bak.txt 2>/dev/null || true
  log_info "Cleaned old backups."

  # Create backup for each file
  for file in "${files[@]}"; do
    if [ ! -f "$file" ]; then
      log_warn "File not found, skipping backup: $file"
      continue
    fi

    backup_file="$file.bak.txt"
    cp "$file" "$backup_file"
    log_info "Backed up: $(basename "$file") → $(basename "$backup_file")"
  done

  log_info "Backup creation completed."
  exit 0
}

# --- FUNCTIONS: LIST MODE ---------------------------------------------------
rollback_list() {
  local output_dir="$1"

  log_info "Searching for backup files in: $output_dir"

  backup_count=0
  while IFS= read -r -d '' file; do
    echo "$file"
    (( backup_count++ ))
  done < <(find "$output_dir" -type f -name '*.bak.txt' -print0 2>/dev/null || true)

  if [ "$backup_count" -eq 0 ]; then
    log_warn "No backup files found."
    exit 1
  fi

  log_info "Found $backup_count backup file(s)."
  exit 0
}

# --- FUNCTIONS: RESTORE MODE -------------------------------------------------
rollback_restore() {
  local output_dir="$1"

  log_info "Restoring from backup files in: $output_dir"

  # Collect backup files
  backup_files=()
  while IFS= read -r -d '' file; do
    backup_files+=("$file")
  done < <(find "$output_dir" -type f -name '*.bak.txt' -print0 2>/dev/null || true)

  if [ ${#backup_files[@]} -eq 0 ]; then
    log_error "No backup files found in $output_dir. Rollback aborted."
    exit 1
  fi

  log_info "Found ${#backup_files[@]} backup file(s) to restore."

  # Restore each backup (copy .bak.txt back to original name)
  for bak_file in "${backup_files[@]}"; do
    # Remove .bak.txt extension to get original filename
    original_file="${bak_file%.bak.txt}"

    cp "$bak_file" "$original_file"
    log_info "Restored: $(basename "$bak_file") → $(basename "$original_file")"
  done

  log_info "Rollback restoration completed."
  exit 0
}

# --- ARGUMENT PARSING --------------------------------------------------------
if [ $# -lt 2 ]; then
  log_error "Usage: $0 {create|list|restore} --dir DIR [FILES...]"
  exit 1
fi

MODE="$1"
shift

PACK_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)
      PACK_DIR="$2"
      shift 2
      ;;
    -*)
      log_error "Unknown flag: $1"
      exit 1
      ;;
    *)
      # Remaining args are file paths (for create mode)
      break
      ;;
  esac
done

# Validate PACK_DIR
if [ -z "$PACK_DIR" ]; then
  log_error "Missing required argument: --dir DIR"
  exit 1
fi

if [ ! -d "$PACK_DIR" ]; then
  log_error "Pack directory not found: $PACK_DIR"
  exit 1
fi

# --- DISPATCH TO MODE --------------------------------------------------------
case "$MODE" in
  create)
    # Remaining args are files to back up
    rollback_create "$PACK_DIR" "$@"
    ;;
  list)
    rollback_list "$PACK_DIR"
    ;;
  restore)
    rollback_restore "$PACK_DIR"
    ;;
  *)
    log_error "Unknown mode: $MODE. Use 'create', 'list', or 'restore'."
    exit 1
    ;;
esac
