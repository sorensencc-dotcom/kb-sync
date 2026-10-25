/**
 * nlm-pack-replace-gate.mjs
 *
 * Pre-upload replace gate for NotebookLM thematic knowledge packs.
 * Invariant: <=1 logical pack family per notebook -- never stack a second pack.
 *
 * Safe pattern (aligned with ingest-notebooklm.sh / notebooklm-uploader.js):
 *   1) query live sources for the notebook
 *   2) purge any existing pack-family titles
 *   3) caller uploads the fresh pack
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProtectedSandboxFixture, assertLiveSandbox, KB_TESTING_FIXTURE_SOURCE_ID } from './notebooklm/sandbox-contract.mjs';
export { KB_TESTING_SANDBOX_UUID, KB_TESTING_FIXTURE_SOURCE_ID, KB_TESTING_FIXTURE_TITLE, isProtectedSandboxFixture } from './notebooklm/sandbox-contract.mjs';

export const PACK_FAMILY_TITLE_RE = [
  /^pack[_-]/i,
  /^repo[_-]?knowledge[_-]?pack/i,
  /\brepo knowledge pack\b/i,
  /\bseed\b.*\bpack\b/i,
  /\bengineering\b.*\bpack\b/i,
  /\baviation engineering pack\b/i,
  /\bthematic knowledge pack\b/i,
  /\bknowledge pack\b/i,
  /\bpolitics\b.*\bpack\b/i,
  /\bpack\b.*\bpolitics\b/i,
  /^cic\b.*\bpack\b/i,
  /^cic - daily research \(buffer\/intake\) pack$/i,
  /^cic - ford executive dynamics & politics pack$/i,
  /^kb - modules pack$/i,
  /^personal os \(household, utilities, florida logistics\) pack$/i,
];

/** Canonical 8+1 Historical Domain Notebook IDs where software packs are forbidden */
export const HISTORICAL_NOTEBOOK_IDS = new Set([
  '6fd7c40b-df90-444b-9c7a-a64682925856', // willow-run
  '0caf6707-f8f2-4d2a-acd2-020acead55ba', // ford-politics
  '9c469910-a900-43a4-877c-a43c9f545b5f', // post-war
  'fd4ebe29-9440-4f4b-97cf-0184ffbe29a0', // willys-overland
  'c8360946-dbee-4a2c-b622-7f89b05695b0', // cuba-claims
  '64949154-5892-4fa4-9ad0-e48b2bf5cc6c', // miami-estate
  '70be0df3-c58a-4711-b4d3-1e4b8726faf7', // assembly-line
  '679b8bab-2d87-42cb-a726-6dc54c83acc2', // master-kb (CIC-KB)
  '1b4861a3-931f-4632-8fc1-343a8dd37df8', // daily
]);

export const SOFTWARE_PACK_PATTERN = /^(repo[_-]?knowledge[_-]?pack|pack_agent_harness|pack_ironledger|pack_sigil|pack_rewrite_labs|agent_harness|ironledger|sigil)|\brepo\b.*pack/i;

export function isSoftwarePack(packFileOrCategory) {
  const str = path.basename(String(packFileOrCategory || '')).toLowerCase();
  return SOFTWARE_PACK_PATTERN.test(str);
}

export function assertAllowedPackNotebook(notebookId, packFile, category) {
  const nbId = String(notebookId || '').toLowerCase().trim();
  const isHistorical = HISTORICAL_NOTEBOOK_IDS.has(nbId);
  const isSoftware = isSoftwarePack(packFile) || isSoftwarePack(category);
  if (isHistorical && isSoftware) {
    throw new Error(
      `ROUTING_GUARD_VIOLATION: Refusing to upload software pack "${packFile || category}" to historical notebook "${notebookId}". ` +
      `Software packs belong in Core Software notebooks (IronLedger, Sigil, or Agent Harness), never historical notebooks.`
    );
  }
}

export function matchesPackFamily(sourceTitle, familyKey) {
  const t = String(sourceTitle || '').toLowerCase().trim();
  const f = String(familyKey || '').toLowerCase().trim();
  if (!t || !f) return false;

  const cleanF = path.basename(f)
    .replace(/\.bak\.txt$/i, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]part[_-][a-z0-9]+$/i, '');

  if (cleanF === 'pack_daily' || cleanF === 'daily') {
    return (
      /^pack_daily(?:[_-]part[_-][a-z0-9]+|\.[a-z0-9]+)*(?:\.bak)?(?:\.txt)?$/i.test(t) ||
      t === 'cic - daily research (buffer/intake) pack'
    );
  }

  if (cleanF === 'pack_ford_politics' || cleanF === 'ford-politics' || cleanF === 'ford_politics') {
    return (
      /^pack_ford_politics(?:[_-]part[_-][a-z0-9]+|\.[a-z0-9]+)*(?:\.bak)?(?:\.txt)?$/i.test(t) ||
      t === 'cic - ford executive dynamics & politics pack'
    );
  }

  const isAgentHarness = (s) =>
    /^(repo[_-]?knowledge[_-]?pack|pack_agent_harness|agent[_-]harness)/i.test(s);
  if (isAgentHarness(cleanF)) {
    return /^(repo[_-]?knowledge[_-]?pack|pack_agent_harness)/i.test(t);
  }

  if (cleanF === 'pack_modules' || cleanF === 'modules') {
    return (
      /^pack_modules(?:[_-]part[_-][a-z0-9]+|\.[a-z0-9]+)*(?:\.bak)?(?:\.txt)?$/i.test(t) ||
      t === 'kb - modules pack'
    );
  }

  if (cleanF === 'pack_personal_os' || cleanF === 'personal-os' || cleanF === 'personal_os') {
    return (
      /^pack_personal_os(?:[_-]part[_-][a-z0-9]+|\.[a-z0-9]+)*(?:\.bak)?(?:\.txt)?$/i.test(t) ||
      t === 'personal os (household, utilities, florida logistics) pack'
    );
  }

  return (
    t === cleanF ||
    t.startsWith(`${cleanF}_`) ||
    t.startsWith(`${cleanF}.`) ||
    t.startsWith(`${cleanF}-`)
  );
}

/**
 * @param {string} title
 * @param {string} [incomingPackBaseName] optional basename of the pack about to upload
 */
export function isPackFamilyTitle(title, incomingPackBaseName) {
  const t = String(title || '').toLowerCase().trim();
  if (!t) return false;
  if (incomingPackBaseName) {
    if (matchesPackFamily(t, incomingPackBaseName)) return true;
    const base = path.basename(incomingPackBaseName).toLowerCase();
    const baseNoExt = base.replace(/\.bak\.txt$/i, '').replace(/\.[^.]+$/, '');
    if (t === base || t === baseNoExt) return true;
    // Treat pack_agent_harness and repo_knowledge_pack as the same pack family
    const isAgentHarnessFamily = (s) =>
      /^(repo[_-]?knowledge[_-]?pack|pack_agent_harness)/i.test(s);
    if (isAgentHarnessFamily(base) && isAgentHarnessFamily(t)) return true;
  }
  return PACK_FAMILY_TITLE_RE.some((re) => re.test(t));
}

export function filterPackFamilySources(sources, incomingPackBaseName) {
  const list = Array.isArray(sources) ? sources : [];
  return list.filter((s) =>
    !isProtectedSandboxFixture(s) && isPackFamilyTitle(s?.title || s?.name || s?.displayName || '', incomingPackBaseName),
  );
}

function runCliCapture(cli, args) {
  const invocation = resolveCliInvocation(cli, args);
  const result = spawnSync(invocation.cmd, invocation.args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(invocation.cmd),
    timeout: 120000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'NotebookLM CLI failed');
  }
  return result.stdout;
}

export function resolveCliInvocation(cli, args = []) {
  const nodeMatch = String(cli).trim().match(/^(?:node|nodejs)\s+(["']?)(.+)\1$/i);
  if (nodeMatch) return { cmd: process.execPath, args: [nodeMatch[2], ...args] };
  return { cmd: cli, args };
}

function assertSafeCliValue(value, label) {
  if (typeof value !== 'string' || !value || /[;&|<>`$()\r\n]/.test(value)) {
    throw new Error(`Unsafe NotebookLM ${label}`);
  }
  return value;
}

const SOURCE_DELETE_LEASE = Symbol('source-delete-lease');

export function createSourceDeletionLease({ notebookId, sourceIds, reason }) {
  const ids = Array.isArray(sourceIds) ? [...new Set(sourceIds)] : [];
  if (!notebookId || !ids.length || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id))) {
    throw new Error('INVALID_SOURCE_DELETE_LEASE');
  }
  if (!['replacement', 'rollback'].includes(reason)) throw new Error('INVALID_SOURCE_DELETE_REASON');
  return Object.freeze({ [SOURCE_DELETE_LEASE]: true, notebookId, sourceIds: Object.freeze(ids), reason });
}

/**
 * List notebook sources via notebooklm/nlm CLI.
 * Tries several known shapes used across CIC scripts.
 */
export function listNotebookSources(cli, notebookId) {
  assertSafeCliValue(cli, 'CLI');
  assertSafeCliValue(notebookId, 'notebook id');
  const isNlm = /\bnlm(\.exe)?$/i.test(cli.trim());
  const attempts = [
    ...(isNlm ? [['source', 'list', notebookId, '--json']] : []),
    ['source', 'list', '--notebook', notebookId, '--json'],
    ['source', 'list', `--notebook-id=${notebookId}`, '--json'],
    ['source', 'list', notebookId, '--json'],
  ];
  let lastErr;
  for (const command of attempts) {
    try {
      const stdout = runCliCapture(cli, command);
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.sources)) return parsed.sources;
      if (Array.isArray(parsed?.data)) return parsed.data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to list NotebookLM sources for ${notebookId}: ${lastErr?.message || lastErr}`,
  );
}

export function deleteNotebookSource(cli, notebookId, sourceId, lease, { protectedSourceIds = [] } = {}) {
  if (protectedSourceIds.includes(sourceId)) throw new Error('PROTECTED_SOURCE_DELETE: source is protected by caller policy');
  if (!lease || lease[SOURCE_DELETE_LEASE] !== true || lease.notebookId !== notebookId || !lease.sourceIds.includes(sourceId)) {
    throw new Error('UNLEASED_SOURCE_DELETE: replacement or rollback lease required');
  }
  assertSafeCliValue(cli, 'CLI');
  assertSafeCliValue(notebookId, 'notebook id');
  assertSafeCliValue(sourceId, 'source id');
  const isNlm = /\bnlm(\.exe)?$/i.test(cli.trim());
  const attempts = isNlm
    ? [
      ['source', 'delete', sourceId, '-y'],
      ['source', 'delete', `--id=${sourceId}`, '-y'],
      ['source', 'remove', sourceId, '-y'],
    ]
    : [
      ['source', 'delete', '--notebook', notebookId, sourceId, '-y'],
      ['source', 'delete', `--notebook-id=${notebookId}`, `--id=${sourceId}`, '-y'],
      ['source', 'remove', '--notebook', notebookId, sourceId, '-y'],
    ];
  let lastErr;
  for (const command of attempts) {
    try {
      runCliCapture(cli, command);
      return true;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to delete NotebookLM source ${sourceId}: ${lastErr?.message || lastErr}`,
  );
}

/**
 * Query + purge pack-family sources BEFORE upload so a second pack never stacks.
 * @returns {{ listed: number, purged: number, matched: object[], safeToUpload: boolean }}
 */
export function purgePackFamilyBeforeUpload({
  cli,
  notebookId,
  packFile,
  dryRun = false,
  logInfo = console.log,
  logWarn = console.warn,
}) {
  assertAllowedPackNotebook(notebookId, packFile);
  const packBase = packFile ? path.basename(packFile) : undefined;
  logInfo(
    `Replace-gate: listing sources in notebook ${notebookId} before pack upload${packBase ? ` (${packBase})` : ''}...`,
  );

  let sources = [];
  try {
    sources = listNotebookSources(cli, notebookId);
  } catch (err) {
    logWarn(`Replace-gate: source list failed -- refusing pack upload to avoid stacking: ${err.message}`);
    throw err;
  }

  const matched = filterPackFamilySources(sources, packBase);
  logInfo(
    `Replace-gate: ${sources.length} source(s) live; ${matched.length} pack-family match(es) to purge.`,
  );

  if (!dryRun) throw new Error('ATOMIC_REPLACEMENT_REQUIRED: use replacePackFamilyAtomic');

  if (matched.length === 0) {
    return { listed: sources.length, purged: 0, matched, safeToUpload: true };
  }

  if (dryRun) {
    for (const s of matched) {
      logWarn(
        `[DRY RUN] Would purge pack-family source ${s.id || s.sourceId || '?'} ("${s.title || s.name}")`,
      );
    }
    return { listed: sources.length, purged: 0, matched, safeToUpload: true };
  }

  let purged = 0;
  for (const s of matched) {
    const id = s.id || s.sourceId || s.source_id;
    if (!id) {
      logWarn(`Replace-gate: skipping match without id ("${s.title || s.name}")`);
      continue;
    }
    logInfo(`Replace-gate: purging ${id} ("${s.title || s.name}")...`);
    try {
      deleteNotebookSource(cli, notebookId, id, createSourceDeletionLease({ notebookId, sourceIds: [id], reason: 'replacement' }));
      purged += 1;
      logInfo(`Replace-gate: purged ${id}`);
    } catch (err) {
      logWarn(`Replace-gate: purge failed for ${id}: ${err.message}`);
      throw err;
    }
  }

  return { listed: sources.length, purged, matched, safeToUpload: true };
}

export function buildNotebookLmUploadCommand({ cli, notebookId, file }) {
  assertSafeCliValue(cli, 'CLI');
  assertSafeCliValue(notebookId, 'notebook id');
  assertSafeCliValue(file, 'file path');
  if (/\bnotebooklm(\.exe)?$/i.test(cli.trim())) {
    return `${cli} source upload --notebook "${notebookId}" --file="${file}"`;
  }
  return `${cli} source add "${notebookId}" --file "${file}"`;
}

export async function uploadAndReplacePack({
  cli,
  notebookId,
  packFile,
  logInfo = console.log,
  logWarn = console.warn,
  runUpload = null,
  runList = null,
  waitMs = 3500,
}) {
  assertAllowedPackNotebook(notebookId, packFile);
  const invoke = runUpload || (() => {
    const isNlm = /\bnlm(\.exe)?$/i.test(cli.trim());
    const command = isNlm
      ? ['source', 'add', notebookId, '--file', packFile, '--json']
      : ['source', 'upload', '--notebook', notebookId, '--file', packFile, '--json'];
    const invocation = resolveCliInvocation(cli, command);
    const result = spawnSync(invocation.cmd, invocation.args, {
      encoding: 'utf8',
      timeout: 120000,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(invocation.cmd),
    });
    if (result.status !== 0) throw new Error(`NLM_UPLOAD_FAILED: ${result.stderr || result.stdout || result.error?.message}`);
    return result.stdout;
  });
  const result = await replacePackFamilyAtomic({
    cli,
    notebookId,
    packFiles: [packFile],
    expectedPartCount: 1,
    runUpload: () => invoke(),
    runList,
    waitMs,
    logInfo,
    logWarn,
  });
  return { uploadedId: result.newSourceIds[0], oldSourceIds: result.purgedOldSourceIds };
}

// Sandbox verification replaces only sources explicitly owned by this run.
export async function replaceSandboxPack({ notebookId, file, runId, oldSourceIds = [], runNlm = null, onUploaded = () => {} }) {
  assertLiveSandbox(notebookId);
  if (!/^[0-9a-f-]{36}$/.test(runId || '') || !path.basename(file).startsWith(`pack_sandbox_${runId}.txt`)) throw new Error('SANDBOX_RUN_OWNERSHIP_REQUIRED');
  if (oldSourceIds.some(id => isProtectedSandboxFixture({ id }))) throw new Error('PROTECTED_SANDBOX_FIXTURE');
  const invoke = runNlm || ((args) => {
    const res = spawnSync('nlm', args, { encoding: 'utf8', timeout: 120000 });
    if (res.status !== 0) throw new Error(`NLM_COMMAND_FAILED: ${res.stderr || res.error?.message}`);
    return args[1] === 'delete' ? res.stdout : JSON.parse(res.stdout);
  });
  const beforeRaw = invoke(['source', 'list', notebookId, '--json']);
  const before = Array.isArray(beforeRaw) ? beforeRaw : beforeRaw.sources;
  if (!Array.isArray(before) || !before.some(s => (s.id || s.sourceId || s.source_id) === KB_TESTING_FIXTURE_SOURCE_ID)) throw new Error('SANDBOX_FIXTURE_MISSING');
  const ids = new Set(before.map(s => s.id || s.sourceId || s.source_id));
  if (oldSourceIds.some(id => !ids.has(id))) throw new Error('OWNED_SOURCE_MISSING');
  if (before.some(s => oldSourceIds.includes(s.id || s.sourceId || s.source_id)
    && ![s.title, s.name, s.displayName].includes(`pack_sandbox_${runId}.txt`))) throw new Error('SOURCE_NOT_OWNED_BY_RUN');
  const added = invoke(['source', 'add', notebookId, '--file', file, '--wait', '--json']);
  const addedId = added.source_id || added.id;
  if (addedId && !ids.has(addedId) && addedId !== KB_TESTING_FIXTURE_SOURCE_ID) onUploaded(addedId);
  const afterRaw = invoke(['source', 'list', notebookId, '--json']);
  const after = Array.isArray(afterRaw) ? afterRaw : afterRaw.sources;
  const uploaded = after?.filter(s => !ids.has(s.id || s.sourceId || s.source_id)
    && [s.title, s.name, s.displayName].includes(path.basename(file)));
  if (uploaded?.length !== 1) throw new Error('NEW_SOURCE_NOT_VERIFIED: old sources retained');
  const newSourceId = uploaded[0].id || uploaded[0].sourceId || uploaded[0].source_id;
  if (newSourceId !== addedId) onUploaded(newSourceId);
  if (addedId && newSourceId !== addedId) throw new Error('UPLOAD_ID_MISMATCH: old sources retained');
  const source = uploaded[0];
  if (![2, '2', 'ACTIVE', 'active', 'READY', 'ready'].includes(source.status)) {
    throw new Error('NEW_SOURCE_NOT_ACTIVE: old sources retained');
  }
  const activeVerifiedAt = Date.now();
  await new Promise(resolve => setTimeout(resolve, 3500));
  for (const id of oldSourceIds) invoke(['source', 'delete', id, '-y']);
  return { newSourceId, oldSourceIds, activeVerifiedAt, deletedAt: Date.now() };
}

/**
 * Polls target notebook sources until all expected source IDs reach ACTIVE (status 2).
 * Handles in-flight transient statuses (1, 5, PROCESSING, UPLOADING, PENDING, PREPARING)
 * and missing status probe fallback. Status 3 (and ERROR/FAILED) fails closed immediately.
 */
export async function pollFamilyUntilActive(notebookId, expectedSourceIds, timeoutMs = 300000, nlmSourceList = null) {
  const listFn = nlmSourceList || ((nbId) => listNotebookSources('nlm', nbId));
  const start = Date.now();
  const pollInterval = 4000;

  while (Date.now() - start < timeoutMs) {
    const liveSources = await listFn(notebookId);
    let allActive = true;
    let anyInFlight = false;

    for (const id of expectedSourceIds) {
      const matches = Array.isArray(liveSources)
        ? liveSources.filter(s => (s.id || s.sourceId || s.source_id) === id)
        : [];
      if (matches.length > 1) {
        throw new Error(`Duplicate source ID ${id} in notebook ${notebookId}`);
      }
      const src = matches[0];
      if (!src) {
        allActive = false;
        anyInFlight = true;
        continue;
      }

      // 1. Explicit Error / Fail-Closed Check (Status 3, ERROR, FAILED)
      if (
        src.status === 3 ||
        src.status === '3' ||
        /^(3|ERROR|FAILED|STATUS_ERROR|STATUS_FAILED)$/i.test(String(src.status ?? ''))
      ) {
        throw new Error(`Source ${id} entered invalid/error status: ${src.status}`);
      }

      // 2. Explicit Active Check
      if (
        src.status === 2 ||
        src.status === '2' ||
        /^(2|ACTIVE|STATUS_ACTIVE)$/i.test(String(src.status ?? ''))
      ) {
        continue;
      }

      // 3. Transient In-Flight Check (Wait)
      if (
        src.status === 1 ||
        src.status === '1' ||
        src.status === 5 ||
        src.status === '5' ||
        /^(1|5|PROCESSING|UPLOADING|INDEXING|PENDING|PREPARING)$/i.test(String(src.status ?? ''))
      ) {
        allActive = false;
        anyInFlight = true;
        continue;
      }

      // 4. Missing Status Field Fallback Probe
      if (src.status === undefined || src.status === null) {
        const hasSize = (src.characterCount > 0) || (src.sizeBytes > 0) || (src.wordCount > 0) ||
                        (src.char_count > 0) || (src.size > 0);
        if (hasSize && !src.error && !src.processingError) {
          console.warn(`[NLM-WARN] Source ${id} in ${notebookId} lacks status field; accepted via size/error probe.`);
          continue;
        }
      }

      throw new Error(`Source ${id} entered invalid/error status: ${src.status}`);
    }

    if (allActive) return true;
    if (anyInFlight) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      continue;
    }
  }

  throw new Error(`Timeout (${timeoutMs / 1000}s) waiting for pack family in ${notebookId} to reach status 2.`);
}

/**
 * Probes existing sources to detect if matching part is already present and active.
 * Only reports EXISTS_ACTIVE for actually ACTIVE sources (2 / ACTIVE / STATUS_ACTIVE).
 * Same-title sources in error status 3 (or ERROR/FAILED) return EXISTS_ERROR (stale: true).
 * Same-title sources in in-flight states return EXISTS_IN_FLIGHT (stale: true, not reused).
 */
export function probeExistingPackSource(liveSources, filename, contentHash = null) {
  const base = path.basename(String(filename || '')).toLowerCase().trim();
  const baseNoExt = base.replace(/\.[^.]+$/, '');
  if (!base) return { exists: false };
  const list = Array.isArray(liveSources) ? liveSources : [];
  const matches = list.filter((s) => {
    if (!s || isProtectedSandboxFixture(s)) return false;
    const title = (s.title || s.name || s.displayName || '').toLowerCase().trim();
    return title === base || title === baseNoExt;
  });

  if (matches.length === 0) return { exists: false };

  for (const s of matches) {
    const status = s.status;
    const isError =
      status === 3 ||
      status === '3' ||
      /^(3|ERROR|FAILED|STATUS_ERROR|STATUS_FAILED)$/i.test(String(status ?? ''));
    if (isError) {
      return {
        exists: true,
        status: 'EXISTS_ERROR',
        reusable: false,
        stale: true,
        sourceId: s.id || s.sourceId || s.source_id,
        source: s,
      };
    }
  }

  for (const s of matches) {
    const status = s.status;
    const isInFlight =
      status === 1 ||
      status === '1' ||
      status === 5 ||
      status === '5' ||
      /^(1|5|PROCESSING|UPLOADING|INDEXING|PENDING|PREPARING)$/i.test(String(status ?? ''));
    if (isInFlight) {
      return {
        exists: true,
        status: 'EXISTS_IN_FLIGHT',
        reusable: false,
        stale: true,
        sourceId: s.id || s.sourceId || s.source_id,
        source: s,
      };
    }
  }

  if (matches.length === 1) {
    const s = matches[0];
    const status = s.status;
    const isActive =
      status === 2 ||
      status === '2' ||
      /^(2|ACTIVE|STATUS_ACTIVE)$/i.test(String(status ?? ''));
    if (isActive) {
      return {
        exists: true,
        status: 'EXISTS_ACTIVE',
        reusable: true,
        stale: false,
        sourceId: s.id || s.sourceId || s.source_id,
        source: s,
      };
    }
  }

  const first = matches[0];
  return {
    exists: true,
    status: 'EXISTS_ERROR',
    reusable: false,
    stale: true,
    sourceId: first.id || first.sourceId || first.source_id,
    source: first,
  };
}

/**
 * Per-notebook atomic replace gate enforcing multipart atomicity,
 * stage-all-before-drop-any, quarantine without deletion, and has_pack bypass.
 */
export async function replacePackFamilyAtomic({
  cli = 'nlm',
  notebookId,
  packFiles = [],
  expectedPartCount = null,
  hasPack = true,
  allowReuse = false,
  quarantineHandler = null,
  logInfo = console.log,
  logWarn = console.warn,
  runUpload = null,
  runList = null,
  runDelete = null,
  spawnFn = spawnSync,
  timeoutMs = 300000,
  waitMs = 3500,
}) {
  // 1. has_pack: false Bypass: skip pack dispatcher entirely
  if (!hasPack) {
    logInfo(`[REPLACE-GATE] Notebook ${notebookId} has_pack: false; bypassing pack dispatcher.`);
    return { bypassed: true, reason: 'HAS_PACK_FALSE', notebookId };
  }

  // 2. Multipart Pack Family Atomicity: Expected part count N must match staged part count N
  if (typeof expectedPartCount === 'number' && packFiles.length !== expectedPartCount) {
    const msg = `MULTIPART_COUNT_MISMATCH: Expected ${expectedPartCount} parts, got ${packFiles.length}`;
    if (quarantineHandler) {
      quarantineHandler(notebookId, msg);
    }
    throw new Error(msg);
  }

  if (!Array.isArray(packFiles) || packFiles.length === 0) {
    const msg = `EMPTY_PACK_FILES: Refusing atomic replace for ${notebookId} with 0 pack files`;
    if (quarantineHandler) {
      quarantineHandler(notebookId, msg);
    }
    throw new Error(msg);
  }

  for (const f of packFiles) {
    assertAllowedPackNotebook(notebookId, f);
  }

  const listFn = runList || ((nbId) => listNotebookSources(cli, nbId));
  const deleteFn = (nbId, srcId, lease) => runDelete
    ? runDelete(srcId, lease, nbId)
    : deleteNotebookSource(cli, nbId, srcId, lease);
  const uploadFn = runUpload || ((nbId, file) => {
    const invocation = resolveCliInvocation(cli, ['source', 'add', nbId, '--file', file, '--json']);
    const res = spawnFn(invocation.cmd, invocation.args, {
      encoding: 'utf8',
      timeout: 120000,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(invocation.cmd)
    });
    if (res.status !== 0) throw new Error(`NLM_UPLOAD_FAILED: ${res.stderr || res.stdout || res.error?.message}`);
    const out = res.stdout;
    try {
      const parsed = typeof out === 'string' ? JSON.parse(out) : out;
      const id = parsed?.source_id || parsed?.id || parsed?.source?.id;
      if (id) return { source_id: id, ...parsed };
    } catch {
      if (typeof out === 'string') {
        const match = out.match(/"?(?:source_id|id)"?\s*[:=]\s*"?([0-9a-fA-F-]{8,}|[a-zA-Z0-9_-]+)"?/);
        if (match) return { source_id: match[1] };
      }
    }
    return out;
  });

  // Query live sources
  const liveSources = await listFn(notebookId);
  const oldSourceIdSet = new Set();
  for (const pf of packFiles) {
    const matched = filterPackFamilySources(liveSources, path.basename(pf));
    for (const s of matched) {
      const sid = s.id || s.sourceId || s.source_id;
      if (sid) oldSourceIdSet.add(sid);
    }
  }
  const staleSourceIds = [];

  const newGenerationSourceIds = [];
  const newlyUploadedSourceIds = [];

  try {
    for (const file of packFiles) {
      const fileName = path.basename(file);
      // Existence probe: Idempotent pre-flight (reuse only when allowReuse is explicitly enabled)
      const probe = probeExistingPackSource(liveSources, fileName);
      if (allowReuse && probe.exists && probe.status === 'EXISTS_ACTIVE' && probe.sourceId) {
        logInfo(`[EXISTS_ACTIVE] Reusing existing source for ${fileName} (${probe.sourceId})`);
        newGenerationSourceIds.push(probe.sourceId);
        continue;
      }

      if (probe.exists && probe.status === 'EXISTS_ACTIVE') {
        logWarn(
          `[WARN] [EXISTS_ACTIVE] Pre-existing active source collision for ${fileName} (${probe.sourceId}); not reusing without generation verification, marking stale for replacement after new generation reaches ACTIVE.`
        );
        if (probe.sourceId) {
          oldSourceIdSet.add(probe.sourceId);
          staleSourceIds.push(probe.sourceId);
        }
      } else if (probe.exists && probe.status === 'EXISTS_ERROR') {
        logWarn(
          `[WARN] [EXISTS_ERROR] Stale error source collision for ${fileName} (${probe.sourceId}, status=${probe.source?.status}); not reusing, marking stale for replacement after new generation reaches ACTIVE.`
        );
        if (probe.sourceId) {
          oldSourceIdSet.add(probe.sourceId);
          staleSourceIds.push(probe.sourceId);
        }
      } else if (probe.exists && probe.status === 'EXISTS_IN_FLIGHT') {
        logWarn(
          `[WARN] [EXISTS_IN_FLIGHT] In-flight source collision for ${fileName} (${probe.sourceId}, status=${probe.source?.status}); not reusing, marking stale for replacement after new generation reaches ACTIVE.`
        );
        if (probe.sourceId) {
          oldSourceIdSet.add(probe.sourceId);
          staleSourceIds.push(probe.sourceId);
        }
      } else if (probe.exists && probe.sourceId) {
        logWarn(
          `[WARN] Stale non-active source collision for ${fileName} (${probe.sourceId}, status=${probe.source?.status}); not reusing, marking stale for replacement after new generation reaches ACTIVE.`
        );
        oldSourceIdSet.add(probe.sourceId);
        staleSourceIds.push(probe.sourceId);
      }

      logInfo(`[UPLOAD] Uploading: ${fileName} to ${notebookId}...`);
      const uploadOut = await uploadFn(notebookId, file);
      let parsed = null;
      if (typeof uploadOut === 'string') {
        try {
          parsed = JSON.parse(uploadOut);
        } catch {
          const match = uploadOut.match(/"?(?:source_id|id)"?\s*[:=]\s*"?([0-9a-fA-F-]{8,}|[a-zA-Z0-9_-]+)"?/);
          if (match) parsed = { source_id: match[1] };
        }
      } else {
        parsed = uploadOut;
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new Error(`UPLOAD_SOURCE_ID_UNVERIFIABLE for ${fileName}`);
      }
      const uploadedId = parsed?.source_id || parsed?.id || parsed?.source?.id;
      if (!uploadedId) throw new Error(`UPLOAD_SOURCE_ID_MISSING for ${fileName}`);
      if (
        oldSourceIdSet.has(uploadedId) ||
        newGenerationSourceIds.includes(uploadedId) ||
        isProtectedSandboxFixture({ id: uploadedId })
      ) {
        throw new Error(`UPLOAD_SOURCE_ID_REUSED for ${fileName}: ${uploadedId}`);
      }
      newGenerationSourceIds.push(uploadedId);
      newlyUploadedSourceIds.push(uploadedId);
    }

    // Stage-All-Before-Drop-Any: wait for every single part of new generation to reach status 2
    logInfo(`[POLL] Polling ${newGenerationSourceIds.length} source(s) until ACTIVE...`);
    await pollFamilyUntilActive(notebookId, newGenerationSourceIds, timeoutMs, listFn);

    // Terminal ACTIVE verified! Apply calibrated indexing propagation delay
    await new Promise(resolve => setTimeout(resolve, waitMs));

    // Cutovers: purge old generation pack parts (excluding any in new generation)
    const oldSourceIds = Array.from(oldSourceIdSet);
    const newGenSet = new Set(newGenerationSourceIds);
    const toDelete = oldSourceIds.filter(id => !newGenSet.has(id));
    const purgedIds = [];
    const oldLease = oldSourceIds.length ? createSourceDeletionLease({ notebookId, sourceIds: oldSourceIds, reason: 'replacement' }) : null;
    let cutoverError = null;
    for (const id of toDelete) {
      try {
        await deleteFn(notebookId, id, oldLease);
        purgedIds.push(id);
      } catch (delErr) {
        logWarn(`[WARN] Failed to delete old source ${id}: ${delErr.message}`);
        cutoverError = delErr;
        break;
      }
    }

    if (cutoverError) {
      const remainingIds = toDelete.filter(id => !purgedIds.includes(id));
      const partialError = new Error(
        `PARTIAL_CUTOVER: deleted ${purgedIds.length}/${toDelete.length} old source(s); ${cutoverError.message}`,
      );
      partialError.deletedSourceIds = purgedIds;
      partialError.remainingSourceIds = remainingIds;
      throw partialError;
    }

    logInfo(`[CUTOVER_COMPLETE] Notebook ${notebookId}: promoted ${newGenerationSourceIds.length} source(s), purged ${purgedIds.length} old source(s).`);
    return {
      success: true,
      notebookId,
      newSourceIds: newGenerationSourceIds,
      purgedOldSourceIds: purgedIds,
      staleSourceIds,
    };
  } catch (err) {
    // Keep an ACTIVE replacement available after an irreversible partial cutover.
    logWarn(`[QUARANTINE] Notebook ${notebookId} failed replace-gate: ${err.message}. Active replacement retained for reconciliation.`);
    const shouldCleanUpOrphans = !err.message.startsWith('PARTIAL_CUTOVER:');
    for (const orphanId of shouldCleanUpOrphans ? newlyUploadedSourceIds : []) {
      try {
        const orphanLease = createSourceDeletionLease({ notebookId, sourceIds: [orphanId], reason: 'rollback' });
        await deleteFn(notebookId, orphanId, orphanLease);
        logInfo(`[CLEANUP] Purged orphaned partial upload ${orphanId}`);
      } catch (cleanErr) {
        logWarn(`[WARN] Failed to purge orphaned upload ${orphanId}: ${cleanErr.message}`);
      }
    }
    if (quarantineHandler) {
      quarantineHandler(notebookId, err.message);
    }
    throw err;
  }
}

const REGISTRY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'state', 'knowledge-plane-notebooks.json');
const PART_TITLE_RE = /[_-]part[_-]?[a-z0-9]+/i;

/** Registry entry for a notebook, or null when unregistered. Throws if the registry is unreadable. */
export function findRegistryNotebook(notebookId, registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))) {
  const id = String(notebookId || '').toLowerCase();
  for (const cluster of Object.values(registry?.clusters || {})) {
    const nb = (cluster?.notebooks || []).find(n => String(n?.uuid || '').toLowerCase() === id);
    if (nb) return nb;
  }
  return null;
}

/**
 * Single-file pack replace for writers outside the cluster sweep (e.g. toolforge daily mining).
 * Skips without uploading or deleting when the registry marks the notebook multipart or has_pack:false,
 * or when any live pack-family source carries a _partN suffix. Otherwise delegates to
 * replacePackFamilyAtomic, which deletes old sources only after the new one is ACTIVE and removes
 * its own upload on failure, so callers must not retry.
 */
export async function replaceSinglePack({ notebookId, packFile, registry, cli = 'nlm', runList = null, ...rest }) {
  const nb = findRegistryNotebook(notebookId, registry);
  if (nb?.multipart === true || Number(nb?.expected_parts) > 1) {
    return { skipped: true, reason: 'MULTIPART_REGISTRY', notebookId };
  }
  if (nb && nb.has_pack === false) {
    return { skipped: true, reason: 'HAS_PACK_FALSE', notebookId };
  }
  const listFn = runList || ((nbId) => listNotebookSources(cli, nbId));
  const live = await listFn(notebookId);
  const hasLiveParts = (live || []).some(s => {
    const t = s?.title || s?.name || s?.displayName || '';
    return PART_TITLE_RE.test(t) && isPackFamilyTitle(t);
  });
  if (hasLiveParts) {
    return { skipped: true, reason: 'MULTIPART_LIVE', notebookId };
  }
  return replacePackFamilyAtomic({ ...rest, cli, notebookId, packFiles: [packFile], expectedPartCount: 1, runList: listFn });
}

