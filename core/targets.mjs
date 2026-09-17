// C:\dev\kb-sync\core\targets.mjs
// Canonical NotebookLM Target Routing Map
//
// NOTEBOOK_TARGETS / resolveCategoryKey are re-exported from
// core/config.mjs, which builds the full category+alias map from
// core/categories.json at load time. This module previously duplicated
// that map by hand and drifted out of sync with categories.json's alias
// list (see kb-sync PR #9 review: run-closed-loop-research.mjs and
// core/dag.mjs both consumed this map directly, so a hand-copied subset
// here meant most aliases silently failed to route or exclude). Do not
// reintroduce a hardcoded map in this file.
import { NOTEBOOK_TARGETS } from './config.mjs';

export { NOTEBOOK_TARGETS, resolveCategoryKey } from './config.mjs';

// Deliberately NOT a re-export of core/config.mjs's resolveNotebookId:
// that resolver persists an unmapped category as a placeholder in
// categories.json (via saveCategoriesData), which throws on read-only
// installs and is the wrong contract for callers that only want routing.
// This resolver stays pure and fail-soft, as it always has: unknown
// categories fall back to the 'daily' notebook, no filesystem writes.
export function resolveNotebookId(category) {
  if (!category) return NOTEBOOK_TARGETS['daily'] || '1b4861a3-931f-4632-8fc1-343a8dd37df8';
  const normalized = String(category).toLowerCase().trim();
  return NOTEBOOK_TARGETS[normalized] || NOTEBOOK_TARGETS['daily'] || '1b4861a3-931f-4632-8fc1-343a8dd37df8';
}

export function extractFrontmatterCategory(content) {
  if (!content) return 'daily';
  const match = content.match(/^category:\s*([^#\r\n]+)/m);
  if (match && match[1]) {
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return 'daily';
}
