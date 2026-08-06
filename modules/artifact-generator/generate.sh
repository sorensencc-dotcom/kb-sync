#!/usr/bin/env bash
# ==============================================================================
# Artifact Generator Module — Orchestrator
# Generates interactive HTML reports from knowledge pack analysis
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
GENERATOR_SCRIPT="$REPO_ROOT/modules/artifact-generator/generate-report.mjs"
CONFIG_FILE="${1:-$REPO_ROOT/configs/artifact-generator.yaml}"
SOURCE="${2:-notebooklm}"

# Logging helpers
log_info() {
  printf '\e[32m[ARTIFACT-GENERATOR] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[ARTIFACT-GENERATOR] [ERROR] %s\e[0m\n' "$*" >&2
}

# Convert Windows paths to WSL mount format (C:\... → /mnt/c/...) only if running in WSL
# Shared helper from modules/obsidian/ingest-obsidian.sh
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

# Validate prerequisites
if [ ! -f "$GENERATOR_SCRIPT" ]; then
  log_error "Generator script not found: $GENERATOR_SCRIPT"
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  log_error "Configuration file not found: $CONFIG_FILE"
  exit 1
fi

log_info "Generating artifact report (source: $SOURCE)..."

# Convert OBSIDIAN_VAULT_ROOT from Windows path to WSL path before passing to Node
if [ -n "${OBSIDIAN_VAULT_ROOT:-}" ]; then
  export OBSIDIAN_VAULT_ROOT=$(convert_to_wsl_path "$OBSIDIAN_VAULT_ROOT")
  log_info "Converted OBSIDIAN_VAULT_ROOT to WSL path: $OBSIDIAN_VAULT_ROOT"
fi

# Format path for Node execution (converts /mnt/c/... or /c/... to C:/... if node is a Windows binary)
format_path_for_node() {
  local path="$1"
  local node_bin="$2"
  local resolved
  resolved="$(command -v "$node_bin" 2>/dev/null || echo "$node_bin")"

  if [[ "$resolved" == *.exe ]] || file "$resolved" 2>/dev/null | grep -qi "PE32"; then
    if [[ "$path" =~ ^/mnt/([a-zA-Z])/(.*) ]]; then
      path="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"
    elif [[ "$path" =~ ^/([a-zA-Z])/(.*) ]]; then
      path="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"
    fi
  fi
  echo "$path"
}

# Locate Node.js executable
NODE_CMD=""
if command -v node >/dev/null 2>&1; then
  NODE_CMD="node"
elif command -v node.exe >/dev/null 2>&1; then
  NODE_CMD="node.exe"
elif [ -f "/mnt/c/Program Files/nodejs/node.exe" ]; then
  NODE_CMD="/mnt/c/Program Files/nodejs/node.exe"
elif [ -f "/c/Program Files/nodejs/node.exe" ]; then
  NODE_CMD="/c/Program Files/nodejs/node.exe"
fi

# Run generator
if [ -n "$NODE_CMD" ]; then
  NODE_SCRIPT="$(format_path_for_node "$GENERATOR_SCRIPT" "$NODE_CMD")"
  NODE_CONFIG="$(format_path_for_node "$CONFIG_FILE" "$NODE_CMD")"

  if "$NODE_CMD" "$NODE_SCRIPT" --source "$SOURCE" --config-file "$NODE_CONFIG"; then
    log_info "Artifact generation completed successfully."
    exit 0
  else
    log_error "Artifact generation failed."
    exit 1
  fi
else
  log_error "Node.js not found. Cannot generate artifact."
  exit 1
fi
