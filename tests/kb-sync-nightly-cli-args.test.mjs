import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const NIGHTLY_PS1 = path.join(REPO_ROOT, 'scripts', 'notebooklm', 'kb-sync-nightly.ps1');

test('Invoke-NlmCli forwards all CLI arguments without $Args shadowing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-nlm-cli-'));
  const shimCmd = path.join(tmpDir, 'mock-nlm.cmd');
  const psScript = path.join(tmpDir, 'invoke-test.ps1');

  try {
    fs.writeFileSync(shimCmd, '@echo off\r\necho ARGS=%*\r\n', 'utf8');
    fs.writeFileSync(
      psScript,
      `
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${NIGHTLY_PS1.replace(/'/g, "''")}', [ref]$tokens, [ref]$errors)
function Write-LogError { param([string]$Msg) Write-Error $Msg }
$funcs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and ($n.Name -in @('Resolve-NlmRuntime', 'Invoke-NlmCli')) }, $true)
foreach ($f in $funcs) { Invoke-Expression $f.Extent.Text }
$env:NLM_CLI = '${shimCmd.replace(/'/g, "''")}'
$out = Invoke-NlmCli @('login', '--check')
Write-Output ($out -join "\`n")
exit $LASTEXITCODE
`.trimStart(),
      'utf8'
    );

    const res = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', psScript], {
      encoding: 'utf8',
      windowsHide: true,
    });

    assert.equal(res.status, 0, `pwsh failed: ${res.stderr}`);
    assert.match(res.stdout, /ARGS=login --check/, `Expected Invoke-NlmCli to forward 'login --check', got: ${res.stdout}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
