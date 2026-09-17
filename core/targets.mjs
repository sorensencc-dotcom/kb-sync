// C:\dev\kb-sync\core\targets.mjs
// Canonical NotebookLM Target Routing Map
//
// NOTEBOOK_TARGETS / resolveNotebookId / resolveCategoryKey are re-exported
// from core/config.mjs, which builds the full category+alias map from
// core/categories.json at load time. This module previously duplicated
// that map by hand and drifted out of sync with categories.json's alias
// list (see kb-sync PR #9 review: run-closed-loop-research.mjs and
// core/dag.mjs both consumed this map directly, so a hand-copied subset
// here meant most aliases silently failed to route or exclude). Do not
// reintroduce a hardcoded map in this file.
export { NOTEBOOK_TARGETS, resolveNotebookId, resolveCategoryKey } from './config.mjs';

export function extractFrontmatterCategory(content) {
  if (!content) return 'daily';
  const match = content.match(/^category:\s*([^#\r\n]+)/m);
  if (match && match[1]) {
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return 'daily';
}
