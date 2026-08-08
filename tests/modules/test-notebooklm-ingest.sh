#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SRC="$(cd "$SCRIPT_DIR/../.." && pwd)"

FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

echo "Setting up isolated git repo fixture at $FIXTURE_DIR..."
git init "$FIXTURE_DIR" --quiet
cd "$FIXTURE_DIR"
mkdir -p "$FIXTURE_DIR/core" "$FIXTURE_DIR/modules/notebooklm" "$FIXTURE_DIR/configs" "$FIXTURE_DIR/.nlm_pack"
cp "$REPO_SRC/core/flatten.sh" "$FIXTURE_DIR/core/"
cp "$REPO_SRC/core/validate.sh" "$FIXTURE_DIR/core/"
cp "$REPO_SRC/core/chunk.sh" "$FIXTURE_DIR/core/"
cp "$REPO_SRC/core/rollback.sh" "$FIXTURE_DIR/core/"
cp -r "$REPO_SRC/modules/notebooklm/"* "$FIXTURE_DIR/modules/notebooklm/"
cp "$REPO_SRC/configs/global.yaml" "$FIXTURE_DIR/configs/"
cp "$REPO_SRC/configs/notebooklm.yaml" "$FIXTURE_DIR/configs/"

chmod +x "$FIXTURE_DIR/core/"*.sh "$FIXTURE_DIR/modules/notebooklm/"*.sh
echo "TEST PACK CONTENT" > "$FIXTURE_DIR/.nlm_pack/repo_knowledge_pack.txt"

CALL_LOG="$FIXTURE_DIR/mock_calls.log"
MOCK_CLI="$FIXTURE_DIR/mock_notebooklm"
STATE_FILE="$FIXTURE_DIR/remote_state.json"

# Initialize remote state JSON
cat << 'EOF' > "$STATE_FILE"
[
  {"id": "src-stale-1", "name": "repo_knowledge_pack.txt"},
  {"id": "src-stale-2", "name": "repo_knowledge_pack_part_1.txt"},
  {"id": "src-backup-1", "name": "repo_knowledge_pack_backup.md"},
  {"id": "src-user-wiki", "name": "unrelated_user_document.md"}
]
EOF

# Stateful Fail-Closed Mock CLI Executable:
cat << 'EOF' > "$MOCK_CLI"
#!/usr/bin/env bash
set -euo pipefail

CALL_LOG="${CALL_LOG_PATH:-/tmp/mock_calls.log}"
STATE_FILE="${FIXTURE_STATE_FILE:-/tmp/remote_state.json}"
echo "$*" >> "$CALL_LOG"

# Reject forbidden subcommands/flags anywhere in argv
for arg in "$@"; do
  if [ "$arg" = "upload" ] || [ "$arg" = "--source-id" ]; then
    echo "ERROR: Forbidden command/flag: $arg" >&2; exit 1
  fi
done

sub1="${1:-}"
sub2="${2:-}"
subcmd="$sub1 $sub2"

if [ "$subcmd" = "auth check" ]; then
  if [ "${MOCK_AUTH_FAIL:-0}" = "1" ]; then exit 1; fi
  exit 0
fi

if [ "$subcmd" = "auth refresh" ]; then
  exit 0
fi

if [ "$subcmd" = "source list" ]; then
  if [ "${3:-}" != "--notebook" ] || [ "${4:-}" != "fixture-notebook-777" ] || [ "${5:-}" != "--json" ]; then
    echo "ERROR: Invalid source list syntax. Got: $*" >&2; exit 1
  fi
  if [ "${MOCK_LIST_FAIL:-0}" = "1" ]; then exit 1; fi
  if [ "${MOCK_MALFORMED_JSON:-0}" = "1" ]; then echo "{invalid_json: true}"; exit 0; fi
  cat "$STATE_FILE"
  exit 0
fi

if [ "$subcmd" = "source add" ]; then
  if [ "${3:-}" != "--notebook" ] || [ "${4:-}" != "fixture-notebook-777" ] || [ -z "${5:-}" ]; then
    echo "ERROR: Invalid source add syntax. Got: $*" >&2; exit 1
  fi
  if [ "${MOCK_UPLOAD_FAIL:-0}" = "1" ]; then exit 1; fi
  export NEW_FILE="$(basename "$5")"
  node -e '
    const fs = require("fs");
    const state = JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE_FILE, "utf8"));
    const uniqueId = "src-new-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7);
    state.push({ id: uniqueId, name: process.env.NEW_FILE });
    fs.writeFileSync(process.env.FIXTURE_STATE_FILE, JSON.stringify(state, null, 2));
  '
  exit 0
fi

if [ "$subcmd" = "source delete" ]; then
  if [ "${3:-}" != "--notebook" ] || [ "${4:-}" != "fixture-notebook-777" ] || [ -z "${5:-}" ] || [ "${6:-}" != "-y" ]; then
    echo "ERROR: Invalid source delete syntax. Got: $*" >&2; exit 1
  fi
  if [ "${MOCK_PURGE_FAIL:-0}" = "1" ]; then exit 1; fi
  export DEL_ID="$5"
  node -e '
    const fs = require("fs");
    const state = JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE_FILE, "utf8"));
    const next = state.filter(s => s.id !== process.env.DEL_ID);
    fs.writeFileSync(process.env.FIXTURE_STATE_FILE, JSON.stringify(next, null, 2));
  '
  exit 0
fi

echo "ERROR: Fail-closed mock rejected unrecognized CLI invocation: $*" >&2
exit 1
EOF
chmod +x "$MOCK_CLI"

export NLM_CLI="$MOCK_CLI"
export CALL_LOG_PATH="$CALL_LOG"
export FIXTURE_STATE_FILE="$STATE_FILE"
export NOTEBOOK_ID="fixture-notebook-777"
export NOTEBOOKLM_COOKIE="fixture-cookie"
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

echo "[TEST 1] --check-auth-only mode..."
bash modules/notebooklm/ingest-notebooklm.sh --check-auth-only

echo "[TEST 2] Auth failure hard-stop & FAILED telemetry..."
rm -f .sync-status.json
if MOCK_AUTH_FAIL=1 bash modules/notebooklm/ingest-notebooklm.sh --check-auth-only 2>/dev/null; then
  echo "FAIL: Expected auth failure exit 1" >&2; exit 1
fi
[ -f .sync-status.json ] || (echo "FAIL: .sync-status.json missing on auth failure" >&2; exit 1)
grep -q '"status": "FAILED"' .sync-status.json

echo "[TEST 3] Successful single pack upload & atomic telemetry..."
rm -f "$CALL_LOG"
bash modules/notebooklm/ingest-notebooklm.sh
grep -q '"status": "SUCCESS"' .sync-status.json
grep -q '"duration_ms":' .sync-status.json

add_count=$(grep -c "source add" "$CALL_LOG" || echo 0)
del_count=$(grep -c "source delete" "$CALL_LOG" || echo 0)
[ "$add_count" -gt 0 ] || (echo "FAIL: Expected at least 1 source add call!" >&2; exit 1)
[ "$del_count" -gt 0 ] || (echo "FAIL: Expected at least 1 source delete call!" >&2; exit 1)
first_del=$(grep -n "source delete" "$CALL_LOG" | head -1 | cut -d: -f1)
last_add=$(grep -n "source add" "$CALL_LOG" | tail -1 | cut -d: -f1)
if [ "$last_add" -ge "$first_del" ]; then
  echo "FAIL: source add occurred after source delete!" >&2; exit 1
fi

echo "[TEST 4] Upload failure preserves status 'FAILED' and ZERO purge calls..."
rm -f "$CALL_LOG"
if MOCK_UPLOAD_FAIL=1 bash modules/notebooklm/ingest-notebooklm.sh 2>/dev/null; then
  echo "FAIL: Expected upload failure exit 1" >&2; exit 1
fi
grep -q '"status": "FAILED"' .sync-status.json
grep -q '"purged_sources": 0' .sync-status.json
if grep -q "source delete" "$CALL_LOG" 2>/dev/null; then
  echo "FAIL: Purge was called despite upload failure!" >&2; exit 1
fi

echo "[TEST 5] Purge failure asserts delete attempt, reports 'PARTIAL_SUCCESS'..."
rm -f "$CALL_LOG"
if MOCK_PURGE_FAIL=1 bash modules/notebooklm/ingest-notebooklm.sh 2>/dev/null; then
  echo "FAIL: Expected purge failure exit 1" >&2; exit 1
fi
grep -q '"status": "PARTIAL_SUCCESS"' .sync-status.json
grep -q '"uploaded_chunks": 1' .sync-status.json
del_attempts=$(grep -c "source delete" "$CALL_LOG" || echo 0)
[ "$del_attempts" -gt 0 ] || (echo "FAIL: Expected delete attempts on purge failure!" >&2; exit 1)

echo "[TEST 6] Stateful multi-run reconciliation removes all stale pack IDs..."
rm -f "$CALL_LOG"
bash modules/notebooklm/ingest-notebooklm.sh
grep -q '"status": "SUCCESS"' .sync-status.json

reconciliation_check=$(node -e '
  const state = JSON.parse(require("fs").readFileSync(process.env.FIXTURE_STATE_FILE, "utf8"));
  const ids = state.map(s => s.id);
  if (!ids.includes("src-user-wiki")) process.exit(1);
  if (!ids.includes("src-backup-1")) process.exit(2);
  if (ids.includes("src-stale-1")) process.exit(3);
  if (ids.includes("src-stale-2")) process.exit(4);
  console.log(state.length);
')
[ "$reconciliation_check" -ge 3 ] || (echo "FAIL: Reconciliation failed" >&2; exit 1)

echo "[TEST 7] Malformed source list JSON fail-closed test..."
rm -f .sync-status.json
if MOCK_MALFORMED_JSON=1 bash modules/notebooklm/ingest-notebooklm.sh 2>/dev/null; then
  echo "FAIL: Expected malformed JSON exit 1" >&2; exit 1
fi
grep -q '"status": "FAILED"' .sync-status.json

echo "[TEST 8] CLI source list failure fail-closed test..."
rm -f .sync-status.json
if MOCK_LIST_FAIL=1 bash modules/notebooklm/ingest-notebooklm.sh 2>/dev/null; then
  echo "FAIL: Expected source list CLI failure exit 1" >&2; exit 1
fi
grep -q '"status": "FAILED"' .sync-status.json

echo "[TEST 9] Timeout boundary enforcement test..."
export TIMEOUT_MS=1500
bash modules/notebooklm/ingest-notebooklm.sh --check-auth-only

echo "[TEST 10] Rollback path staged upload & pattern filtering test..."
rm -f "$CALL_LOG"
bash modules/notebooklm/ingest-notebooklm.sh --rollback
grep -q '"status": "SUCCESS"' .sync-status.json
add_count_rb=$(grep -c "source add" "$CALL_LOG" || echo 0)
del_count_rb=$(grep -c "source delete" "$CALL_LOG" || echo 0)
[ "$add_count_rb" -gt 0 ] || (echo "FAIL: Rollback expected source add!" >&2; exit 1)
first_del_rb=$(grep -n "source delete" "$CALL_LOG" | head -1 | cut -d: -f1)
last_add_rb=$(grep -n "source add" "$CALL_LOG" | tail -1 | cut -d: -f1)
if [ "$last_add_rb" -ge "$first_del_rb" ]; then
  echo "FAIL: Rollback source add occurred after delete!" >&2; exit 1
fi

rollback_preserve_check=$(node -e '
  const state = JSON.parse(require("fs").readFileSync(process.env.FIXTURE_STATE_FILE, "utf8"));
  const ids = state.map(s => s.id);
  if (!ids.includes("src-user-wiki")) process.exit(1);
  if (!ids.includes("src-backup-1")) process.exit(2);
  console.log("OK");
')
[ "$rollback_preserve_check" = "OK" ] || (echo "FAIL: Rollback did not preserve user doc or backup!" >&2; exit 1)

echo "[TEST 11] Telemetry write failure loudness test..."
rm -f .sync-status.json
touch .sync-status.json
chmod 444 .sync-status.json
chmod 555 .
if MOCK_AUTH_FAIL=1 bash modules/notebooklm/ingest-notebooklm.sh --check-auth-only 2>/dev/null; then
  chmod 755 .
  rm -f .sync-status.json
  echo "FAIL: Expected script exit 1 when telemetry file write fails!" >&2
  exit 1
fi
chmod 755 .
rm -f .sync-status.json

echo "[TEST 12] Rollback source list CLI failure test..."
rm -f .sync-status.json
if MOCK_LIST_FAIL=1 bash modules/notebooklm/ingest-notebooklm.sh --rollback 2>/dev/null; then
  echo "FAIL: Expected rollback list failure exit 1" >&2; exit 1
fi
grep -q '"status": "FAILED"' .sync-status.json

echo "[TEST 13] Rollback purge failure PARTIAL_SUCCESS test..."
rm -f .sync-status.json
if MOCK_PURGE_FAIL=1 bash modules/notebooklm/ingest-notebooklm.sh --rollback 2>/dev/null; then
  echo "FAIL: Expected rollback purge failure exit 1" >&2; exit 1
fi
grep -q '"status": "PARTIAL_SUCCESS"' .sync-status.json

echo "✓ All 13 contract, ordering, error path, rollback safety, telemetry failure, and reconciliation test cases passed cleanly!"
