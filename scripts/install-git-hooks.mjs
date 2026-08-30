import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

let gitDir;
try {
  gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoRoot, encoding: 'utf8' }).trim();
} catch {
  process.exit(0);
}

const hooksDir = path.resolve(repoRoot, gitDir, 'hooks');
fs.mkdirSync(hooksDir, { recursive: true });

const hookPath = path.join(hooksDir, 'pre-commit');

// kb-sync already ships scripts/wiki-validate-precommit.sh (installed via the
// "wiki:setup-hook" npm script), which itself runs scripts/secret-scan-hook.sh
// as its Step 0. Rather than clobber that chain, this hook runs both the
// existing wiki-validation script AND the new Node-based secret scanner --
// both must pass. If "wiki:setup-hook" is re-run later it will overwrite this
// file with just the wiki-validation script; re-run "npm run prepare" (or
// "node scripts/install-git-hooks.mjs") afterward to restore the chain.
const wikiPrecommit = path.relative(repoRoot, path.join(repoRoot, 'scripts', 'wiki-validate-precommit.sh')).split(path.sep).join('/');
const secretScan = path.relative(repoRoot, path.join(here, 'secret-scan.mjs')).split(path.sep).join('/');

const hookBody = `#!/bin/sh
# Installed by scripts/install-git-hooks.mjs
# Chains the existing wiki-validation hook (which includes
# scripts/secret-scan-hook.sh) with the new Node secret scanner.
if [ -f "${wikiPrecommit}" ]; then
  bash "${wikiPrecommit}" || exit 1
fi

node "${secretScan}" || exit 1
`;

fs.writeFileSync(hookPath, hookBody, { mode: 0o755 });

const driftHookBody = `#!/usr/bin/env bash
# Installed by scripts/install-git-hooks.mjs
# Fail-soft documentation drift autoheal for post-commit/post-merge/post-checkout.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || exit 0

DRIFT_SCRIPT="modules/wiki/detect-drift.ts"
REPORT_FILE=".drift-report.json"

log_info() { printf '\\033[0;34m[KB-SYNC-HOOK] [INFO] %s\\033[0m\\n' "$*" >&2; }
log_warn() { printf '\\033[0;33m[KB-SYNC-HOOK] [WARN] %s\\033[0m\\n' "$*" >&2; }

[ -f "$DRIFT_SCRIPT" ] || exit 0

log_info "Analyzing knowledge base for local documentation drift..."
if ! npx tsx "$DRIFT_SCRIPT" >/dev/null 2>&1; then
  log_warn "Drift detection analyzer exited with an error. Skipping check."
  exit 0
fi

if [ ! -f "$REPORT_FILE" ] || ! command -v node >/dev/null 2>&1; then
  exit 0
fi

STATUS=$(node -e "try { console.log(JSON.parse(require('fs').readFileSync('$REPORT_FILE', 'utf8')).status) } catch { console.log('UNKNOWN') }")
STALE_COUNT=$(node -e "try { console.log(JSON.parse(require('fs').readFileSync('$REPORT_FILE', 'utf8')).summary.stale_pages_count) } catch { console.log(0) }")

if [ "$STATUS" = "DRIFT_DETECTED" ]; then
  echo ""
  echo "========================================================================"
  echo "⚠️  [KB-SYNC] WARNING: LOCAL DOCUMENTATION DRIFT DETECTED!"
  echo "========================================================================"
  echo "Found \${STALE_COUNT} stale wiki page(s). Running harmless offline autoheal:"
  echo "  bash modules/obsidian/ingest-obsidian.sh --incremental"
  echo "  bash modules/obsidian/ingest-wiki.sh --provider offline-template"
  echo "========================================================================"
  echo ""

  if ! bash modules/obsidian/ingest-obsidian.sh --incremental >/dev/null 2>&1; then
    log_warn "Incremental staging refresh failed. Skipping offline wiki autoheal."
    exit 0
  fi

  if bash modules/obsidian/ingest-wiki.sh --provider offline-template >/dev/null 2>&1; then
    log_info "✓ Offline wiki autoheal completed."
  else
    log_warn "Offline wiki autoheal failed. Manual fallback:"
    log_warn "  bash modules/obsidian/ingest-wiki.sh --provider offline-template"
  fi
fi
`;

// post-commit closes the coverage gap: ordinary local commits that edit
// core/*.json between scheduled pipeline runs would otherwise drift the wiki
// with nothing to heal it until the next merge/checkout. The drift script
// never commits, so this cannot re-trigger itself.
for (const name of ['post-commit', 'post-merge', 'post-checkout']) {
  fs.writeFileSync(path.join(hooksDir, name), driftHookBody, { mode: 0o755 });
}

console.log('Installed pre-commit secret-scan hook and post-commit/post-merge/post-checkout wiki drift autoheal hooks.');
