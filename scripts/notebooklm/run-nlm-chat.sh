#!/usr/bin/env bash
# ==============================================================================
# Thin CLI bridge: runs a `chat` query against a NotebookLM notebook and
# prints the raw JSON response to stdout, using the same dialect-safe
# resolution as modules/notebooklm/ingest-notebooklm.sh.
#
# Exists so Node callers (e.g. scripts/notebooklm/verify-grounding-gate.mjs)
# can query the notebook without reimplementing the uv-project/global CLI
# dialect split in JS -- see RFC-NLM-05 Decision B, Option A.
#
# Usage: run-nlm-chat.sh <NOTEBOOK_ID> <PROMPT>
# Prints the CLI's JSON response to stdout; logs go to stderr.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

if [ "$#" -ne 2 ]; then
  echo "Usage: $(basename "$0") <NOTEBOOK_ID> <PROMPT>" >&2
  exit 2
fi

NOTEBOOK_ID_ARG="$1"
PROMPT_ARG="$2"
TIMEOUT_MS="${TIMEOUT_MS:-90000}"

if [[ ! "$PROMPT_ARG" =~ ^\[[0-9]{4}-[0-9]{2}-[0-9]{2} ]]; then
  TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  PROMPT_ARG="[$TIMESTAMP] $PROMPT_ARG"
fi

# shellcheck source=../../modules/notebooklm/lib/nlm-cli.sh
source "$REPO_ROOT/modules/notebooklm/lib/nlm-cli.sh"

if ! resolve_nlm_cli; then
  exit 1
fi

nlm_chat_json "$NOTEBOOK_ID_ARG" "$PROMPT_ARG"
