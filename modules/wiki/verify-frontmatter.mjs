#!/usr/bin/env node
// Non-mutating audit for the metadata-extraction ruleset: reports what `category`/`tags`
// frontmatter *should* be for each Markdown file, without ever writing to the file.
// Supersedes autofill-frontmatter.mjs, which hardcoded `category: "wiki"` on any file
// missing frontmatter -- this pipeline never synthesizes a category value; a file that
// can't be resolved through frontmatter/path/heading is flagged `uncategorized` (or, if
// its YAML is malformed, routed to the unresolved queue) rather than guessed.
//
// Per kb-sync's human-in-loop / immutable-staging principles, this tool is advisory only:
// it never edits source files or stages git changes. Run it in CI/pre-commit as a --check.
//
// Usage:
//   node modules/wiki/verify-frontmatter.mjs [targetDir]              # human-readable report
//   node modules/wiki/verify-frontmatter.mjs [targetDir] --json       # also write a JSON report
//   node modules/wiki/verify-frontmatter.mjs [targetDir] --json=out.json
//
// Exit code is non-zero if anything needs an operator's attention (proposed changes,
// missing frontmatter, unmapped categories, or malformed YAML) -- 0 only when every file
// already conforms.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadCategoriesData } from '../../core/config.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', '_kb-sync-staging']);
const IGNORED_ROOT_SEGMENTS = new Set(['content', 'pages', 'posts', 'drafts', 'src']);
const MAX_CATEGORY_DEPTH = 2;

const SEMVER_TOKEN_RE = /^v[0-9]+(?:\.[0-9]+)*$/i;
// A bare "any two lowercase letters" pattern false-positives on ordinary 2-letter
// directory names ("kb", "ui", "qa", "db", ...) that aren't locale codes at all -- so this
// matches against a curated set of common ISO 639-1 codes instead of a wildcard regex.
const LOCALE_CODES = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'ja', 'zh', 'ko', 'ar', 'hi',
  'pl', 'tr', 'sv', 'da', 'fi', 'no', 'cs', 'el', 'he', 'th', 'vi', 'id', 'uk'
]);
const LOCALE_TOKEN_RE = /^([a-z]{2})(-[A-Z]{2})?$/;
const HEADING_ANCHOR_RE = /^#{1,2}\s*\[([^\]]+)\]/;
function isLocaleToken(seg) {
  const m = LOCALE_TOKEN_RE.exec(seg);
  return Boolean(m) && LOCALE_CODES.has(m[1]);
}

// Domain terms a naive trailing-`s` strip would mangle; left as-is. Starter list --
// operators should extend this as they hit more false positives, same as the ruleset's
// own "static mapping table for irregular forms" ask. Includes plural top-level doc
// domain buckets (operations, modules, skills, targets, superpowers): singularizing a
// directory-derived category name reintroduces the exact taxonomy-fragmentation problem
// the whitelist exists to prevent whenever an operator has already used the plural form
// elsewhere (e.g. an existing file already declares `category: "operations"`).
const KEEP_AS_IS = new Set([
  'kubernetes', 'devops', 'nodejs', 'analytics', 'js', 'ios', 'os',
  'status', 'https', 'aws', 'iis', 'news', 'series', 'kb',
  'postgres', 'redis', 'nginx', 'k8s',
  'operations', 'modules', 'skills', 'targets', 'superpowers'
]);
// Irregular plural -> singular forms worth naming explicitly.
const IRREGULAR_PLURALS = {
  analyses: 'analysis',
  indices: 'index',
  matrices: 'matrix',
  vertices: 'vertex',
  criteria: 'criterion'
};

// Exact-match overrides for tokens generic char-stripping can't reconstruct -- "c++" -> "cpp"
// requires knowing "++" reads as "pp" for this specific, well-known name; no punctuation rule
// derives that. Matched against the raw, trimmed, lowercased input before the general pipeline.
const KNOWN_TOKEN_ALIASES = {
  'c++': 'cpp',
  'c#': 'csharp',
  'f#': 'fsharp',
  '.net': 'dotnet',
  'asp.net': 'aspnet'
};

function singularize(word) {
  if (!word || KEEP_AS_IS.has(word)) return word;
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

// Case -> lowercase, separators -> hyphen, strip non [a-z0-9-], collapse/trim hyphens,
// singularize. Applied identically to every candidate category/tag string.
function normalize(raw) {
  if (raw === null || raw === undefined) return '';
  const trimmedLower = String(raw).trim().toLowerCase();
  if (KNOWN_TOKEN_ALIASES[trimmedLower]) return KNOWN_TOKEN_ALIASES[trimmedLower];

  // Only whitespace/underscore become hyphens ("web dev" -> "web-dev"); dots and other
  // punctuation are stripped outright in sanitization ("node.js" -> "nodejs"), not
  // hyphenated -- hyphenating dots first would make "node.js" -> "node-js", which
  // contradicts the ruleset's own worked example.
  let s = trimmedLower.replace(/[\s_]+/g, '-');
  s = s.replace(/[^a-z0-9-]/g, '');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return singularize(s);
}

function loadTaxonomy() {
  const data = loadCategoriesData();
  const rules = {
    case_sensitive: false,
    max_category_depth: MAX_CATEGORY_DEPTH,
    unmapped_fallback: 'uncategorized',
    ...(data.rules || {})
  };
  // Canonical keys/aliases must run through the same `normalize()` as resolved candidates,
  // or anything the taxonomy stores in a form normalize() would change (a trailing plural,
  // an underscore) reads as unmapped even though it's the canonical value itself.
  const canonical = new Map(); // normalized key/alias -> canonical category key
  for (const [key, def] of Object.entries(data.categories || {})) {
    canonical.set(normalize(key), key);
    for (const alias of def.aliases || []) {
      canonical.set(normalize(alias), key);
    }
  }
  return { rules, canonical };
}

// The delimiter must be a complete line ("---" alone, optionally with trailing
// whitespace/CR), not merely a "---" prefix -- a document that starts with e.g.
// "---draft embargo notice" is ordinary content, not a frontmatter block, and must not
// be rejected as malformed.
function splitFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return { hasBlock: false, body: content, raw: null };

  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { closingIdx = i; break; }
  }
  if (closingIdx === -1) {
    // Leading `---` with no closing delimiter line -- malformed, not "no frontmatter"; the
    // caller must not fall through to path/heading inference for this file.
    return { hasBlock: true, closed: false, body: content, raw: null };
  }

  const raw = lines.slice(1, closingIdx).join('\n').trim();
  const body = lines.slice(closingIdx + 1).join('\n');
  return { hasBlock: true, closed: true, body, raw }; // frontmatter parsed by caller (needs try/catch)
}

function declaredCategory(fm) {
  if (!fm || typeof fm !== 'object') return null;
  for (const key of ['category', 'categories', 'section']) {
    const val = fm[key];
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      return { primary: val[0], tags: val.slice(1) };
    }
    if (typeof val === 'string' && val.trim()) {
      return { primary: val, tags: [] };
    }
  }
  return null;
}

function pathHeuristic(relPath) {
  const segments = relPath.split(path.sep).slice(0, -1); // drop filename
  const tokens = segments.filter((seg) => {
    if (IGNORED_ROOT_SEGMENTS.has(seg)) return false;
    if (SEMVER_TOKEN_RE.test(seg)) return false;
    if (isLocaleToken(seg)) return false;
    return seg.length > 0;
  });
  if (tokens.length === 0) return null;
  const categoryTiers = tokens.slice(0, MAX_CATEGORY_DEPTH);
  const tagTiers = tokens.slice(MAX_CATEGORY_DEPTH);
  return {
    primary: categoryTiers[0],
    secondary: categoryTiers[1] || null,
    tags: tagTiers
  };
}

function headingAnchor(body) {
  const lines = body.split('\n').slice(0, 10);
  for (const line of lines) {
    const m = HEADING_ANCHOR_RE.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

function resolveCategoryAndTags(fm, relPath, body) {
  const declared = declaredCategory(fm);
  if (declared) {
    // A scalar `category`/`section` carries no tags of its own; a separate `tags:` field
    // (common alongside a scalar category) is still real declared data and must not be
    // reported as "should be removed" just because it wasn't the field precedence matched.
    const explicitTags = Array.isArray(fm && fm.tags) ? fm.tags : [];
    return {
      source: 'frontmatter',
      category: normalize(declared.primary),
      tags: [...declared.tags, ...explicitTags].map(normalize).filter(Boolean)
    };
  }

  const path_ = pathHeuristic(relPath);
  if (path_) {
    const category = normalize(path_.primary);
    const tags = [
      ...(path_.secondary ? [normalize(path_.secondary)] : []),
      ...path_.tags.map(normalize)
    ].filter(Boolean);
    return { source: 'path', category, tags };
  }

  const anchor = headingAnchor(body);
  if (anchor) {
    return { source: 'heading', category: normalize(anchor), tags: [] };
  }

  return { source: 'fallback', category: 'uncategorized', tags: [] };
}

function dedupeTags(tags, primaryCategory) {
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    if (!tag || tag === primaryCategory) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function auditFile(absPath, relPath, taxonomy) {
  const content = fs.readFileSync(absPath, 'utf8');
  const { hasBlock, closed, body: rawBody, raw } = splitFrontmatter(content);

  if (hasBlock && !closed) {
    // A leading `---` with no closing delimiter is a malformed block, not an absent one --
    // falling through to path/heading inference here would guess at a file whose declared
    // frontmatter simply failed to parse.
    return { file: relPath, kind: 'malformed', error: 'Unclosed frontmatter block (no closing "---")' };
  }

  let fm = null;
  if (hasBlock) {
    if (raw === '') {
      // Explicit empty frontmatter block ("---\n---") -- malformed per the ruleset, never guess.
      return { file: relPath, kind: 'malformed', error: 'Empty frontmatter block' };
    }
    try {
      fm = yaml.load(raw);
    } catch (err) {
      return { file: relPath, kind: 'malformed', error: err.message };
    }
  }

  const resolved = resolveCategoryAndTags(fm, relPath, rawBody);
  const tags = dedupeTags(resolved.tags, resolved.category);

  // A normalized candidate (e.g. "personal-o", singularized from "personal-os") matching
  // the whitelist only proves it maps to a canonical entry -- it is not itself a value the
  // live routing (core/config.mjs's resolveNotebookId, exact-match on stored keys/aliases)
  // can resolve. Report/compare the map's stored canonical key, not the normalized form,
  // whenever one was found.
  const proposedCanonicalKey = taxonomy.canonical.get(resolved.category);
  const proposedCategory = proposedCanonicalKey || resolved.category;
  const unmapped = resolved.category !== 'uncategorized' && !proposedCanonicalKey;

  const currentCategoryNorm = fm && typeof fm.category === 'string' ? normalize(fm.category) : null;
  const currentCategory = currentCategoryNorm
    ? taxonomy.canonical.get(currentCategoryNorm) || currentCategoryNorm
    : null;
  const currentTags = Array.isArray(fm && fm.tags) ? fm.tags.map(normalize).filter(Boolean) : [];
  const changed =
    !hasBlock || // no frontmatter block at all
    currentCategory !== proposedCategory ||
    JSON.stringify([...currentTags].sort()) !== JSON.stringify([...tags].sort());

  if (!hasBlock) {
    return {
      file: relPath,
      kind: 'missing_frontmatter',
      proposed: { category: proposedCategory, tags, source: resolved.source },
      unmapped
    };
  }

  if (!changed && !unmapped) {
    return { file: relPath, kind: 'ok' };
  }

  return {
    file: relPath,
    kind: unmapped ? 'unmapped_category' : 'proposed_change',
    current: { category: currentCategory, tags: currentTags },
    proposed: { category: proposedCategory, tags, source: resolved.source },
    unmapped
  };
}

function walk(dir, root, taxonomy, results) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, root, taxonomy, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const relPath = path.relative(root, full);
      results.push(auditFile(full, relPath, taxonomy));
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const jsonArg = args.find((a) => a === '--json' || a.startsWith('--json='));
  const jsonOutPath = jsonArg && jsonArg.includes('=') ? jsonArg.split('=')[1] : null;
  const targetArg = args.find((a) => !a.startsWith('--'));
  const targetDir = targetArg ? path.resolve(process.cwd(), targetArg) : path.join(process.cwd(), 'docs');

  if (!fs.existsSync(targetDir)) {
    console.error(`[VERIFY-FRONTMATTER] Directory not found: ${targetDir}`);
    process.exit(1);
  }

  const taxonomy = loadTaxonomy();
  const results = [];
  walk(targetDir, targetDir, taxonomy, results);

  const ok = results.filter((r) => r.kind === 'ok');
  const missing = results.filter((r) => r.kind === 'missing_frontmatter');
  const proposed = results.filter((r) => r.kind === 'proposed_change');
  const unmapped = results.filter((r) => r.kind === 'unmapped_category');
  const malformed = results.filter((r) => r.kind === 'malformed');

  console.log(`[VERIFY-FRONTMATTER] Scanned ${results.length} file(s) in ${targetDir}`);
  console.log(`  ok: ${ok.length}  missing_frontmatter: ${missing.length}  proposed_change: ${proposed.length}  unmapped_category: ${unmapped.length}  malformed: ${malformed.length}`);

  for (const group of [missing, proposed, unmapped]) {
    for (const r of group) {
      console.log(`  [${r.kind}] ${r.file} -> category: ${r.proposed.category}${r.proposed.tags.length ? ', tags: ' + r.proposed.tags.join(',') : ''} (via ${r.proposed.source})`);
    }
  }
  for (const r of malformed) {
    console.log(`  [malformed] ${r.file}: ${r.error}`);
  }

  if (jsonArg) {
    const outPath = jsonOutPath ? path.resolve(process.cwd(), jsonOutPath) : path.join(process.cwd(), 'verify-frontmatter-report.json');
    fs.writeFileSync(outPath, JSON.stringify({ scannedAt: new Date().toISOString(), targetDir, results }, null, 2), 'utf8');
    console.log(`[VERIFY-FRONTMATTER] JSON report written to ${outPath}`);
  }

  const needsAttention = missing.length + proposed.length + unmapped.length + malformed.length;
  process.exit(needsAttention > 0 ? 1 : 0);
}

main();
