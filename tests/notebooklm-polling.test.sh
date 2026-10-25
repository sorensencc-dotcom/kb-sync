#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Polling ownership and status coverage now lives in the canonical Node gate.
exec node --test --test-name-pattern='pollFamilyUntilActive' "$REPO_ROOT/tests/nlm-pack-replace-gate.test.mjs"
