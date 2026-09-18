#!/usr/bin/env bash
# ==============================================================================
# Thin CLI bridge: pushes a single file as a NotebookLM source, using the
# same dialect-safe resolution as modules/notebooklm/ingest-notebooklm.sh.
#
# Exists so Node callers (e.g. modules/wiki/gated-climb-repair.mjs) can push
# a source without reimplementing the uv-project/global CLI dialect split in
# JS -- see RFC-NLM-05 Decision B, Option A.
#
# Usage: push-source.sh <NOTEBOOK_ID> <FILE_PATH>
# Exit 0 on success, non-zero on failure. Logs go to stderr.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

if [ "$#" -ne 2 ]; then
  echo "Usage: $(basename "$0") <NOTEBOOK_ID> <FILE_PATH>" >&2
  exit 2
fi

NOTEBOOK_ID_ARG="$1"
FILE_PATH_ARG="$2"

if [ ! -f "$FILE_PATH_ARG" ]; then
  echo "[PUSH-SOURCE] [ERROR] File not found: $FILE_PATH_ARG" >&2
  exit 1
fi

TIMEOUT_MS="${TIMEOUT_MS:-90000}"

# shellcheck source=lib/nlm-cli.sh
source "$SCRIPT_DIR/lib/nlm-cli.sh"

if ! resolve_nlm_cli; then
  exit 1
fi

nlm_source_add "$NOTEBOOK_ID_ARG" "$FILE_PATH_ARG"
