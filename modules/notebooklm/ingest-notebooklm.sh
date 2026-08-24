#!/usr/bin/env bash
# ==============================================================================
# NotebookLM Sync Orchestrator (v2: core-modular)
# Calls shared core/ pipeline + NotebookLM-specific CLI operations
# ==============================================================================
set -euo pipefail

# Line 1 REPO_ROOT resolution (guarantees $REPO_ROOT is bound)
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

START_TIME_MS=$(node -e 'console.log(Date.now())' 2>/dev/null || echo $(($(date +%s)*1000)))
SYNC_STATUS_TMP=""
TELEMETRY_WRITTEN=false

cleanup_sync_telemetry_tmp() {
  if [ -n "${SYNC_STATUS_TMP:-}" ] && [ -f "$SYNC_STATUS_TMP" ]; then
    rm -f "$SYNC_STATUS_TMP" 2>/dev/null || true
  fi
}

write_sync_telemetry() {
  [ "$TELEMETRY_WRITTEN" = true ] && return 0

  local status="$1"
  local purged="$2"
  local uploaded="$3"
  local last_error="${4:-}"
  local now_ms=$(node -e 'console.log(Date.now())' 2>/dev/null || echo $(($(date +%s)*1000)))
  local duration_ms=$(( now_ms - START_TIME_MS ))
  if [ "$duration_ms" -lt 0 ]; then duration_ms=0; fi
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  SYNC_STATUS_TMP="$REPO_ROOT/.sync-status.json.tmp.$$"

  # Merge into any existing .sync-status.json instead of overwriting it --
  # core/flatten.sh's compactor step writes compaction_stats/compactor_warnings
  # into this same file earlier in the pipeline; a raw overwrite here erased them.
  if node -e '
    const fs = require("fs");
    const [statusFile, tmpFile, status, purged, uploaded, durationMs, timestamp, lastError] = process.argv.slice(1);
    let existing = {};
    if (fs.existsSync(statusFile)) {
      try { existing = JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch (_) {}
    }
    existing.target = "notebooklm";
    existing.status = status;
    existing.timestamp = timestamp;
    existing.duration_ms = Number(durationMs);
    existing.purged_sources = Number(purged);
    existing.uploaded_chunks = Number(uploaded);
    if (status !== "SUCCESS") {
      // Stage booleans / notebook_id are written by generate-kb-sync-artifact.mjs
      // on successful runs and persist through the merge below. Left untouched,
      // a FAILED run would advertise stage1/stage2 success from a prior run --
      // monitors keying on these booleans would report health during an outage.
      existing.stage1_success = false;
      existing.stage2_success = false;
      existing.notebook_id = "unknown";
    }
    if (lastError) {
      existing.last_error = lastError;
    } else if (status === "SUCCESS") {
      delete existing.last_error;
    }
    fs.writeFileSync(tmpFile, JSON.stringify(existing, null, 2), "utf8");
  ' "$REPO_ROOT/.sync-status.json" "$SYNC_STATUS_TMP" "$status" "$purged" "$uploaded" "$duration_ms" "$timestamp" "$last_error"
  then
    if mv -f "$SYNC_STATUS_TMP" "$REPO_ROOT/.sync-status.json" 2>/dev/null; then
      TELEMETRY_WRITTEN=true
      SYNC_STATUS_TMP=""
      return 0
    fi
  fi

  log_error "FATAL: Failed to write sync telemetry to $REPO_ROOT/.sync-status.json"
  cleanup_sync_telemetry_tmp
  return 1
}

on_script_error() {
  local exit_code=$?
  local line_no="${1:-${BASH_LINENO[0]:-unknown}}"
  local command="${2:-${BASH_COMMAND:-unknown}}"
  local err_msg="Script terminated with error (exit code ${exit_code}) at line ${line_no}: '${command}'"
  log_error "$err_msg"
  write_sync_telemetry "FAILED" 0 0 "$err_msg" || true
}
trap 'on_script_error "${LINENO:-}" "${BASH_COMMAND:-}"' ERR

on_signal_exit() {
  cleanup_sync_telemetry_tmp
  write_sync_telemetry "FAILED" 0 0 "Script interrupted by signal" || true
  exit 130
}
trap cleanup_sync_telemetry_tmp EXIT
trap on_signal_exit INT TERM

# Unset git environment overrides
unset GIT_DIR
unset GIT_WORK_TREE
unset GIT_INDEX_FILE

# --- CONSTANTS & SETUP -------------------------------------------------------
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
  grep -E "^\s*${key}\s*[:=]" "$file" | head -1 | tr -d '\r' | \
    sed -E "s/^\s*${key}\s*[:=]\s*//; s/#.*$//; s/^\s*['\"]//; s/['\"]\s*$//; s/\s*$//" || true
}

# --- PRE-FLIGHT CHECKS -------------------------------------------------------
log_info "Initializing NotebookLM sync orchestrator..."

# Verify we're in a git repo
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.git" ]; then
  log_error "Not inside a valid git repository."
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

# Verify core scripts exist
if [ ! -x "$CORE_DIR/flatten.sh" ]; then
  log_error "Core script not found: $CORE_DIR/flatten.sh"
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

# Verify configs exist
if [ ! -f "$GLOBAL_CONFIG" ]; then
  log_error "Global config not found: $GLOBAL_CONFIG"
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

if [ ! -f "$MODULE_CONFIG" ]; then
  log_error "NotebookLM config not found: $MODULE_CONFIG"
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

log_info "Core scripts and configs located."

# --- LOAD MODULE CONFIG & ENVIRONMENT ----------------------------------------
PACK_DIR=$(get_config_value "$MODULE_CONFIG" "output_dir")
PACK_FILE=$(get_config_value "$MODULE_CONFIG" "pack_filename")
INCLUDE_EXTENSIONS=""

raw_timeout=$(get_config_value "$MODULE_CONFIG" "timeout_ms")
raw_retry=$(get_config_value "$MODULE_CONFIG" "retry_attempts")
raw_backoff=$(get_config_value "$MODULE_CONFIG" "backoff_ms")

export TIMEOUT_MS="${raw_timeout:-90000}"
export RETRY_ATTEMPTS="${raw_retry:-3}"
export BACKOFF_MS="${raw_backoff:-2000}"

if ! [[ "$TIMEOUT_MS" =~ ^[0-9]+$ ]] || [ "$TIMEOUT_MS" -lt 1000 ]; then
  log_error "Invalid configuration: timeout_ms must be an integer >= 1000 (got '$TIMEOUT_MS')"
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

if ! [[ "$RETRY_ATTEMPTS" =~ ^[0-9]+$ ]] || [ "$RETRY_ATTEMPTS" -lt 1 ]; then
  log_error "Invalid configuration: retry_attempts must be an integer >= 1 (got '$RETRY_ATTEMPTS')"
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

if ! [[ "$BACKOFF_MS" =~ ^[0-9]+$ ]] || [ "$BACKOFF_MS" -lt 100 ]; then
  log_error "Invalid configuration: backoff_ms must be an integer >= 100 (got '$BACKOFF_MS')"
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

# Set defaults if config parsing failed
: ${PACK_DIR:="./.nlm_pack"}
: ${PACK_FILE:="repo_knowledge_pack"}

# Make paths absolute (handle both Unix / and Windows \ separators)
if [[ ! "$PACK_DIR" =~ ^[/A-Za-z]: ]]; then
  PACK_DIR="$REPO_ROOT/$PACK_DIR"
fi
PACK_DIR="${PACK_DIR//\\//}"

log_info "Pack directory: $PACK_DIR"
log_info "Pack filename: $PACK_FILE"

# Load .env (hardened parser)
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

NOTEBOOK_ID="${NOTEBOOK_ID:-}"

# --- RESOLVE NOTEBOOKLM CLI RUNTIME ------------------------------------------
NLM_MODE=""
EXPLICIT_NLM_CLI="${NLM_CLI:-}"

if [ -n "$EXPLICIT_NLM_CLI" ]; then
  NLM_MODE="explicit"
  log_info "CLI resolution mode: explicit (path: '$EXPLICIT_NLM_CLI')"
elif (command -v uv >/dev/null 2>&1 || command -v uv.exe >/dev/null 2>&1) && [ -f "$REPO_ROOT/notebooklm-mcp-cli/pyproject.toml" ]; then
  NLM_MODE="uv-project"
  UV_EXEC="uv"
  if ! command -v uv >/dev/null 2>&1 && command -v uv.exe >/dev/null 2>&1; then
    UV_EXEC="uv.exe"
  fi
  log_info "CLI resolution mode: local uv project ($REPO_ROOT/notebooklm-mcp-cli)"
elif command -v notebooklm >/dev/null 2>&1; then
  NLM_MODE="global"
  GLOBAL_NLM_EXEC="notebooklm"
  log_info "CLI resolution mode: global ($GLOBAL_NLM_EXEC)"
elif command -v notebooklm.exe >/dev/null 2>&1; then
  NLM_MODE="global"
  GLOBAL_NLM_EXEC="notebooklm.exe"
  log_info "CLI resolution mode: global ($GLOBAL_NLM_EXEC)"
elif command -v nlm >/dev/null 2>&1; then
  NLM_MODE="global"
  GLOBAL_NLM_EXEC="nlm"
  log_info "CLI resolution mode: global ($GLOBAL_NLM_EXEC)"
elif command -v nlm.exe >/dev/null 2>&1; then
  NLM_MODE="global"
  GLOBAL_NLM_EXEC="nlm.exe"
  log_info "CLI resolution mode: global ($GLOBAL_NLM_EXEC)"
else
  NLM_MODE="none"
  log_error "No valid NotebookLM CLI runtime found (explicit NLM_CLI, uv local project, or global notebooklm/nlm binaries)."
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

exec_with_timeout() {
  local timeout_sec=$(( (TIMEOUT_MS + 999) / 1000 ))
  [ "$timeout_sec" -lt 1 ] && timeout_sec=1
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_sec" "$@"
  elif node -e 'process.exit(0)' >/dev/null 2>&1; then
    node -e '
      const { spawnSync } = require("child_process");
      const [cmd, ...args] = process.argv.slice(1);
      const res = spawnSync(cmd, args, { stdio: "inherit", timeout: parseInt(process.env.TIMEOUT_MS, 10) || 90000 });
      if (res.error || res.status !== 0) process.exit(res.status || 1);
    ' "$@"
  else
    log_error "FATAL: No valid timeout provider available (neither 'timeout' binary nor 'node')."
    write_sync_telemetry "FAILED" 0 0
    exit 1
  fi
}

run_nlm_cli() {
  if [ "$NLM_MODE" = "explicit" ]; then
    exec_with_timeout "$EXPLICIT_NLM_CLI" "$@"
  elif [ "$NLM_MODE" = "uv-project" ]; then
    exec_with_timeout "${UV_EXEC:-uv}" --directory "$REPO_ROOT/notebooklm-mcp-cli" run nlm "$@"
  elif [ "$NLM_MODE" = "global" ]; then
    exec_with_timeout "$GLOBAL_NLM_EXEC" "$@"
  else
    log_error "Cannot execute NotebookLM CLI: no valid runtime available."
    write_sync_telemetry "FAILED" 0 0
    return 1
  fi
}

# The local uv-project `nlm` CLI (notebooklm-mcp-cli) and the global
# `notebooklm` CLI use incompatible argument dialects for the same
# operations: uv-project takes NOTEBOOK_ID positionally and has no
# --notebook flag at all on `source delete`, and requires --file (not a
# bare positional) for local file uploads on `source add`. Calling
# uv-project's `nlm` with the global CLI's --notebook flag fails outright
# (exit 2, empty output) -- confirmed live against the CIC-KB notebook,
# where it silently broke the pre-existing-source query every run.
nlm_source_list_json() {
  local notebook_id="$1"
  if [ "$NLM_MODE" = "uv-project" ]; then
    run_nlm_cli source list "$notebook_id" --json
  else
    run_nlm_cli source list --notebook "$notebook_id" --json
  fi
}

nlm_source_add() {
  local notebook_id="$1" file_path="$2"
  if [ "$NLM_MODE" = "uv-project" ]; then
    run_nlm_cli source add "$notebook_id" --file "$file_path"
  else
    run_nlm_cli source add --notebook "$notebook_id" "$file_path"
  fi
}

nlm_source_delete() {
  local notebook_id="$1" source_id="$2"
  if [ "$NLM_MODE" = "uv-project" ]; then
    run_nlm_cli source delete "$source_id" -y
  else
    run_nlm_cli source delete --notebook "$notebook_id" "$source_id" -y
  fi
}

# uv-project's `nlm` has no `auth` command group at all (confirmed live:
# "No such command 'auth'. Did you mean 'batch'?") -- its equivalent is
# `login --check`. This previously made verify_auth_or_die always think
# auth was broken and fall through every recovery path to a hard FATAL
# stop, even when the stored profile was already valid (confirmed live:
# `login --check` returns "Authentication valid!" with the same profile
# that `auth check` was failing against).
nlm_auth_check() {
  if [ "$NLM_MODE" = "uv-project" ]; then
    run_nlm_cli login --check
  else
    run_nlm_cli auth check
  fi
}

sleep_backoff() {
  local ms="${1:-2000}"
  if node -e "setTimeout(() => {}, $ms)" 2>/dev/null; then
    return 0
  fi
  local sec=$(( (ms + 999) / 1000 ))
  [ "$sec" -lt 1 ] && sec=1
  sleep "$sec"
}

if [ -z "${NOTEBOOKLM_COOKIE:-}" ] && [ -z "${NOTEBOOKLM_TOKEN:-}" ] && [ -z "${NOTEBOOKLM_MASTER_TOKEN:-}" ]; then
  log_error "Missing credentials: set NOTEBOOKLM_COOKIE, NOTEBOOKLM_TOKEN, or NOTEBOOKLM_MASTER_TOKEN in .env"
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

if [ -z "$NOTEBOOK_ID" ]; then
  log_error "NOTEBOOK_ID not set in .env"
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

import_cookie_json() {
  if [ -z "${NOTEBOOKLM_COOKIE:-}" ]; then return 1; fi
  log_info "Attempting import from NOTEBOOKLM_COOKIE..."
  local auth_json=""
  if [[ "$NOTEBOOKLM_COOKIE" =~ ^\[.*\]$ ]] || [[ "$NOTEBOOKLM_COOKIE" =~ ^\{.*\}$ ]]; then
    auth_json="$NOTEBOOKLM_COOKIE"
  else
    auth_json=$(node -e '
      const cookie = process.env.NOTEBOOKLM_COOKIE || "";
      const cookies = [];
      cookie.split(";").forEach(p => {
        const parts = p.trim().split("=");
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const value = parts.slice(1).join("=").trim();
          if (name && value) {
            cookies.push({ name, value, domain: ".google.com", path: "/" });
          }
        }
      });
      console.log(JSON.stringify(cookies));
    ' 2>/dev/null || echo "")
  fi

  if [ -z "$auth_json" ]; then return 1; fi

  if [ "$NLM_MODE" = "uv-project" ]; then
    # uv-project's `login --manual` reads cookies from a --file path, not
    # stdin -- there is no `auth import-cookies` command in this dialect.
    local cookie_file
    cookie_file="$(mktemp)"
    printf '%s' "$auth_json" > "$cookie_file"
    run_nlm_cli login --manual --file "$cookie_file" 2>/dev/null
    local status=$?
    rm -f "$cookie_file"
    return $status
  fi

  echo "$auth_json" | run_nlm_cli auth import-cookies --quiet - 2>/dev/null || return 1
  return 0
}

CHECK_AUTH_ONLY=false
for arg in "$@"; do
  if [ "$arg" = "--check-auth-only" ] || [ "$arg" = "-c" ]; then
    CHECK_AUTH_ONLY=true
  fi
done

verify_auth_or_die() {
  if nlm_auth_check >/dev/null 2>&1; then return 0; fi
  log_warn "CLI auth state missing/invalid. Recovering..."

  if [ "$NLM_MODE" = "uv-project" ]; then
    # No `auth refresh` equivalent in this dialect -- login --check above
    # already reflects live token validity, nothing to refresh separately.
    :
  else
    run_nlm_cli auth refresh --verify --quiet 2>/dev/null || true
    if nlm_auth_check >/dev/null 2>&1; then return 0; fi
  fi

  if [ -n "${NOTEBOOKLM_MASTER_TOKEN:-}" ]; then
    if [ "$NLM_MODE" = "uv-project" ]; then
      log_warn "Master-token login is not supported by the local uv-project nlm CLI; skipping this recovery path."
    else
      run_nlm_cli login --master-token --oauth-token "$NOTEBOOKLM_MASTER_TOKEN" --quiet 2>/dev/null || true
      if nlm_auth_check >/dev/null 2>&1; then return 0; fi
    fi
  fi

  if import_cookie_json; then
    if nlm_auth_check >/dev/null 2>&1; then return 0; fi
  fi

  log_error "FATAL: All authentication recovery paths failed. Hard-stopping before purge/upload."
  write_sync_telemetry "FAILED" 0 0
  exit 1
}

verify_auth_or_die

if [ "$CHECK_AUTH_ONLY" = true ]; then
  log_info "Auth check passed successfully. Exiting without side effects."
  exit 0
fi

# Shared helper for structural source querying & exact pack pattern filtering
query_preexisting_pack_sources() {
  PRE_EXISTING_SOURCES=()
  local sources_json
  if ! sources_json="$(nlm_source_list_json "$NOTEBOOK_ID" 2>/dev/null)"; then
    log_error "FATAL: Failed to query existing notebook sources for Notebook ID: $NOTEBOOK_ID"
    return 1
  fi

  local parsed_ids
  parsed_ids=$(printf '%s' "$sources_json" | node -e '
    const fs = require("fs");
    try {
      const input = fs.readFileSync(0, "utf8");
      let raw = JSON.parse(input || "[]");
      let list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.sources) ? raw.sources : null);
      if (!list) process.exit(1);
      const pattern = /^repo_knowledge_pack.*\.txt$/i;
      const matching = [];
      for (const s of list) {
        if (!s || typeof s.id !== "string" || !s.id) process.exit(1);
        const name = typeof s.title === "string" ? s.title : (typeof s.name === "string" ? s.name : "");
        if (!name) process.exit(1);
        if (pattern.test(name)) matching.push(s.id);
      }
      console.log(matching.join("\n"));
    } catch(e) { process.exit(1); }
  ' 2>/dev/null || echo "PARSE_ERROR")

  if [ "$parsed_ids" = "PARSE_ERROR" ]; then
    log_error "FATAL: Malformed JSON output returned from source list."
    return 1
  fi

  if [ -n "$parsed_ids" ]; then
    while read -r src_id; do
      [ -n "$src_id" ] && PRE_EXISTING_SOURCES+=("$src_id")
    done <<< "$parsed_ids"
  fi
  return 0
}

# Pre-flight audit and automated drift correction
run_preflight_drift_audit() {
  log_info "Step 0/5: Executing pre-flight source audit and drift check..."
  if ! query_preexisting_pack_sources; then
    log_warn "[AUDIT] Pre-flight source query failed. Proceeding with caution..."
    return 0
  fi

  local count="${#PRE_EXISTING_SOURCES[@]}"
  if [ "$count" -gt 1 ]; then
    log_warn "[AUDIT-DRIFT] Anomaly detected: Found $count matching knowledge pack sources (drift from interrupted prior run)."
    log_info "[AUDIT-DRIFT] Executing automated drift correction... Purging $((count - 1)) duplicate stale source(s)."
    
    local purged=0
    for ((i=0; i<count-1; i++)); do
      local src_id="${PRE_EXISTING_SOURCES[i]}"
      if nlm_source_delete "$NOTEBOOK_ID" "$src_id" >/dev/null 2>&1; then
        purged=$((purged + 1))
      fi
    done
    log_info "[AUDIT-DRIFT] Automated drift correction complete: Purged $purged stale duplicate source(s)."
  else
    log_info "[AUDIT] Pre-flight audit passed cleanly ($count active pack source)."
  fi
  return 0
}

# --- ARGUMENT PARSING --------------------------------------------------------
RUN_ROLLBACK=false
RUN_REPAIR_DRIFT=false

if [ "${1:-}" = "--rollback" ] || [ "${1:-}" = "-r" ]; then
  RUN_ROLLBACK=true
elif [ "${1:-}" = "--repair-drift" ] || [ "${1:-}" = "--audit-drift" ]; then
  RUN_REPAIR_DRIFT=true
fi

if [ "$RUN_REPAIR_DRIFT" = true ]; then
  log_info "Executing STANDALONE REPAIR DRIFT audit..."
  run_preflight_drift_audit
  log_info "Standalone drift repair completed successfully."
  exit 0
fi

# --- ROLLBACK PATH -----------------------------------------------------------
if [ "$RUN_ROLLBACK" = true ]; then
  log_info "Executing ROLLBACK strategy..."

  if ! "$CORE_DIR/rollback.sh" restore --dir "$PACK_DIR"; then
    log_error "Rollback restore failed."
    write_sync_telemetry "FAILED" 0 0
    exit 1
  fi

  UPLOAD_FILES=()
  while IFS= read -r file; do
    upload_file="${file%.bak.txt}"
    [ -f "$upload_file" ] && UPLOAD_FILES+=("$upload_file")
  done < <("$CORE_DIR/rollback.sh" list --dir "$PACK_DIR" 2>/dev/null || true)

  if [ ${#UPLOAD_FILES[@]} -eq 0 ]; then
    log_error "No files to upload after rollback."
    write_sync_telemetry "FAILED" 0 0
    exit 1
  fi

  log_info "Found ${#UPLOAD_FILES[@]} restored backup file(s) to re-upload."

  PRE_EXISTING_SOURCES=()
  if ! query_preexisting_pack_sources; then
    write_sync_telemetry "FAILED" 0 0
    exit 1
  fi

  # Staged Rollback Upload FIRST
  log_info "Re-uploading ${#UPLOAD_FILES[@]} restored backup file(s)..."
  UPLOADED_COUNT=0
  for file in "${UPLOAD_FILES[@]}"; do
    retry_count=0
    target_upload_path="$file"
    if [[ "${EXPLICIT_NLM_CLI:-}" == *.exe || "${GLOBAL_NLM_EXEC:-}" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then
      abs_file="$(readlink -f "$file" 2>/dev/null || echo "$file")"
      target_upload_path="$(wslpath -w "$abs_file")"
    fi

    until nlm_source_add "$NOTEBOOK_ID" "$target_upload_path"; do
      retry_count=$((retry_count + 1))
      if [ "$retry_count" -ge "$RETRY_ATTEMPTS" ]; then
        log_error "Rollback upload failed after $RETRY_ATTEMPTS attempts for file: $file"
        write_sync_telemetry "FAILED" 0 $UPLOADED_COUNT
        exit 1
      fi
      log_warn "Rollback upload failed for $file. Retrying in ${BACKOFF_MS}ms (attempt $retry_count/$RETRY_ATTEMPTS)..."
      sleep_backoff "$BACKOFF_MS"
    done
    UPLOADED_COUNT=$((UPLOADED_COUNT + 1))
  done

  # Purge pre-existing pack sources ONLY after rollback upload succeeds
  log_info "Rollback upload complete. Purging ${#PRE_EXISTING_SOURCES[@]} old pack source(s)..."
  PURGED_COUNT=0
  PURGE_SUCCESS=true
  for src_id in "${PRE_EXISTING_SOURCES[@]}"; do
    if nlm_source_delete "$NOTEBOOK_ID" "$src_id" >/dev/null 2>&1; then
      PURGED_COUNT=$((PURGED_COUNT + 1))
    else
      log_error "Failed to purge old source ID during rollback: $src_id"
      PURGE_SUCCESS=false
    fi
  done

  if [ "$PURGE_SUCCESS" = false ]; then
    log_error "Rollback completed with purge failures. Setting status to PARTIAL_SUCCESS."
    write_sync_telemetry "PARTIAL_SUCCESS" $PURGED_COUNT $UPLOADED_COUNT
    exit 1
  fi

  log_info "NotebookLM rollback completed successfully! Purged: $PURGED_COUNT, Uploaded: $UPLOADED_COUNT."
  write_sync_telemetry "SUCCESS" $PURGED_COUNT $UPLOADED_COUNT
  exit 0
fi

# --- NORMAL SYNC PATH (INGEST) -----------------------------------------------
log_info "Starting normal sync pipeline..."

# Step 0: Pre-flight audit & drift correction
run_preflight_drift_audit

mkdir -p "$PACK_DIR"
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
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi

PACK_FILE_PATH="$PACK_DIR/$PACK_FILE.txt"
log_info "Flatten completed: $PACK_FILE_PATH"

# Consolidate wiki/lessons/*.md into knowledge pack
if [ -d "$REPO_ROOT/wiki/lessons" ]; then
  shopt -s nullglob
  LESSON_FILES=("$REPO_ROOT/wiki/lessons"/*.md)
  shopt -u nullglob
  if [ ${#LESSON_FILES[@]} -gt 0 ]; then
    log_info "Consolidating ${#LESSON_FILES[@]} lesson note(s) into knowledge pack..."
    for lf in "${LESSON_FILES[@]}"; do
      rel_lf="${lf#$REPO_ROOT/}"
      rel_lf="${rel_lf//\\//}"
      if ! grep -Fq "--- START FILE: $rel_lf ---" "$PACK_FILE_PATH" 2>/dev/null; then
        {
          echo ""
          echo "--- START FILE: $rel_lf ---"
          cat "$lf" || true
          echo "--- END FILE: $rel_lf ---"
          echo ""
        } >> "$PACK_FILE_PATH"
      fi
    done
  fi
fi


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
    write_sync_telemetry "FAILED" 0 0
    exit 1
  fi

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
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi
log_info "Backups created."

# Step 5: Purge & Upload (Staged)
log_info "Step 5/5: Staged upload of fresh sources, followed by purge..."

PRE_EXISTING_SOURCES=()
log_info "Step 5a: Querying existing notebook sources..."
if ! query_preexisting_pack_sources; then
  write_sync_telemetry "FAILED" 0 0
  exit 1
fi
log_info "Found ${#PRE_EXISTING_SOURCES[@]} matching pre-existing knowledge pack source(s)."

# Step 5b: Upload fresh chunks
log_info "Step 5b: Uploading fresh pack chunks to Notebook $NOTEBOOK_ID..."
UPLOADED_COUNT=0
for file in "${UPLOAD_FILES[@]}"; do
  retry_count=0
  target_upload_path="$file"
  if [[ "${EXPLICIT_NLM_CLI:-}" == *.exe || "${GLOBAL_NLM_EXEC:-}" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then
    abs_file="$(readlink -f "$file" 2>/dev/null || echo "$file")"
    target_upload_path="$(wslpath -w "$abs_file")"
  fi

  until nlm_source_add "$NOTEBOOK_ID" "$target_upload_path"; do
    retry_count=$((retry_count + 1))
    if [ "$retry_count" -ge "$RETRY_ATTEMPTS" ]; then
      log_error "Upload failed after $RETRY_ATTEMPTS attempts for file: $file"
      write_sync_telemetry "FAILED" 0 $UPLOADED_COUNT
      exit 1
    fi
    log_warn "Upload failed for $file. Retrying in ${BACKOFF_MS}ms (attempt $retry_count/$RETRY_ATTEMPTS)..."
    sleep_backoff "$BACKOFF_MS"
  done
  UPLOADED_COUNT=$((UPLOADED_COUNT + 1))
done

# Step 5c: Delete pre-existing sources ONLY after upload succeeds
log_info "Step 5c: Upload complete. Purging ${#PRE_EXISTING_SOURCES[@]} old source(s)..."
PURGED_COUNT=0
PURGE_SUCCESS=true
for src_id in "${PRE_EXISTING_SOURCES[@]}"; do
  if nlm_source_delete "$NOTEBOOK_ID" "$src_id" >/dev/null 2>&1; then
    PURGED_COUNT=$((PURGED_COUNT + 1))
  else
    log_error "Failed to purge old source ID: $src_id"
    PURGE_SUCCESS=false
  fi
done

if [ "$PURGE_SUCCESS" = false ]; then
  log_error "Sync completed with purge failures. Setting status to PARTIAL_SUCCESS."
  write_sync_telemetry "PARTIAL_SUCCESS" $PURGED_COUNT $UPLOADED_COUNT
  exit 1
fi

log_info "NotebookLM sync completed successfully! Purged: $PURGED_COUNT, Uploaded: $UPLOADED_COUNT."
write_sync_telemetry "SUCCESS" $PURGED_COUNT $UPLOADED_COUNT
exit 0
