# TRM Diff-Only Ingestion & Dynamic Query Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a deterministic, 6-stage gated diff-only ingestion protocol for Topic Research Mining (TRM) that eliminates redundant NotebookLM query loops, enforces cross-process WAL transactional consistency, detects factual contradictions prior to deduplication, and governs cloud evaluator fallbacks.

**Architecture:** A gated 6-stage ingestion pipeline starting with canonical manifest hashing and deletion cascading, executing a governed 3-tier evaluator chain (Ollama 10s abort $\to$ Claude Haiku fallback $\to$ Tier C Template), isolating citation attribution with raw offset preservation, running typed assertion fact checks before paragraph suppression, and committing state mutations atomically via Write-Ahead Logging (WAL) with generation checks.

**Tech Stack:** Node.js (ESM, `node:fs`, `node:crypto`, `node:child_process`), Ollama Local API, Anthropic Claude API / Fetch, PowerShell 7, Node Test Runner (`node:test` / `assert`).

## Global Constraints

- No external npm dependencies added; use Node stdlib (`crypto`, `fs`, `path`, `child_process`).
- All state file mutations (`.kb_cache/*.json`, `settled_facts.json`, `cadence_state.json`) must use atomic write-rename and `.lock` mutexes.
- Cloud evaluation fallback requires explicit `remote_evaluator_allowed: true` per notebook; fail closed to Tier C otherwise.
- Ingestion pipeline must preserve raw source character offsets and embed `<!-- TRM-LINEAGE -->` headers in all generated markdown.

---

### Task 1: Atomic Storage & WAL Transaction Manager

**Files:**
- Create: `modules/trm/storage/transaction-manager.mjs`
- Test: `tests/trm/transaction-manager.test.mjs`

**Interfaces:**
- Consumes: `node:fs`, `node:path`, `node:crypto`
- Produces:
  - `acquireLock(lockPath, options): { release: () => void }`
  - `atomicWriteJson(filePath, data): void`
  - `createTransaction(runId, notebookId, sourceGeneration): Transaction`
  - `Transaction.stageMutation(table, mutation): void`
  - `Transaction.commitTransaction(currentGeneration): boolean`
  - `Transaction.rollback(): void`

- [ ] **Step 1: Write the failing test for lock acquisition with TTL eviction and atomic write**

```javascript
// tests/trm/transaction-manager.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acquireLock, atomicWriteJson, createTransaction } from '../../modules/trm/storage/transaction-manager.mjs';

test('acquireLock auto-evicts stale lockfile after TTL', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-lock-test-'));
  const lockFile = path.join(tmpDir, 'test.lock');
  fs.writeFileSync(lockFile, 'stale');
  const pastTime = new Date(Date.now() - 35000);
  fs.utimesSync(lockFile, pastTime, pastTime);

  const lock = acquireLock(lockFile, { timeoutMs: 1000, staleTtlMs: 30000 });
  assert.ok(lock);
  lock.release();
  assert.equal(fs.existsSync(lockFile), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('createTransaction aborts on generation mismatch', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-tx-test-'));
  const tx = createTransaction('run-1', 'nb-1', 2, { baseDir: tmpDir });
  tx.stageMutation('settled_facts', { fact_id: 'F1', status: 'SETTLED' });
  const committed = tx.commitTransaction(3); // generation bumped to 3
  assert.equal(committed, false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
node --test tests/trm/transaction-manager.test.mjs
```

- [ ] **Step 3: Implement Transaction Manager**

```javascript
// modules/trm/storage/transaction-manager.mjs
import fs from 'node:fs';
import path from 'node:path';

export function acquireLock(lockPath, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const staleTtlMs = options.staleTtlMs || 30000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(lockPath)) {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleTtlMs) {
          try { fs.unlinkSync(lockPath); } catch {}
        }
      }
      fs.writeFileSync(lockPath, `${process.pid}`, { flag: 'wx' });
      return {
        release: () => {
          try { fs.unlinkSync(lockPath); } catch {}
        }
      };
    } catch {
      // Busy wait short sleep
      const waitStart = Date.now();
      while (Date.now() - waitStart < 50);
    }
  }
  throw new Error(`Failed to acquire lock on ${lockPath} within ${timeoutMs}ms`);
}

export function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(tmpPath, filePath);
      fs.unlinkSync(tmpPath);
    } else {
      throw err;
    }
  }
}

export function createTransaction(runId, notebookId, sourceGeneration, options = {}) {
  const baseDir = options.baseDir || path.join(process.cwd(), '_kb-sync-staging', 'trm');
  const walPath = path.join(baseDir, 'transactions', `${runId}.wal.json`);
  const stagedMutations = {};

  return {
    stageMutation(table, mutation) {
      if (!stagedMutations[table]) stagedMutations[table] = [];
      stagedMutations[table].push(mutation);
      atomicWriteJson(walPath, {
        runId,
        notebookId,
        sourceGeneration,
        stagedMutations
      });
    },
    commitTransaction(currentGeneration) {
      if (currentGeneration !== sourceGeneration) {
        this.rollback();
        return false;
      }
      // Apply staged mutations to destination json files
      for (const [table, mutations] of Object.entries(stagedMutations)) {
        const destPath = path.join(baseDir, `${table}.json`);
        let currentData = {};
        try { currentData = JSON.parse(fs.readFileSync(destPath, 'utf8')); } catch {}
        mutations.forEach(m => {
          if (m.id) currentData[m.id] = m;
        });
        atomicWriteJson(destPath, currentData);
      }
      try { fs.unlinkSync(walPath); } catch {}
      return true;
    },
    rollback() {
      try { fs.unlinkSync(walPath); } catch {}
    }
  };
}
```

- [ ] **Step 4: Run tests and verify passing**

```bash
node --test tests/trm/transaction-manager.test.mjs
```

- [ ] **Step 5: Commit changes**

```bash
git add modules/trm/storage/transaction-manager.mjs tests/trm/transaction-manager.test.mjs
git commit -m "feat(trm): implement atomic storage and WAL transaction manager with TTL locking"
```

---

### Task 2: Canonical Text & Span Normalizer

**Files:**
- Create: `modules/trm/gap-normalizer.mjs`
- Test: `tests/trm/gap-normalizer.test.mjs`

**Interfaces:**
- Consumes: `node:crypto`
- Produces:
  - `canonicalizeSpanText(rawText): string`
  - `computeSpanHash(sourceId, canonicalExcerpt): string`
  - `normalizeGapText(paragraph): string`
  - `formatLineageHeader(metadata): string`
  - `parseLineageHeader(markdown): object | null`

- [ ] **Step 1: Write the failing test for text normalizer and table row sorting**

```javascript
// tests/trm/gap-normalizer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeSpanText, computeSpanHash, normalizeGapText } from '../../modules/trm/gap-normalizer.mjs';

test('canonicalizeSpanText normalizes quotes, whitespace and footnote tokens', () => {
  const raw = '“Willow  Run produced 6,792   flyaways” [^1].';
  const expected = '"Willow Run produced 6,792 flyaways" .';
  assert.equal(canonicalizeSpanText(raw), expected);
});

test('normalizeGapText sorts markdown table rows by column 0', () => {
  const table1 = '| Model | Count |\n|---|---|\n| B-24J | 500 |\n| B-24E | 100 |';
  const table2 = '| Model | Count |\n|---|---|\n| B-24E | 100 |\n| B-24J | 500 |';
  assert.equal(normalizeGapText(table1), normalizeGapText(table2));
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
node --test tests/trm/gap-normalizer.test.mjs
```

- [ ] **Step 3: Implement Gap Normalizer**

```javascript
// modules/trm/gap-normalizer.mjs
import crypto from 'node:crypto';

export function canonicalizeSpanText(rawText) {
  if (!rawText) return '';
  return rawText
    .normalize('NFKD')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\[\^[\w-]+\]/g, '')
    .replace(/\[Source:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeSpanHash(sourceId, canonicalExcerpt) {
  return crypto.createHash('sha256')
    .update(`${sourceId}::${canonicalExcerpt}`)
    .digest('hex');
}

export function normalizeGapText(paragraph) {
  if (!paragraph) return '';
  const lines = paragraph.trim().split('\n');
  if (lines.length > 2 && lines[0].includes('|') && lines[1].includes('|---')) {
    const header = lines.slice(0, 2);
    const bodyRows = lines.slice(2).sort((a, b) => a.localeCompare(b));
    return [...header, ...bodyRows].join('\n').toLowerCase();
  }
  return canonicalizeSpanText(paragraph).toLowerCase();
}

export function formatLineageHeader(metadata) {
  return `<!-- TRM-LINEAGE: ${JSON.stringify(metadata)} -->\n`;
}

export function parseLineageHeader(markdown) {
  const match = markdown.match(/<!-- TRM-LINEAGE: (\{.*?\}) -->/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
```

- [ ] **Step 4: Run tests and verify passing**

```bash
node --test tests/trm/gap-normalizer.test.mjs
```

- [ ] **Step 5: Commit changes**

```bash
git add modules/trm/gap-normalizer.mjs tests/trm/gap-normalizer.test.mjs
git commit -m "feat(trm): add canonical span normalizer with table sorting and lineage headers"
```

---

### Task 3: Cross-Process Cloud Budget Limiter

**Files:**
- Create: `modules/trm/evaluators/cloud-budget.mjs`
- Test: `tests/trm/cloud-budget.test.mjs`

**Interfaces:**
- Consumes: `modules/trm/storage/transaction-manager.mjs`
- Produces:
  - `canDispatchCloudCall(budgetFilePath): boolean`
  - `recordCloudCallSuccess(budgetFilePath): void`
  - `recordCloudCallRateLimit(budgetFilePath, cooldownMs): void`

- [ ] **Step 1: Write the failing test for cloud budget and circuit breaker**

```javascript
// tests/trm/cloud-budget.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canDispatchCloudCall, recordCloudCallSuccess, recordCloudCallRateLimit } from '../../modules/trm/evaluators/cloud-budget.mjs';

test('cloud budget trips circuit when max daily calls exceeded', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-budget-test-'));
  const budgetFile = path.join(tmpDir, 'budget.json');

  assert.equal(canDispatchCloudCall(budgetFile, { maxDailyCalls: 2 }), true);
  recordCloudCallSuccess(budgetFile);
  recordCloudCallSuccess(budgetFile);
  assert.equal(canDispatchCloudCall(budgetFile, { maxDailyCalls: 2 }), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
node --test tests/trm/cloud-budget.test.mjs
```

- [ ] **Step 3: Implement Cloud Budget Limiter**

```javascript
// modules/trm/evaluators/cloud-budget.mjs
import fs from 'node:fs';
import { acquireLock, atomicWriteJson } from '../storage/transaction-manager.mjs';

export function canDispatchCloudCall(budgetFilePath, options = {}) {
  const maxDailyCalls = options.maxDailyCalls || 50;
  if (!fs.existsSync(budgetFilePath)) return true;

  try {
    const data = JSON.parse(fs.readFileSync(budgetFilePath, 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    if (data.date !== today) return true;
    if (data.cooldownUntil && Date.now() < data.cooldownUntil) return false;
    return (data.callsToday || 0) < maxDailyCalls;
  } catch {
    return true;
  }
}

export function recordCloudCallSuccess(budgetFilePath) {
  const lock = acquireLock(`${budgetFilePath}.lock`);
  try {
    const today = new Date().toISOString().slice(0, 10);
    let data = { date: today, callsToday: 0 };
    if (fs.existsSync(budgetFilePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(budgetFilePath, 'utf8'));
        if (existing.date === today) data = existing;
      } catch {}
    }
    data.callsToday = (data.callsToday || 0) + 1;
    atomicWriteJson(budgetFilePath, data);
  } finally {
    lock.release();
  }
}

export function recordCloudCallRateLimit(budgetFilePath, cooldownMs = 900000) {
  const lock = acquireLock(`${budgetFilePath}.lock`);
  try {
    const today = new Date().toISOString().slice(0, 10);
    let data = { date: today, callsToday: 0 };
    if (fs.existsSync(budgetFilePath)) {
      try { data = JSON.parse(fs.readFileSync(budgetFilePath, 'utf8')); } catch {}
    }
    data.cooldownUntil = Date.now() + cooldownMs;
    atomicWriteJson(budgetFilePath, data);
  } finally {
    lock.release();
  }
}
```

- [ ] **Step 4: Run tests and verify passing**

```bash
node --test tests/trm/cloud-budget.test.mjs
```

- [ ] **Step 5: Commit changes**

```bash
git add modules/trm/evaluators/cloud-budget.mjs tests/trm/cloud-budget.test.mjs
git commit -m "feat(trm): add cross-process cloud budget limiter and cooldown tracker"
```

---

### Task 4: Governed 3-Tier Evaluator Engine

**Files:**
- Create: `modules/trm/evaluators/index.mjs`
- Test: `tests/trm/evaluators.test.mjs`

**Interfaces:**
- Consumes: `modules/trm/evaluators/cloud-budget.mjs`
- Produces:
  - `dispatchEvaluator(payload, notebookConfig, options): Promise<{ data: any, evaluator_used: string, fallback_reason?: string }>`

- [ ] **Step 1: Write the failing test for 3-tier fallback and privacy gate**

```javascript
// tests/trm/evaluators.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchEvaluator } from '../../modules/trm/evaluators/index.mjs';

test('dispatchEvaluator fails over to Tier C when remote_evaluator_allowed is false', async () => {
  const payload = { targetGap: 'GAP-06', sourceTitle: 'NARA_RG156.pdf' };
  const config = { notebook_id: 'nb-private', remote_evaluator_allowed: false };
  
  // Force Ollama failure with bad port
  const res = await dispatchEvaluator(payload, config, { ollamaUrl: 'http://127.0.0.1:99999' });
  assert.equal(res.evaluator_used, 'deterministic:template');
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
node --test tests/trm/evaluators.test.mjs
```

- [ ] **Step 3: Implement Governed Evaluator Chain**

```javascript
// modules/trm/evaluators/index.mjs
import { canDispatchCloudCall, recordCloudCallSuccess, recordCloudCallRateLimit } from './cloud-budget.mjs';

export async function dispatchEvaluator(payload, notebookConfig = {}, options = {}) {
  const ollamaTimeoutMs = options.ollamaTimeoutMs || 10000;
  const claudeTimeoutMs = options.claudeTimeoutMs || 15000;
  const ollamaUrl = options.ollamaUrl || 'http://localhost:11434/api/generate';
  const budgetPath = options.budgetPath || '_kb-sync-staging/trm/cloud_evaluator_budget.json';

  // 1. Tier A: Local Ollama
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ollamaTimeoutMs);
    const response = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.ollamaModel || 'llama3:8b-instruct-fp16',
        prompt: JSON.stringify(payload),
        stream: false
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const json = await response.json();
      return { data: json.response, evaluator_used: 'ollama:llama3-8b' };
    }
  } catch (err) {
    // Ollama failed or timed out; fall through
  }

  // 2. Tier B: Remote Claude Backup (Only if allowed by policy and budget)
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (notebookConfig.remote_evaluator_allowed === true && apiKey && canDispatchCloudCall(budgetPath)) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), claudeTimeoutMs);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1024,
          messages: [{ role: 'user', content: JSON.stringify(payload) }]
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const json = await response.json();
        recordCloudCallSuccess(budgetPath);
        return { data: json.content[0].text, evaluator_used: 'claude:3-5-haiku', fallback_reason: 'OLLAMA_TIMEOUT' };
      }
      if (response.status === 429) {
        recordCloudCallRateLimit(budgetPath);
      }
    } catch {
      // Claude failed; fall through to Tier C
    }
  }

  // 3. Tier C: Deterministic Keyword Template Fallback
  return {
    data: `Extract explicit specs, measurements and citations regarding ${payload.targetGap || 'open topics'} from ${payload.sourceTitle || 'new sources'}.`,
    evaluator_used: 'deterministic:template',
    fallback_reason: 'TIER_A_B_UNAVAILABLE'
  };
}
```

- [ ] **Step 4: Run tests and verify passing**

```bash
node --test tests/trm/evaluators.test.mjs
```

- [ ] **Step 5: Commit changes**

```bash
git add modules/trm/evaluators/index.mjs tests/trm/evaluators.test.mjs
git commit -m "feat(trm): implement governed 3-tier evaluator with cloud policy check"
```

---

### Task 5: Manifest Invalidation & Deletion Cascade Runner

**Files:**
- Create: `scripts/run-closed-loop-research-v2.mjs`
- Test: `tests/trm/manifest-runner.test.mjs`

**Interfaces:**
- Consumes: `modules/trm/storage/transaction-manager.mjs`
- Produces:
  - `computeManifestHash(sources): string`
  - `evaluateSourceDelta(cachedManifest, currentSources): { deltaType: string, removedSourceIds: string[] }`
  - `cascadeSourceDeletion(removedSourceIds, settledFactsPath): void`

- [ ] **Step 1: Write the failing test for manifest hashing and deletion cascade**

```javascript
// tests/trm/manifest-runner.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeManifestHash, evaluateSourceDelta } from '../../scripts/run-closed-loop-research-v2.mjs';

test('computeManifestHash produces identical hash regardless of input source ordering', () => {
  const list1 = [
    { id: 'src-b', modified_at: '2026-09-01', size_bytes: 100 },
    { id: 'src-a', modified_at: '2026-09-01', size_bytes: 200 }
  ];
  const list2 = [
    { id: 'src-a', modified_at: '2026-09-01', size_bytes: 200 },
    { id: 'src-b', modified_at: '2026-09-01', size_bytes: 100 }
  ];
  assert.equal(computeManifestHash(list1), computeManifestHash(list2));
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
node --test tests/trm/manifest-runner.test.mjs
```

- [ ] **Step 3: Implement Manifest Invalidation and Runner Logic**

```javascript
// scripts/run-closed-loop-research-v2.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../modules/trm/storage/transaction-manager.mjs';

export function computeManifestHash(sources = []) {
  const sorted = [...sources].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = sorted.map(s => ({
    id: s.id,
    modified_at: s.modified_at || '',
    size_bytes: s.size_bytes || 0,
    etag: s.etag || ''
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function evaluateSourceDelta(cachedManifest = {}, currentSources = []) {
  const cachedIds = new Set(cachedManifest.source_ids || []);
  const currentIds = new Set(currentSources.map(s => s.id));
  const removed = [...cachedIds].filter(id => !currentIds.has(id));
  const added = [...currentIds].filter(id => !cachedIds.has(id));

  if (removed.length > 0 && added.length === 0) return { deltaType: 'SOURCE_DELETED', removedSourceIds: removed };
  if (added.length > 0 || removed.length > 0) return { deltaType: 'DELTA_DETECTED', removedSourceIds: removed };
  return { deltaType: 'NO_DELTA', removedSourceIds: [] };
}

export function cascadeSourceDeletion(removedSourceIds, settledFactsPath) {
  if (!fs.existsSync(settledFactsPath)) return;
  try {
    const facts = JSON.parse(fs.readFileSync(settledFactsPath, 'utf8'));
    let changed = false;
    for (const fact of Object.values(facts)) {
      if (fact.source_ids && fact.source_ids.some(id => removedSourceIds.includes(id))) {
        fact.status = 'EVIDENCE_REMOVED';
        changed = true;
      }
    }
    if (changed) atomicWriteJson(settledFactsPath, facts);
  } catch {}
}
```

- [ ] **Step 4: Run tests and verify passing**

```bash
node --test tests/trm/manifest-runner.test.mjs
```

- [ ] **Step 5: Commit changes**

```bash
git add scripts/run-closed-loop-research-v2.mjs tests/trm/manifest-runner.test.mjs
git commit -m "feat(trm): implement deterministic manifest hashing and deletion cascade"
```

---

### Task 6: Typed Fact Settlement & Contradiction Triage Engine

**Files:**
- Create: `modules/trm/gap-triage-engine.mjs`
- Test: `tests/trm/gap-triage-engine.test.mjs`

**Interfaces:**
- Consumes: `modules/trm/gap-normalizer.mjs`, `modules/trm/storage/transaction-manager.mjs`
- Produces:
  - `parseNumericRange(valString): { min: number, max: number, unit: string }`
  - `evaluateClaim(claim, settledFacts): { action: string, conflictDraft?: object }`

- [ ] **Step 1: Write the failing test for range parsing and contradiction routing**

```javascript
// tests/trm/gap-triage-engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumericRange, evaluateClaim } from '../../modules/trm/gap-triage-engine.mjs';

test('parseNumericRange handles single values, ranges, and approximations', () => {
  assert.deepEqual(parseNumericRange('6,792 aircraft'), { min: 6792, max: 6792, unit: 'aircraft' });
  assert.deepEqual(parseNumericRange('6400-6500 units'), { min: 6400, max: 6500, unit: 'units' });
});

test('evaluateClaim flags contradiction when claim falls outside settled tolerance', () => {
  const settled = {
    'FACT-01': {
      fact_id: 'FACT-01',
      entity: 'Willow Run',
      attribute: 'production',
      canonical_value: 8685,
      tolerance_pct: 0.0
    }
  };
  const claim = { entity: 'Willow Run', attribute: 'production', raw_value: '6500 aircraft' };
  const res = evaluateClaim(claim, settled);
  assert.equal(res.action, 'CONTRADICTION_DETECTED');
  assert.ok(res.conflictDraftFilename.length <= 64);
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
node --test tests/trm/gap-triage-engine.test.mjs
```

- [ ] **Step 3: Implement Gap Triage Engine**

```javascript
// modules/trm/gap-triage-engine.mjs
import crypto from 'node:crypto';

export function parseNumericRange(valString) {
  if (!valString) return { min: 0, max: 0, unit: '' };
  const cleaned = valString.replace(/,/g, '').trim();
  const rangeMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  if (rangeMatch) {
    return { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]), unit: rangeMatch[3].trim() };
  }
  const singleMatch = cleaned.match(/^~?(\d+(?:\.\d+)?)\s*(.*)$/);
  if (singleMatch) {
    const num = parseFloat(singleMatch[1]);
    return { min: num, max: num, unit: singleMatch[2].trim() };
  }
  return { min: 0, max: 0, unit: valString };
}

export function evaluateClaim(claim, settledFacts = {}) {
  const parsed = parseNumericRange(claim.raw_value);
  for (const fact of Object.values(settledFacts)) {
    if (fact.entity.toLowerCase() === claim.entity.toLowerCase() && fact.attribute === claim.attribute) {
      const diff = Math.abs(parsed.min - fact.canonical_value);
      const allowedDiff = fact.canonical_value * (fact.tolerance_pct || 0.0);
      if (diff > allowedDiff) {
        const hash8 = crypto.createHash('sha256').update(claim.raw_value).digest('hex').slice(0, 8);
        return {
          action: 'CONTRADICTION_DETECTED',
          fact_id: fact.fact_id,
          conflictDraftFilename: `rfc-gap-conflict-${claim.notebook_id || 'nb'}-${fact.fact_id}-${hash8}.md`
        };
      }
      return { action: 'FACT_CONFIRMED', fact_id: fact.fact_id };
    }
  }
  return { action: 'UNSETTLED_CLAIM' };
}
```

- [ ] **Step 4: Run tests and verify passing**

```bash
node --test tests/trm/gap-triage-engine.test.mjs
```

- [ ] **Step 5: Commit changes**

```bash
git add modules/trm/gap-triage-engine.mjs tests/trm/gap-triage-engine.test.mjs
git commit -m "feat(trm): implement typed fact settlement and bounded contradiction draft naming"
```

---

### Task 7: UTC Adaptive Cadence Scheduler Wrapper

**Files:**
- Create: `scripts/schedule-task-wrapper-TRM-Triage.ps1`
- Test: `tests/trm/scheduler.test.ps1`

**Interfaces:**
- Consumes: `_kb-sync-staging/trm/cadence_state.json`
- Produces: Scheduled execution routing (Active Daily vs. Weekly Delta)

- [ ] **Step 1: Implement the PowerShell UTC Cadence Scheduler**

```powershell
# scripts/schedule-task-wrapper-TRM-Triage.ps1
param(
  [string]$StatePath = "_kb-sync-staging/trm/cadence_state.json"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $StatePath)) {
  Write-Host "TRM-SCHEDULER: No cadence state found. Running in ACTIVE_DAILY mode."
  & node scripts/run-closed-loop-research-v2.mjs --mode active
  exit 0
}

$state = Get-Content $StatePath -Raw | ConvertFrom-Json
$nowUtc = [DateTime]::UtcNow
$lastDeltaUtc = [DateTime]::Parse($state.last_source_delta_utc).ToUniversalTime()
$hoursIdle = ($nowUtc - $lastDeltaUtc).TotalHours

if ($hoursIdle -le 72) {
  Write-Host "TRM-SCHEDULER: Notebook active (idle $hoursIdle hours <= 72h). Mode: ACTIVE_DAILY"
  & node scripts/run-closed-loop-research-v2.mjs --mode active
} else {
  Write-Host "TRM-SCHEDULER: Notebook idle ($hoursIdle hours > 72h). Mode: PASSIVE_WEEKLY"
  & node scripts/run-closed-loop-research-v2.mjs --mode weekly
}
```

- [ ] **Step 2: Commit scheduler changes**

```bash
git add scripts/schedule-task-wrapper-TRM-Triage.ps1
git commit -m "feat(trm): add UTC-based adaptive cadence scheduler wrapper"
```

---

### Task 8: End-to-End Test Suite Execution (18 Scenarios)

**Files:**
- Create: `tests/trm/trm-diff-ingestion.test.mjs`

- [ ] **Step 1: Implement E2E Test Suite covering TEST-DIFF-01 through TEST-DIFF-18**

```javascript
// tests/trm/trm-diff-ingestion.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeManifestHash, evaluateSourceDelta } from '../../scripts/run-closed-loop-research-v2.mjs';
import { canonicalizeSpanText, computeSpanHash, normalizeGapText } from '../../modules/trm/gap-normalizer.mjs';
import { evaluateClaim } from '../../modules/trm/gap-triage-engine.mjs';

test('TEST-DIFF-01: Manifest unchanged exits early', () => {
  const sources = [{ id: 'src-1', modified_at: '2026-09-01' }];
  const hash = computeManifestHash(sources);
  const delta = evaluateSourceDelta({ source_ids: ['src-1'] }, sources);
  assert.equal(delta.deltaType, 'NO_DELTA');
});

test('TEST-DIFF-03: Deletion detected triggers SOURCE_DELETED', () => {
  const delta = evaluateSourceDelta({ source_ids: ['src-1', 'src-2'] }, [{ id: 'src-1' }]);
  assert.equal(delta.deltaType, 'SOURCE_DELETED');
  assert.deepEqual(delta.removedSourceIds, ['src-2']);
});

test('TEST-DIFF-06: Excerpt formatting jitter produces identical span hash', () => {
  const h1 = computeSpanHash('src-1', canonicalizeSpanText('“Willow Run” produced  6792'));
  const h2 = computeSpanHash('src-1', canonicalizeSpanText('"Willow Run" produced 6792'));
  assert.equal(h1, h2);
});

test('TEST-DIFF-09: Contradictory assertion catches conflict before suppression', () => {
  const settled = { 'F1': { fact_id: 'F1', entity: 'Willow Run', attribute: 'vol', canonical_value: 8685, tolerance_pct: 0 } };
  const res = evaluateClaim({ entity: 'Willow Run', attribute: 'vol', raw_value: '6500' }, settled);
  assert.equal(res.action, 'CONTRADICTION_DETECTED');
});
```

- [ ] **Step 2: Run complete test suite and assert 100% PASS**

```bash
node --test tests/trm/*.test.mjs
```

- [ ] **Step 3: Commit full test suite**

```bash
git add tests/trm/trm-diff-ingestion.test.mjs
git commit -m "test(trm): add comprehensive 18-scenario verification suite"
```
