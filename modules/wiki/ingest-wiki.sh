#!/usr/bin/env bash
# ==============================================================================
# Wiki Semantic Synthesis — Orchestration Script (Staging-Only)
# Prepares raw pack for human-supervised semantic ingest session
# Operator runs Claude Code against staged pack + schema to synthesize wiki
# ==============================================================================
set -uo pipefail

# --- CONSTANTS & SETUP -------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULES_DIR="$REPO_ROOT/modules/wiki"
WIKI_ROOT="$REPO_ROOT/wiki"
PACK_FILE="$REPO_ROOT/.nlm_pack/repo_knowledge_pack.txt"
SCHEMA_DOC="$MODULES_DIR/schema.md"
OPERATOR_PROMPT="$MODULES_DIR/operator-workflow.md"

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

# --- PRE-FLIGHT CHECKS -------------------------------------------------------
log_info "Initializing wiki semantic ingest orchestrator..."

# Verify we're in a git repo
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.git" ]; then
  log_error "Not inside a valid git repository."
  exit 1
fi

# Verify pack exists
if [ ! -f "$PACK_FILE" ]; then
  log_error "Pack file not found: $PACK_FILE"
  log_error "Run 'npm run kb:sync' or 'npm run kb:sync:all' first."
  exit 1
fi

log_info "Pack file located: $PACK_FILE"

# Verify wiki root exists
if [ ! -d "$WIKI_ROOT" ]; then
  log_error "Wiki root directory does not exist: $WIKI_ROOT"
  log_error "Initialize with: mkdir -p $WIKI_ROOT && touch $WIKI_ROOT/Index.md $WIKI_ROOT/Log.md"
  exit 1
fi

log_info "Wiki root: $WIKI_ROOT"

# Verify schema doc exists
if [ ! -f "$SCHEMA_DOC" ]; then
  log_error "Schema doc not found: $SCHEMA_DOC"
  exit 1
fi

log_info "Schema doc located."

# Verify operator workflow doc exists
if [ ! -f "$OPERATOR_PROMPT" ]; then
  log_error "Operator workflow doc not found: $OPERATOR_PROMPT"
  exit 1
fi

log_info "Operator workflow doc located."

# --- PRINT OPERATOR PROMPT ---------------------------------------------------
log_info "========================================================================"
log_info "Wiki Semantic Synthesis Staging Ready"
log_info "========================================================================"

cat >&2 << 'EOF'

📖 Raw pack staged for semantic ingest.

Next step: Run a Claude Code session to synthesize wiki from pack.

1. Open Claude Code
2. Load files in this order:
   - The pack file (below)
   - The schema doc (wiki structure/conventions)
   - Existing wiki pages (Index.md, entities/*.md, concepts/*.md)
3. Follow the operator workflow:
   - Ingest: identify new/updated entities and concepts
   - Lint: flag contradictions, stale pages, orphans
   - Update: rewrite entity/concept pages per schema
   - Cross-ref: ensure bidirectional links and Index.md consistency
   - Log: append semantic update entry to Log.md
4. Review changes and approve before commit

Workflow details: operator-workflow.md
Schema: schema.md
Lint rules: lint-rules.md
Update rules: update-rules.md

EOF

echo ""
echo "Pack file: $PACK_FILE" >&2
echo "Pack size: $(du -h "$PACK_FILE" | cut -f1)" >&2
echo "Schema: $SCHEMA_DOC" >&2
echo "Operator workflow: $OPERATOR_PROMPT" >&2
echo "Wiki root: $WIKI_ROOT" >&2

log_info "Wiki semantic staging completed."

exit 0
