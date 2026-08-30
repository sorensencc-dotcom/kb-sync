// kb-sync/core/config.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CATEGORIES_PATH = path.join(__dirname, 'categories.json');

export function loadCategoriesData() {
  try {
    if (fs.existsSync(CATEGORIES_PATH)) {
      const raw = fs.readFileSync(CATEGORIES_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`[CONFIG] [ERROR] Failed to load categories.json: ${err.message}`);
  }
  return { version: '2026-08-29-1', categories: {}, placeholders: {} };
}

export function validateCategoriesData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('CATEGORY_INVARIANT_VIOLATION: Data must be a non-null object');
  }
  if (!data.categories || typeof data.categories !== 'object') {
    throw new Error('CATEGORY_INVARIANT_VIOLATION: Missing categories object');
  }

  const seenTargets = new Map();
  const seenAliases = new Set();

  for (const [key, catDef] of Object.entries(data.categories)) {
    if (!catDef.target || typeof catDef.target !== 'string') {
      throw new Error(`CATEGORY_INVARIANT_VIOLATION: Category '${key}' missing valid 'target' UUID`);
    }
    if (!catDef.title || typeof catDef.title !== 'string') {
      throw new Error(`CATEGORY_INVARIANT_VIOLATION: Category '${key}' missing valid 'title' string`);
    }
    if (catDef.status !== 'canonical') {
      throw new Error(`CATEGORY_INVARIANT_VIOLATION: Category '${key}' must have status 'canonical'`);
    }

    // Check alias collisions
    if (Array.isArray(catDef.aliases)) {
      for (const alias of catDef.aliases) {
        const normAlias = alias.toLowerCase().trim();
        if (seenAliases.has(normAlias) && seenTargets.get(normAlias) !== catDef.target) {
          throw new Error(`CATEGORY_CONFLICT: Alias collision for '${normAlias}' across distinct categories`);
        }
        seenAliases.add(normAlias);
      }
    }
  }

  // Validate placeholders if present
  if (data.placeholders && typeof data.placeholders === 'object') {
    for (const [pKey, pVal] of Object.entries(data.placeholders)) {
      if (!pKey.startsWith('placeholder::')) {
        throw new Error(`CATEGORY_INVARIANT_VIOLATION: Placeholder key '${pKey}' must start with 'placeholder::'`);
      }
      const validStatuses = ['unmapped', 'mapped', 'merged', 'retired'];
      if (!validStatuses.includes(pVal.status)) {
        throw new Error(`CATEGORY_INVARIANT_VIOLATION: Placeholder '${pKey}' invalid status '${pVal.status}'`);
      }
    }
  }

  return true;
}

export function saveCategoriesData(data) {
  validateCategoriesData(data);
  const tmpPath = `${CATEGORIES_PATH}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, CATEGORIES_PATH);
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
    throw new Error(`Failed to atomically save categories.json: ${err.message}`);
  }
}

export function buildNotebookTargetMap(categoriesData = loadCategoriesData()) {
  const map = {};
  const categories = categoriesData.categories || {};
  for (const [key, catDef] of Object.entries(categories)) {
    map[key.toLowerCase().trim()] = catDef.target;
    if (Array.isArray(catDef.aliases)) {
      for (const alias of catDef.aliases) {
        map[alias.toLowerCase().trim()] = catDef.target;
      }
    }
  }
  return map;
}

export const NOTEBOOK_TARGETS = buildNotebookTargetMap();

export function resolveNotebookId(category, options = {}) {
  if (!category) return NOTEBOOK_TARGETS['daily'] || '1b4861a3-931f-4632-8fc1-343a8dd37df8';
  const normalized = String(category).toLowerCase().trim();
  
  const currentTargets = buildNotebookTargetMap();
  if (currentTargets[normalized]) {
    return currentTargets[normalized];
  }

  // Deterministic Placeholder Lifecycle Management
  const catData = loadCategoriesData();
  const placeholderKey = `placeholder::${normalized}`;
  
  if (!catData.placeholders) {
    catData.placeholders = {};
  }

  if (!catData.placeholders[placeholderKey]) {
    const placeholderEntry = {
      category: placeholderKey,
      slug: normalized,
      created_at: new Date().toISOString(),
      source: options.source || 'runtime',
      status: 'unmapped',
      candidate_files: options.candidateFiles || 1,
      fallback_notebook_id: currentTargets['daily'] || '1b4861a3-931f-4632-8fc1-343a8dd37df8',
      operator_required: true
    };
    catData.placeholders[placeholderKey] = placeholderEntry;
    saveCategoriesData(catData);

    if (options.warnOnPlaceholder !== false) {
      console.warn(`[CONFIG] [PLACEHOLDER] Unmapped topic '${normalized}' detected. Registered placeholder '${placeholderKey}'. Requires operator assignment before ingestion.`);
    }
  }

  return currentTargets['daily'] || '1b4861a3-931f-4632-8fc1-343a8dd37df8';
}
