#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { checkSiblingPatterns, appendDriftTodo } from './sibling-checker.mjs';

const COLOR = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const logInfo = (msg) => console.log(`${COLOR.green}[SIBLING-CHECK] [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.log(`${COLOR.yellow}[SIBLING-CHECK] [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.log(`${COLOR.red}[SIBLING-CHECK] [ERROR]${COLOR.reset} ${msg}`);

function getStagedFiles(repoRoot) {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return output.split('\n').map(f => f.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function main() {
  const repoRoot = process.cwd();
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const modeArg = args.find(arg => arg.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'check'; // pre-commit, pre-push, check
  
  const filesArg = args.find(arg => arg.startsWith('--files='));
  let stagedFiles = filesArg ? filesArg.split('=')[1].split(',').map(f => f.trim()) : [];
  
  if (stagedFiles.length === 0) {
    stagedFiles = getStagedFiles(repoRoot);
  }

  if (stagedFiles.length === 0) {
    logInfo('No staged files detected in execution context. Sibling checks bypassed.');
    process.exit(0);
  }

  logInfo(`Staging Context: Auditing ${stagedFiles.length} file(s) in --mode=${mode}...`);

  try {
    const { warnings, errors } = checkSiblingPatterns(stagedFiles, repoRoot);

    if (mode === 'pre-commit') {
      // Rule 1: Wiki Drift Warning (Fail-Soft)
      if (warnings.length > 0) {
        console.log(`\n${COLOR.bold}${COLOR.yellow}[SIBLING-CHECK] [WARN] Documentation Drift Detected!${COLOR.reset}`);
        for (const warn of warnings) {
          console.log(`  - Code modified: ${COLOR.cyan}${warn.file}${COLOR.reset}`);
          console.log(`  - Missing wiki sibling update: ${COLOR.yellow}${warn.wikiSibling}${COLOR.reset}\n`);
        }

        // Generate consolidated TODO item rather than flooding TODOS.md with per-file items
        const today = new Date().toISOString().slice(0, 10);
        const signatureKey = '**[P2] kb-sync documentation drift remediation (batch)**';
        const taskLine = `- [ ] ${signatureKey} (created ${today}) — ${warnings.length} sibling wiki file(s) out of sync with code changes across workspace. Run wiki synthesis to regenerate.`;

        // Deduplication: compare the currently drifted file set against what is already open in TODOS.md.
        // If the open item already covers these exact files (or a superset), skip writing — it's the same
        // recurring drift, not a new event.
        const driftedFiles = new Set(warnings.map(w => w.file));
        const isRecurringDrift = (() => {
          const possiblePaths = [
            path.join(repoRoot, 'TODOS.md'),
            path.resolve(repoRoot, '../TODOS.md'),
            'C:/dev/TODOS.md',
            'c:/dev/TODOS.md',
          ];
          for (const p of possiblePaths) {
            if (!fs.existsSync(p)) continue;
            const content = fs.readFileSync(p, 'utf8');
            if (!content.includes(signatureKey)) break; // No open item yet; not recurring

            // Extract the files mentioned in the existing open TODO item by matching
            // the wiki sibling names (e.g. `watch-competitors-v2.mjs.md`)
            const existingFiles = new Set(
              [...content.matchAll(/wiki\/entities\/([\w.\-]+\.md)/g)].map(m => m[1].replace(/\.md$/, ''))
            );
            // Check if every currently-drifted file is already captured in the open item
            const allCovered = [...driftedFiles].every(f => {
              const base = path.basename(f);
              return existingFiles.has(base) || content.includes(base);
            });
            return allCovered;
          }
          return false;
        })();

        if (isRecurringDrift) {
          logInfo(`Recurring drift — open P2 item already covers these ${warnings.length} file(s). Skipping duplicate TODOS.md entry.`);
        } else {
          appendDriftTodo(repoRoot, taskLine, signatureKey);
          console.log(`${COLOR.green}[✓] Staged consolidated drift remediation task in TODOS.md (${warnings.length} file(s)).${COLOR.reset}`);
        }
        console.log(`${COLOR.green}[✓] Hook completed in fail-soft mode. Commit succeeded.${COLOR.reset}\n`);
      } else {
        logInfo('No documentation drift detected. Pre-commit check completed successfully.');
      }
      process.exit(0);
    }

    
    if (mode === 'pre-push') {
      // Rule 2: Interface Signature Drift (Fail-Closed)
      if (errors.length > 0) {
        console.log(`\n${COLOR.bold}${COLOR.red}[SIBLING-CHECK] [ERROR] Structural Interface Mismatch Found! Push Blocked!${COLOR.reset}`);
        for (const err of errors) {
          if (err.symbol) {
            console.log(`  - Shared module modified: ${COLOR.red}${err.file}${COLOR.reset} (Symbol: "${COLOR.bold}${err.symbol}${COLOR.reset}")`);
            console.log(`  - Consumer module un-migrated: ${COLOR.yellow}${err.consumer}${COLOR.reset} (Source: ${err.source})`);
          } else {
            console.log(`  - Shared module modified: ${COLOR.red}${err.file}${COLOR.reset}`);
            console.log(`  - Consumer module un-migrated: ${COLOR.yellow}${err.consumer}${COLOR.reset} (Source: ${err.source})`);
          }
          console.log(`  - Reason: ${err.message}\n`);
        }
        logError('Push aborted. Please update and stage changes for the affected consumer files before pushing.');
        process.exit(1);
      } else {
        logInfo('✓ Sibling consumer interfaces validated successfully. Pre-push gate cleared.');
        process.exit(0);
      }
    }

    // Default 'check' mode: report both cleanly
    if (warnings.length === 0 && errors.length === 0) {
      logInfo('✓ No Sibling Pattern violations detected in active workspace.');
    } else {
      if (warnings.length > 0) {
        console.log(`\n[Drift Warnings]`);
        warnings.forEach(w => console.log(`  - [WARN] ${w.message}`));
      }
      if (errors.length > 0) {
        console.log(`\n[Structural Interface Errors]`);
        errors.forEach(e => console.log(`  - [ERROR] ${e.message}`));
      }
    }
    process.exit(0);

  } catch (err) {
    // Fail-soft during commit hooks, but print error
    logWarn(`Execution suspended: Sibling checks encountered error: ${err.message}. Proceeding cleanly.`);
    process.exit(0);
  }
}

main();
