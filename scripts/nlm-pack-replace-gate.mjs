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

import { execSync } from 'node:child_process';
import path from 'node:path';

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
  }
  return PACK_FAMILY_TITLE_RE.some((re) => re.test(t));
}

export function filterPackFamilySources(sources, incomingPackBaseName) {
  const list = Array.isArray(sources) ? sources : [];
  return list.filter((s) =>
    isPackFamilyTitle(s?.title || s?.name || '', incomingPackBaseName),
  );
}

function runCapture(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: true,
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
  const attempts = [
    `${cli} source list --notebook "${notebookId}" --json`,
    `${cli} source list --notebook-id="${notebookId}" --json`,
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
    const id = s.id || s.sourceId;
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
  return `${cli} source upload --notebook "${notebookId}" --file="${file}"`;
}
