#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Exercise the production function; end-to-end ownership/cleanup lives in notebooklm-multipart.test.mjs.
eval "$(sed -n '/^poll_new_sources_active() {/,/^}/p' "$REPO_ROOT/modules/notebooklm/ingest-notebooklm.sh")"
NOTEBOOK_ID=fixture-only
TIMEOUT_MS=1000
UPLOADED_SOURCE_IDS=(new1)
sleep_backoff() { :; }
assert_poll() {
  local expected="$1" label="$2" actual=0
  poll_new_sources_active || actual=$?
  if [ "$actual" -ne "$expected" ]; then
    echo "FAIL: $label (expected $expected, got $actual)" >&2
    exit 1
  fi
  echo "PASS: $label"
}
for status in ACTIVE active 2; do
  nlm_source_list_json() { printf '[{"id":"new1","status":"%s"}]' "$status"; }
  assert_poll 0 "terminal ACTIVE status $status"
done
nlm_source_list_json() { echo '[{"id":"new1","status":2}]'; }
assert_poll 0 "numeric ACTIVE status"
for status in READY unknown ERROR FAILED; do
  nlm_source_list_json() { printf '[{"id":"new1","status":"%s"}]' "$status"; }
  assert_poll 1 "reject unverifiable/error status $status"
done
nlm_source_list_json() { echo '[{"id":"new1"}]'; }
assert_poll 1 "missing status fails closed"
UPLOADED_SOURCE_IDS=(new1 new2)
nlm_source_list_json() { echo '[{"id":"new1","status":"ACTIVE"},{"id":"unowned","status":"ACTIVE"}]'; }
assert_poll 1 "unowned ACTIVE source cannot replace missing returned ID"
nlm_source_list_json() { echo '[{"id":"new1","status":"ACTIVE"},{"id":"new2"}]'; }
assert_poll 1 "mixed batch requires every status"
nlm_source_list_json() { echo '{bad json'; }
assert_poll 1 "malformed source inventory fails closed"
nlm_source_list_json() { return 1; }
assert_poll 1 "list failure fails closed"
UPLOADED_SOURCE_IDS=(new1)
TIMEOUT_MS=10000
mkdir -p "$REPO_ROOT/node_modules/.cache"
COUNTER="$(mktemp "$REPO_ROOT/node_modules/.cache/nlm-poll.XXXXXX")"
trap 'rm -f "$COUNTER"' EXIT
for pending in 1 PROCESSING; do
  echo 0 > "$COUNTER"
  nlm_source_list_json() {
    local n
    n=$(cat "$COUNTER"); echo $((n + 1)) > "$COUNTER"
    if [ "$n" -eq 0 ]; then printf '[{"id":"new1","status":"%s"}]' "$pending"
    else echo '[{"id":"new1","status":2}]'; fi
  }
  assert_poll 0 "pending $pending transitions to numeric ACTIVE"
  [ "$(cat "$COUNTER")" -eq 2 ] || exit 1
done
echo "All poll contract cases passed."
