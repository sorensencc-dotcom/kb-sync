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
console.log('Installed pre-commit secret-scan hook (chained with existing wiki-validation hook).');
