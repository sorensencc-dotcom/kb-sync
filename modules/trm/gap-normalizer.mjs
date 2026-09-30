/**
 * gap-normalizer.mjs
 *
 * Topic Research Mining (TRM) Gap Normalization, Deduplication, and Identity Engine.
 * Implements deterministic scope hashing, alias resolution, and cross-notebook provenance tracking.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

export function canonicalizeSpanText(rawText) {
  if (!rawText) return '';
  return String(rawText)
    .normalize('NFKD')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\[\^[\w-]+\]/g, '')
    .replace(/\[Source:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeSpanHash(sourceId, canonicalExcerpt) {
  return crypto
    .createHash('sha256')
    .update(`${sourceId}::${canonicalExcerpt}`, 'utf8')
    .digest('hex');
}

/**
 * Normalizes raw gap text by stripping citation artifacts, markdown headings,
 * and conversational noise while preserving semantic tokens.
 *
 * @param {string} rawText
 * @returns {string}
 */
export function normalizeGapText(rawText) {
  if (!rawText) return '';
  const lines = String(rawText).trim().split(/\r?\n/);
  if (lines.length > 2 && lines[0].includes('|') && /^\|\s*-+/.test(lines[1])) {
    const bodyRows = lines.slice(2).sort((a, b) => {
      const left = a.split('|')[1]?.trim() || a;
      const right = b.split('|')[1]?.trim() || b;
      return left.localeCompare(right);
    });
    return [lines[0], lines[1], ...bodyRows].join('\n').toLowerCase();
  }

  return String(rawText)
    // Remove markdown citation markers e.g. [1], [2-4]
    .replace(/\[\d+(?:-\d+)?\]/g, '')
    // Remove markdown bold/italic/header tokens
    .replace(/[*_#`~]+/g, ' ')
    // Remove conversational filler and drafting tags
    .replace(/\(Drafted:[^)]*\)/gi, '')
    // Collapse multiple whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatLineageHeader(metadata) {
  return `<!-- TRM-LINEAGE: ${JSON.stringify(metadata)} -->\n`;
}

export function parseLineageHeader(markdown) {
  const match = String(markdown || '').match(/<!-- TRM-LINEAGE: (\{.*?\}) -->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Extracts atomic research elements (entity, claim, time period, location) from gap text.
 * Falls back to deterministic heuristic tokenization when NLP metadata is not provided.
 *
 * @param {string} text
 * @returns {{ entity: string, claim: string, timePeriod: string, location: string }}
 */
export function extractAtomicElements(text) {
  const normalized = normalizeGapText(text);
  
  // Extract 4-digit years (e.g. 1919, 1945, 1947) if present
  const yearMatch = normalized.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/);
  const timePeriod = yearMatch ? yearMatch[1] : '';

  // Extract known geographic or facility anchors if present
  const locMatch = normalized.match(/\b(Willow Run|River Rouge|Rouge|Cuba|Cuban|Detroit|Dearborn|Toledo|Washtenaw|Wayne County)\b/i);
  const location = locMatch ? locMatch[1].toLowerCase() : '';

  // Separate subject entity from predicate claim
  const parts = normalized.split(/[:\-\—\–]/);
  let entity = '';
  let claim = normalized;

  if (parts.length > 1 && parts[0].trim().length > 0 && parts[0].trim().length < 60) {
    entity = parts[0].trim().toLowerCase();
    claim = parts.slice(1).join(' ').trim().toLowerCase();
  } else {
    // Take first 3-5 tokens as entity anchor
    const words = normalized.split(/\s+/);
    entity = words.slice(0, Math.min(4, words.length)).join(' ').toLowerCase();
    claim = normalized.toLowerCase();
  }

  return {
    entity: entity.replace(/[^a-z0-9\s]/g, '').trim(),
    claim: claim.replace(/[^a-z0-9\s]/g, '').trim(),
    timePeriod,
    location
  };
}

/**
 * Computes a deterministic SHA-256 scope hash using unit-separator (\x1f) delimiters.
 * Delimiters prevent hash collisions between adjacent concatenated fields.
 *
 * @param {{ entity: string, claim: string, timePeriod?: string, location?: string } | string} input
 * @returns {string} SHA-256 hex string (64 characters)
 */
export function computeScopeHash(input) {
  let elements;
  if (typeof input === 'string') {
    elements = extractAtomicElements(input);
  } else {
    elements = {
      entity: String(input.entity || '').trim().toLowerCase(),
      claim: String(input.claim || '').trim().toLowerCase(),
      timePeriod: String(input.timePeriod || '').trim(),
      location: String(input.location || '').trim().toLowerCase()
    };
  }

  const payload = [
    elements.entity,
    elements.claim,
    elements.timePeriod,
    elements.location
  ].join('\x1f');

  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Loads the canonical alias dictionary from disk.
 *
 * @param {string} aliasFilePath
 * @returns {Record<string, string>} Mapping from alias string or hash to canonical gapId
 */
export function loadGapAliases(aliasFilePath) {
  if (!aliasFilePath || !fs.existsSync(aliasFilePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(aliasFilePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[gap-normalizer] Failed to load aliases from ${aliasFilePath}: ${err.message}`);
    return {};
  }
}

/**
 * Resolves the canonical identity of a gap candidate against existing registry gaps and alias maps.
 *
 * @param {Object} candidate - { title, description, raw, notebookName, entryKey, date }
 * @param {Array<Object>} existingGaps - Array of canonical gap records
 * @param {Record<string, string>} [aliasMap={}] - Alias mapping
 * @returns {{ tier: number, matchType: string, canonicalGapId: string|null, existingGap: Object|null, scopeHash: string }}
 */
export function resolveGapIdentity(candidate, existingGaps = [], aliasMap = {}) {
  const fullText = `${candidate.title || ''} ${candidate.description || ''}`.trim();
  const elements = extractAtomicElements(fullText);
  const scopeHash = computeScopeHash(elements);

  // Tier 1: Exact scope_hash match
  const exactMatch = existingGaps.find(g => g.scope_hash === scopeHash || g.scopeHash === scopeHash);
  if (exactMatch) {
    return {
      tier: 1,
      matchType: 'exact_scope_hash',
      canonicalGapId: exactMatch.gap_id || exactMatch.id || exactMatch.localId,
      existingGap: exactMatch,
      scopeHash
    };
  }

  // Tier 2: Alias dictionary match (by alias text or alias hash)
  const normalizedTitle = normalizeGapText(candidate.title || '').toLowerCase();
  if (aliasMap[normalizedTitle]) {
    const targetId = aliasMap[normalizedTitle];
    const aliasTarget = existingGaps.find(g => (g.gap_id || g.id || g.localId) === targetId);
    return {
      tier: 2,
      matchType: 'alias_lookup',
      canonicalGapId: targetId,
      existingGap: aliasTarget || null,
      scopeHash
    };
  }

  if (aliasMap[scopeHash]) {
    const targetId = aliasMap[scopeHash];
    const aliasTarget = existingGaps.find(g => (g.gap_id || g.id || g.localId) === targetId);
    return {
      tier: 2,
      matchType: 'alias_hash_lookup',
      canonicalGapId: targetId,
      existingGap: aliasTarget || null,
      scopeHash
    };
  }

  // Tier 4: Greenfield / Unmatched
  return {
    tier: 4,
    matchType: 'greenfield',
    canonicalGapId: null,
    existingGap: null,
    scopeHash
  };
}

/**
 * Ingests a collection of mined gap candidates across notebooks, deduplicates against
 * existing canonical gaps, merges source provenance, and filters out retired/resolved items.
 *
 * @param {Array<Object>} minedCandidates - Raw mined rows across notebooks
 * @param {Array<Object>} existingRegistry - Current canonical registry records
 * @param {Record<string, string>} [aliasMap={}] - Alias dictionary
 * @returns {{
 *   deduplicatedGaps: Array<Object>,
 *   retiredSuppressions: Array<Object>,
 *   mergedOccurrences: Array<Object>,
 *   newGaps: Array<Object>
 * }}
 */
export function deduplicateMinedGaps(minedCandidates = [], existingRegistry = [], aliasMap = {}) {
  const registry = [...existingRegistry];
  const deduplicatedGaps = [];
  const retiredSuppressions = [];
  const mergedOccurrences = [];
  const newGaps = [];

  for (const candidate of minedCandidates) {
    const resolution = resolveGapIdentity(candidate, registry, aliasMap);

    if (resolution.tier === 1 || resolution.tier === 2) {
      const target = resolution.existingGap;
      const targetStatus = (target?.status || '').toLowerCase();

      // Check if previously resolved or retired
      if (targetStatus === 'resolved' || targetStatus === 'retired' || targetStatus === 'published') {
        retiredSuppressions.push({
          candidate,
          canonicalGapId: resolution.canonicalGapId,
          status: targetStatus,
          reason: 'Already grounded and resolved in canonical knowledge base'
        });
        continue;
      }

      // Merge multi-notebook provenance
      if (target) {
        target.source_notebooks = target.source_notebooks || [];
        const exists = target.source_notebooks.some(
          src => src.notebook_name === candidate.notebookName && src.entry_key === candidate.entryKey
        );
        if (!exists) {
          target.source_notebooks.push({
            notebook_name: candidate.notebookName,
            first_seen: candidate.firstSeen || new Date().toISOString(),
            entry_key: candidate.entryKey || ''
          });
        }
        mergedOccurrences.push({
          candidate,
          canonicalGapId: resolution.canonicalGapId,
          tier: resolution.tier
        });
      }
    } else {
      // Greenfield gap
      const newId = `GAP-${String(registry.length + newGaps.length + 1).padStart(2, '0')}`;
      const newGap = {
        gap_id: newId,
        id: newId,
        localId: newId,
        title: candidate.title,
        description: candidate.description,
        scope_hash: resolution.scopeHash,
        status: 'discovered',
        source_notebooks: [{
          notebook_name: candidate.notebookName,
          first_seen: candidate.firstSeen || new Date().toISOString(),
          entry_key: candidate.entryKey || ''
        }],
        first_seen: candidate.firstSeen || new Date().toISOString(),
        last_seen: new Date().toISOString()
      };
      newGaps.push(newGap);
      registry.push(newGap);
      deduplicatedGaps.push(newGap);
    }
  }

  return {
    deduplicatedGaps,
    retiredSuppressions,
    mergedOccurrences,
    newGaps,
    updatedRegistry: registry
  };
}
