#!/usr/bin/env node
// ==============================================================================
// Artifact Generator — Interactive HTML Report
// Analyzes a knowledge source (NotebookLM pack or Obsidian staging snapshot),
// extracts HTTP(s) URLs, ranks them by reference frequency, and emits a
// self-contained, theme-aware HTML dashboard to <output_dir>/<report_filename>.
//
// Contract (invoked by generate.sh):
//   node generate-report.mjs --source <notebooklm|obsidian> --config-file <path>
//
// Dependency-free at runtime (node: builtins only), mirroring the repo's
// validate-staging-docs.mjs convention. The chart is inline SVG — no CDN.
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const COLOR = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const TAG = '[ARTIFACT-GENERATOR]';
const logInfo = (msg) => console.error(`${COLOR.green}${TAG} [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.error(`${COLOR.yellow}${TAG} [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.error(`${COLOR.red}${TAG} [ERROR]${COLOR.reset} ${msg}`);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// Hardcoded fallbacks (used when the config file is missing — see docs).
const DEFAULTS = {
  output_dir: '_integration',
  report_filename: 'kb-sync-interactive-report.html',
  url_analysis_enabled: true,
  max_urls_displayed: 100,
  severity: { high: 10, medium: 5, low: 1 },
};

const URL_RE = /https?:\/\/[^\s)"'\]<>`]+/g;
// Trailing sentence punctuation to strip. URL_RE already excludes ) ] < > " '
// from the match, so those never trail here; this only handles . , ; : ! ? } .
const TRAILING_PUNCT_RE = /[.,;:!?}]+$/;

function repoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: SCRIPT_DIR }).toString().trim();
  } catch (err) {
    logError(`Not inside a git repository (or git not on PATH): ${err.message.trim()}`);
    process.exit(1);
  }
}

// Parse a top-level scalar "key: value" (tolerant of "key = value", inline
// comments, and quotes). Mirrors validate-staging-docs.mjs / ingest-wiki.sh.
function getScalar(content, key) {
  const re = new RegExp(`^\\s*${key}\\s*[:=]\\s*(.*)$`, 'm');
  const match = content.match(re);
  if (!match) return null;
  const raw = match[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
  return raw === '' ? null : raw;
}

// Parse a nested numeric value under a parent block, e.g. severity: -> high: 10.
// The intervening lines must all be indented (part of the parent block), so a
// child key in a *later* top-level block cannot be matched by mistake.
function getNestedNumber(content, parent, child) {
  const re = new RegExp(
    `^[ \\t]*${parent}[ \\t]*:[ \\t]*(?:#.*)?$(?:\\r?\\n[ \\t]+[^\\n]*)*?\\r?\\n[ \\t]+${child}[ \\t]*:[ \\t]*(\\d+)`,
    'm',
  );
  const match = content.match(re);
  return match ? Number(match[1]) : null;
}

function loadConfig(configFile) {
  if (!configFile || !fs.existsSync(configFile)) {
    logWarn(`Config not found; using defaults (output_dir=${DEFAULTS.output_dir}).`);
    return { ...DEFAULTS };
  }
  const content = fs.readFileSync(configFile, 'utf8');
  const num = (v, d) => (v == null || Number.isNaN(Number(v)) ? d : Number(v));
  const bool = (v, d) => (v == null ? d : /^(true|1|yes|on)$/i.test(v));

  let high = getNestedNumber(content, 'severity', 'high') ?? DEFAULTS.severity.high;
  let medium = getNestedNumber(content, 'severity', 'medium') ?? DEFAULTS.severity.medium;
  let low = getNestedNumber(content, 'severity', 'low') ?? DEFAULTS.severity.low;
  // severityOf assumes high >= medium >= low. Clamp misconfigured thresholds so
  // an inverted config can't classify every URL as HIGH.
  if (medium > high || low > medium) {
    logWarn(`Severity thresholds not descending (high=${high}, medium=${medium}, low=${low}); clamping.`);
    medium = Math.min(medium, high);
    low = Math.min(low, medium);
  }

  return {
    output_dir: getScalar(content, 'output_dir') || DEFAULTS.output_dir,
    report_filename: getScalar(content, 'report_filename') || DEFAULTS.report_filename,
    url_analysis_enabled: bool(getScalar(content, 'url_analysis_enabled'), DEFAULTS.url_analysis_enabled),
    max_urls_displayed: num(getScalar(content, 'max_urls_displayed'), DEFAULTS.max_urls_displayed),
    severity: { high, medium, low },
  };
}

// --- Source collection --------------------------------------------------------
// Returns an array of { name, content } logical documents.

function collectNotebookLM(root) {
  const packDir = path.join(root, '.nlm_pack');
  if (!fs.existsSync(packDir)) {
    logError(`Pack directory not found: ${packDir}`);
    logError("Run 'npm run kb:sync:notebooklm' first to generate knowledge pack.");
    process.exit(1);
  }
  const packFiles = fs.readdirSync(packDir)
    .filter((f) => f.endsWith('.txt') && !f.includes('.bak'))
    .map((f) => path.join(packDir, f));
  if (packFiles.length === 0) {
    logError(`No pack .txt files under ${packDir}.`);
    process.exit(1);
  }
  const docs = [];
  for (const packFile of packFiles) {
    const raw = fs.readFileSync(packFile, 'utf8');
    // Split into per-file sections via "--- START FILE: <path> ---" markers.
    const sectionRe = /--- START FILE:\s*(.+?)\s*---\r?\n([\s\S]*?)\r?\n--- END FILE:\s*.+? ---/g;
    let match;
    let matched = false;
    while ((match = sectionRe.exec(raw)) !== null) {
      matched = true;
      docs.push({ name: match[1].trim(), content: match[2] });
    }
    // No delimiters (unexpected format): treat the whole pack as one document.
    if (!matched) docs.push({ name: path.basename(packFile), content: raw });
  }
  return docs;
}

function collectObsidian(root) {
  const configFile = path.join(root, 'configs', 'obsidian.yaml');
  let vaultRoot = process.env.OBSIDIAN_VAULT_ROOT;
  let stagingDir = '_kb-sync-staging';
  if (fs.existsSync(configFile)) {
    const c = fs.readFileSync(configFile, 'utf8');
    vaultRoot = vaultRoot || getScalar(c, 'vault_root');
    stagingDir = getScalar(c, 'staging_dir') || stagingDir;
  }
  if (!vaultRoot) {
    logError('OBSIDIAN_VAULT_ROOT not set and vault_root missing from configs/obsidian.yaml.');
    process.exit(1);
  }
  const base = path.join(vaultRoot, stagingDir, 'kb-sync');
  if (!fs.existsSync(base)) {
    logError(`Staging directory not found: ${base}`);
    logError("Run 'npm run kb:sync:obsidian' first to stage files.");
    process.exit(1);
  }
  const snapshots = fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{8}-\d{6}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (snapshots.length === 0) {
    logError(`No timestamped snapshots under ${base}.`);
    process.exit(1);
  }
  const snapshotDir = path.join(base, snapshots[snapshots.length - 1]);
  logInfo(`Using latest staging snapshot: ${snapshotDir}`);
  const docs = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(md|txt|json|ya?ml|ts|js|sh|ps1)$/i.test(entry.name)) {
        docs.push({ name: path.relative(snapshotDir, full).replace(/\\/g, '/'), content: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(snapshotDir);
  return docs;
}

// --- Analysis -----------------------------------------------------------------

function analyze(docs) {
  const urlCounts = new Map();
  let filesWithUrls = 0;
  let totalRefs = 0;
  let maxRefsInFile = 0;

  for (const doc of docs) {
    const matches = doc.content.match(URL_RE) || [];
    let fileRefs = 0;
    for (const m of matches) {
      const url = m.replace(TRAILING_PUNCT_RE, '');
      if (!url) continue;
      urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
      fileRefs += 1;
      totalRefs += 1;
    }
    if (fileRefs > 0) filesWithUrls += 1;
    if (fileRefs > maxRefsInFile) maxRefsInFile = fileRefs;
  }

  const ranked = [...urlCounts.entries()]
    .map(([url, count]) => ({ url, count }))
    .sort((a, b) => b.count - a.count || a.url.localeCompare(b.url));

  return {
    ranked,
    fileCount: docs.length,
    filesWithUrls,
    uniqueUrls: urlCounts.size,
    totalRefs,
    maxReferences: ranked.length ? ranked[0].count : 0,
    maxRefsInFile,
    avgRefsPerFile: docs.length ? totalRefs / docs.length : 0,
  };
}

function severityOf(count, thresholds) {
  if (count >= thresholds.high) return 'HIGH';
  if (count >= thresholds.medium) return 'MEDIUM';
  return 'LOW';
}

// --- Rendering ----------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function renderBarChart(top) {
  if (top.length === 0) return '<p class="empty">No URLs found to chart.</p>';
  const max = top[0].count || 1;
  const rowH = 26;
  const labelW = 46;
  const width = 640;
  const barMax = width - labelW - 60;
  const rows = top.map((item, i) => {
    const y = i * rowH;
    const w = Math.max(2, Math.round((item.count / max) * barMax));
    const host = (() => { try { return new URL(item.url).host; } catch { return item.url; } })();
    return `
      <g transform="translate(0, ${y})">
        <text x="0" y="${rowH / 2}" dy="0.35em" class="bar-label" font-size="11">${esc(host).slice(0, 26)}</text>
        <rect x="${labelW}" y="4" width="${w}" height="${rowH - 10}" rx="3" class="bar"></rect>
        <text x="${labelW + w + 6}" y="${rowH / 2}" dy="0.35em" class="bar-count" font-size="11">${item.count}</text>
      </g>`;
  }).join('');
  const height = top.length * rowH + 8;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Top referenced URLs">${rows}</svg>`;
}

function renderHtml({ source, config, metrics, generatedAt }) {
  const thresholds = config.severity;
  const top10 = metrics.ranked.slice(0, 10);
  const tableRows = metrics.ranked.slice(0, config.max_urls_displayed).map((item, i) => {
    const sev = severityOf(item.count, thresholds);
    return `<tr>
      <td class="rank">${i + 1}</td>
      <td class="url"><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.url)}</a></td>
      <td class="num">${item.count}</td>
      <td><span class="badge badge-${sev.toLowerCase()}">${sev}</span></td>
    </tr>`;
  }).join('');

  const kpi = (label, value) => `<div class="kpi"><div class="kpi-value">${esc(value)}</div><div class="kpi-label">${esc(label)}</div></div>`;

  const truncatedNote = metrics.ranked.length > config.max_urls_displayed
    ? `<p class="note">Showing top ${config.max_urls_displayed} of ${metrics.ranked.length} unique URLs.</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KB Sync — Interactive Report (${esc(source)})</title>
<style>
  :root {
    --bg: #f7f7f8; --panel: #ffffff; --ink: #1a1a1c; --muted: #666; --line: #e3e3e6;
    --accent: #b5651d; --bar: #b5651d; --high: #c0392b; --medium: #d98a1f; --low: #3a7d44;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16161a; --panel: #1f1f25; --ink: #ececf0; --muted: #9a9aa5; --line: #2e2e37;
      --accent: #d98a3a; --bar: #d98a3a; --high: #e05a4b; --medium: #e6a94a; --low: #5fae6b;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px 20px 60px; }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header .meta { color: var(--muted); font-size: 13px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin: 18px 0; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 14px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
  .kpi { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; text-align: center; }
  .kpi-value { font-size: 26px; font-weight: 700; color: var(--accent); }
  .kpi-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
  .chart { overflow-x: auto; }
  .bar { fill: var(--bar); }
  .bar-label, .bar-count { fill: var(--ink); }
  ol.recs { margin: 0; padding-left: 20px; }
  ol.recs li { margin: 4px 0; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
  td.rank, td.num { text-align: right; font-variant-numeric: tabular-nums; width: 60px; }
  td.url { word-break: break-all; }
  td.url a { color: var(--accent); text-decoration: none; }
  td.url a:hover { text-decoration: underline; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; color: #fff; }
  .badge-high { background: var(--high); }
  .badge-medium { background: var(--medium); }
  .badge-low { background: var(--low); }
  .note, .empty { color: var(--muted); font-size: 12px; }
  footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 30px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>KB Sync — Interactive Report</h1>
    <div class="meta">Source: <strong>${esc(source)}</strong> &nbsp;|&nbsp; Generated: ${esc(generatedAt)}</div>
  </header>

  <section class="kpis">
    ${kpi('Unique URLs', metrics.uniqueUrls)}
    ${kpi('Files Analyzed', metrics.fileCount)}
    ${kpi('Avg Refs/File', metrics.avgRefsPerFile.toFixed(2))}
    ${kpi('Max References', metrics.maxReferences)}
  </section>

  <section class="panel">
    <h2>Reference Distribution (Top 10)</h2>
    <div class="chart">${renderBarChart(top10)}</div>
  </section>

  <section class="panel">
    <h2>Recommendations</h2>
    <ol class="recs">
      <li>Verify high-impact URLs (most referenced) for correctness.</li>
      <li>Perform link maintenance before the next ingestion run.</li>
      <li>Remove broken or dead links from the knowledge base.</li>
      <li>Archive low-reference URLs that no longer add value.</li>
      <li>Enable post-commit link validation for continuous health checks.</li>
    </ol>
  </section>

  <section class="panel">
    <h2>Link Reference Table</h2>
    ${truncatedNote}
    <div class="table-scroll">
      <table>
        <thead><tr><th>#</th><th>URL</th><th>Refs</th><th>Severity</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="4" class="empty">No URLs extracted from source.</td></tr>'}</tbody>
      </table>
    </div>
  </section>

  <footer>
    kb-sync artifact-generator &nbsp;·&nbsp; ${esc(metrics.filesWithUrls)}/${esc(metrics.fileCount)} files contained URLs
    &nbsp;·&nbsp; severity thresholds: HIGH ≥ ${thresholds.high}, MEDIUM ≥ ${thresholds.medium}, LOW ≥ ${thresholds.low}
  </footer>
</div>
</body>
</html>
`;
}

// --- Main ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { source: 'notebooklm', configFile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--config-file') args.configFile = argv[++i];
    else if (argv[i].startsWith('--source=')) args.source = argv[i].split('=')[1];
    else if (argv[i].startsWith('--config-file=')) args.configFile = argv[i].split('=')[1];
  }
  return args;
}

function main() {
  const start = Date.now();
  const root = repoRoot();
  const { source, configFile } = parseArgs(process.argv.slice(2));

  if (source !== 'notebooklm' && source !== 'obsidian') {
    logError(`Unknown source: "${source}". Expected "notebooklm" or "obsidian".`);
    process.exit(1);
  }

  const config = loadConfig(configFile);
  if (!config.url_analysis_enabled) {
    logWarn('url_analysis_enabled is false; generating report shell without URL analysis.');
  }

  logInfo(`Collecting ${source} source documents...`);
  const docs = source === 'notebooklm' ? collectNotebookLM(root) : collectObsidian(root);
  logInfo(`Collected ${docs.length} document(s).`);

  const metrics = config.url_analysis_enabled
    ? analyze(docs)
    : { ranked: [], fileCount: docs.length, filesWithUrls: 0, uniqueUrls: 0, totalRefs: 0, maxReferences: 0, maxRefsInFile: 0, avgRefsPerFile: 0 };

  const generatedAt = new Date().toISOString();
  const html = renderHtml({ source, config, metrics, generatedAt });

  const outDir = path.isAbsolute(config.output_dir) ? config.output_dir : path.join(root, config.output_dir);
  fs.mkdirSync(outDir, { recursive: true });
  // Namespace the output by source so notebooklm and obsidian reports coexist.
  const base = config.report_filename.replace(/\.html$/i, '');
  const outFile = path.join(outDir, `${base}-${source}.html`);
  fs.writeFileSync(outFile, html, 'utf8');

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  logInfo(`Report written: ${outFile}`);
  logInfo(`${metrics.uniqueUrls} unique URL(s), ${metrics.fileCount} file(s), ${elapsed}s.`);
}

main();
