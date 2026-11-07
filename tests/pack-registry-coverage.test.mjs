import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMATIC_PACK_MAP } from '../scripts/consolidate-pack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'state', 'knowledge-plane-notebooks.json'), 'utf8')
);

// The research sync uploads whatever consolidate-pack.mjs wrote. A notebook that
// expects a pack nobody builds is skipped with a WARN on every run.
test('every research-sync notebook that expects a pack has a builder in THEMATIC_PACK_MAP', () => {
  const built = new Set(THEMATIC_PACK_MAP.map((p) => p.filename.replace(/\.txt$/i, '')));
  const missing = [];
  for (const [clusterName, cluster] of Object.entries(registry.clusters || {})) {
    if (cluster.execution_target !== 'research_sync') continue;
    for (const nb of cluster.notebooks || []) {
      if (nb.has_pack === false || nb.pack_writer === 'master' || nb.skip_ops_pack_sync === true) continue;
      if (!built.has(nb.pack_family)) missing.push(`${clusterName}/${nb.key} -> ${nb.pack_family}`);
    }
  }
  assert.deepEqual(missing, [], `notebooks expect packs no builder emits:\n${missing.join('\n')}`);
});
