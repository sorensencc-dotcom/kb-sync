import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const syncScript = path.join(repoRoot, 'modules', 'notebooklm', 'ingest-notebooklm.sh');
const syncScriptRelative = path.relative(repoRoot, syncScript).replaceAll('\\', '/');

test('rollback keeps adapter diagnostics separate from its JSON receipt', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'kb-sync-nlm-shell-'));
  const cliDir = path.join(fixtureRoot, 'mock cli bin');
  const cliPath = path.join(cliDir, 'mock nlm');
  const packDir = path.join(repoRoot, '.nlm_pack');
  const backupPath = path.join(packDir, 'repo_knowledge_pack_part_aa.bak.txt');
  const restoredPath = path.join(packDir, 'repo_knowledge_pack_part_aa.txt');
  const statusPath = path.join(repoRoot, '.sync-status.json');
  const originalStatus = existsSync(statusPath) ? readFileSync(statusPath, 'utf8') : null;

  mkdirSync(cliDir, { recursive: true });
  mkdirSync(packDir, { recursive: true });
  writeFileSync(cliPath, `#!/usr/bin/env bash
set -euo pipefail
printf '[SHELL-CONTRACT-CLI] Invoked with arguments: %s\\n' "$*" >&2
case "$1 $2" in
  "source list --notebook") printf '[ ]\\n' ;;
  "source add --help") printf '%s\\n' '--json' ;;
  "source add --notebook") printf '%s\\n' '{"source_id":"shell-contract-source"}' ;;
  "source delete --notebook") exit 0 ;;
  "auth check"|"auth refresh") exit 0 ;;
  *) exit 64 ;;
esac
`, { mode: 0o755 });
  writeFileSync(backupPath, 'shell contract fixture');

  const result = spawnSync('bash', [syncScriptRelative, '--rollback'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NLM_CLI: cliPath,
      NLM_DIALECT: 'notebooklm',
      NOTEBOOK_ID: 'mock-notebook-shell-contract',
      NOTEBOOKLM_COOKIE: 'test-cookie',
      NOTEBOOKLM_TOKEN: 'test-token',
    },
  });

  try {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /SHELL-CONTRACT-CLI/);
    assert.match(`${result.stdout}${result.stderr}`, /rollback completed successfully/i);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(backupPath, { force: true });
    rmSync(restoredPath, { force: true });
    if (originalStatus === null) rmSync(statusPath, { force: true });
    else writeFileSync(statusPath, originalStatus);
  }
});
