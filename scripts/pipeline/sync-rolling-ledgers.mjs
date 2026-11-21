#!/usr/bin/env node
/**
 * scripts/pipeline/sync-rolling-ledgers.mjs
 *
 * Drive-to-NotebookLM Rolling Ledger Sync Pass.
 * Automatically synchronizes scheduled Gemini/TRM runs falling back to Google Drive
 * into their target NotebookLM sources via in-place atomic refresh:
 * - Idempotent: Skips unchanged ledgers via Drive modifiedTime & SHA-256 content hashing.
 * - Stage-before-drop: Verifies newly staged source is ACTIVE (status 2) before deleting prior source.
 * - Pacing: Enforces calibrated 3.5s delay after status 2 verification before purging old sources.
 * - Leased deletion: Employs scoped deletion leases with retry and rollback on activation failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  listNotebookSources,
  deleteNotebookSource,
  createSourceDeletionLease,
  pollFamilyUntilActive,
  resolveCliInvocation,
  isProtectedSandboxFixture,
} from '../nlm-pack-replace-gate.mjs';
import { updateJsonLocked } from '../../modules/trm/storage/transaction-manager.mjs';

export function spawnResolvedCli(spawnFn, invocation, options = {}) {
  const isWinBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(invocation.cmd);
  const cmd = isWinBatch ? (process.env.ComSpec || 'cmd.exe') : invocation.cmd;
  const args = isWinBatch ? ['/d', '/c', invocation.cmd, ...invocation.args] : invocation.args;
  return spawnFn(cmd, args, { windowsHide: true, ...options });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export const DEFAULT_STATE_FILE = path.resolve(REPO_ROOT, 'state/rolling-ledgers-state.json');

export const ROLLING_LEDGER_MAPPINGS = [
  {
    id: 'trm-staging-gap-sweep',
    folderName: 'research-gaps',
    folderId: '1g3UQc2LM7YcXgr6f0G9H0NByns66cZ7q',
    fileName: 'TRM Staging & Gap Sweep — Rolling Log.md',
    targetNotebookId: '1b4861a3-931f-4632-8fc1-343a8dd37df8',
    sourceTitle: 'TRM Staging & Gap Sweep — Rolling Log',
  },
  {
    id: 'daily-intel-briefing',
    folderName: 'research-gaps',
    folderId: '1g3UQc2LM7YcXgr6f0G9H0NByns66cZ7q',
    fileName: 'Daily Intelligence Briefing — Rolling 7-Day Ledger.md',
    targetNotebookId: 'c17c2a18-3562-4fe4-9880-c1289ec5f506',
    sourceTitle: 'Daily Intelligence Briefing — Rolling 7-Day Ledger',
  },
  {
    id: 'operational-ideas-harvest',
    folderName: 'research-gaps',
    folderId: '1g3UQc2LM7YcXgr6f0G9H0NByns66cZ7q',
    fileName: 'Operational Ideas Harvest — Rolling Log.md',
    targetNotebookId: 'c17c2a18-3562-4fe4-9880-c1289ec5f506',
    sourceTitle: 'Operational Ideas Harvest — Rolling Log',
  },
  {
    id: 'unsubscribe-audit-ledger',
    folderName: 'research-gaps',
    folderId: '1g3UQc2LM7YcXgr6f0G9H0NByns66cZ7q',
    fileName: 'Unsubscribe Audit Ledger.md',
    targetNotebookId: '9724e682-c5ea-4693-8e21-caf8de68611e',
    sourceTitle: 'Unsubscribe Audit Ledger',
  },
  {
    id: 'tampa-bourbon-deals',
    folderName: 'research-gaps',
    folderId: '1g3UQc2LM7YcXgr6f0G9H0NByns66cZ7q',
    fileName: 'Tampa Bourbon Deals — Rolling Tracker.md',
    targetNotebookId: '3d1f84b2-1ac8-48d2-8ec8-5052e91a55a0',
    sourceTitle: 'Tampa Bourbon Deals — Rolling Tracker',
  },
  {
    id: 'ai-news-summary',
    folderName: 'AI/AI_News',
    folderId: '1y0h4HEkg_mBVKfCbQIZ0_cag_3QyXvEy',
    fileName: 'AI News Summary — Rolling 7-Day Ledger.md',
    targetNotebookId: 'bec5a197-8256-4eba-af78-c4881cc28fdd',
    sourceTitle: 'AI News Summary — Rolling 7-Day Ledger',
  },
  {
    id: 'rewrite-labs-industry-briefing',
    folderName: 'research-gaps',
    folderId: null,
    fileName: 'Rewrite Labs Industry Briefing — Rolling Ledger.md',
    targetNotebookId: '140119ae-3496-45c9-bf0c-71c955136afc',
    sourceTitle: 'Rewrite Labs Industry Briefing — Rolling Ledger',
  },
];

const COLOR = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
const logInfo = (msg) => console.log(`${COLOR.green}[ROLLING-SYNC] [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.log(`${COLOR.yellow}[ROLLING-SYNC] [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.error(`${COLOR.red}[ROLLING-SYNC] [ERROR]${COLOR.reset} ${msg}`);
const logStep = (msg) => console.log(`${COLOR.cyan}[ROLLING-SYNC] [STEP]${COLOR.reset} ${msg}`);

export function stripBom(s) {
  return typeof s === 'string' ? s.replace(/^\uFEFF/, '') : s;
}

export function computeSha256(content) {
  return crypto.createHash('sha256').update(stripBom(String(content || '')), 'utf8').digest('hex');
}

export function matchesSourceTitle(actualTitle, targetTitle) {
  if (!actualTitle || !targetTitle) return false;
  const normalize = (s) =>
    String(s)
      .toLowerCase()
      .trim()
      .replace(/[—–]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/\.(txt|md)$/i, '');
  return normalize(actualTitle) === normalize(targetTitle);
}

export function loadRollingLedgerState(statePath = DEFAULT_STATE_FILE) {
  if (fs.existsSync(statePath)) {
    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (!parsed.entries || typeof parsed.entries !== 'object') {
          parsed.entries = {};
        }
        return parsed;
      }
    } catch (_) {}
  }
  return { lastSync: null, entries: {} };
}

export function saveRollingLedgerState(statePath = DEFAULT_STATE_FILE, state = {}) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  updateJsonLocked(statePath, (curr) => {
    const next = { ...curr, ...state };
    next.entries = { ...(curr.entries || {}), ...(state.entries || {}) };
    return next;
  });
}

/**
 * Searches local candidate roots for a matching file or .gdoc pointer.
 */
export function findLocalFileCandidates(mapping, candidateRoots = []) {
  const roots = [
    ...candidateRoots,
    'G:/My Drive/research-gaps',
    'G:/My Drive/TRM-Research/research-gaps',
    'G:/My Drive/TRM-Research',
    'G:/My Drive/AI/AI_News',
    'G:/My Drive',
  ].filter(Boolean);

  const folderParts = mapping.folderName
    ? [mapping.folderName, mapping.folderName.replace(/\//g, path.sep)]
    : [''];

  const rawName = mapping.fileName;
  const noExt = rawName.replace(/\.md$/i, '');
  const dashToHyphen = rawName.replace(/[—–]/g, '-');
  const noExtHyphen = noExt.replace(/[—–]/g, '-');

  const nameVariants = new Set([
    rawName,
    noExt,
    dashToHyphen,
    noExtHyphen,
    `${rawName}.gdoc`,
    `${noExt}.gdoc`,
    `${dashToHyphen}.gdoc`,
    `${noExtHyphen}.gdoc`,
  ]);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    // Check with folder prefixes
    for (const folder of folderParts) {
      const dir = folder ? path.resolve(root, folder) : root;
      if (!fs.existsSync(dir)) continue;
      for (const variant of nameVariants) {
        const full = path.join(dir, variant);
        if (fs.existsSync(full)) {
          return full;
        }
      }
    }

    // Direct check in root
    for (const variant of nameVariants) {
      const full = path.join(root, variant);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  }

  return null;
}

/**
 * Resolves content and metadata for a rolling ledger mapping.
 */
export async function resolveDriveFileContent(mapping, options = {}) {
  // 1. Injected content resolver or docFetcher (used in unit tests / custom overrides)
  if (typeof options.contentResolver === 'function') {
    const res = await options.contentResolver(mapping);
    if (res && res.content !== undefined) {
      return {
        content: stripBom(String(res.content)),
        modifiedTime: res.modifiedTime || new Date().toISOString(),
        sourceMethod: res.sourceMethod || 'custom_resolver',
        fileId: res.fileId || null,
      };
    }
  }

  // 2. Check local mirrored filesystem
  const localCandidate = findLocalFileCandidates(mapping, options.candidateRoots || []);
  if (localCandidate && fs.existsSync(localCandidate)) {
    const stat = fs.statSync(localCandidate);
    const ext = path.extname(localCandidate).toLowerCase();

    if (ext === '.gdoc') {
      try {
        const parsed = JSON.parse(fs.readFileSync(localCandidate, 'utf8'));
        const docId = parsed.doc_id || parsed.id;
        if (docId) {
          if (typeof options.docFetcher === 'function') {
            const fetched = await options.docFetcher(docId);
            if (fetched && fetched.content !== undefined) {
              return {
                content: stripBom(String(fetched.content)),
                modifiedTime: fetched.modifiedTime || stat.mtime.toISOString(),
                sourceMethod: 'local_gdoc_fetcher',
                fileId: docId,
              };
            }
          }
          // Try fetching via Drive export URL
          const token = options.accessToken || process.env.GCLI_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_TOKEN;
          if (token) {
            const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(docId)}/export?mimeType=text%2Fplain`;
            const fetchFn = options.fetchFn || fetch;
            const resp = await fetchFn(exportUrl, {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(options.timeoutMs || 30000),
            });
            if (resp.ok) {
              const text = await resp.text();
              return {
                content: stripBom(text),
                modifiedTime: stat.mtime.toISOString(),
                sourceMethod: 'drive_api_gdoc_export',
                fileId: docId,
              };
            }
          }
        }
      } catch (_) {}
    } else {
      // Direct raw text or markdown file
      const text = fs.readFileSync(localCandidate, 'utf8');
      return {
        content: stripBom(text),
        modifiedTime: stat.mtime.toISOString(),
        sourceMethod: 'local_file',
        fileId: localCandidate,
      };
    }
  }

  // 3. Remote Google Drive v3 API
  const token = options.accessToken || process.env.GCLI_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_TOKEN;
  if (token) {
    try {
      const fetchFn = options.fetchFn || fetch;
      const cleanName = mapping.fileName.replace(/\.md$/i, '');
      const nameQueries = [
        `name = '${mapping.fileName}'`,
        `name = '${cleanName}'`,
        `name = '${mapping.fileName.replace(/[—–]/g, '-')}'`,
        `name = '${cleanName.replace(/[—–]/g, '-')}'`,
      ];
      let q = `trashed = false and (${nameQueries.join(' or ')})`;
      if (mapping.folderId) {
        q = `'${mapping.folderId}' in parents and ${q}`;
      }

      const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime)`;
      const listResp = await fetchFn(listUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(options.timeoutMs || 30000),
      });

      if (listResp.ok) {
        const listData = await listResp.json();
        const files = listData?.files || [];
        if (files.length > 0) {
          const file = files[0];
          const isDoc = file.mimeType === 'application/vnd.google-apps.document';
          const dlUrl = isDoc
            ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=text%2Fplain`
            : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`;

          const dlResp = await fetchFn(dlUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(options.timeoutMs || 30000),
          });

          if (dlResp.ok) {
            const text = await dlResp.text();
            return {
              content: stripBom(text),
              modifiedTime: file.modifiedTime || new Date().toISOString(),
              sourceMethod: isDoc ? 'drive_api_gdoc_export' : 'drive_api_download',
              fileId: file.id,
            };
          }
        }
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Executes stage-before-drop replacement of a single rolling ledger in NotebookLM:
 * 1. Stages new content in target notebook.
 * 2. Polls until verified ACTIVE (status 2).
 * 3. Waits calibrated pacing delay (default 3.5s).
 * 4. Purges prior matching source(s).
 */
export async function replaceRollingLedgerSource({
  cli = 'nlm',
  notebookId,
  sourceTitle,
  content,
  options = {},
}) {
  const timeoutMs = options.timeoutMs ?? 300000;
  const waitMs = options.waitMs ?? 3500;
  const activeListFn = options.listFn || ((nbId) => listNotebookSources(cli, nbId));
  const activeDeleteFn = options.deleteFn || ((nbId, srcId, lease) => deleteNotebookSource(cli, nbId, srcId, lease));

  const safeTitle = sourceTitle.replace(/[^a-zA-Z0-9_\-\u2014\s]/g, '').trim();
  const tmpFile = path.join(os.tmpdir(), `${safeTitle}.txt`);
  fs.writeFileSync(tmpFile, content, 'utf8');

  let uploadedSourceId = null;
  try {
    // 1. Inspect live sources for prior matches
    const liveSources = await activeListFn(notebookId);
    const oldMatchingSources = (liveSources || []).filter(
      (s) => !isProtectedSandboxFixture(s) && matchesSourceTitle(s.title || s.name, sourceTitle)
    );
    const oldSourceIds = oldMatchingSources
      .map((s) => s.id || s.sourceId || s.source_id)
      .filter(Boolean);

    logInfo(`[STAGE] Notebook ${notebookId}: found ${oldSourceIds.length} prior source(s) matching "${sourceTitle}".`);

    // 2. Upload fresh copy (STAGE)
    const activeUploadFn = options.uploadFn || (async (nbId, file) => {
      const invocation = resolveCliInvocation(cli, ['source', 'add', nbId, '--file', file, '--json']);
      const res = spawnResolvedCli(options.spawnFn || spawnSync, invocation, {
        encoding: 'utf8',
        timeout: 120000,
      });
      if (res.status !== 0) throw new Error(`NLM_UPLOAD_FAILED: ${res.stderr || res.stdout || res.error?.message}`);
      const out = res.stdout;
      try {
        const parsed = typeof out === 'string' ? JSON.parse(out) : out;
        const id = parsed?.source_id || parsed?.id || parsed?.source?.id;
        if (id) return { source_id: id, ...parsed };
      } catch {
        const match = typeof out === 'string' && out.match(/"?(?:source_id|id)"?\s*[:=]\s*"?([0-9a-fA-F-]{8,}|[a-zA-Z0-9_-]+)"?/);
        if (match) return { source_id: match[1] };
      }
      return out;
    });

    logInfo(`[STAGE] Uploading "${sourceTitle}" to ${notebookId}...`);
    const uploadRes = await activeUploadFn(notebookId, tmpFile);
    uploadedSourceId = uploadRes?.source_id || uploadRes?.id || (typeof uploadRes === 'string' ? uploadRes : null);
    if (!uploadedSourceId) {
      throw new Error(`UPLOAD_SOURCE_ID_UNVERIFIABLE for ${sourceTitle}`);
    }
    logInfo(`[STAGE] Successfully staged source ID: ${uploadedSourceId}`);

    // 3. Poll until ACTIVE (status 2)
    logInfo(`[POLL] Verifying source ${uploadedSourceId} reaches ACTIVE status...`);
    const activePollFn = options.pollFn || ((nbId, ids) => pollFamilyUntilActive(nbId, ids, timeoutMs, activeListFn));
    await activePollFn(notebookId, [uploadedSourceId]);
    logInfo(`[ACTIVE] Source ${uploadedSourceId} verified ACTIVE.`);

    // 4. Indexing propagation delay (3.5s pacing)
    if (waitMs > 0) {
      logInfo(`[PACING] Applying ${waitMs}ms indexing propagation delay...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    // 5. Drop prior matching source(s)
    const oldToDelete = oldSourceIds.filter((id) => id !== uploadedSourceId);
    const purgedIds = [];
    if (oldToDelete.length > 0) {
      logInfo(`[DROP] Purging ${oldToDelete.length} prior generation source(s)...`);
      const lease = createSourceDeletionLease({
        notebookId,
        sourceIds: oldToDelete,
        reason: 'replacement',
      });
      for (const oldId of oldToDelete) {
        try {
          await activeDeleteFn(notebookId, oldId, lease);
          purgedIds.push(oldId);
          logInfo(`[DROP] Purged prior source ${oldId}`);
        } catch (delErr) {
          logWarn(`[WARN] Failed to purge prior source ${oldId}: ${delErr.message}`);
        }
      }
    }

    return {
      status: 'SUCCESS',
      sourceId: uploadedSourceId,
      purgedSourceIds: purgedIds,
    };
  } catch (err) {
    // Rollback orphaned new source if activation failed
    if (uploadedSourceId) {
      try {
        logWarn(`[ROLLBACK] Cleaning up staged orphan source ${uploadedSourceId}...`);
        const rollbackLease = createSourceDeletionLease({
          notebookId,
          sourceIds: [uploadedSourceId],
          reason: 'rollback',
        });
        await activeDeleteFn(notebookId, uploadedSourceId, rollbackLease);
      } catch (rbErr) {
        logWarn(`[WARN] Failed to clean up staged orphan ${uploadedSourceId}: ${rbErr.message}`);
      }
    }
    throw err;
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
}

/**
 * Synchronizes an individual rolling ledger mapping.
 */
export async function syncSingleRollingLedger(mapping, options = {}) {
  const {
    state = {},
    dryRun = false,
    force = false,
    cli = 'nlm',
  } = options;

  logStep(`Checking rolling ledger [${mapping.id}] -> "${mapping.sourceTitle}"`);

  // 1. Fetch content from Drive or local mirror
  const resolved = await resolveDriveFileContent(mapping, options);
  if (!resolved || !resolved.content) {
    logWarn(`No source content found for "${mapping.fileName}"; skipping.`);
    return {
      id: mapping.id,
      sourceTitle: mapping.sourceTitle,
      status: 'SKIPPED',
      reason: 'SOURCE_NOT_FOUND',
    };
  }

  const { content, modifiedTime, sourceMethod, fileId } = resolved;
  const contentHash = computeSha256(content);
  const previous = state.entries?.[mapping.id];

  // 2. Idempotency Check: skip if content hash matches and prior sync was successful
  if (!force && previous && previous.status === 'SUCCESS' && previous.contentHash === contentHash) {
    logInfo(`[IDEMPOTENT] Ledger "${mapping.sourceTitle}" unchanged (hash: ${contentHash.slice(0, 8)}). Skipping.`);
    return {
      id: mapping.id,
      sourceTitle: mapping.sourceTitle,
      status: 'SKIPPED',
      reason: 'UNCHANGED',
      contentHash,
      modifiedTime,
    };
  }

  logInfo(`[DIRTY] Content updated for "${mapping.sourceTitle}" (source: ${sourceMethod}, hash: ${contentHash.slice(0, 8)}).`);

  if (dryRun) {
    logInfo(`[DRY-RUN] Would stage "${mapping.sourceTitle}" to notebook ${mapping.targetNotebookId}`);
    return {
      id: mapping.id,
      sourceTitle: mapping.sourceTitle,
      status: 'DRY_RUN',
      contentHash,
      modifiedTime,
    };
  }

  // 3. Stage-before-drop execution
  const result = await replaceRollingLedgerSource({
    cli,
    notebookId: mapping.targetNotebookId,
    sourceTitle: mapping.sourceTitle,
    content,
    options,
  });

  return {
    id: mapping.id,
    sourceTitle: mapping.sourceTitle,
    targetNotebookId: mapping.targetNotebookId,
    status: 'SUCCESS',
    sourceId: result.sourceId,
    purgedSourceIds: result.purgedSourceIds,
    contentHash,
    modifiedTime,
    sourceMethod,
    fileId,
  };
}

/**
 * Orchestrates synchronization across all configured rolling ledgers.
 */
export async function syncRollingLedgers(options = {}) {
  const {
    dryRun = false,
    force = false,
    cli = 'nlm',
    statePath = DEFAULT_STATE_FILE,
    targetLedger = null,
    mappings = ROLLING_LEDGER_MAPPINGS,
  } = options;

  logInfo(`================================================================================`);
  logInfo(`Starting Drive-to-NotebookLM Rolling Ledger Sync (DryRun: ${dryRun}, Force: ${force})`);
  logInfo(`================================================================================`);

  const state = loadRollingLedgerState(statePath);
  const targets = targetLedger
    ? mappings.filter((m) => m.id === targetLedger || m.sourceTitle === targetLedger)
    : mappings;

  if (targets.length === 0) {
    logWarn(`No matching rolling ledger found for target: "${targetLedger}"`);
    return { total: 0, synced: 0, skipped: 0, failed: 0, results: [] };
  }

  const results = [];
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const mapping of targets) {
    try {
      const res = await syncSingleRollingLedger(mapping, {
        ...options,
        state,
        dryRun,
        force,
        cli,
      });
      results.push(res);

      if (res.status === 'SUCCESS') {
        synced++;
        if (!dryRun) {
          state.entries[mapping.id] = {
            id: mapping.id,
            sourceTitle: mapping.sourceTitle,
            targetNotebookId: mapping.targetNotebookId,
            contentHash: res.contentHash,
            modifiedTime: res.modifiedTime,
            sourceId: res.sourceId,
            lastSyncedAt: new Date().toISOString(),
            status: 'SUCCESS',
          };
        }
      } else if (res.status === 'SKIPPED' || res.status === 'DRY_RUN') {
        skipped++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      logError(`Failed to sync ledger "${mapping.sourceTitle}": ${err.message}`);
      results.push({
        id: mapping.id,
        sourceTitle: mapping.sourceTitle,
        status: 'FAILED',
        error: err.message,
      });
      if (!dryRun) {
        state.entries[mapping.id] = {
          id: mapping.id,
          sourceTitle: mapping.sourceTitle,
          targetNotebookId: mapping.targetNotebookId,
          lastAttemptAt: new Date().toISOString(),
          status: 'FAILED',
          error: err.message,
        };
      }
    }
  }

  if (!dryRun && (synced > 0 || failed > 0)) {
    state.lastSync = new Date().toISOString();
    try {
      saveRollingLedgerState(statePath, state);
      logInfo(`Updated state written to ${statePath}`);
    } catch (saveErr) {
      logWarn(`Failed to persist rolling ledger state: ${saveErr.message}`);
    }
  }

  logInfo(`================================================================================`);
  logInfo(`Rolling Ledger Sync Complete: ${synced} synced, ${skipped} skipped, ${failed} failed.`);
  logInfo(`================================================================================`);

  return {
    total: targets.length,
    synced,
    skipped,
    failed,
    results,
  };
}

// CLI entrypoint
const mainFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
const thisFile = fs.realpathSync(__filename);
if (mainFile === thisFile) {
  const args = process.argv.slice(2);
  let dryRun = false;
  let force = false;
  let targetLedger = null;
  let cli = 'nlm';
  let waitMs = 3500;

  for (const a of args) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--force') force = true;
    else if (a.startsWith('--ledger=')) targetLedger = a.split('=')[1];
    else if (a.startsWith('--cli=')) cli = a.split('=')[1];
    else if (a.startsWith('--wait-ms=')) waitMs = parseInt(a.split('=')[1], 10);
  }

  syncRollingLedgers({ dryRun, force, targetLedger, cli, waitMs })
    .then((out) => {
      process.exit(out.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      logError(`FATAL: ${err.message}`);
      process.exit(1);
    });
}
