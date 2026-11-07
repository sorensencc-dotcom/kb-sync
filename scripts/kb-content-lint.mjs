#!/usr/bin/env node
/**
 * Content lint for the wiki: orphan pages (no inbound wikilinks), dead wikilinks, and stale pages.
 * Read-only over the wiki; writes only the offender report (default .kb_cache/content-lint.json).
 * Surfaced through `npm run kb:pipeline:status`.
 *
 * Page age = frontmatter updated/last_updated/last_verified/date/created, else last git commit, else mtime.
 * Freshness age: --max-age-days or KB_LINT_MAX_AGE_DAYS (default 90).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_MAX_AGE_DAYS = 90;
const DAY_MS = 86400000;
// Entry points and nav pages are expected to have no inbound links.
const ROOT_PAGES = new Set(['index', 'home', '_sidebar', '_footer', 'log', 'readme']);
const WIKILINK = /\[\[([^\]\n]+?)\]\]/g;

function walk(dir, base = dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // Skip dot-directories (.git, .obsidian) but not dot-named pages such as .dream-state.json.md.
    if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(full, base, out); }
    else if (e.name.endsWith('.md')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const norm = (p) => p.toLowerCase().replace(/\.md$/, '');

function frontmatterDate(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  for (const key of ['updated', 'last_updated', 'last_verified', 'date', 'created']) {
    const k = m[1].match(new RegExp(`^${key}:\\s*["']?([^"'\\r\\n]+)`, 'm'));
    if (k) { const t = Date.parse(k[1].trim()); if (!Number.isNaN(t)) return t; }
  }
  return null;
}

/** One `git log` pass: rel path (under wikiDir) -> last commit ms. */
export function gitLastCommitTimes(wikiDir) {
  const r = spawnSync('git', ['log', '--format=@%ct', '--name-only', '--relative', '--', '.'], { cwd: wikiDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const times = new Map();
  if (r.status !== 0) return times;
  let t = 0;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('@')) t = Number(line.slice(1)) * 1000;
    else if (line && !times.has(line)) times.set(line, t);
  }
  return times;
}

export function lintContent({ wikiDir, maxAgeDays = DEFAULT_MAX_AGE_DAYS, now = Date.now(), gitTimes, top = 25 } = {}) {
  const pages = walk(wikiDir);
  const byPath = new Map(pages.map((p) => [norm(p), p]));
  const byBase = new Map();
  for (const p of pages) {
    const b = norm(path.posix.basename(p));
    byBase.set(b, byBase.has(b) ? null : p); // null = ambiguous
  }
  const resolve = (from, raw) => {
    let t = raw.split('|')[0].split('#')[0].trim().replace(/\\/g, '/');
    if (!t) return from; // same-page anchor
    t = norm(t.replace(/^\.?\//, ''));
    const candidates = [t, norm(path.posix.join(path.posix.dirname(from), t))];
    const slash = t.indexOf('/');
    if (slash > 0) candidates.push(t.slice(slash + 1)); // vault prefix, e.g. kb-sync/concepts/x
    for (const c of candidates) if (byPath.has(c)) return byPath.get(c);
    return byBase.get(norm(path.posix.basename(t))) || null;
  };

  const times = gitTimes ?? gitLastCommitTimes(wikiDir);
  const inbound = new Map(pages.map((p) => [p, 0]));
  const dead = [];
  const stale = [];
  const cutoff = now - maxAgeDays * DAY_MS;
  for (const p of pages) {
    const full = path.join(wikiDir, p);
    const text = fs.readFileSync(full, 'utf8');
    for (const m of text.matchAll(WIKILINK)) {
      const target = resolve(p, m[1]);
      if (!target) dead.push({ page: p, link: m[1] });
      else if (target !== p) inbound.set(target, inbound.get(target) + 1);
    }
    const at = frontmatterDate(text) ?? times.get(p) ?? fs.statSync(full).mtimeMs;
    if (at < cutoff) stale.push({ page: p, age_days: Math.floor((now - at) / DAY_MS) });
  }
  const orphans = pages.filter((p) => inbound.get(p) === 0 && !ROOT_PAGES.has(norm(path.posix.basename(p))));

  const deadByPage = new Map();
  for (const d of dead) deadByPage.set(d.page, (deadByPage.get(d.page) ?? 0) + 1);
  const orphansByDir = new Map();
  for (const o of orphans) { const d = path.posix.dirname(o); orphansByDir.set(d, (orphansByDir.get(d) ?? 0) + 1); }
  const desc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    generated_at: new Date(now).toISOString(),
    max_age_days: maxAgeDays,
    counts: { pages: pages.length, orphans: orphans.length, dead_links: dead.length, stale: stale.length },
    top_offenders: {
      dead_links_by_page: desc(deadByPage).slice(0, top).map(([page, count]) => ({ page, count })),
      orphans_by_dir: desc(orphansByDir).slice(0, top).map(([dir, count]) => ({ dir, count })),
      oldest_pages: stale.sort((a, b) => b.age_days - a.age_days).slice(0, top),
    },
    orphans,
    dead_links: dead,
    stale_pages: stale,
  };
}

export function runContentLint({ repoRoot, wikiDir, reportPath, maxAgeDays, now } = {}) {
  const root = repoRoot || process.cwd();
  const days = maxAgeDays ?? (Number(process.env.KB_LINT_MAX_AGE_DAYS) || DEFAULT_MAX_AGE_DAYS);
  const report = lintContent({ wikiDir: wikiDir || path.join(root, 'wiki'), maxAgeDays: days, now });
  const out = reportPath || path.join(root, '.kb_cache', 'content-lint.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  return { ...report.counts, max_age_days: days, report: out };
}

if (process.argv[1] && process.argv[1].endsWith('kb-content-lint.mjs')) {
  const i = process.argv.indexOf('--max-age-days');
  const r = runContentLint({ maxAgeDays: i > 0 ? Number(process.argv[i + 1]) : undefined });
  console.log(`[LINT] pages=${r.pages} orphans=${r.orphans} dead_links=${r.dead_links} stale(>${r.max_age_days}d)=${r.stale} report=${r.report}`);
}
