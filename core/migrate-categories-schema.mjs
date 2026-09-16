#!/usr/bin/env node
// Additive migration for kb-sync/core/categories.json:
// - bumps schema version and adds a `rules` block (case_sensitive, max_category_depth,
//   unmapped_fallback) for the extraction-pipeline taxonomy work
// - optionally merges new canonical categories from a --seed file, each of which must
//   already carry a real `target` (NotebookLM UUID) and `title` -- this script never
//   invents one, since assigning a category's routing target is an operator decision
// - never touches existing categories/placeholders entries and never renames the
//   top-level `categories` key, since core/config.mjs's loadCategoriesData /
//   validateCategoriesData / buildNotebookTargetMap read that shape directly
//
// Usage:
//   node core/migrate-categories-schema.mjs                 # rules-only migration
//   node core/migrate-categories-schema.mjs --seed new.json # also merge new categories
//   node core/migrate-categories-schema.mjs --dry-run [--seed new.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCategoriesData } from './config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CATEGORIES_PATH = path.join(__dirname, 'categories.json');

const DEFAULT_RULES = {
  case_sensitive: false,
  max_category_depth: 2,
  unmapped_fallback: 'uncategorized'
};

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const seedIdx = argv.indexOf('--seed');
  const seedPath = seedIdx !== -1 ? argv[seedIdx + 1] : null;
  if (seedIdx !== -1 && !seedPath) {
    throw new Error('--seed requires a file path');
  }
  return { dryRun, seedPath };
}

function loadSeedCategories(seedPath) {
  const resolved = path.resolve(process.cwd(), seedPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const seed = JSON.parse(raw);
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) {
    throw new Error(`Seed file must be a JSON object of {categoryKey: categoryDef}: ${resolved}`);
  }
  return seed;
}

// Mirrors the alias-collision check in config.mjs validateCategoriesData, run ahead of
// merge so a bad seed entry is rejected before it ever touches categories.json.
function checkAliasCollisions(existingCategories, seedCategories) {
  const seenAliases = new Map(); // normalized alias/key -> owning category key

  for (const [key, def] of Object.entries(existingCategories)) {
    seenAliases.set(key.toLowerCase().trim(), key);
    for (const alias of def.aliases || []) {
      seenAliases.set(alias.toLowerCase().trim(), key);
    }
  }

  const conflicts = [];
  for (const [key, def] of Object.entries(seedCategories)) {
    const normKey = key.toLowerCase().trim();
    if (seenAliases.has(normKey) && seenAliases.get(normKey) !== key) {
      conflicts.push(`seed category key '${key}' collides with existing category/alias '${seenAliases.get(normKey)}'`);
    }
    for (const alias of def.aliases || []) {
      const normAlias = alias.toLowerCase().trim();
      if (seenAliases.has(normAlias) && seenAliases.get(normAlias) !== key) {
        conflicts.push(`seed alias '${alias}' (category '${key}') collides with existing category/alias '${seenAliases.get(normAlias)}'`);
      }
      seenAliases.set(normAlias, key);
    }
    seenAliases.set(normKey, key);
  }
  return conflicts;
}

function validateSeedEntry(key, def) {
  const errors = [];
  if (!def.target || typeof def.target !== 'string') {
    errors.push(`seed category '${key}' missing valid 'target' UUID -- assign a real NotebookLM notebook id or drop it from the seed and register it as a placeholder instead`);
  }
  if (!def.title || typeof def.title !== 'string') {
    errors.push(`seed category '${key}' missing valid 'title' string`);
  }
  if (def.status !== 'canonical') {
    errors.push(`seed category '${key}' must have status 'canonical'`);
  }
  return errors;
}

function main() {
  const { dryRun, seedPath } = parseArgs(process.argv.slice(2));

  const raw = fs.readFileSync(CATEGORIES_PATH, 'utf8');
  const current = JSON.parse(raw);
  validateCategoriesData(current); // fail loudly if the file is already inconsistent

  const migrated = {
    ...current,
    version: '2.0.0',
    rules: { ...DEFAULT_RULES, ...(current.rules || {}) },
    categories: { ...current.categories },
    placeholders: { ...(current.placeholders || {}) }
  };

  if (seedPath) {
    const seed = loadSeedCategories(seedPath);

    const entryErrors = Object.entries(seed).flatMap(([key, def]) => validateSeedEntry(key, def));
    if (entryErrors.length) {
      console.error('[MIGRATE-CATEGORIES] Seed validation failed:');
      for (const err of entryErrors) console.error(`  - ${err}`);
      process.exit(1);
    }

    const collisions = checkAliasCollisions(migrated.categories, seed);
    if (collisions.length) {
      console.error('[MIGRATE-CATEGORIES] Alias collisions between seed and existing categories:');
      for (const c of collisions) console.error(`  - ${c}`);
      process.exit(1);
    }

    for (const [key, def] of Object.entries(seed)) {
      if (migrated.categories[key]) {
        console.error(`[MIGRATE-CATEGORIES] Seed category '${key}' already exists in categories.json -- refusing to overwrite`);
        process.exit(1);
      }
      migrated.categories[key] = def;
    }
  }

  validateCategoriesData(migrated); // re-validate the merged result against the live invariants

  if (dryRun) {
    console.log(JSON.stringify(migrated, null, 2));
    console.log(`\n[MIGRATE-CATEGORIES] Dry run OK. ${Object.keys(migrated.categories).length} categories, ${seedPath ? Object.keys(loadSeedCategories(seedPath)).length : 0} added from seed.`);
    return;
  }

  const backupPath = `${CATEGORIES_PATH}.bak-${Date.now()}`;
  fs.copyFileSync(CATEGORIES_PATH, backupPath);

  const tmpPath = `${CATEGORIES_PATH}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(migrated, null, 2), 'utf8');
    fs.renameSync(tmpPath, CATEGORIES_PATH);
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
    throw new Error(`Failed to write migrated categories.json: ${err.message}`);
  }

  console.log(`[MIGRATE-CATEGORIES] Migrated to schema 2.0.0. Backup written to ${backupPath}.`);
}

main();
