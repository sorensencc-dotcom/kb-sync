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

import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
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

/**
 * @param {string} title
 * @param {string} [incomingPackBaseName] optional basename of the pack about to upload
 */
export function isPackFamilyTitle(title, incomingPackBaseName) {
  const t = String(title || '').toLowerCase().trim();
  if (!t) return false;
  if (incomingPackBaseName) {
    const base = path.basename(incomingPackBaseName).toLowerCase();
    const baseNoExt = base.replace(/\.[^.]+$/, '');
    if (t === base || t === baseNoExt || t.startsWith(baseNoExt)) return true;
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

function runCapture(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: true,
    timeout: 120000,
  });
}

function assertSafeCliValue(value, label) {
  if (typeof value !== 'string' || !value || /[;&|<>`$()\r\n]/.test(value)) {
    throw new Error(`Unsafe NotebookLM ${label}`);
  }
  return value;
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
    ...(isNlm ? [`${cli} source list "${notebookId}" --json`] : []),
    `${cli} source list --notebook "${notebookId}" --json`,
    `${cli} source list --notebook-id="${notebookId}" --json`,
    `${cli} source list "${notebookId}" --json`,
  ];
  let lastErr;
  for (const cmd of attempts) {
    try {
      const stdout = runCapture(cmd);
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

export function deleteNotebookSource(cli, sourceId) {
  if (isProtectedSandboxFixture({ id: sourceId })) throw new Error('PROTECTED_SANDBOX_FIXTURE: deletion forbidden');
  assertSafeCliValue(cli, 'CLI');
  assertSafeCliValue(sourceId, 'source id');
  const attempts = [
    `${cli} source delete ${sourceId} -y`,
    `${cli} source delete --id="${sourceId}" -y`,
    `${cli} source remove ${sourceId} -y`,
  ];
  let lastErr;
  for (const cmd of attempts) {
    try {
      runCapture(cmd);
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
      deleteNotebookSource(cli, id);
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
  oldSources = [],
  logInfo = console.log,
  runUpload = null,
  waitMs = 3500,
}) {
  assertAllowedPackNotebook(notebookId, packFile);
  const invoke = runUpload || (() => {
    const result = spawnSync(cli, ['source', 'upload', '--notebook', notebookId, '--file', packFile, '--json'], {
      encoding: 'utf8', timeout: 120000, shell: true,
    });
    if (result.status !== 0) throw new Error(`NLM_UPLOAD_FAILED: ${result.stderr || result.stdout || result.error?.message}`);
    return result.stdout;
  });
  const added = typeof invoke === 'function' ? invoke() : null;
  let parsed;
  try { parsed = typeof added === 'string' ? JSON.parse(added) : added; } catch { throw new Error('UPLOAD_SOURCE_ID_UNVERIFIABLE'); }
  const uploadedId = parsed?.source_id || parsed?.id || parsed?.source?.id;
  if (typeof uploadedId !== 'string' || !uploadedId) throw new Error('UPLOAD_SOURCE_ID_UNVERIFIABLE');
  const sources = listNotebookSources(cli, notebookId);
  const matches = sources.filter(source => (source.id || source.sourceId || source.source_id) === uploadedId);
  if (matches.length !== 1) throw new Error('UPLOAD_SOURCE_ID_NOT_UNIQUE');
  if (![2, '2', 'ACTIVE', 'active'].includes(matches[0].status)) throw new Error('UPLOAD_SOURCE_NOT_ACTIVE');
  await new Promise(resolve => setTimeout(resolve, waitMs));
  for (const source of oldSources) deleteNotebookSource(cli, source.id || source.sourceId || source.source_id);
  logInfo(`Uploaded ${path.basename(packFile)} as ${uploadedId}; deleted ${oldSources.length} old source(s).`);
  return { uploadedId, oldSourceIds: oldSources.map(source => source.id || source.sourceId || source.source_id) };
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
