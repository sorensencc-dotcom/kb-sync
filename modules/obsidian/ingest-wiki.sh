#!/usr/bin/env bash
# ==============================================================================
# Obsidian Wiki Ingest Orchestrator
# Validates staged raw sources and orchestrates autonomous wiki synthesis.
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

CORE_DIR="$REPO_ROOT/core"

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
# Strips surrounding quotes, inline comments, CRLF
get_config_value() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 1
  fi
  if command -v node >/dev/null 2>&1 && [ -f "$CORE_DIR/config-loader.mjs" ]; then
    node "$CORE_DIR/config-loader.mjs" --file "$file" --key "$key" || true
  else
    grep -E "^\s*${key}\s*[:=]" "$file" | head -1 | tr -d '\r' | \
      sed -E "s/^\s*${key}\s*[:=]\s*//; s/#.*$//; s/^\s*//; s/\s*$//; s/^['\"]//; s/['\"]$//; s/\s*$//" || true
  fi
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

# Normalize paths (handle Windows backslashes → forward slashes, WSL/Git Bash mounts)
normalize_path() {
  local path="$1"
  path="${path//\\//}"
  if [ -f /etc/wsl.conf ] || grep -q microsoft /proc/version 2>/dev/null; then
    if [[ "$path" =~ ^([A-Za-z]):/(.*) ]]; then
      local drive="${BASH_REMATCH[1]}"
      local rest="${BASH_REMATCH[2]}"
      drive=$(echo "$drive" | tr '[:upper:]' '[:lower:]')
      path="/mnt/${drive}/${rest}"
    fi
  else
    if [[ "$path" =~ ^/mnt/([A-Za-z])/(.*) ]]; then
      local drive="${BASH_REMATCH[1]}"
      local rest="${BASH_REMATCH[2]}"
      drive=$(echo "$drive" | tr '[:upper:]' '[:lower:]')
      if [ ! -d "/mnt/${drive}" ] && [ -d "/${drive}" ]; then
        path="/${drive}/${rest}"
      fi
    elif [[ "$path" =~ ^([A-Za-z]):/(.*) ]]; then
      local drive="${BASH_REMATCH[1]}"
      local rest="${BASH_REMATCH[2]}"
      drive=$(echo "$drive" | tr '[:upper:]' '[:lower:]')
      if [ -d "/${drive}" ]; then
        path="/${drive}/${rest}"
      fi
    fi
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

# --- ARGUMENT PARSING (FLAGS BEFORE POSITIONAL ACTIONS) ---------------------
PROVIDER=""
HAS_AUTO_SYNTHESIZE=false
HAS_OFFLINE_TEMPLATE=false
DRY_RUN=false
FORCE=false
ALLOW_REMOTE_ENDPOINT=false
LOCAL_ENDPOINT=""
MODEL=""
STAGING_PATH=""
ACTION="validate"

RAW_ARGS=("$@")
i=0
while [ $i -lt ${#RAW_ARGS[@]} ]; do
  arg="${RAW_ARGS[$i]}"
  case "$arg" in
    --auto-synthesize|auto-synthesize)
      HAS_AUTO_SYNTHESIZE=true
      if [ -z "$PROVIDER" ]; then PROVIDER="anthropic"; fi
      ;;
    --offline-template|offline-template)
      HAS_OFFLINE_TEMPLATE=true
      PROVIDER="offline-template"
      ;;
    --provider)
      i=$((i + 1))
      PROVIDER="${RAW_ARGS[$i]}"
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --force)
      FORCE=true
      ;;
    --allow-remote-endpoint)
      ALLOW_REMOTE_ENDPOINT=true
      ;;
    --local-endpoint)
      i=$((i + 1))
      LOCAL_ENDPOINT="${RAW_ARGS[$i]}"
      ;;
    --model)
      i=$((i + 1))
      MODEL="${RAW_ARGS[$i]}"
      ;;
    --staging-path)
      i=$((i + 1))
      STAGING_PATH="${RAW_ARGS[$i]}"
      ;;
    validate|prompt|log-entry)
      ACTION="$arg"
      ;;
    -*)
      log_warn "Unknown flag: $arg"
      ;;
    *)
      if [ -z "$STAGING_PATH" ]; then
        STAGING_PATH="$arg"
      fi
      ;;
  esac
  i=$((i + 1))
done

# Check mutually exclusive flags
if [ "$HAS_AUTO_SYNTHESIZE" = true ] && [ "$HAS_OFFLINE_TEMPLATE" = true ]; then
  log_error "Mutually exclusive options: cannot pass both --auto-synthesize and --offline-template."
  exit 1
fi

# Determine execution path: if provider or synthesis flag specified, route to worker
IS_SYNTHESIS_RUN=false
if [ -n "$PROVIDER" ] || [ "$HAS_AUTO_SYNTHESIZE" = true ] || [ "$HAS_OFFLINE_TEMPLATE" = true ]; then
  IS_SYNTHESIS_RUN=true
fi

# Find latest staging directory if not specified
if [ -z "$STAGING_PATH" ]; then
  log_info "No staging path provided. Finding latest staging..."
  LATEST_STAGING=$(find "$OBSIDIAN_VAULT_ROOT/$STAGING_DIR" -maxdepth 3 -type d -name "[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]*" 2>/dev/null | sort -r | head -1)
  if [ -z "$LATEST_STAGING" ]; then
    log_error "No staged sources found. Run: npm run kb:sync:obsidian"
    exit 1
  fi
  STAGING_PATH="$LATEST_STAGING"
fi

STAGING_PATH="${STAGING_PATH%/}"
log_info "Staging path: $STAGING_PATH"

# Validate staging
if [ ! -d "$STAGING_PATH" ]; then
  log_error "Staging directory not found: $STAGING_PATH"
  exit 1
fi

MANIFEST_FILE="$STAGING_PATH/FILES.manifest.txt"
if [ ! -f "$MANIFEST_FILE" ]; then
  log_error "Manifest not found: $MANIFEST_FILE"
  exit 1
fi

FILE_COUNT=$(wc -l < "$MANIFEST_FILE")
log_info "Manifest validated: $FILE_COUNT files in staging."

# If this is a synthesis run, delegate to synthesize-wiki.ts
if [ "$IS_SYNTHESIS_RUN" = true ]; then
  log_info "Routing to Headless Wiki Synthesis Worker (provider: '${PROVIDER:-anthropic}')..."

  # Pre-flight API key check for anthropic provider
  if [ "${PROVIDER:-anthropic}" = "anthropic" ]; then
    if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
      log_error "ANTHROPIC_API_KEY environment variable is required for provider 'anthropic'."
      log_error "Set ANTHROPIC_API_KEY or use --provider offline-template for local draft generation."
      exit 1
    fi
  fi

  WORKER_ARGS=("--provider" "${PROVIDER:-anthropic}" "--staging-path" "$STAGING_PATH" "--vault-root" "$OBSIDIAN_VAULT_ROOT" "--config" "$MODULE_CONFIG")
  if [ "$DRY_RUN" = true ]; then WORKER_ARGS+=("--dry-run"); fi
  if [ "$FORCE" = true ]; then WORKER_ARGS+=("--force"); fi
  if [ "$ALLOW_REMOTE_ENDPOINT" = true ]; then WORKER_ARGS+=("--allow-remote-endpoint"); fi
  if [ -n "$LOCAL_ENDPOINT" ]; then WORKER_ARGS+=("--local-endpoint" "$LOCAL_ENDPOINT"); fi
  if [ -n "$MODEL" ]; then WORKER_ARGS+=("--model" "$MODEL"); fi

  if [ -f /etc/wsl.conf ] || grep -q microsoft /proc/version 2>/dev/null; then
    if command -v cmd.exe &>/dev/null; then
      WIN_SCRIPT_PATH=$(wslpath -w "$SCRIPT_DIR/synthesize-wiki.ts")
      WIN_WORKER_ARGS=()
      for arg in "${WORKER_ARGS[@]}"; do
        if [[ "$arg" == /mnt/?/* ]]; then
          WIN_WORKER_ARGS+=("$(wslpath -w "$arg")")
        else
          WIN_WORKER_ARGS+=("$arg")
        fi
      done
      cmd.exe /c npx tsx "$WIN_SCRIPT_PATH" "${WIN_WORKER_ARGS[@]}"
      exit $?
    fi
  fi

  npx tsx "$SCRIPT_DIR/synthesize-wiki.ts" "${WORKER_ARGS[@]}"
  exit $?
fi

# Fallback to positional ACTIONS
case "$ACTION" in
  validate)
    log_info "Validation complete. Staging ready for wiki ingest."
    exit 0
    ;;
  log-entry)
    log_info "Action: log-entry (handled by synthesize-wiki.ts)"
    exit 0
    ;;
  prompt)
    log_info "Generating Claude Code prompt..."
    cat << EOF

=== OBSIDIAN WIKI INGEST PROMPT ===

Staging Path: $STAGING_PATH
Vault Root: $OBSIDIAN_VAULT_ROOT
Schema Document: docs/targets/obsidian.md

Workflow Phases:
1. Ingest — Identify new entities and concepts from staged sources
2. Lint — Verify current wiki for structural/semantic issues
3. Update — Create/modify entity and concept pages
4. Cross-Ref — Establish bidirectional links
5. Lint — Re-verify after updates
6. Log — Record session in Log.md
7. Review — Spot-check for accuracy
8. Commit — Git commit with change summary

EOF
    exit 0
    ;;
  *)
    log_error "Unknown action: $ACTION"
    exit 1
    ;;
esac
