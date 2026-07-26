#!/usr/bin/env bash
# ==============================================================================
# KB Sync Nightly Orchestrator — Both Stages
# Stage 1: Sync CIC/Rewrite docs to NotebookLM knowledge base
# Stage 2: Generate interactive artifact report with impact scoring
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
STAGE_1_SCRIPT="$REPO_ROOT/modules/notebooklm/ingest-notebooklm.sh"
STAGE_2_SCRIPT="$REPO_ROOT/scripts/notebooklm/generate-kb-sync-artifact.mjs"

# Logging helpers
log_info() {
  printf '\e[32m[KB-SYNC-NIGHTLY] [INFO] %s\e[0m\n' "$*" >&2
}

log_error() {
  printf '\e[31m[KB-SYNC-NIGHTLY] [ERROR] %s\e[0m\n' "$*" >&2
}

log_warn() {
  printf '\e[33m[KB-SYNC-NIGHTLY] [WARN] %s\e[0m\n' "$*" >&2
}

send_webhook_notification() {
  local title="$1"
  local message="$2"
  local level="${3:-ERROR}"
  local url="${WEBHOOK_URL:-}"
  if [ -z "$url" ] && [ -f "$REPO_ROOT/.env" ]; then
    url="$(grep -E "^\s*WEBHOOK_URL\s*=" "$REPO_ROOT/.env" | head -1 | sed -E 's/^\s*WEBHOOK_URL\s*=\s*//; s/#.*$//; s/^["'\'']//; s/["'\'']$//; s/\s*$//' || true)"
  fi
  if [ -n "$url" ] && command -v curl >/dev/null 2>&1; then
    curl -s -X POST -H "Content-Type: application/json" \
      -d "{\"text\":\"*[KB-SYNC] [$level] $title*\\n$message\"}" \
      "$url" >/dev/null 2>&1 || log_warn "Failed to send webhook notification."
  fi
}

# Validate prerequisites
log_info "Validating prerequisites..."
if [ ! -f "$STAGE_1_SCRIPT" ]; then
  log_error "Stage 1 script not found: $STAGE_1_SCRIPT"
  exit 1
fi

if [ ! -f "$STAGE_2_SCRIPT" ]; then
  log_error "Stage 2 script not found: $STAGE_2_SCRIPT"
  exit 1
fi

log_info "Starting KB Sync Nightly Pipeline..."
log_info "REPO_ROOT: $REPO_ROOT"

# --- STAGE 1: SYNC TO NOTEBOOKLM ---
log_info "================================================================================"
log_info "STAGE 1: Syncing CIC & Rewrite Labs docs to NotebookLM"
log_info "================================================================================"

if bash "$STAGE_1_SCRIPT"; then
  log_info "Stage 1 completed successfully."
else
  log_error "Stage 1 failed. Aborting pipeline."
  send_webhook_notification "Stage 1 Ingest Failed" "NotebookLM Knowledge Base Ingest failed on $(hostname 2>/dev/null || echo 'localhost')." "ERROR"
  exit 1
fi

# --- STAGE 2: GENERATE ARTIFACT ---
log_info ""
log_info "================================================================================"
log_info "STAGE 2: Generating interactive KB sync artifact"
log_info "================================================================================"

# Attempt Stage 2; failure does not fail the entire pipeline (nightly sync won't break)
if command -v node >/dev/null 2>&1; then
  if node "$STAGE_2_SCRIPT"; then
    log_info "Stage 2 completed successfully."
    log_info "Artifact output: $REPO_ROOT/_integration/kb-sync-interactive-report.html"
  else
    log_warn "Stage 2 failed, but Stage 1 succeeded. Sync is complete; artifact generation will retry next cycle."
    send_webhook_notification "Stage 2 Artifact Generation Failed" "Stage 1 sync succeeded, but Stage 2 report generation failed." "WARN"
  fi
else
  log_warn "node not found. Stage 2 skipped. Install Node.js to enable artifact generation."
fi

log_info ""
log_info "================================================================================"
log_info "KB Sync Nightly Pipeline Completed"
log_info "================================================================================"
exit 0
