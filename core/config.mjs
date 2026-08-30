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
  return { version: '1.0.0', categories: {}, placeholders: {} };
}

export function saveCategoriesData(data) {
  try {
    fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[CONFIG] [ERROR] Failed to save categories.json: ${err.message}`);
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
  
  // Re-read map in case runtime additions occurred
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
      status: 'unmapped', // unmapped | mapped | merged | retired
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


