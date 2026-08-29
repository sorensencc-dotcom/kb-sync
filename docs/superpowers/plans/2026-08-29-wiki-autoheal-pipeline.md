# Wiki Autohealing Sweeper & Path-Isolated Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple vault path resolution, add a manifest-aware autohealing sweeper to eliminate fail-closed validation deadlocks across staged markdown notes, update the contract schema, and surface autohealing telemetry in the validation dashboard.

**Architecture:** A 5-stage modular pipeline where `config-loader.mjs` isolates working directories, `autoheal-sweeper.mjs` idempotently sanitizes frontmatter and rewrites relative wikilinks against indexed basenames, `validate-contract.mjs` enforces zero-tolerance schema contracts, and results feed into `.autoheal-report.json` and `dashboard.html`.

**Tech Stack:** Node.js (ESM), JSON Schema (Draft 07), Vitest / Node test runner.

## Global Constraints

- Never use hardcoded path strings like `C:\dev\wiki`; always resolve via `resolveVaultPaths`.
- All wikilink rewrites must preserve alias labels (`[[Target|Label]]` -> `[[kb-sync/wiki/.../Target|Label]]`) and ignore code blocks.
- Frontmatter injection must default to `category: "wiki"`, `status: "draft"`, and `sourceRepository: "kb-sync"`.
- Adhere strictly to the Technical Writing Heuristics in `AGENTS.md`.

---

### Task 1: Contract Schema Whitelist Updates & Shared Constants

**Files:**
- Modify: `modules/wiki/toolforge-kbsync-contract.json`
- Test: `tests/modules/wiki/validate-contract.test.mjs`

**Interfaces:**
- Produces: Expanded JSON schema whitelist for `sourceRepository`, `category`, and `status`.

- [ ] **Step 1: Write the failing test for schema whitelist validation**

Create or update test in `tests/modules/wiki/contract-schema.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('toolforge-kbsync-contract schema', () => {
  const schemaPath = path.resolve('modules/wiki/toolforge-kbsync-contract.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  it('includes trm and cic-ingestion in sourceRepository enum', () => {
    const repos = schema.properties.sourceRepository.enum;
    expect(repos).toContain('trm');
    expect(repos).toContain('cic-ingestion');
  });

  it('includes research and lessons in category description/whitelist', () => {
    const noteProps = schema.properties.payload.properties.stagingNotes.items.properties.frontmatter.properties;
    expect(noteProps.status.enum).toContain('proposed');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/modules/wiki/contract-schema.test.mjs`
Expected: FAIL on missing `trm` or `proposed` status enum.

- [ ] **Step 3: Update `modules/wiki/toolforge-kbsync-contract.json`**

Expand `sourceRepository` to include `"trm"`, `"cic-ingestion"`, `"castironforge"`, `"sigil"`, and update `status.enum` to include `"proposed"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/wiki/contract-schema.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/wiki/toolforge-kbsync-contract.json tests/modules/wiki/contract-schema.test.mjs
git commit -m "feat(schema): expand sourceRepository and status contract enums"
```

---

### Task 2: Path Resolver Utility (`modules/wiki/config-loader.mjs`)

**Files:**
- Create: `modules/wiki/config-loader.mjs`
- Test: `tests/modules/wiki/config-loader.test.mjs`

**Interfaces:**
- Produces: `export function resolveVaultPaths(args = process.argv, env = process.env)`

- [ ] **Step 1: Write the failing test for config loader**

Create `tests/modules/wiki/config-loader.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveVaultPaths } from '../../modules/wiki/config-loader.mjs';

describe('resolveVaultPaths', () => {
  it('resolves using --vault-root CLI argument', () => {
    const target = 'C:\\dev\\dev-sandbox';
    const paths = resolveVaultPaths(['node', 'script.js', `--vault-root=${target}`], {});
    expect(paths.vaultRoot).toBe(path.resolve(target));
    expect(paths.wikiDir).toBe(path.join(path.resolve(target), 'wiki'));
    expect(paths.stagingDir).toBe(path.join(path.resolve(target), '_kb-sync-staging'));
  });

  it('resolves using VAULT_ROOT env var when no CLI arg present', () => {
    const target = 'C:\\dev\\custom-vault';
    const paths = resolveVaultPaths([], { VAULT_ROOT: target });
    expect(paths.vaultRoot).toBe(path.resolve(target));
    expect(paths.researchDir).toBe(path.join(path.resolve(target), 'wiki', 'research'));
  });

  it('falls back to process.cwd() when no overrides provided', () => {
    const paths = resolveVaultPaths([], {});
    expect(paths.vaultRoot).toBe(path.resolve(process.cwd()));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/modules/wiki/config-loader.test.mjs`
Expected: FAIL with "Cannot find module '../../modules/wiki/config-loader.mjs'".

- [ ] **Step 3: Implement `modules/wiki/config-loader.mjs`**

```javascript
import path from 'node:path';

export function resolveVaultPaths(args = process.argv, env = process.env) {
  const cliArg = args.find(arg => typeof arg === 'string' && arg.startsWith('--vault-root='));
  const cliOverride = cliArg ? cliArg.split('=')[1] : null;
  const envOverride = env.VAULT_ROOT;
  const resolvedRoot = path.resolve(cliOverride || envOverride || process.cwd());

  return {
    vaultRoot: resolvedRoot,
    wikiDir: path.join(resolvedRoot, 'wiki'),
    stagingDir: path.join(resolvedRoot, '_kb-sync-staging'),
    researchDir: path.join(resolvedRoot, 'wiki', 'research'),
    transactDir: path.join(resolvedRoot, `.transact-${Date.now()}`)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/wiki/config-loader.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/wiki/config-loader.mjs tests/modules/wiki/config-loader.test.mjs
git commit -m "feat(wiki): add vault path resolution utility"
```

---

### Task 3: Manifest-Aware Autohealing Engine & Sweeper (`modules/wiki/autoheal-sweeper.mjs`)

**Files:**
- Create: `modules/wiki/autoheal-sweeper.mjs`
- Test: `tests/modules/wiki/autoheal-sweeper.test.mjs`

**Interfaces:**
- Consumes: `resolveVaultPaths` from `./config-loader.mjs`
- Produces: `export function autohealMetadata(filePath, fileContent, options)`
- Produces: `export async function sweepStagingVault(options)`

- [ ] **Step 1: Write failing tests for autoheal transformations**

Create `tests/modules/wiki/autoheal-sweeper.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { autohealMetadata } from '../../modules/wiki/autoheal-sweeper.mjs';

describe('autohealMetadata', () => {
  it('injects missing YAML frontmatter with defaults', () => {
    const raw = '# My Note Title\nSome body text.';
    const result = autohealMetadata('wiki/research/my-note-title.md', raw);
    expect(result.hasChanges).toBe(true);
    expect(result.fileContent).toMatch(/^---\ntitle: "My Note Title"\ncategory: "research"\nstatus: "draft"\nsourceRepository: "kb-sync"\n---/);
  });

  it('normalizes uppercase categories and invalid statuses', () => {
    const raw = '---\ntitle: "Test"\ncategory: "Sync Tools"\nstatus: "WIP"\n---\nBody';
    const result = autohealMetadata('wiki/sync-tools/test.md', raw, {
      categoryWhitelist: ['sync-tools', 'wiki', 'research']
    });
    expect(result.hasChanges).toBe(true);
    expect(result.fileContent).toContain('category: "sync-tools"');
    expect(result.fileContent).toContain('status: "draft"');
    expect(result.fileContent).toContain('sourceRepository: "kb-sync"');
  });

  it('rewrites un-namespaced wikilinks preserving alias labels and code fences', () => {
    const raw = 'See [[KnownTarget|Custom Label]] and `[[CodeLink]]` and [[UnknownTarget]].';
    const vaultIndex = {
      'KnownTarget': 'kb-sync/wiki/daemons/KnownTarget'
    };
    const result = autohealMetadata('wiki/research/caller.md', raw, { vaultIndex });
    expect(result.fileContent).toContain('[[kb-sync/wiki/daemons/KnownTarget|Custom Label]]');
    expect(result.fileContent).toContain('`[[CodeLink]]`');
    expect(result.fileContent).toContain('[[kb-sync/wiki/research/UnknownTarget]]');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/modules/wiki/autoheal-sweeper.test.mjs`
Expected: FAIL with missing module.

- [ ] **Step 3: Implement `modules/wiki/autoheal-sweeper.mjs`**

Implement `autohealMetadata` handling frontmatter injection, status/category sanitization, code-block masking, and manifest-aware link rewriting with alias support. Add CLI entrypoint for standalone runs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/wiki/autoheal-sweeper.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/wiki/autoheal-sweeper.mjs tests/modules/wiki/autoheal-sweeper.test.mjs
git commit -m "feat(wiki): implement manifest-aware autoheal sweeper"
```

---

### Task 4: Validation Gate Integration

**Files:**
- Modify: `modules/wiki/validate-staging-docs.mjs`
- Modify: `modules/wiki/gated-climb-repair.mjs`
- Modify: `scripts/fix-wiki-frontmatter.mjs`
- Modify: `scripts/fix-wiki-links.mjs`

**Interfaces:**
- Consumes: `resolveVaultPaths`, `sweepStagingVault`, `autohealMetadata`

- [ ] **Step 1: Write integration test for pre-pass autohealing**

Create `tests/modules/wiki/validation-gate-autoheal.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sweepStagingVault } from '../../modules/wiki/autoheal-sweeper.mjs';

describe('Validation gate autohealing pre-pass', () => {
  it('heals dirty files in a mock staging directory before validation', async () => {
    const tmpDir = path.resolve('scratch/test-staging');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'dirty.md'), '# Dirty Note\nSee [[LinkTarget]]');

    const report = await sweepStagingVault({
      targetDir: tmpDir,
      vaultIndex: {},
      fix: true
    });

    expect(report.filesHealed).toBe(1);
    const content = fs.readFileSync(path.join(tmpDir, 'dirty.md'), 'utf8');
    expect(content).toContain('category: "wiki"');
    expect(content).toContain('[[kb-sync/wiki/research/LinkTarget]]');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `npx vitest run tests/modules/wiki/validation-gate-autoheal.test.mjs`

- [ ] **Step 3: Update `validate-staging-docs.mjs` and `gated-climb-repair.mjs`**

Integrate `resolveVaultPaths()` and execute `sweepStagingVault({ fix: true })` prior to contract validation checks. Update scripts `fix-wiki-frontmatter.mjs` and `fix-wiki-links.mjs` to delegate to `autoheal-sweeper.mjs`.

- [ ] **Step 4: Run test suite to verify integration**

Run: `npx vitest run tests/modules/wiki/`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/wiki/validate-staging-docs.mjs modules/wiki/gated-climb-repair.mjs scripts/fix-wiki-frontmatter.mjs scripts/fix-wiki-links.mjs tests/modules/wiki/validation-gate-autoheal.test.mjs
git commit -m "feat(wiki): integrate autoheal pre-pass into validation gates"
```

---

### Task 5: Dashboard Telemetry Integration

**Files:**
- Modify: `modules/wiki/dashboard.html`
- Modify: `modules/wiki/validate-staging-docs.mjs` (to include autoheal metrics in `.validation-report.json`)

**Interfaces:**
- Produces: Autoheal telemetry section in dashboard UI rendering metrics from `.autoheal-report.json`.

- [ ] **Step 1: Update report generation in `validate-staging-docs.mjs`**

Include `autohealSummary: { filesScanned, filesHealed, linksRewritten, headersInjected }` in `.validation-report.json`.

- [ ] **Step 2: Update `modules/wiki/dashboard.html`**

Add an "Autohealing Telemetry" metric card displaying files healed and metadata injected in the dashboard UI.

- [ ] **Step 3: Test JSON structure and dashboard loading**

Verify `.validation-report.json` contains `autohealSummary` and that `modules/wiki/dashboard.html` parses and renders without JS errors.

- [ ] **Step 4: Commit**

```bash
git add modules/wiki/dashboard.html modules/wiki/validate-staging-docs.mjs
git commit -m "feat(dashboard): add autohealing telemetry card"
```

---

### Task 6: Live Staging Backfill Verification & End-to-End Run

**Files:**
- Test: Live files in `_kb-sync-staging` / `wiki`

- [ ] **Step 1: Execute autohealing sweeper on staging notes**

Run: `node modules/wiki/autoheal-sweeper.mjs --vault-root=C:\dev\kb-sync --fix`

- [ ] **Step 2: Run contract validation backfill**

Run: `node scripts/wiki-contract-backfill.mjs --dry-run`
Expected: 0 validation errors across all staging files.

- [ ] **Step 3: Run full TRM test suite**

Run: `npm run test:trm`
Expected: PASS.

- [ ] **Step 4: Commit cleaned staging updates and summary report**

```bash
git add .autoheal-report.json .validation-report.json
git commit -m "chore(wiki): sweep and validate staging documentation"
```
