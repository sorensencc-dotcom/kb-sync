import fs from 'node:fs';
import path from 'node:path';
import { getDatabase, DEFAULT_DB_PATH } from '../cache/db-schema.mjs';
import { handleQueryContextCache, handleFetchTopicNote } from '../../scripts/mcp-memory-server.mjs';
import {
  generateEmbedding,
  searchDenseVectors,
  reciprocalRankFusion,
} from '../cache/vector-store.mjs';
import {
  extractCodeSymbols,
  fetchAstBlastRadius,
  formatAstGroundingSection,
} from './ast-grounding.mjs';
import { searchWebFallback } from './web-search-fallback.mjs';
import { filterMatchedDocuments } from './jev-filter.mjs';

/**
 * Derive a stable topic slug fragment from a gap title for namespaced gap IDs.
 * Strips surrounding **, prefers text before ` (`, then slugifies.
 *
 * @param {string} title
 * @returns {string}
 */
export function slugifyTopicKey(title) {
  let text = String(title || '').trim();
  text = text.replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
  const parenIdx = text.indexOf(' (');
  if (parenIdx !== -1) {
    text = text.slice(0, parenIdx).trim();
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

/**
 * Parses markdown gap items from trm-research-gaps.md.
 * Supports standard task list markdown: - [ ] [GAP-01] Title / Description
 *
 * Canonical `id` is namespaced as `${localId}--${topicKey}` when topicKey is
 * non-empty so reused local bracket IDs across topics do not collide in RFC
 * gap_id / topicSlug prefixes. On-disk markdown keeps the local bracket id.
 *
 * @param {string} content - Markdown file content
 * @returns {Array<{ id: string, localId: string, topicKey: string, title: string, description: string, status: string, line: string, raw: string }>}
 */
export function parseGapItems(content) {
  const lines = content.split(/\r?\n/);
  const gaps = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match - [ ] or - [x] or - [/] followed by optional [GAP-XXX] or text
    const match = trimmed.match(/^-\s*\[([ xX/])\]\s*(?:\[([^\]]+)\])?\s*(.*)$/);
    if (match) {
      const checkState = match[1].toLowerCase();
      let status = 'pending';
      if (checkState === 'x') status = 'resolved';
      else if (checkState === '/') status = 'in-progress';

      const localId = match[2] || `GAP-${String(gaps.length + 1).padStart(2, '0')}`;
      const rawText = match[3].trim();
      const fullText = rawText.replace(/\s*\(Drafted:[^)]*\)/g, '').trim();
      
      const colonIdx = fullText.indexOf(':');
      let title = fullText;
      let description = fullText;
      if (colonIdx !== -1) {
        title = fullText.slice(0, colonIdx).trim();
        description = fullText.slice(colonIdx + 1).trim();
      }

      const topicKey = slugifyTopicKey(title);
      const id = topicKey ? `${localId}--${topicKey}` : localId;

      gaps.push({
        id,
        localId,
        topicKey,
        title,
        description,
        status,
        line: trimmed,
        raw: line
      });
    }
  }

  return gaps;
}

/**
 * Triages a single gap item against the SQLite context cache.
 * Uses cognitive query expansion, hybrid vector search (RRF), and AST call-graph grounding.
 *
 * @param {Object} dbInstance - SQLite Database instance
 * @param {Object} gap - Parsed gap object
 * @param {Object} [options]
 * @param {Function|null} [options.expandSearchQuery] - Query expander fn (async)
 * @param {Object|null} [options.circuitBreaker] - Circuit breaker instance
 * @param {Object} [options.expandOptions] - Options forwarded to expandSearchQuery
 * @returns {Promise<{ gap: Object, matchedDocuments: Array, citations: Array, rfcContent: string, topicSlug: string }>}
 */
export async function triageGapAgainstCache(dbInstance, gap, options = {}) {
  const { expandSearchQuery = null, circuitBreaker = null, expandOptions = {}, jevCircuitBreaker = null } = options;

  let query;
  let expansionMethod = 'raw';

  if (expandSearchQuery) {
    try {
      const result = await expandSearchQuery(gap, dbInstance, {
        ...expandOptions,
        circuitBreaker,
      });
      query = result.query;
      expansionMethod = result.method;
    } catch {
      // Defensive: if expander throws unexpectedly, fall back to raw query
      query = `${gap.title} ${gap.description}`.replace(/[[\]()#*]/g, ' ').trim();
    }
  } else {
    // Legacy path: raw lexical concatenation (used when --no-expand is set)
    query = `${gap.title} ${gap.description}`.replace(/[[\]()#*]/g, ' ').trim();
  }

  // 1. Lexical search via SQLite FTS5
  const searchRes = handleQueryContextCache(dbInstance, {
    query,
    category: 'all',
    limit: options.limit || 5
  });

  let lexicalHits = [];
  if (!searchRes.isError && searchRes.content?.[0]?.text) {
    try {
      lexicalHits = JSON.parse(searchRes.content[0].text);
    } catch {}
  }

  // 2. Dense vector search & RRF blending (Path B)
  let matchedDocuments = lexicalHits;
  let retrievalMode = 'lexical';

  try {
    const rawGapText = `${gap.title} ${gap.description}`;
    const embeddingRes = await generateEmbedding(rawGapText, {
      provider: expandOptions.provider === 'offline' ? 'offline' : 'auto',
      timeoutMs: 3000,
    });

    const vectorHits = searchDenseVectors(dbInstance, embeddingRes.vector, {
      limit: options.limit || 5,
    });

    if (vectorHits.length > 0) {
      matchedDocuments = reciprocalRankFusion(lexicalHits, vectorHits, {
        k: 60,
        limit: options.limit || 5,
      });
      retrievalMode = 'hybrid-rrf';
    }
  } catch {
    // Fail-soft: continue with lexical hits if vector search fails
    matchedDocuments = lexicalHits;
  }

  if (retrievalMode === 'hybrid-rrf') {
    const { matchedDocuments: filtered, applied } = await filterMatchedDocuments(
      gap, matchedDocuments, { circuitBreaker: jevCircuitBreaker }
    );
    matchedDocuments = filtered;
    if (applied) retrievalMode = 'hybrid-rrf+jev';
  }

  // 2b. Live Web Fallback (Path D: Parallel / TinyFish) if local cache has 0 matches
  const allowWebFallback = options.webFallback ?? (process.env.TRM_WEB_FALLBACK === '1');
  if (matchedDocuments.length === 0 && allowWebFallback) {
    try {
      const webHits = searchWebFallback(`${gap.title} ${gap.description}`, {
        limit: options.limit || 3,
        timeoutMs: 8000,
      });
      if (webHits.length > 0) {
        matchedDocuments = webHits;
        retrievalMode = webHits[0].retrieval_mode || 'web-fallback';
      }
    } catch {
      // Fail-soft: continue if web fallback encounters errors
    }
  }

  // 3. AST Call-Graph Grounding (Path C)
  let astSection = '';
  let groundedSymbols = [];
  try {
    const combinedSearchText = `${gap.title} ${gap.description} ${matchedDocuments.map(d => d.content || '').join(' ')}`;
    const candidateSymbols = extractCodeSymbols(combinedSearchText);
    if (candidateSymbols.length > 0) {
      const astResults = fetchAstBlastRadius(candidateSymbols, { maxSymbols: 3 });
      if (astResults.length > 0) {
        astSection = formatAstGroundingSection(astResults);
        groundedSymbols = astResults.map(r => r.symbol);
      }
    }
  } catch {
    // Fail-soft: continue without AST grounding if error occurs
  }

  if (!astSection) {
    astSection = formatAstGroundingSection([]);
  }

  const topicSlug = `rfc-${gap.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${gap.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`.replace(/-+$/, '');

  const citations = matchedDocuments.map((doc) => doc.file_path || doc.id);
  const evidenceList = matchedDocuments.length > 0
    ? matchedDocuments.map((doc) => {
        const cleanSnippet = (doc.snippet || doc.content || '')
          .replace(/\r?\n/g, ' ')
          .replace(/\[MATCH\]|\[\/MATCH\]/g, '')
          .replace(/[[\]()]/g, '')
          .slice(0, 250)
          .trim();
        const modeTag = doc.retrieval_mode ? ` [${doc.retrieval_mode}]` : '';
        return `- **${doc.topic}** (\`${doc.file_path}\`)${modeTag}:\n  > ${cleanSnippet}`;
      }).join('\n')
    : '- *No immediate context matches found in local knowledge cache. External investigation required.*';

  const rfcContent = `---
title: "RFC: ${gap.id} - ${gap.title}"
category: "research"
topic: "${topicSlug}"
gap_id: "${gap.id}"
status: "draft"
created_at: "${new Date().toISOString()}"
expansion_method: "${expansionMethod}"
retrieval_mode: "${retrievalMode}"
ast_grounded_symbols: ${JSON.stringify(groundedSymbols)}
citations: ${JSON.stringify(citations)}
---

# RFC: ${gap.id} - ${gap.title}

## 1. Problem Statement & Context
${gap.description || gap.title}

## 2. Evidence Grounding & Cache Findings
The following related context nodes were retrieved from the local knowledge base via ${retrievalMode} search:

${evidenceList}

${astSection}
## 4. Proposed Resolution & Protocol Decision
- Specify clear interface contracts and execution requirements addressing this gap.
- Maintain deterministic state across pipeline boundaries and fail-soft fallbacks.

## 5. Open Questions & Residual Risk
- [ ] Are additional integration tests required to verify protocol compliance?
- [ ] Does this resolution introduce cross-platform drift across runtime targets?
`;

  return {
    gap,
    topicSlug,
    matchedDocuments,
    citations,
    rfcContent
  };
}

/**
 * Runs the full gap triage cycle: reads gaps file, evaluates cache matches,
 * writes synthesized RFC notes to output directory, and updates gaps file with RFC links.
 * Processes gaps concurrently (up to `options.concurrency` parallel tasks).
 *
 * @param {Object} options
 * @param {string} options.gapsFilePath - Path to trm-research-gaps.md
 * @param {string} options.outputDir - Output directory for synthesized RFCs (e.g. wiki/research/)
 * @param {string} [options.dbPath] - Path to SQLite database
 * @param {boolean} [options.dryRun=false] - Dry run mode
 * @param {boolean} [options.noExpand=false] - Disable cognitive query expansion
 * @param {string} [options.provider] - LLM provider override
 * @param {string} [options.model] - LLM model override
 * @param {number} [options.timeoutMs] - Provider timeout in ms
 * @param {number} [options.concurrency] - Max parallel gap triage tasks
 * @param {boolean} [options.force=false] - Reprocess in-progress ([/]) drafted gaps
 * @returns {Promise<{ processed: number, rfcFiles: string[], updatedGapsContent: string }>}
 */
export async function executeGapTriage(options = {}) {
  const gapsPath = path.resolve(options.gapsFilePath);
  const outputDir = path.resolve(options.outputDir);
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const dryRun = !!options.dryRun;
  const noExpand = !!options.noExpand;
  const concurrency = Number(process.env.TRM_EXPANDER_CONCURRENCY ?? options.concurrency ?? 3);

  if (!fs.existsSync(gapsPath)) {
    throw new Error(`Gaps file not found at: ${gapsPath}`);
  }

  const db = getDatabase(dbPath, { readonly: true });
  const rawContent = fs.readFileSync(gapsPath, 'utf8');
  const parsedGaps = parseGapItems(rawContent);
  const force = !!options.force;
  // Default: only pending ([ ]). Skip in-progress ([/]) drafts unless --force.
  // Resolved ([x]) gaps are never reprocessed.
  const pendingGaps = parsedGaps.filter((g) => {
    if (g.status === 'resolved') return false;
    if (g.status === 'in-progress') return force;
    return g.status === 'pending';
  });

  if (!fs.existsSync(outputDir) && !dryRun) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Lazy-load expander only if needed (avoids import cost when --no-expand)
  let expandSearchQuery = null;
  let circuitBreaker = null;
  if (!noExpand) {
    const expander = await import('./query-expander.mjs');
    expandSearchQuery = expander.expandSearchQuery;
    circuitBreaker = expander.createCircuitBreaker();
  }

  const expandOptions = {
    provider: options.provider,
    ollamaModel: options.model,
    timeoutMs: options.timeoutMs,
  };

  const rfcFiles = [];
  let updatedContent = rawContent;
  let processed = 0;

  // Process gaps in bounded concurrency batches
  for (let i = 0; i < pendingGaps.length; i += concurrency) {
    const batch = pendingGaps.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((gap) =>
        triageGapAgainstCache(db, gap, {
          expandSearchQuery,
          circuitBreaker,
          expandOptions,
          webFallback: options.webFallback,
          limit: 3,
        })
      )
    );

    for (const triageResult of results) {
      const rfcFilename = `${triageResult.topicSlug}.md`;
      const rfcFullPath = path.join(outputDir, rfcFilename);

      if (!dryRun) {
        fs.writeFileSync(rfcFullPath, triageResult.rfcContent, 'utf8');
      }
      rfcFiles.push(path.relative(process.cwd(), rfcFullPath).replace(/\\/g, '/'));
      processed++;

      // Update gap line in markdown with RFC backlink (keep local bracket id on disk)
      const { gap } = triageResult;
      const bracketId = gap.localId || gap.id;
      const rfcRelativePath = path.relative(path.dirname(gapsPath), rfcFullPath).replace(/\\/g, '/');
      const updatedLine = gap.title === gap.description
        ? `- [/] [${bracketId}] ${gap.title} (Drafted: [RFC](${rfcRelativePath}))`
        : `- [/] [${bracketId}] ${gap.title}: ${gap.description} (Drafted: [RFC](${rfcRelativePath}))`;
      updatedContent = updatedContent.replace(gap.raw, updatedLine);
    }
  }

  if (!dryRun && processed > 0) {
    fs.writeFileSync(gapsPath, updatedContent, 'utf8');
  }

  db.close();

  return {
    processed,
    rfcFiles,
    updatedGapsContent: updatedContent
  };
}

/**
 * Scans vault fact cards and SQLite context cache to automatically mark
 * in-progress gaps as resolved (- [x]) when matching facts exist.
 *
 * @param {string} gapsFilePath
 * @param {Object} [options]
 * @returns {{ resolvedCount: number, resolvedGaps: string[] }}
 */
export function reconcileResolvedGaps(gapsFilePath, options = {}) {
  const gapsPath = path.resolve(gapsFilePath);
  if (!fs.existsSync(gapsPath)) return { resolvedCount: 0, resolvedGaps: [] };

  const rawContent = fs.readFileSync(gapsPath, 'utf8');
  const parsedGaps = parseGapItems(rawContent);
  const inProgressGaps = parsedGaps.filter((g) => g.status === 'in-progress');

  if (inProgressGaps.length === 0) {
    return { resolvedCount: 0, resolvedGaps: [] };
  }

  const vaultRoot = options.vaultRoot || 'C:\\Users\\soren\\trm-vault';
  const resolvedGaps = [];
  let updatedContent = rawContent;

  const topicsDir = path.join(vaultRoot, 'topics');
  const factTexts = [];
  if (fs.existsSync(topicsDir)) {
    try {
      const topics = fs.readdirSync(topicsDir);
      for (const topic of topics) {
        const factsPath = path.join(topicsDir, topic, 'extracted-facts.json');
        if (fs.existsSync(factsPath)) {
          const parsed = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
          const facts = Array.isArray(parsed) ? parsed : (parsed.facts || []);
          for (const f of facts) {
            if (f.text) factTexts.push(String(f.text).toLowerCase());
            if (f.claim) factTexts.push(String(f.claim).toLowerCase());
          }
        }
      }
    } catch {}
  }

  for (const gap of inProgressGaps) {
    const keywords = gap.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4);
    if (keywords.length >= 2) {
      const regexes = keywords.map((kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
      const match = factTexts.some((text) => regexes.every((re) => re.test(text)));
      if (match) {
        const resolvedLine = gap.raw.replace(/-\s*\[\s*\/\]/, '- [x]');
        updatedContent = updatedContent.replace(gap.raw, resolvedLine);
        resolvedGaps.push(gap.id);
      }
    }
  }

  if (resolvedGaps.length > 0 && !options.dryRun) {
    fs.writeFileSync(gapsPath, updatedContent, 'utf8');
  }

  return { resolvedCount: resolvedGaps.length, resolvedGaps };
}
