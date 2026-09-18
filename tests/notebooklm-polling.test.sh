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

# poll_new_sources_active's JSON parsing is a node -e call -- without this
# check, a missing node binary would surface as every scenario mysteriously
# timing out (node -e silently failing) rather than a clear environment
# error naming the actual missing prerequisite.
if ! command -v node >/dev/null 2>&1; then
  echo "FAIL: node is required to run this test (poll_new_sources_active parses JSON via node -e) but was not found on PATH"
  exit 1
fi

log_info() { :; }
log_warn() { echo "[WARN] $*" >&2; }
log_error() { echo "[ERROR] $*" >&2; }
sleep_backoff() { :; } # no real sleep -- keep the test fast

DELETED_IDS=()
nlm_source_delete() { DELETED_IDS+=("$2"); return 0; }

# Extract cleanup_orphaned_new_sources() and poll_new_sources_active()'s
# bodies verbatim from the live script (rather than a hand-copied
# duplicate) so the test can never silently drift from the code it's
# supposed to cover.
FN_SRC="$(sed -n '/^cleanup_orphaned_new_sources() {/,/^}/p' "$SCRIPT")"
FN_SRC="$FN_SRC
$(sed -n '/^poll_new_sources_active() {/,/^}/p' "$SCRIPT")"
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
DELETED_IDS=()
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
if [ "${#DELETED_IDS[@]}" -eq 1 ] && [ "${DELETED_IDS[0]}" = "new1" ]; then
  echo "PASS: Scenario 3: cleaned up the errored new source (new1) to avoid ambiguity on next run"
else
  echo "FAIL: Scenario 3: expected new1 to be deleted, got: ${DELETED_IDS[*]:-<none>}"
  FAIL=1
fi

# --- Scenario 4: always PROCESSING -> times out, Step 5c must be skippable -
TIMEOUT_MS=1000 # short timeout so the test doesn't hang
nlm_source_list_json() {
  echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"PROCESSING"}]'
}
DELETED_IDS=()
poll_new_sources_active; assert_eq "$?" "1" "Scenario 4: perpetual PROCESSING times out (failure, so Step 5c is skipped)"
if [ "${#DELETED_IDS[@]}" -eq 1 ] && [ "${DELETED_IDS[0]}" = "new1" ]; then
  echo "PASS: Scenario 4: cleaned up the still-PROCESSING new source on timeout"
else
  echo "FAIL: Scenario 4: expected new1 to be deleted on timeout, got: ${DELETED_IDS[*]:-<none>}"
  FAIL=1
fi

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

# --- Scenario 6a: partial visibility must NOT resolve early ----------------
# Regression guard: an earlier version only checked whatever sources were
# currently visible, so 1-of-3 uploaded chunks appearing ACTIVE would
# resolve success and let Step 5c purge the complete old pack while 2/3 of
# the new one was not even visible yet.
PACK_FILE="repo_knowledge_pack"
TIMEOUT_MS=1000
NOTEBOOK_ID="nb1"
PRE_EXISTING_SOURCES=("old1")
nlm_source_list_json() {
  # Only 1 of the 3 expected chunks is visible, and it is ACTIVE.
  echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"ACTIVE"}]'
}
poll_new_sources_active 3; assert_eq "$?" "1" "Scenario 6a: 1-of-3 visible ACTIVE does not resolve early (times out instead)"

# --- Scenario 6b: once all expected chunks are visible and ACTIVE, succeeds -
TIMEOUT_MS=90000
nlm_source_list_json() {
  echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"ACTIVE"},{"id":"new2","title":"repo_knowledge_pack_part_ab.txt","status":"ACTIVE"},{"id":"new3","title":"repo_knowledge_pack_part_ac.txt","status":"ACTIVE"}]'
}
poll_new_sources_active 3; assert_eq "$?" "0" "Scenario 6b: 3-of-3 visible ACTIVE resolves success"

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

# --- Scenario 6c: custom PACK_FILE with a CHUNKED upload ---------------------
# Regression guard: core/chunk.sh hardcodes its output prefix to
# "repo_knowledge_pack_part_" regardless of what --file/PACK_FILE it was
# given, so a custom pack_filename's chunked uploads are STILL named
# repo_knowledge_pack_part_*.txt, never <custom>_part_*.txt. Scenario 6
# above used an unrealistic mock (my_org_kb_pack_part_aa.txt) that doesn't
# reflect this; this one uses the real naming chunk.sh actually produces.
PACK_FILE="my_org_kb_pack"
TIMEOUT_MS=90000
nlm_source_list_json() {
  echo '[{"id":"old1","title":"my_org_kb_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"ACTIVE"}]'
}
PRE_EXISTING_SOURCES=("old1")
START_S=$(date +%s)
poll_new_sources_active; RC=$?
END_S=$(date +%s)
assert_eq "$RC" "0" "Scenario 6c: custom PACK_FILE recognizes chunk.sh's real (unprefixed) chunk naming"
ELAPSED=$((END_S - START_S))
if [ "$ELAPSED" -lt 5 ]; then
  echo "PASS: Scenario 6c: returned immediately, did not time out on real chunk naming"
else
  echo "FAIL: Scenario 6c: took ${ELAPSED}s -- chunk-prefix alternation likely not matching"
  FAIL=1
fi
PACK_FILE="repo_knowledge_pack"

# --- Scenario 7: mixed statuses must NOT resolve on the ACTIVE subset ------
# Regression guard: an earlier version excluded status-less sources from
# both the error and readiness checks, so one ACTIVE chunk plus one
# status-less chunk (proving this CLI variant DOES report status, just not
# for every source yet) would resolve success while the status-less
# chunk's real indexing state was still unknown.
TIMEOUT_MS=1000
NOTEBOOK_ID="nb1"
PRE_EXISTING_SOURCES=("old1")
nlm_source_list_json() {
  echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"ACTIVE"},{"id":"new2","title":"repo_knowledge_pack_part_ab.txt"}]'
}
poll_new_sources_active 2; assert_eq "$?" "1" "Scenario 7: mixed ACTIVE + status-less does not resolve early (times out instead)"

# --- Scenario 8: overall timeout is wall-clock, not counted only on sleeps -
# Regression guard: elapsed_sec previously advanced only on the
# sleep_backoff path, never accounting for time spent inside a slow-but-
# successful nlm_source_list_json call (each individually allowed up to
# TIMEOUT_MS via exec_with_timeout). A CLI that responds slowly could let
# the loop run for many multiples of TIMEOUT_MS instead of bounding total
# wall time to it.
TIMEOUT_MS=800 # timeout_sec rounds to 1; poll_interval_sec is a fixed 5s,
               # so the old counter-based logic always allowed exactly 2
               # real CLI-call iterations before stopping, regardless of
               # how long each individual call actually took.
CALL_COUNT_FILE="$(mktemp)"
echo 0 > "$CALL_COUNT_FILE"
nlm_source_list_json() {
  local n=$(cat "$CALL_COUNT_FILE")
  n=$((n + 1))
  echo "$n" > "$CALL_COUNT_FILE"
  sleep 2
  echo '[{"id":"old1","title":"repo_knowledge_pack.txt"},{"id":"new1","title":"repo_knowledge_pack_part_aa.txt","status":"PROCESSING"}]'
}
START_S=$(date +%s)
poll_new_sources_active; RC=$?
END_S=$(date +%s)
CALLS=$(cat "$CALL_COUNT_FILE")
rm -f "$CALL_COUNT_FILE"
assert_eq "$RC" "1" "Scenario 8: still times out (fails) as before"
ELAPSED=$((END_S - START_S))
if [ "$CALLS" -eq 1 ] && [ "$ELAPSED" -lt 4 ]; then
  echo "PASS: Scenario 8: stopped after the deadline passed mid-call (1 call, ${ELAPSED}s) instead of running a second ~2s call regardless"
else
  echo "FAIL: Scenario 8: expected 1 call and <4s elapsed, got $CALLS call(s) and ${ELAPSED}s -- timeout may still be counted only on sleeps"
  FAIL=1
fi
TIMEOUT_MS=90000

if [ "$FAIL" -ne 0 ]; then
  echo "--- notebooklm-polling.test.sh: FAILED ---"
  exit 1
fi
echo "--- notebooklm-polling.test.sh: ALL PASSED ---"
