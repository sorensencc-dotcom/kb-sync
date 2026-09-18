#!/usr/bin/env bash
# ==============================================================================
# Verifies poll_new_sources_active() in modules/notebooklm/ingest-notebooklm.sh:
# Step 5c (purging pre-existing sources) must never run while newly uploaded
# sources are still PROCESSING, must run once they report ACTIVE/READY, must
# fail fast (not wait for timeout) on an ERROR status, and must degrade
# gracefully (not hang forever) when the CLI response has no status field.
#
# This extracts the real function body from the live script (rather than a
# hand-copied duplicate) so the test can never silently drift from the code
# it's supposed to cover.
# ==============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/modules/notebooklm/ingest-notebooklm.sh"
FAIL=0

log_info() { :; }
log_warn() { echo "[WARN] $*" >&2; }
log_error() { echo "[ERROR] $*" >&2; }
sleep_backoff() { :; } # no real sleep -- keep the test fast

# Extract poll_new_sources_active()'s body verbatim from the live script.
FN_SRC="$(sed -n '/^poll_new_sources_active() {/,/^}/p' "$SCRIPT")"
if [ -z "$FN_SRC" ]; then
  echo "FAIL: could not extract poll_new_sources_active() from $SCRIPT"
  exit 1
fi
eval "$FN_SRC"

assert_eq() {
  local actual="$1" expected="$2" label="$3"
  if [ "$actual" = "$expected" ]; then
    echo "PASS: $label"
  else
    echo "FAIL: $label -- got exit=$actual, expected exit=$expected"
    FAIL=1
  fi
}

# --- Scenario 1: immediately ACTIVE -----------------------------------------
NOTEBOOK_ID="nb1"
PACK_FILE="repo_knowledge_pack" # set in the real script from configs/notebooklm.yaml
TIMEOUT_MS=90000
PRE_EXISTING_SOURCES=("old1")
nlm_source_list_json() {
  echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"ACTIVE"}]'
}
poll_new_sources_active; assert_eq "$?" "0" "Scenario 1: immediately ACTIVE returns success"

# --- Scenario 2: PROCESSING then ACTIVE (must wait, then succeed) ----------
CALL_COUNT_FILE="$(mktemp)"
echo 0 > "$CALL_COUNT_FILE"
nlm_source_list_json() {
  local n=$(cat "$CALL_COUNT_FILE")
  n=$((n + 1))
  echo "$n" > "$CALL_COUNT_FILE"
  if [ "$n" -lt 2 ]; then
    echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"PROCESSING"}]'
  else
    echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"ACTIVE"}]'
  fi
}
poll_new_sources_active; RC=$?
assert_eq "$RC" "0" "Scenario 2: eventually-ACTIVE returns success"
CALLS=$(cat "$CALL_COUNT_FILE")
rm -f "$CALL_COUNT_FILE"
if [ "$CALLS" -ge 2 ]; then
  echo "PASS: Scenario 2: polled more than once before succeeding ($CALLS calls)"
else
  echo "FAIL: Scenario 2: expected multiple polls, got $CALLS"
  FAIL=1
fi

# --- Scenario 3: ERROR status fails fast, does not wait for timeout --------
TIMEOUT_MS=90000 # deliberately large -- must NOT be exhausted for this to pass
nlm_source_list_json() {
  echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"ERROR"}]'
}
START_S=$(date +%s)
poll_new_sources_active; RC=$?
END_S=$(date +%s)
assert_eq "$RC" "1" "Scenario 3: ERROR status returns failure"
ELAPSED=$((END_S - START_S))
if [ "$ELAPSED" -lt 5 ]; then
  echo "PASS: Scenario 3: failed fast (${ELAPSED}s), did not wait out the 90s timeout"
else
  echo "FAIL: Scenario 3: took ${ELAPSED}s -- looks like it waited instead of failing fast"
  FAIL=1
fi

# --- Scenario 4: always PROCESSING -> times out, Step 5c must be skippable -
TIMEOUT_MS=1000 # short timeout so the test doesn't hang
nlm_source_list_json() {
  echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"PROCESSING"}]'
}
poll_new_sources_active; assert_eq "$?" "1" "Scenario 4: perpetual PROCESSING times out (failure, so Step 5c is skipped)"

# --- Scenario 5: no status field at all -> degrades gracefully, no hang ----
TIMEOUT_MS=90000
nlm_source_list_json() {
  echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt"}]'
}
START_S=$(date +%s)
poll_new_sources_active; RC=$?
END_S=$(date +%s)
assert_eq "$RC" "0" "Scenario 5: missing status field degrades to success (does not block)"
ELAPSED=$((END_S - START_S))
if [ "$ELAPSED" -lt 5 ]; then
  echo "PASS: Scenario 5: returned immediately, did not wait out the timeout"
else
  echo "FAIL: Scenario 5: took ${ELAPSED}s -- expected immediate return"
  FAIL=1
fi

# --- Scenario 6: custom PACK_FILE must still match its own new sources -----
# Regression guard: an earlier version hardcoded the "repo_knowledge_pack"
# pattern, so any deployment with a custom pack_filename would see
# NO_NEW_SOURCES_YET forever and hard-fail the whole sync via TIMEOUT_MS.
PACK_FILE="my_org_kb_pack"
TIMEOUT_MS=90000
nlm_source_list_json() {
  echo '[{"id":"old1","title":"my_org_kb_pack.txt"},{"id":"new1","title":"my_org_kb_pack_part_aa.txt","status":"ACTIVE"}]'
}
PRE_EXISTING_SOURCES=("old1")
START_S=$(date +%s)
poll_new_sources_active; RC=$?
END_S=$(date +%s)
assert_eq "$RC" "0" "Scenario 6: custom PACK_FILE recognizes its own new sources as ACTIVE"
ELAPSED=$((END_S - START_S))
if [ "$ELAPSED" -lt 5 ]; then
  echo "PASS: Scenario 6: returned immediately, did not time out matching a custom pack filename"
else
  echo "FAIL: Scenario 6: took ${ELAPSED}s -- custom PACK_FILE pattern likely not matching"
  FAIL=1
fi
PACK_FILE="repo_knowledge_pack"

if [ "$FAIL" -ne 0 ]; then
  echo "--- notebooklm-polling.test.sh: FAILED ---"
  exit 1
fi
echo "--- notebooklm-polling.test.sh: ALL PASSED ---"
