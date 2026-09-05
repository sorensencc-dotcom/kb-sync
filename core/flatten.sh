#!/usr/bin/env bash
# ==============================================================================
# Core Flatten: Repository Flattening & Manifest Generation
# Shared by NotebookLM, Obsidian, and future sync targets
# ==============================================================================
set -euo pipefail

# Unset git environment overrides to ensure local git operations run relative to cwd
unset GIT_DIR
unset GIT_WORK_TREE
unset GIT_INDEX_FILE

# --- FUNCTIONS ---------------------------------------------------------------
log_info() {
  printf '\e[32m[FLATTEN] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[FLATTEN] [ERROR] %s\e[0m\n' "$*" >&2
}

log_warn() {
  printf '\e[33m[FLATTEN] [WARN] %s\e[0m\n' "$*" >&2
}

# Parse YAML-like config file for a specific key using Node.js config-loader
get_config_value() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  node "$(dirname "$0")/config-loader.mjs" --file "$file" --key "$key" || true
}

# Parse array-like config value using Node.js config-loader
get_config_array() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  node "$(dirname "$0")/config-loader.mjs" --file "$file" --key "$key" --array || true
}

# --- ARGUMENT PARSING --------------------------------------------------------
PACK_DIR=""
PACK_FILE=""
GLOBAL_CONFIG=""
USE_MANIFEST=false
INCLUDE_EXTENSIONS=""
REPO_ROOT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --output)
      PACK_DIR="$2"
      shift 2
      ;;
    --pack-name)
      PACK_FILE="$2"
      shift 2
      ;;
    --global-config)
      GLOBAL_CONFIG="$2"
      shift 2
      ;;
    --include-extensions)
      INCLUDE_EXTENSIONS="$2"
      shift 2
      ;;
    --manifest)
      USE_MANIFEST=true
      shift
      ;;
    --repo-root)
      REPO_ROOT="$2"
      shift 2
      ;;
    *)
      log_error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Default REPO_ROOT if not provided
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
elif command -v cygpath >/dev/null 2>&1 && [[ "$REPO_ROOT" =~ ^[A-Za-z]: ]]; then
  REPO_ROOT="$(cygpath -u "$REPO_ROOT")"
fi

if command -v cygpath >/dev/null 2>&1 && [[ "$PACK_DIR" =~ ^[A-Za-z]: ]]; then
  PACK_DIR="$(cygpath -u "$PACK_DIR")"
fi

# Validate required arguments
if [ -z "$PACK_DIR" ] || [ -z "$PACK_FILE" ]; then
  log_error "Missing required arguments: --output DIR --pack-name FILENAME"
  exit 1
fi

# Create pack directory
mkdir -p "$PACK_DIR"

log_info "Flattening repository codebase..."
log_info "Repo root: $REPO_ROOT"
log_info "Pack dir: $PACK_DIR"
log_info "Use manifest mode: $USE_MANIFEST"

# --- CONFIG LOADING ----------------------------------------------------------
# Load skip patterns from global config
SKIP_PATTERNS=(
  "package-lock.json"
  "yarn.lock"
  "pnpm-lock.yaml"
  "*node_modules/*"
  "*dist/*"
  "*build/*"
  "*.png"
  "*.jpg"
  "*.jpeg"
  "*.gif"
  "*.pdf"
  "*.bin"
  "*playwright-report/*"
  "*coverage/*"
)

if [ -n "$GLOBAL_CONFIG" ] && [ -f "$GLOBAL_CONFIG" ]; then
  log_info "Loading skip patterns from config: $GLOBAL_CONFIG"
  # Parse skip_patterns from config (each item on own line or comma-separated)
  SKIP_PATTERNS=()
  get_config_array "$GLOBAL_CONFIG" "skip_patterns" | while read -r pattern; do
    [ -n "$pattern" ] && SKIP_PATTERNS+=("$pattern")
  done
fi

# --- STEP 1: TRY PYRAGIFY FIRST (if explicitly enabled) -----------------------
PYRAGIFY_CONFIG="$REPO_ROOT/pyragify.yaml"
if [ "${ENABLE_PYRAGIFY:-false}" = "true" ] && [ "$USE_MANIFEST" = false ] && command -v uv >/dev/null 2>&1 && [ -f "$PYRAGIFY_CONFIG" ]; then
  log_info "Attempting pyragify flattener via uv..."
  if uvx pyragify --config-file "$PYRAGIFY_CONFIG"; then
    log_info "pyragify succeeded."
    exit 0
  else
    log_info "pyragify failed. Falling back to standard flattener..."
  fi
fi

# --- STEP 2: FALLBACK TO GIT-GREP MANUAL FLATTENER ----------------------------
log_info "Compiling repository files via git grep..."

# Temporary file to hold file list
TEMP_FILE_LIST=$(mktemp)
trap "rm -f $TEMP_FILE_LIST" EXIT

# Build list of files to include, filtering by skip patterns and extensions
{
  git -C "$REPO_ROOT" grep -I --name-only -e "" 2>/dev/null || true
  git -C "$REPO_ROOT" ls-files --others --exclude-standard 2>/dev/null || true
} | sort -u | while read -r file; do
  # Skip patterns check
  skip=false
  for pattern in "${SKIP_PATTERNS[@]}"; do
    # Use shell glob matching
    if [[ "$file" == $pattern ]]; then
      skip=true
      break
    fi
  done

  if [ "$skip" = true ]; then
    continue
  fi

  # Include extensions check (if specified)
  if [ -n "$INCLUDE_EXTENSIONS" ]; then
    skip=true
    while IFS= read -r ext; do
      [ -z "$ext" ] && continue
      if [[ "$file" == *"$ext" ]]; then
        skip=false
        break
      fi
    done <<< "$INCLUDE_EXTENSIONS"

    if [ "$skip" = true ]; then
      continue
    fi
  fi

  # Verify file exists
  if [ -f "$REPO_ROOT/$file" ]; then
    echo "$file"
  fi
done > "$TEMP_FILE_LIST"

log_info "Found $(wc -l < "$TEMP_FILE_LIST") files to include."

# --- STEP 3: OUTPUT BASED ON MODE --------------------------------------------
mkdir -p "$PACK_DIR"

if [ "$USE_MANIFEST" = true ]; then
  # Manifest mode: write newline-delimited file list
  MANIFEST_FILE="$PACK_DIR/pack.manifest.txt"
  log_info "Writing manifest to: $MANIFEST_FILE"
  cp "$TEMP_FILE_LIST" "$MANIFEST_FILE"
  log_info "Manifest generated successfully."
else
  # Concatenated pack mode: write full pack file with START/END FILE markers
  FULL_PACK="$PACK_DIR/$PACK_FILE"
  log_info "Writing concatenated pack to: $FULL_PACK"

  COMPACTION_CONFIG="${COMPACTION_CONFIG:-$REPO_ROOT/configs/compaction.yaml}"
  USE_COMPACTION=false

  # Default OFF: compaction is an explicit opt-in (set COMPACTION_ENABLED=true)
  # until a Tier 1 rollout decision turns it on by default for production syncs.
  if [ "${COMPACTION_ENABLED:-false}" = "true" ] && [ -f "$COMPACTION_CONFIG" ]; then
    log_info "Compacted Context Engine enabled. Invoking batch compactor..."
    if node "$REPO_ROOT/modules/compactor/index.mjs" \
      --repo-root "$REPO_ROOT" \
      --manifest "$TEMP_FILE_LIST" \
      --output "$FULL_PACK" \
      --config "$COMPACTION_CONFIG" \
      --global-config "${GLOBAL_CONFIG:-}"; then
      log_info "Compacted knowledge pack generated successfully."
      USE_COMPACTION=true
    else
      log_warn "Compactor execution failed. Falling back to standard git flattener..."
    fi
  fi

  if [ "$USE_COMPACTION" = false ]; then
    {
      echo "================================================================================"
      echo "REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK"
      echo "Generated: $(date)"
      echo "Repo Root: $REPO_ROOT"
      echo "================================================================================"
      echo ""

      while IFS= read -r file; do
        [ -z "$file" ] && continue
        echo ""
        echo "--- START FILE: $file ---"
        if [ -f "$REPO_ROOT/$file" ]; then
          cat "$REPO_ROOT/$file" || true
        fi
        echo "--- END FILE: $file ---"
        echo ""
      done < "$TEMP_FILE_LIST"
    } > "$FULL_PACK"

    log_info "Standard uncompacted knowledge pack generated successfully."
  fi
fi

exit 0
