/**
 * nlm-pack-count-check.mjs
 *
 * Plain (no AI, no network except local `nlm` CLI) NotebookLM pack-count check script.
 * Invariant: at most ONE logical pack family per notebook; multipart parts count as ONE family.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  isPackFamilyTitle,
  matchesPackFamily,
  isSoftwarePack,
  HISTORICAL_NOTEBOOK_IDS,
} from './nlm-pack-replace-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'state', 'knowledge-plane-notebooks.json');

const AUTH_ERROR_RE = /auth(entication)? (expired|failed|required)|not (logged|signed) in|login required|unauthori[sz]ed|401|403/i;

/**
 * Load active swept notebooks from a manifest object or file path.
 * Skips cluster `excluded_not_swept` and any entry with sweep_status "EXCLUDED_RETIRED".
 */
export function loadNotebooks(manifestInput = DEFAULT_MANIFEST_PATH) {
  let manifestObj = manifestInput;
  if (typeof manifestInput === 'string') {
    const raw = fs.readFileSync(manifestInput, 'utf8');
    manifestObj = JSON.parse(raw);
  }
  if (!manifestObj || typeof manifestObj !== 'object' || !manifestObj.clusters) {
    return [];
  }

  const result = [];
  for (const [clusterKey, clusterVal] of Object.entries(manifestObj.clusters)) {
    if (clusterKey === 'excluded_not_swept') continue;
    if (!clusterVal || typeof clusterVal !== 'object' || !Array.isArray(clusterVal.notebooks)) {
      continue;
    }
    for (const nb of clusterVal.notebooks) {
      if (!nb || nb.sweep_status === 'EXCLUDED_RETIRED') continue;
      result.push({
        id: nb.uuid,
        alias: nb.key,
        has_pack: Boolean(nb.has_pack),
        pack_family: nb.pack_family || undefined,
        multipart: Boolean(nb.multipart),
        legacy_title_alias: nb.legacy_title_alias || undefined,
        cluster: clusterKey,
      });
    }
  }
  return result;
}

/**
 * Default runner using child_process.execFile (no shell) to invoke `nlm source list <notebook-id> --json`.
 */
export function defaultRunner(notebookId) {
  return new Promise((resolve) => {
    execFile(
      'nlm',
      ['source', 'list', String(notebookId), '--json'],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const combinedText = `${stderr || ''}\n${stdout || ''}\n${err?.message || ''}`.trim();
        if (err) {
          if (err.code === 'ENOENT') {
            return resolve({
              ok: false,
              sources: [],
              error: err.message || 'nlm CLI not found (ENOENT)',
              kind: 'CLI_MISSING',
            });
          }
          if (AUTH_ERROR_RE.test(combinedText)) {
            return resolve({
              ok: false,
              sources: [],
              error: combinedText || 'Authentication error',
              kind: 'AUTH',
            });
          }
          return resolve({
            ok: false,
            sources: [],
            error: combinedText || 'Command execution failed',
            kind: 'ERROR',
          });
        }

        try {
          const parsed = JSON.parse(stdout);
          let rawList = null;
          if (Array.isArray(parsed)) {
            rawList = parsed;
          } else if (parsed && Array.isArray(parsed.sources)) {
            rawList = parsed.sources;
          } else if (parsed && Array.isArray(parsed.data)) {
            rawList = parsed.data;
          }

          if (!rawList) {
            if (AUTH_ERROR_RE.test(combinedText)) {
              return resolve({
                ok: false,
                sources: [],
                error: combinedText || 'Authentication error',
                kind: 'AUTH',
              });
            }
            return resolve({
              ok: false,
              sources: [],
              error: 'Unexpected JSON shape from nlm source list',
              kind: 'ERROR',
            });
          }

          const sources = rawList.map((s) => ({
            ...s,
            id: s?.id ?? s?.sourceId ?? s?.source_id,
            title: s?.title ?? s?.name ?? '',
            status: s?.status,
          }));

          return resolve({
            ok: true,
            sources,
            error: null,
            kind: null,
          });
        } catch (parseErr) {
          if (AUTH_ERROR_RE.test(combinedText)) {
            return resolve({
              ok: false,
              sources: [],
              error: combinedText || 'Authentication error',
              kind: 'AUTH',
            });
          }
          return resolve({
            ok: false,
            sources: [],
            error: `Invalid JSON output: ${parseErr.message}`,
            kind: 'ERROR',
          });
        }
      }
    );
  });
}

function normalizePackFamilyKey(rawTitle, notebook) {
  const packFamily = notebook?.pack_family;
  const legacyAlias = notebook?.legacy_title_alias;

  let base = String(rawTitle || '').trim();
  const isBak = /\.bak\.txt$/i.test(base);
  base = base.replace(/\.bak\.txt$/i, '');
  base = base.replace(/\.(txt|md|pdf|json|yaml|yml|docx|doc|html|csv)$/i, '');

  const partMatch = base.match(/^(.*?)[_-]part[_-]([a-z0-9]+)$/i);
  let partLabel = null;
  let coreName = base;
  if (partMatch) {
    coreName = partMatch[1];
    partLabel = partMatch[2].toLowerCase();
  }

  const lowerCore = coreName.toLowerCase().trim();
  let familyKey = lowerCore;

  if (/^(repo[_-]?knowledge[_-]?pack|pack_agent_harness|agent[_-]harness)/i.test(lowerCore)) {
    familyKey = 'agent_harness';
  }

  if (packFamily && (matchesPackFamily(rawTitle, packFamily) || (legacyAlias && matchesPackFamily(rawTitle, legacyAlias)) || (legacyAlias && String(rawTitle).toLowerCase().trim() === String(legacyAlias).toLowerCase().trim()))) {
    familyKey = packFamily;
  }

  return {
    familyKey,
    partLabel,
    isPart: partLabel !== null,
    isBak,
    normalizedTitle: String(rawTitle || '').toLowerCase().trim(),
  };
}

function isPackSourceForNotebook(rawTitle, notebook) {
  const title = String(rawTitle || '').trim();
  if (!title) return false;
  const packFamily = notebook?.pack_family;
  const legacyAlias = notebook?.legacy_title_alias;
  if (isPackFamilyTitle(title, packFamily)) return true;
  if (matchesPackFamily(title, packFamily || legacyAlias)) return true;
  if (legacyAlias && matchesPackFamily(title, legacyAlias)) return true;
  return false;
}

function isErrorStatus(status) {
  if (status === undefined || status === null || status === '') return true;
  if (status === 3 || status === '3') return true;
  if (/^(3|ERROR|FAILED|STATUS_ERROR|STATUS_FAILED)$/i.test(String(status).trim())) return true;
  return false;
}

function isSoftwarePackTitle(rawTitle) {
  const t = path.basename(String(rawTitle || '')).toLowerCase().trim();
  if (isSoftwarePack(t)) return true;
  return /^(pack_ironledger|pack_sigil|pack_agent_harness|repo_knowledge_pack)/i.test(t);
}

function indexToTwoLetterLabel(idx) {
  const first = Math.floor(idx / 26);
  const second = idx % 26;
  return String.fromCharCode(97 + first) + String.fromCharCode(97 + second);
}

function twoLetterLabelToIndex(label) {
  if (!/^[a-z]{2}$/.test(label)) return -1;
  return (label.charCodeAt(0) - 97) * 26 + (label.charCodeAt(1) - 97);
}

/**
 * Classify a single notebook's live sources into counts and findings.
 */
export function classifyNotebook(notebook, rawSources = []) {
  const notebookId = notebook.id || notebook.uuid;
  const alias = notebook.alias || notebook.key;
  const hasPack = Boolean(notebook.has_pack);
  const sources = Array.isArray(rawSources) ? rawSources : [];

  const findings = [];
  const addFinding = (code, detail, severity = 'red') => {
    findings.push({
      notebook_id: notebookId,
      alias,
      code,
      detail,
      severity,
    });
  };

  const packSources = [];

  for (const s of sources) {
    const title = String(s?.title ?? s?.name ?? '').trim();
    if (/\.bak\.txt$/i.test(title)) {
      addFinding('BAK_UPLOADED', `Backup file uploaded as source: "${title}"`, 'red');
    }
    if (isPackSourceForNotebook(title, notebook)) {
      const info = normalizePackFamilyKey(title, notebook);
      packSources.push({
        source: s,
        title,
        status: s?.status,
        ...info,
      });
    }
  }

  // Check PACK_ERROR_STATUS on pack sources
  for (const ps of packSources) {
    if (isErrorStatus(ps.status)) {
      addFinding(
        'PACK_ERROR_STATUS',
        `Pack source "${ps.title}" has invalid/error status: ${ps.status === undefined || ps.status === null ? 'missing' : ps.status}`,
        'red'
      );
    }
  }

  // Distinct family keys & duplicate exact titles
  const familySet = new Set(packSources.map((p) => p.familyKey));
  const titleCounts = new Map();
  for (const ps of packSources) {
    titleCounts.set(ps.normalizedTitle, (titleCounts.get(ps.normalizedTitle) || 0) + 1);
  }
  const duplicateTitles = [];
  for (const [t, count] of titleCounts.entries()) {
    if (count > 1) duplicateTitles.push(t);
  }

  if (familySet.size > 1) {
    addFinding(
      'MULTI_FAMILY',
      `Multiple pack families present (${Array.from(familySet).join(', ')})`,
      'red'
    );
  } else if (duplicateTitles.length > 0) {
    addFinding(
      'MULTI_FAMILY',
      `Duplicate pack source title(s) present: ${duplicateTitles.join(', ')}`,
      'red'
    );
  }

  // MULTIPART_GAP check per family with parts
  const partsByFamily = new Map();
  for (const ps of packSources) {
    if (ps.isPart) {
      if (!partsByFamily.has(ps.familyKey)) {
        partsByFamily.set(ps.familyKey, []);
      }
      partsByFamily.get(ps.familyKey).push(ps.partLabel);
    }
  }

  for (const [fam, labels] of partsByFamily.entries()) {
    const indices = labels.map(twoLetterLabelToIndex);
    const invalidLabels = labels.filter((_, i) => indices[i] < 0);
    const validIndices = indices.filter((idx) => idx >= 0);
    if (invalidLabels.length > 0) {
      addFinding(
        'MULTIPART_GAP',
        `Family "${fam}" has non-two-letter part label(s): ${invalidLabels.join(', ')}`,
        'red'
      );
    } else if (validIndices.length > 0) {
      const maxIdx = Math.max(...validIndices);
      const presentSet = new Set(validIndices);
      const missingLabels = [];
      for (let i = 0; i <= maxIdx; i++) {
        if (!presentSet.has(i)) {
          missingLabels.push(indexToTwoLetterLabel(i));
        }
      }
      if (missingLabels.length > 0) {
        addFinding(
          'MULTIPART_GAP',
          `Family "${fam}" is missing multipart label(s): ${missingLabels.join(', ')}`,
          'red'
        );
      }
    }
  }

  // POLLUTION check
  const isHistorical = HISTORICAL_NOTEBOOK_IDS.has(String(notebookId || '').toLowerCase().trim());
  if (!hasPack && packSources.length > 0) {
    addFinding(
      'POLLUTION',
      `Notebook "${alias}" has has_pack=false but contains ${packSources.length} pack source(s): ${packSources.map((p) => p.title).join(', ')}`,
      'red'
    );
  }
  if (isHistorical) {
    const softwarePolluting = sources.filter((s) => {
      const t = String(s?.title ?? s?.name ?? '').trim();
      return isSoftwarePackTitle(t);
    });
    if (softwarePolluting.length > 0) {
      addFinding(
        'POLLUTION',
        `Historical notebook "${alias}" (${notebookId}) contains forbidden software pack(s): ${softwarePolluting.map((s) => s.title || s.name).join(', ')}`,
        'red'
      );
    }
  }

  // NO_PACK (info only)
  if (hasPack && packSources.length === 0) {
    addFinding(
      'NO_PACK',
      `Notebook "${alias}" has has_pack=true but 0 pack sources present`,
      'info'
    );
  }

  const partsCount = packSources.filter((p) => p.isPart).length;
  const counts = {
    notebook_id: notebookId,
    families: familySet.size,
    sources: sources.length,
    pack_sources: packSources.length,
    parts: partsCount,
  };

  return { counts, findings };
}

/**
 * Run pack-count check across all active swept notebooks in manifest.
 */
export async function runCheck({
  manifest = DEFAULT_MANIFEST_PATH,
  runner = defaultRunner,
  now = () => new Date(),
} = {}) {
  const notebooks = loadNotebooks(manifest);
  const counts = {};
  const findings = [];
  const unknown = [];
  let notebooksChecked = 0;

  for (const nb of notebooks) {
    let res = await runner(nb.id);
    if (!res || !res.ok) {
      const kind = res?.kind || 'ERROR';
      if (kind === 'ERROR') {
        // Retry at most ONE time for generic ERROR only
        res = await runner(nb.id);
      }
    }

    if (!res || !res.ok) {
      const kind = res?.kind || 'ERROR';
      const detail = res?.error || `Runner failed with ${kind}`;
      unknown.push({
        notebook_id: nb.id,
        alias: nb.alias,
        kind,
        detail,
      });
      if (kind === 'AUTH' || kind === 'CLI_MISSING') {
        break;
      }
      continue;
    }

    notebooksChecked += 1;
    const { counts: nbCounts, findings: nbFindings } = classifyNotebook(nb, res.sources);
    counts[nb.alias] = nbCounts;
    findings.push(...nbFindings);
  }

  const hasRedFindings = findings.some((f) => f.severity === 'red');
  let overall = 'GREEN';
  if (hasRedFindings) {
    overall = 'RED';
  } else if (unknown.length > 0) {
    overall = 'UNKNOWN';
  }

  const currentNow = typeof now === 'function' ? now() : now;
  const generatedAt = currentNow instanceof Date ? currentNow.toISOString() : new Date(currentNow).toISOString();

  return {
    generated_at: generatedAt,
    overall,
    notebooks_checked: notebooksChecked,
    notebooks_unknown: unknown.length,
    counts,
    findings,
    unknown,
  };
}

function parseArgs(argv = []) {
  const out = { manifest: null, outPath: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (arg === '--manifest' && i + 1 < argv.length) {
      out.manifest = argv[++i];
    } else if (arg.startsWith('--manifest=')) {
      out.manifest = arg.slice('--manifest='.length);
    } else if (arg === '--out' && i + 1 < argv.length) {
      out.outPath = argv[++i];
    } else if (arg.startsWith('--out=')) {
      out.outPath = arg.slice('--out='.length);
    }
  }
  return out;
}

function writeJsonAtomic(targetPath, data) {
  const resolved = path.resolve(targetPath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${resolved}.tmp-${process.pid}`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, resolved);
}

/**
 * CLI entrypoint.
 * @param {string[]} argv
 * @param {object} env
 * @param {{ runner?: Function, now?: Function }} [options]
 * @returns {Promise<number>} exit code (0 GREEN, 2 RED, 3 UNKNOWN)
 */
export async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(
      'Usage: node scripts/nlm-pack-count-check.mjs [--manifest <path>] [--out <path>]\n'
    );
    return 0;
  }

  const manifestPath = parsed.manifest
    ? path.resolve(parsed.manifest)
    : DEFAULT_MANIFEST_PATH;
  const outPath = parsed.outPath || env?.NLM_PACK_COUNT_OUT || path.resolve(process.cwd(), '_status-feed', 'nlm_pack_counts.json');

  const report = await runCheck({
    manifest: manifestPath,
    runner: options.runner || defaultRunner,
    now: options.now || (() => new Date()),
  });

  writeJsonAtomic(outPath, report);

  const redCount = report.findings.filter((f) => f.severity === 'red').length;
  process.stdout.write(
    `nlm-pack-count: ${report.overall} (${report.notebooks_checked} notebooks, ${redCount} findings) -> ${outPath}\n`
  );

  if (report.overall === 'GREEN') return 0;
  if (report.overall === 'RED') return 2;
  return 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
