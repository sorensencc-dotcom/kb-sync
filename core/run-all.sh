#!/usr/bin/env bash
# ==============================================================================
# Core Run-All: Multi-Target Orchestrator
# Invokes all configured sync targets (NotebookLM, Obsidian, etc.) fail-soft
# ==============================================================================
set -euo pipefail

# Unset git environment overrides
unset GIT_DIR
unset GIT_WORK_TREE
unset GIT_INDEX_FILE

# --- CONSTANTS & SETUP -------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Log helpers
log_info() {
  printf '\e[32m[RUN-ALL] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[RUN-ALL] [ERROR] %s\e[0m\n' "$*" >&2
}

log_warn() {
  printf '\e[33m[RUN-ALL] [WARN] %s\e[0m\n' "$*" >&2
}

# --- CONFIGURATION & TIMEOUT POLICY -----------------------------------------
get_config_value() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  grep -E "^\s*${key}\s*[:=]" "$file" | head -1 | \
    sed -E "s/^\s*${key}\s*[:=]\s*//; s/#.*$//; s/^['\"]//; s/['\"]$//; s/\s*$//" || true
}

load_timeout_config() {
  local config="${1:-$REPO_ROOT/configs/global.yaml}"
  local timeout_val
  local retry_val

  timeout_val=$(get_config_value "$config" "timeout_ms")
  retry_val=$(get_config_value "$config" "retry_attempts")

  export WORKSPACE_TIMEOUT_MS="${timeout_val:-90000}"
  export WORKSPACE_RETRY_ATTEMPTS="${retry_val:-3}"
}

load_timeout_config "$REPO_ROOT/configs/global.yaml"

# List of sync targets to invoke (path relative to repo root)

# Format: target_name:script_path
SYNC_TARGETS=(
  "notebooklm:modules/notebooklm/ingest-notebooklm.sh"
  "obsidian:modules/obsidian/ingest-obsidian.sh"
)

log_info "Multi-target sync orchestrator starting..."
log_info "Repository root: $REPO_ROOT"

# --- ARGUMENT PARSING --------------------------------------------------------
RUN_ROLLBACK=false
if [ "${1:-}" = "--rollback" ] || [ "${1:-}" = "-r" ]; then
  RUN_ROLLBACK=true
fi

if [ "$RUN_ROLLBACK" = true ]; then
  log_info "Rollback mode: restoring from backups..."
else
  log_info "Normal mode: syncing all targets..."
fi

# --- SYNC ORCHESTRATION (FAIL-SOFT) ------------------------------------------
OVERALL_SUCCESS=true
COMPLETED_TARGETS=()
FAILED_TARGETS=()

for target_entry in "${SYNC_TARGETS[@]}"; do
  # Parse target_name:script_path
  target_name="${target_entry%%:*}"
  target_script="${target_entry##*:}"

  target_path="$REPO_ROOT/$target_script"

  # Check if target script exists
  if [ ! -f "$target_path" ]; then
    log_warn "Target '$target_name' script not found: $target_path (skipping)"
    continue
  fi

  log_info "========================================================================"
  log_info "Running target: $target_name"
  log_info "========================================================================"

  # Run the target with optional --rollback flag
  if [ "$RUN_ROLLBACK" = true ]; then
    if bash "$target_path" --rollback; then
      log_info "✓ Target '$target_name' rollback completed."
      COMPLETED_TARGETS+=("$target_name")
    else
      log_error "✗ Target '$target_name' rollback FAILED."
      FAILED_TARGETS+=("$target_name")
      OVERALL_SUCCESS=false
      # Continue with next target (fail-soft)
    fi
  else
    if bash "$target_path"; then
      log_info "✓ Target '$target_name' sync completed."
      COMPLETED_TARGETS+=("$target_name")
    else
      log_error "✗ Target '$target_name' sync FAILED."
      FAILED_TARGETS+=("$target_name")
      OVERALL_SUCCESS=false
      # Continue with next target (fail-soft)
    fi
  fi

  log_info ""
done

# --- SUMMARY -----------------------------------------------------------------
log_info "========================================================================"
log_info "Multi-Target Sync Summary"
log_info "========================================================================"

if [ ${#COMPLETED_TARGETS[@]} -gt 0 ]; then
  log_info "Completed targets: ${COMPLETED_TARGETS[*]}"
fi

if [ ${#FAILED_TARGETS[@]} -gt 0 ]; then
  log_error "Failed targets: ${FAILED_TARGETS[*]}"
fi

log_info "Total targets: ${#SYNC_TARGETS[@]}"
log_info "Completed: ${#COMPLETED_TARGETS[@]}"
log_info "Failed: ${#FAILED_TARGETS[@]}"

if [ "$OVERALL_SUCCESS" = true ]; then
  log_info "All targets completed successfully."

  # --- ARTIFACT GENERATION (POST-SYNC, OPTIONAL) ---
  # Fail-soft: a failed report never fails the sync (sync already succeeded).
  if [ "$RUN_ROLLBACK" = false ]; then
    log_info ""
    log_info "========================================================================"
    log_info "Generating artifact reports..."
    log_info "========================================================================"

    # Run artifact generation for completed targets (fail-soft)
    for target in "${COMPLETED_TARGETS[@]}"; do
      if [ "$target" = "notebooklm" ]; then
        if bash "$REPO_ROOT/modules/artifact-generator/generate.sh" "$REPO_ROOT/configs/artifact-generator.yaml" notebooklm; then
          log_info "✓ Artifact generated for NotebookLM"
        else
          log_warn "✗ Artifact generation failed for NotebookLM (sync completed, artifact skipped)"
        fi
      elif [ "$target" = "obsidian" ]; then
        if bash "$REPO_ROOT/modules/artifact-generator/generate.sh" "$REPO_ROOT/configs/artifact-generator.yaml" obsidian; then
          log_info "✓ Artifact generated for Obsidian"
        else
          log_warn "✗ Artifact generation failed for Obsidian (sync completed, artifact skipped)"
        fi
      fi
    done
    log_info ""
    log_info "Artifacts output to: $REPO_ROOT/_integration/"
  fi

  exit 0
else
  log_error "One or more targets failed. See details above."
  exit 1
fi
