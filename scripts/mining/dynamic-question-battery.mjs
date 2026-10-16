#!/usr/bin/env node
/**
 * scripts/mining/dynamic-question-battery.mjs
 *
 * Dynamic Question Battery Generator with Fallback Auto-Heal (PR #140 / ACT-20261015).
 *
 * Requirements:
 * 1. Query knowledge.db for the top 3 recently modified AST entities and open gaps for the target notebook.
 * 2. Fallback Rule: If fewer than 2 active AST entities exist, fall back to a deterministic,
 *    high-entropy domain battery built from core/categories.json rather than returning an empty array
 *    or tripping the low-token-density circuit breaker.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export const DEFAULT_DB_PATH = path.resolve(REPO_ROOT, '.kb_cache/knowledge.db');
export const DEFAULT_CATEGORIES_PATH = path.resolve(REPO_ROOT, 'core/categories.json');
export const DEFAULT_GAPS_PATH = path.resolve(REPO_ROOT, 'trm-research-gaps.md');

/**
 * Calculates Shannon entropy of a string (in bits per character).
 */
export function calculateContentEntropy(text) {
  if (!text || typeof text !== 'string') return 0;
  const clean = text.trim();
  if (clean.length === 0) return 0;
  const freq = new Map();
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  let entropy = 0;
  const total = clean.length;
  for (const count of freq.values()) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return parseFloat(entropy.toFixed(3));
}

/**
 * Calculates aggregate Shannon entropy of an array of question objects.
 */
export function calculateBatteryEntropy(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return 0;
  const joined = questions.map((q) => (typeof q === 'string' ? q : q.text || '')).join(' ');
  return calculateContentEntropy(joined);
}

/**
 * Loads categories data from core/categories.json.
 */
export function loadCategories(categoriesPath = DEFAULT_CATEGORIES_PATH) {
  if (!fs.existsSync(categoriesPath)) return { categories: {} };
  try {
    return JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));
  } catch {
    return { categories: {} };
  }
}

/**
 * Resolves notebook metadata from key, slug, uuid, or title.
 */
export function resolveNotebookMetadata(target, categoriesPath = DEFAULT_CATEGORIES_PATH) {
  const norm = String(target || '').toLowerCase().trim();
  const catData = loadCategories(categoriesPath);
  const categories = catData.categories || {};

  // Direct match on key
  if (categories[norm]) {
    return {
      key: norm,
      uuid: categories[norm].target,
      title: categories[norm].title,
      aliases: categories[norm].aliases || [],
      domain: categories[norm].domain || categories[norm].title,
    };
  }

  // Match on target UUID or aliases
  for (const [key, catDef] of Object.entries(categories)) {
    if (catDef.target && catDef.target.toLowerCase() === norm) {
      return {
        key,
        uuid: catDef.target,
        title: catDef.title,
        aliases: catDef.aliases || [],
        domain: catDef.domain || catDef.title,
      };
    }
    if (Array.isArray(catDef.aliases) && catDef.aliases.some((a) => a.toLowerCase().trim() === norm)) {
      return {
        key,
        uuid: catDef.target,
        title: catDef.title,
        aliases: catDef.aliases || [],
        domain: catDef.domain || catDef.title,
      };
    }
    if (catDef.title && catDef.title.toLowerCase().includes(norm)) {
      return {
        key,
        uuid: catDef.target,
        title: catDef.title,
        aliases: catDef.aliases || [],
        domain: catDef.domain || catDef.title,
      };
    }
  }

  return {
    key: norm,
    uuid: norm,
    title: norm,
    aliases: [],
    domain: norm,
  };
}

/**
 * Loads open research gaps for a target notebook from trm-research-gaps.md.
 */
export function loadOpenGapsForNotebook(notebookTitle, gapsPath = DEFAULT_GAPS_PATH, limit = 3) {
  if (!fs.existsSync(gapsPath)) return [];
  try {
    const content = fs.readFileSync(gapsPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const cleanTitle = notebookTitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const matched = [];

    for (const line of lines) {
      if (!line.startsWith('- [ ]')) continue;
      const lower = line.toLowerCase();
      if (lower.includes(cleanTitle) || lower.includes(notebookTitle.toLowerCase())) {
        const match = line.match(/\*\*([^*]+)\*\*:\s*(.*)$/);
        if (match) {
          matched.push({
            title: match[1].trim(),
            context: match[2].trim(),
          });
        }
      }
      if (matched.length >= limit) break;
    }
    return matched;
  } catch {
    return [];
  }
}

/**
 * Queries knowledge.db for the top 3 recently modified AST entities matching the notebook.
 */
export function queryRecentlyModifiedEntities(notebookMeta, dbPath = DEFAULT_DB_PATH, limit = 3) {
  if (!fs.existsSync(dbPath)) return [];

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    // Check if kb_documents table exists
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kb_documents'").get();
    if (!tableCheck) {
      db.close();
      return [];
    }

    const searchPatterns = [
      notebookMeta.key,
      notebookMeta.title,
      ...(notebookMeta.aliases || []),
    ].map((s) => `%${s.toLowerCase()}%`);

    const query = `
      SELECT id, topic, file_path, abstract, substr(content, 1, 300) AS excerpt, last_updated
      FROM kb_documents
      WHERE (
        LOWER(topic) LIKE ?
        OR LOWER(category) LIKE ?
        OR LOWER(file_path) LIKE ?
      )
      ORDER BY last_updated DESC
      LIMIT ?
    `;

    const stmt = db.prepare(query);
    const results = stmt.all(searchPatterns[0], searchPatterns[0], searchPatterns[0], limit);
    db.close();
    return results || [];
  } catch (err) {
    if (db) {
      try { db.close(); } catch (_) {}
    }
    return [];
  }
}

/**
 * Generates a deterministic, high-entropy domain battery built from core/categories.json.
 */
export function generateDomainFallbackBattery(notebookMeta) {
  const { key, title, domain, aliases } = notebookMeta;
  const aliasStr = (aliases && aliases.length > 0) ? ` (aliases: ${aliases.slice(0, 3).join(', ')})` : '';

  const questions = [
    {
      id: `domain-contradiction-${key}`,
      text: `Analyze primary documentary sources for ${title}: identify open contradictions, unresolved technical discrepancies, or diverging historical evidence regarding ${domain}${aliasStr}.`,
    },
    {
      id: `domain-undercorroborated-${key}`,
      text: `In ${title}, examine critical assertions, technical milestones, or architectural decisions that remain single-sourced without independent corroboration. Specify verifiable provenance records required to ground these claims.`,
    },
    {
      id: `domain-adjacent-frontiers-${key}`,
      text: `Explore adjacent domains and unindexed primary accessions linked to ${title}. What external archival collections, legal depositions, engineering specifications, or subsystem interfaces require immediate triage?`,
    },
    {
      id: `domain-synthesis-connections-${key}`,
      text: `Discover non-obvious operational, governance, or evidentiary correlations between ${title} and broader ecosystem dependencies, isolating cross-domain coupling and latent systemic risks.`,
    },
  ];

  return questions;
}

/**
 * Main Dynamic Question Battery Generator.
 * Enforces AST entity grounding with high-entropy fallback auto-heal.
 */
export function generateDynamicQuestionBattery(target, options = {}) {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const categoriesPath = options.categoriesPath || DEFAULT_CATEGORIES_PATH;
  const gapsPath = options.gapsPath || DEFAULT_GAPS_PATH;

  const notebookMeta = resolveNotebookMetadata(target, categoriesPath);
  const entities = queryRecentlyModifiedEntities(notebookMeta, dbPath, 3);
  const openGaps = loadOpenGapsForNotebook(notebookMeta.title, gapsPath, 3);

  let questions = [];
  let source = 'ast_entities';

  // Fallback Rule: If fewer than 2 active AST entities exist, fall back to high-entropy domain battery
  if (!entities || entities.length < 2) {
    source = 'domain_fallback';
    const fallback = generateDomainFallbackBattery(notebookMeta);

    // If we have any open gaps, inject up to 2 gap questions alongside domain questions
    if (openGaps.length > 0) {
      const gapQuestions = openGaps.slice(0, 2).map((gap, idx) => ({
        id: `open-gap-${idx + 1}-${crypto.createHash('md5').update(gap.title).digest('hex').slice(0, 6)}`,
        text: `Resolve open research gap in ${notebookMeta.title}: "${gap.title}". Ground specific inquiry: ${gap.context.slice(0, 180)}`,
      }));
      questions = [...gapQuestions, ...fallback.slice(0, 4 - gapQuestions.length)];
    } else {
      questions = fallback;
    }
  } else {
    // Grounded in AST entities
    questions = entities.map((ent, idx) => {
      const topicName = ent.topic || path.basename(ent.file_path || '', '.md');
      const snippet = (ent.abstract || ent.excerpt || '').replace(/\r?\n/g, ' ').slice(0, 140);
      return {
        id: `ast-entity-${idx + 1}-${crypto.createHash('md5').update(topicName).digest('hex').slice(0, 6)}`,
        text: `Investigate recently modified entity "${topicName}" in ${notebookMeta.title}: resolve open technical questions and verify empirical citations against primary records: ${snippet}`,
      };
    });

    if (openGaps.length > 0) {
      questions.push({
        id: `ast-gap-${crypto.createHash('md5').update(openGaps[0].title).digest('hex').slice(0, 6)}`,
        text: `Cross-reference entity evidence with open gap: "${openGaps[0].title}". Determine whether existing documentary records satisfy the verification gate.`,
      });
    }
  }

  const entropy = calculateBatteryEntropy(questions);

  return {
    notebook: notebookMeta,
    source,
    entityCount: entities ? entities.length : 0,
    gapCount: openGaps.length,
    entropy,
    circuitBreakerSafe: entropy >= 3.0,
    questions,
  };
}

// CLI entry point
const mainFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
const thisFile = fs.realpathSync(__filename);
if (mainFile === thisFile) {
  const target = process.argv[2] || 'daily';
  try {
    const result = generateDynamicQuestionBattery(target);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`[ERROR] Dynamic question battery generation failed: ${err.message}`);
    process.exit(1);
  }
}
