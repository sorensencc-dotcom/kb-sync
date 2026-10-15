#!/usr/bin/env bash
# ==============================================================================
# Verifies modules/notebooklm/ingest-notebooklm.sh's CLI-resolution guard:
# when the local uv project ($REPO_ROOT/notebooklm-mcp-cli, gitignored) is
# unprovisioned, the script must warn clearly, still try the global CLI, and
# -- only if that's also missing -- exit with an actionable FATAL message
# rather than the old generic "not found" text or an unhandled crash.
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
SCRIPT="$REPO_ROOT/modules/notebooklm/ingest-notebooklm.sh"
FAIL=0

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "PASS: $label"
  else
    echo "FAIL: $label -- expected output to contain: $needle"
    FAIL=1
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "PASS: $label"
  else
    echo "FAIL: $label -- expected output to NOT contain: $needle"
    FAIL=1
  fi
}

NODE_DIR="$(dirname "$(command -v node)")"
GIT_DIR="$(dirname "$(command -v git)")"

# --- Scenario 1: uv absent entirely, no global CLI --------------------------
# (The local project being unprovisioned is irrelevant when uv itself isn't
# even installed -- this must stay on the original generic error message.)
OUT_1="$(PATH="$GIT_DIR:/usr/bin:/bin:$NODE_DIR" bash "$SCRIPT" --check-auth-only 2>&1 || true)"
assert_contains "$OUT_1" "No valid NotebookLM CLI runtime found (explicit NLM_CLI, uv local project, or global notebooklm/nlm binaries)." \
  "Scenario 1 (no uv, no global CLI): generic FATAL message"
assert_not_contains "$OUT_1" "git submodule update" \
  "Scenario 1: does not claim a submodule fix when uv was never installed"

STUB_BIN="$(mktemp -d)"
PYPROJECT_FILE="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/notebooklm-mcp-cli/pyproject.toml"
RESTORE_PYPROJECT=false
if [ -f "$PYPROJECT_FILE" ]; then
  mv "$PYPROJECT_FILE" "$PYPROJECT_FILE.bak"
  RESTORE_PYPROJECT=true
fi
cleanup() {
  rm -rf "$STUB_BIN"
  if [ "$RESTORE_PYPROJECT" = true ] && [ -f "$PYPROJECT_FILE.bak" ]; then
    mv "$PYPROJECT_FILE.bak" "$PYPROJECT_FILE"
  fi
}
trap cleanup EXIT

# A real `uv` is not guaranteed on the host running this test (it happens to
# be present in some dev sandboxes but not on GitHub Actions' ubuntu-latest
# runner) -- a bare no-op stub is enough here since the script only checks
# `command -v uv` for presence before reaching the pyproject.toml check this
# scenario is actually exercising.
cat > "$STUB_BIN/uv" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$STUB_BIN/uv"
UV_DIR="$STUB_BIN"

# --- Scenario 2: uv present, local project unprovisioned, no global CLI -----
OUT_2="$(PATH="$STUB_BIN:$GIT_DIR:/usr/bin:/bin:$NODE_DIR:$UV_DIR" bash "$SCRIPT" --check-auth-only 2>&1 || true)"
assert_contains "$OUT_2" "Local uv project not found at" \
  "Scenario 2: warns about the unprovisioned local project"
assert_contains "$OUT_2" "notebooklm-mcp-cli (pyproject.toml missing)" \
  "Scenario 2: specifies missing pyproject.toml"
assert_contains "$OUT_2" "git submodule update --init --recursive" \
  "Scenario 2: FATAL message gives the actionable provisioning command"

# --- Scenario 3: uv present, local project unprovisioned, global CLI DOES exist
cat > "$STUB_BIN/notebooklm" <<'EOF'
#!/usr/bin/env bash
echo '[]'
exit 0
EOF
chmod +x "$STUB_BIN/notebooklm"

OUT_3="$(PATH="$STUB_BIN:$GIT_DIR:/usr/bin:/bin:$NODE_DIR:$UV_DIR" bash "$SCRIPT" --check-auth-only 2>&1 || true)"
assert_contains "$OUT_3" "Local uv project not found at" \
  "Scenario 3: still warns about the unprovisioned local project"
assert_contains "$OUT_3" "notebooklm-mcp-cli (pyproject.toml missing)" \
  "Scenario 3: specifies missing pyproject.toml"
assert_contains "$OUT_3" "CLI resolution mode: global (notebooklm)" \
  "Scenario 3: falls back to the global CLI instead of crashing or FATAL-exiting"
assert_not_contains "$OUT_3" "No valid NotebookLM CLI runtime found" \
  "Scenario 3: does not hit the FATAL branch when a global CLI is available"

if [ "$FAIL" -ne 0 ]; then
  echo "--- notebooklm-submodule-guard.test.sh: FAILED ---"
  exit 1
fi
echo "--- notebooklm-submodule-guard.test.sh: ALL PASSED ---"
