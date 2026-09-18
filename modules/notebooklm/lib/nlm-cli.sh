#!/usr/bin/env bash
# ==============================================================================
# Shared NotebookLM CLI resolution + dialect-safe wrappers.
#
# Extracted from modules/notebooklm/ingest-notebooklm.sh so that other
# scripts (scripts/notebooklm/push-source.sh, scripts/notebooklm/run-nlm-chat.sh)
# can resolve and invoke the same CLI without duplicating the dialect logic
# in a second language/location. Callers must set REPO_ROOT and TIMEOUT_MS
# before sourcing this file; NOTEBOOK_ID is read at call sites, not here.
#
# This file has no telemetry side effects of its own (no write_sync_telemetry
# calls) -- ingest-notebooklm.sh and other callers decide what to do with a
# non-zero return from resolve_nlm_cli.
# ==============================================================================

# Define minimal logging only if the caller hasn't already (ingest-notebooklm.sh
# defines colorized versions before sourcing this file; standalone callers like
# push-source.sh/run-nlm-chat.sh get these plain fallbacks instead).
declare -F log_info >/dev/null || log_info() { printf '[NLM-CLI] [INFO] %s\n' "$*" >&2; }
declare -F log_warn >/dev/null || log_warn() { printf '[NLM-CLI] [WARN] %s\n' "$*" >&2; }
declare -F log_error >/dev/null || log_error() { printf '[NLM-CLI] [ERROR] %s\n' "$*" >&2; }

# --- .env loading (idempotent: only sets a var if not already set/exported) -
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

export NOTEBOOK_ID="${NOTEBOOK_ID:-}"

# --- RESOLVE NOTEBOOKLM CLI RUNTIME ------------------------------------------
# Sets NLM_MODE (explicit|uv-project|global|none) and the associated exec
# vars. Returns 1 (does not exit) if no runtime is available, so callers can
# decide their own failure handling (telemetry, exit code, etc).
resolve_nlm_cli() {
  NLM_MODE=""
  EXPLICIT_NLM_CLI="${NLM_CLI:-}"
  UV_PROJECT_UNPROVISIONED=false

  if (command -v uv >/dev/null 2>&1 || command -v uv.exe >/dev/null 2>&1) \
     && [ -z "$EXPLICIT_NLM_CLI" ] \
     && [ ! -f "$REPO_ROOT/notebooklm-mcp-cli/pyproject.toml" ]; then
    # uv is available but the local project (gitignored; see .gitignore) has
    # not been provisioned in this checkout. This is a standalone pre-check,
    # not an elif branch of the chain below -- an elif that matches would
    # short-circuit the whole chain and skip the global-CLI checks entirely.
    UV_PROJECT_UNPROVISIONED=true
    log_warn "Local uv project not found at $REPO_ROOT/notebooklm-mcp-cli (pyproject.toml missing). Checking for a global CLI instead..."
  fi

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
    if [ "$UV_PROJECT_UNPROVISIONED" = true ]; then
      log_error "No valid NotebookLM CLI runtime found. The local uv project is not provisioned ($REPO_ROOT/notebooklm-mcp-cli/pyproject.toml missing) and no global notebooklm/nlm binary is on PATH. Run: git submodule update --init --recursive (or install the global CLI)."
    else
      log_error "No valid NotebookLM CLI runtime found (explicit NLM_CLI, uv local project, or global notebooklm/nlm binaries)."
    fi
    return 1
  fi
  return 0
}

exec_with_timeout() {
  local timeout_sec=$(( (${TIMEOUT_MS:-90000} + 999) / 1000 ))
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
    return 1
  fi
}

run_nlm_cli() {
  if [ "$NLM_MODE" = "explicit" ]; then
    exec_with_timeout "$EXPLICIT_NLM_CLI" "$@"
  elif [ "$NLM_MODE" = "uv-project" ]; then
    local uv_dir="$REPO_ROOT/notebooklm-mcp-cli"
    if command -v wslpath >/dev/null 2>&1; then
      uv_dir="$(wslpath -w "$uv_dir")"
    elif command -v cygpath >/dev/null 2>&1; then
      uv_dir="$(cygpath -w "$uv_dir")"
    fi
    exec_with_timeout "${UV_EXEC:-uv}" --directory "$uv_dir" run nlm "$@"
  elif [ "$NLM_MODE" = "global" ]; then
    exec_with_timeout "$GLOBAL_NLM_EXEC" "$@"
  else
    log_error "Cannot execute NotebookLM CLI: no valid runtime available."
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

# UNVERIFIED DIALECT ASSUMPTION: unlike source list/add/delete above, this
# repo has no live-confirmed record of `chat`'s argument shape on either
# dialect (tools/notebooklm-mcp-cli is an empty stub here -- see RFC-NLM-05
# Decision A). Mirrors the established --notebook-vs-positional split for
# consistency; correct this the same way the source-* dialects were
# originally corrected, i.e. against a real CLI response, if it's wrong.
nlm_chat_json() {
  local notebook_id="$1" prompt="$2"
  if [ "$NLM_MODE" = "uv-project" ]; then
    run_nlm_cli chat "$notebook_id" "$prompt" --json
  else
    run_nlm_cli chat --notebook "$notebook_id" "$prompt" --json
  fi
}
