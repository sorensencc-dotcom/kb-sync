/**
 * One explicit, restart-safe path through the EXISTING documentation pipeline:
 *
 *   source_checked -> generation_complete -> content_validated -> publication_prepared
 *                  -> indexing_complete -> publication_verified
 *
 * Each stage reuses an existing component (entity synthesizer, wiki contract
 * validator, GitHub-wiki publisher, SQLite/FTS5 cache sync). This file adds no
 * scheduler and no new store: it sequences them, records a distinct status per
 * stage in `.pipeline-state.json`, and refuses to report HEALTHY unless every
 * required stage succeeded against the CURRENT source bytes.
 *
 * Run:  npm run kb:pipeline:e2e            (local stages; publication not requested)
 *       npm run kb:pipeline:e2e -- --publish   (also pushes + verifies the remote wiki)
 *       npm run kb:pipeline:status         (read-only: is what we have current?)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  checkGeneratedFreshness,
  computeSourceInputs,
  synthesizeAllEntities,
  ENTITY_GENERATION_KIND,
  type EntitySynthesisResult,
} from './entity-synthesizer.ts';
import { GENERATED_MANIFEST_NAME, readOwnershipManifest, sha256Text, toPosix, writeJsonAtomic } from './generated-ownership.mjs';
import { DEFAULT_RECEIPT_MAX_AGE_MS, evaluateReceiptFreshness } from './cross-repo-drift-scanner.ts';
import { publishWiki, deriveWikiSshUrl } from '../../scripts/sync-github-wiki.mjs';
import { redactCredentialsInText } from './credential-redaction.mjs';
import { syncKnowledgeCache } from '../cache/sync-cache.mjs';
import { getDatabase } from '../cache/db-schema.mjs';

const __filename = fileURLToPath(import.meta.url);
const KB_SYNC_ROOT = path.resolve(path.dirname(__filename), '../..');

export const STAGES = [
  'source_checked',
  'generation_complete',
  'content_validated',
  'publication_prepared',
  'indexing_complete',
  'publication_verified',
] as const;
export type StageName = (typeof STAGES)[number];

export interface StageRecord {
  status: 'ok' | 'failed' | 'skipped' | 'not_run';
  resumed?: boolean;
  at?: string;
  /** What this stage's result was computed from. A different key means the result is stale. */
  key?: string;
  detail?: string;
  error?: string;
}

export type PipelineOverall = 'HEALTHY' | 'LOCAL_ONLY' | 'DEGRADED' | 'FAILED' | 'IN_PROGRESS';

export interface PipelineState {
  version: 1;
  repository: string;
  run_id: string;
  started_at: string;
  finished_at?: string;
  mode: { publish: boolean; semantic: string | null };
  sources_hash: string | null;
  outputs_hash: string | null;
  /** What the generation stage actually produced. Entity pages are metadata inventories, never semantic prose. */
  generation_kind: typeof ENTITY_GENERATION_KIND;
  semantic_regeneration: string;
  stages: Record<StageName, StageRecord>;
  overall: PipelineOverall;
  reasons: string[];
}

export interface PipelineOptions {
  repoRoot?: string;
  repoName?: string;
  wikiDir?: string;
  dbPath?: string;
  statePath?: string;
  publish?: boolean;
  remoteWikiUrl?: string;
  force?: boolean;
  /** Run the existing obsidian synthesis path (e.g. 'offline-template') as part of generation. */
  semanticProvider?: string | null;
  receiptMaxAgeMs?: number;
  now?: () => number;
  /** Seams (defaults run the repo's real scripts). */
  detectDrift?: (repoRoot: string) => { status: string; stale_pages_count: number } | null;
  validateContract?: (repoRoot: string) => { ok: boolean; detail: string };
  runSemantic?: (repoRoot: string, provider: string) => { ok: boolean; detail: string };
  synthesize?: typeof synthesizeAllEntities;
}

function resolveOptions(options: PipelineOptions) {
  const repoRoot = path.resolve(options.repoRoot || KB_SYNC_ROOT);
  return {
    repoRoot,
    repoName: options.repoName || path.basename(repoRoot),
    wikiDir: path.resolve(options.wikiDir || path.join(repoRoot, 'wiki')),
    dbPath: path.resolve(options.dbPath || path.join(repoRoot, '.kb_cache', 'knowledge.db')),
    statePath: path.resolve(options.statePath || path.join(repoRoot, '.pipeline-state.json')),
    lockPath: path.join(repoRoot, '.pipeline.lock'),
    publish: !!options.publish,
    maxAge: options.receiptMaxAgeMs ?? DEFAULT_RECEIPT_MAX_AGE_MS,
    now: options.now ?? Date.now,
  };
}

function gitHead(repoRoot: string): string | null {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  return r.status === 0 && out ? out : null;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

const IS_WIN = process.platform === 'win32';

function defaultDetectDrift(repoRoot: string) {
  const script = path.join(repoRoot, 'modules', 'wiki', 'detect-drift.ts');
  if (!fs.existsSync(script)) return null;
  const startedAt = Date.now();
  const r = spawnSync(IS_WIN ? 'npx.cmd' : 'npx', ['tsx', 'modules/wiki/detect-drift.ts'], { cwd: repoRoot, encoding: 'utf8', shell: IS_WIN });
  if (r.status !== 0) throw new Error(`drift detection exited ${r.status}`);
  const report = readJson<any>(path.join(repoRoot, '.drift-report.json'));
  const ts = Date.parse(report?.timestamp);
  if (!report || isNaN(ts) || ts < startedAt - 5000) throw new Error('drift detection did not produce a fresh .drift-report.json');
  return { status: String(report.status), stale_pages_count: Number(report.summary?.stale_pages_count ?? 0) };
}

function defaultValidateContract(repoRoot: string) {
  const pkg = readJson<any>(path.join(repoRoot, 'package.json'));
  if (!pkg?.scripts?.['wiki:validate-contract']) return { ok: true, detail: 'no wiki:validate-contract script in repo (external contract validation skipped)' };
  const r = spawnSync(IS_WIN ? 'npm.cmd' : 'npm', ['run', 'wiki:validate-contract'], { cwd: repoRoot, encoding: 'utf8', shell: IS_WIN });
  return { ok: r.status === 0, detail: `npm run wiki:validate-contract exited ${r.status}` };
}

function defaultRunSemantic(repoRoot: string, provider: string) {
  const r = spawnSync('bash', ['modules/obsidian/ingest-wiki.sh', '--provider', provider], { cwd: repoRoot, encoding: 'utf8' });
  return { ok: r.status === 0, detail: `bash modules/obsidian/ingest-wiki.sh --provider ${provider} exited ${r.status}` };
}

function acquireLock(lockPath: string, now: number) {
  const tryOnce = () => {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now }));
    fs.closeSync(fd);
  };
  try {
    tryOnce();
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;
    const held = readJson<{ pid: number; at: number }>(lockPath);
    let alive = false;
    if (held?.pid) {
      try {
        process.kill(held.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (alive && held && now - held.at < 6 * 3600 * 1000) throw new Error(`PIPELINE_LOCKED: another run (pid ${held.pid}) is in progress`);
    fs.rmSync(lockPath, { force: true }); // stale lock from a crashed run: safe to take over
    tryOnce();
  }
}

export function emptyStages(): Record<StageName, StageRecord> {
  return Object.fromEntries(STAGES.map((s) => [s, { status: 'not_run' }])) as Record<StageName, StageRecord>;
}

/** Generated pages recorded in the ownership manifest (entity pages and, with allKinds, legacy alias pages). */
function entityPageIds(wikiDir: string, allKinds = false) {
  const manifest = readOwnershipManifest(path.join(wikiDir, GENERATED_MANIFEST_NAME)) as any;
  const pages: Array<{ rel: string; sha256: string }> = [];
  for (const [rel, e] of Object.entries<any>(manifest?.files ?? {})) {
    if ((allKinds || e.kind === 'entity') && !e.orphanedEdited) pages.push({ rel, sha256: e.sha256 });
  }
  return pages;
}

export async function runPipeline(options: PipelineOptions = {}): Promise<PipelineState> {
  const o = resolveOptions(options);
  const synthesize = options.synthesize || synthesizeAllEntities;
  const detectDrift = options.detectDrift || defaultDetectDrift;
  const validateContract = options.validateContract || defaultValidateContract;
  const runSemantic = options.runSemantic || defaultRunSemantic;
  const semantic = options.semanticProvider || null;

  acquireLock(o.lockPath, o.now());
  try {
    const prev = readJson<PipelineState>(o.statePath);
    const state: PipelineState = {
      version: 1,
      repository: o.repoName,
      run_id: `${new Date(o.now()).toISOString()}-${process.pid}`,
      started_at: new Date(o.now()).toISOString(),
      mode: { publish: o.publish, semantic },
      sources_hash: null,
      outputs_hash: null,
      generation_kind: ENTITY_GENERATION_KIND,
      semantic_regeneration: 'not_performed',
      stages: emptyStages(),
      overall: 'IN_PROGRESS',
      reasons: [],
    };
    // Written first: a crash from here on leaves an IN_PROGRESS record, never a stale "healthy" one.
    const save = () => writeJsonAtomic(o.statePath, state);
    save();

    let blockedBy: StageName | null = null;
    const stamp = () => new Date(o.now()).toISOString();

    async function stage(
      name: StageName,
      key: string | null,
      fn: () => Promise<string | void> | string | void,
      resume?: () => boolean,
    ) {
      if (blockedBy) {
        state.stages[name] = { status: 'not_run', detail: `blocked: ${blockedBy} did not succeed` };
        save();
        return;
      }
      const p = prev?.stages?.[name];
      if (resume && !options.force && p?.status === 'ok' && p.key === key && resume()) {
        state.stages[name] = { ...p, resumed: true };
        save();
        return;
      }
      try {
        const detail = await fn();
        state.stages[name] = { status: 'ok', at: stamp(), key: key ?? undefined, detail: detail || undefined };
      } catch (err: any) {
        // Stage errors are persisted to .pipeline-state.json; git failures quote the remote URL, token included.
        const msg = redactCredentialsInText(String(err?.message || err), options.remoteWikiUrl, process.env.WIKI_REPO_URL);
        state.stages[name] = { status: 'failed', at: stamp(), key: key ?? undefined, error: msg };
        state.reasons.push(`${name}: ${msg}`);
        blockedBy = name;
      }
      save();
    }

    // 1. source_checked: fingerprint the exact generation inputs (+ drift, informational).
    let sourcesHash = '';
    await stage('source_checked', null, () => {
      const inputs = computeSourceInputs(o.repoName, o.repoRoot);
      const count = Object.keys(inputs.entries).length;
      if (count === 0) throw new Error('NO_SOURCES: no source files found to document');
      sourcesHash = inputs.sourcesHash;
      state.sources_hash = sourcesHash;
      const before = checkGeneratedFreshness({ repoName: o.repoName, repoRoot: o.repoRoot, targetWikiDir: o.wikiDir });
      let drift = 'drift detection unavailable';
      const d = detectDrift(o.repoRoot);
      if (d) drift = `drift=${d.status} stale_pages=${d.stale_pages_count}`;
      return `${count} sources, hash ${sourcesHash.slice(0, 12)}; generated pages before: stale=${before.stale.length} missing=${before.missing.length} orphaned=${before.orphaned.length}; ${drift}`;
    });
    if (state.stages.source_checked.status === 'ok') state.stages.source_checked.key = sourcesHash;

    // 2. generation_complete (REQUIRED): entity pages (metadata inventory) + optional existing semantic path.
    let gen: EntitySynthesisResult | null = null;
    await stage(
      'generation_complete',
      sourcesHash,
      () => {
        gen = synthesize({ repoName: o.repoName, repoRoot: o.repoRoot, targetWikiDir: o.wikiDir });
        if (gen.status !== 'OK') {
          throw new Error(`entity synthesis failed for ${gen.failures.length} file(s): ${gen.failures.slice(0, 3).map((f) => `${f.file} (${f.stage})`).join(', ')}`);
        }
        state.outputs_hash = gen.outputsHash;
        let semDetail = 'semantic regeneration: not performed (entity pages are metadata-only)';
        if (semantic) {
          const sem = runSemantic(o.repoRoot, semantic);
          if (!sem.ok) throw new Error(`semantic synthesis (${semantic}) failed: ${sem.detail}`);
          state.semantic_regeneration = semantic === 'offline-template' ? 'offline-template (template drafts, no LLM)' : semantic;
          semDetail = `semantic regeneration via existing path: ${state.semantic_regeneration}`;
        }
        return `generated=${gen.entitiesGenerated} updated=${gen.entitiesUpdated} unchanged=${gen.entitiesUnchanged} removed=${gen.removed.length} preserved_edited=${gen.preservedModified.length}; ${semDetail}`;
      },
      () => {
        if (semantic) return false; // a requested semantic run is never skipped on resume
        const f = checkGeneratedFreshness({ repoName: o.repoName, repoRoot: o.repoRoot, targetWikiDir: o.wikiDir });
        return f.fresh;
      },
    );
    if (state.stages.generation_complete.resumed) {
      state.outputs_hash = prev?.outputs_hash ?? null;
      state.semantic_regeneration = prev?.semantic_regeneration ?? 'not_performed';
    }
    const outputsHash = state.outputs_hash ?? '';
    const downstreamKey = sha256Text(`${sourcesHash}\0${outputsHash}`);

    // 3. content_validated (REQUIRED): generated pages match the manifest and the current sources; contract validator passes.
    await stage(
      'content_validated',
      downstreamKey,
      () => {
        const f = checkGeneratedFreshness({ repoName: o.repoName, repoRoot: o.repoRoot, targetWikiDir: o.wikiDir });
        if (!f.fresh) {
          throw new Error(`generated pages not current: stale=${f.stale.length} missing=${f.missing.length} orphaned=${f.orphaned.length} tampered=${f.tampered.length}`);
        }
        const c = validateContract(o.repoRoot);
        if (!c.ok) throw new Error(`wiki contract validation failed: ${c.detail}`);
        return `${entityPageIds(o.wikiDir).length} entity pages match manifest and sources; ${c.detail}; preserved edited orphans=${f.preservedOrphans.length}`;
      },
      () => checkGeneratedFreshness({ repoName: o.repoName, repoRoot: o.repoRoot, targetWikiDir: o.wikiDir }).fresh,
    );

    // 4. publication_prepared: build the publish tree locally (secret scan gate included). Writes nothing remote.
    await stage(
      'publication_prepared',
      downstreamKey,
      async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-publish-prep-'));
        try {
          const receipt = await publishWiki({ repoRoot: o.repoRoot, repoName: o.repoName, sourceDir: o.wikiDir, buildOnly: tmp, repoUrl: 'prepare-only' });
          if (receipt.sync_status !== 'PREPARED_NOT_PUSHED') throw new Error(`unexpected prepare status ${receipt.sync_status}`);
          const missing = entityPageIds(o.wikiDir).filter((p) => !fs.existsSync(path.join(tmp, p.rel)));
          if (missing.length > 0) throw new Error(`publish tree is missing ${missing.length} entity page(s), e.g. ${missing[0].rel}`);
          return `prepared ${receipt.total_pages_published} files; flat-name collisions skipped=${receipt.flat_name_collisions}`;
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
      () => false, // cheap and side-effect free: always re-run so the scan gate is never skipped
    );

    // 5. indexing_complete (REQUIRED): refresh the SQLite/FTS5 cache and prove each current page is indexed at its current hash.
    await stage('indexing_complete', downstreamKey, () => {
      const stats = syncKnowledgeCache({ repoRoot: o.repoRoot, dbPath: o.dbPath });
      const pages = entityPageIds(o.wikiDir, true);
      const db = getDatabase(o.dbPath);
      try {
        const missing: string[] = [];
        const stale: string[] = [];
        const wanted = new Set<string>();
        for (const p of pages) {
          const id = toPosix(path.relative(o.repoRoot, path.join(o.wikiDir, p.rel)));
          wanted.add(id);
          const row = db.prepare('SELECT sha256 FROM kb_documents WHERE id = ?').get(id) as { sha256: string } | undefined;
          if (!row) missing.push(id);
          else if (row.sha256 !== p.sha256) stale.push(id);
        }
        const entitiesPrefix = toPosix(path.relative(o.repoRoot, path.join(o.wikiDir, 'entities'))) + '/';
        // Anything still indexed under entities/ whose file no longer exists is an obsolete retrieval hit.
        const indexedExtras = (db.prepare('SELECT id FROM kb_documents WHERE id LIKE ?').all(`${entitiesPrefix}%`) as Array<{ id: string }>)
          .map((r) => r.id)
          .filter((id) => !wanted.has(id) && !fs.existsSync(path.join(o.repoRoot, id)));
        if (missing.length || stale.length || indexedExtras.length) {
          throw new Error(`index not current: missing=${missing.length} stale=${stale.length} obsolete_indexed=${indexedExtras.length}${missing[0] ? ` (e.g. ${missing[0]})` : ''}`);
        }
        return `indexed ${pages.length} generated pages (inserted=${stats.inserted} updated=${stats.updated} deleted=${stats.deleted})`;
      } finally {
        db.close();
      }
    });

    // 6. publication_verified: only when requested; the remote head is verified and the receipt must be fresh.
    if (!o.publish) {
      const receipt = readJson<any>(path.join(o.repoRoot, '.wiki-sync-receipt.json'));
      const f = receipt ? evaluateReceiptFreshness(receipt, gitHead(o.repoRoot), { maxAgeMs: o.maxAge, now: o.now(), repository: o.repoName }) : null;
      state.stages.publication_verified = {
        status: 'skipped',
        detail: `publication not requested (use --publish). Existing receipt: ${!receipt ? 'none' : f?.fresh ? 'fresh' : `NOT current (${f?.reasons.join('; ')})`}`,
      };
      save();
    } else {
      await stage('publication_verified', downstreamKey, async () => {
        const url = options.remoteWikiUrl || process.env.WIKI_REPO_URL || deriveWikiSshUrl(o.repoRoot);
        const receipt = await publishWiki({ repoRoot: o.repoRoot, repoName: o.repoName, sourceDir: o.wikiDir, targetDir: path.join(o.repoRoot, '.wiki-publish-temp'), push: true, repoUrl: url });
        const onDisk = readJson<any>(path.join(o.repoRoot, '.wiki-sync-receipt.json')) ?? receipt;
        const f = evaluateReceiptFreshness(onDisk, gitHead(o.repoRoot), { maxAgeMs: o.maxAge, now: o.now(), repository: o.repoName });
        if (!f.fresh) throw new Error(`receipt cannot establish current freshness: ${f.reasons.join('; ')}`);
        return `${onDisk.sync_status}; remote wiki head ${String(onDisk.remote_wiki_head).slice(0, 12)} verified against remote`;
      });
    }

    const failed = STAGES.filter((s) => state.stages[s].status === 'failed');
    if (failed.length > 0) state.overall = 'FAILED';
    else state.overall = o.publish ? 'HEALTHY' : 'LOCAL_ONLY';
    state.finished_at = stamp();
    save();
    return state;
  } finally {
    fs.rmSync(o.lockPath, { force: true });
  }
}

export interface PipelineStatus {
  overall: PipelineOverall;
  reasons: string[];
  state: PipelineState | null;
}

/**
 * Read-only: is what the last run produced still current? Never writes, never runs a stage.
 * HEALTHY/LOCAL_ONLY is only returned when the recorded run succeeded AND the sources, generated pages and
 * (for publish runs) the sync receipt are all still current.
 */
export function evaluatePipelineStatus(options: PipelineOptions = {}): PipelineStatus {
  const o = resolveOptions(options);
  const state = readJson<PipelineState>(o.statePath);
  const reasons: string[] = [];
  if (!state) return { overall: 'DEGRADED', reasons: ['NO_PIPELINE_RUN_RECORDED'], state: null };

  if (state.overall === 'IN_PROGRESS' || !state.finished_at) reasons.push('RUN_INTERRUPTED_OR_IN_PROGRESS');
  const failed = STAGES.filter((s) => state.stages[s]?.status === 'failed');
  for (const s of failed) reasons.push(`STAGE_FAILED: ${s}: ${state.stages[s].error ?? ''}`);
  for (const s of STAGES) {
    if (s === 'publication_verified' && !state.mode.publish) continue;
    if (state.stages[s]?.status === 'not_run' || state.stages[s] === undefined) reasons.push(`STAGE_NOT_RUN: ${s}`);
  }

  const current = computeSourceInputs(o.repoName, o.repoRoot).sourcesHash;
  if (state.sources_hash !== current) reasons.push('SOURCES_CHANGED_SINCE_LAST_RUN');
  const fresh = checkGeneratedFreshness({ repoName: o.repoName, repoRoot: o.repoRoot, targetWikiDir: o.wikiDir });
  if (!fresh.fresh) reasons.push(`GENERATED_PAGES_NOT_CURRENT: stale=${fresh.stale.length} missing=${fresh.missing.length} orphaned=${fresh.orphaned.length} tampered=${fresh.tampered.length}`);

  if (state.mode.publish) {
    const receipt = readJson<any>(path.join(o.repoRoot, '.wiki-sync-receipt.json'));
    const f = evaluateReceiptFreshness(receipt, gitHead(o.repoRoot), { maxAgeMs: o.maxAge, now: o.now(), repository: o.repoName });
    if (!f.fresh) reasons.push(`PUBLICATION_NOT_CURRENT: ${f.reasons.join('; ')}`);
  }

  if (reasons.length === 0) return { overall: state.overall, reasons, state };
  return { overall: failed.length > 0 ? 'FAILED' : 'DEGRADED', reasons, state };
}

function parseCli(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hours = val('--max-receipt-age-hours');
  return {
    status: argv.includes('--status'),
    json: argv.includes('--json'),
    requirePublished: argv.includes('--require-published'),
    options: {
      repoRoot: val('--repo-root'),
      dbPath: val('--db'),
      remoteWikiUrl: val('--remote-url'),
      semanticProvider: val('--semantic') ?? null,
      publish: argv.includes('--publish'),
      force: argv.includes('--force'),
      receiptMaxAgeMs: hours ? Number(hours) * 3600 * 1000 : undefined,
    } as PipelineOptions,
  };
}

if (process.argv[1] && process.argv[1].endsWith('pipeline-runner.ts')) {
  const cli = parseCli(process.argv.slice(2));
  const done = (overall: PipelineOverall, payload: unknown) => {
    if (cli.json) console.log(JSON.stringify(payload, null, 2));
    const ok = overall === 'HEALTHY' || (overall === 'LOCAL_ONLY' && !cli.requirePublished);
    process.exitCode = ok ? 0 : 1;
  };
  if (cli.status) {
    const s = evaluatePipelineStatus(cli.options);
    console.log(`[PIPELINE] status=${s.overall}${s.reasons.length ? `\n  - ${s.reasons.join('\n  - ')}` : ''}`);
    done(s.overall, s);
  } else {
    runPipeline(cli.options)
      .then((state) => {
        for (const s of STAGES) console.log(`[PIPELINE] ${s.padEnd(22)} ${state.stages[s].status}${state.stages[s].resumed ? ' (resumed)' : ''}${state.stages[s].error ? ` - ${state.stages[s].error}` : state.stages[s].detail ? ` - ${state.stages[s].detail}` : ''}`);
        console.log(`[PIPELINE] generation=${state.generation_kind} semantic_regeneration=${state.semantic_regeneration}`);
        console.log(`[PIPELINE] overall=${state.overall}`);
        done(state.overall, state);
      })
      .catch((err) => {
        console.error(`[PIPELINE] FAILED to run: ${err?.message || err}`);
        process.exitCode = 1;
      });
  }
}
