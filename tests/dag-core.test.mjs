import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDagGraph, canonicalize } from '../core/dag.mjs';

test('buildDagGraph constructs canonical nodes, canonicalizes keys, contentHash, and adjacency maps', () => {
  const chunks = [
    { file: 'docs/readme.md', anchor: 'setup', line: 25, content: 'Setup section', tags: ['SETUP', 'intro'] }
  ];
  const backlinks = [
    { source: 'docs/readme.md', target: 'missing-page.md', type: 'wikilink' }
  ];
  const fileList = ['docs/readme.md'];

  const { dag, adjacency, markdownDoc, contentHash, genId } = buildDagGraph({
    chunks,
    backlinks,
    fileList,
    commitTimestamp: '2026-08-08T07:00:00.000Z'
  });

  // 1. Assert nodes count and types (file, chunk, dangling)
  assert.equal(dag.nodes.length, 3);
  const fileNode = dag.nodes.find(n => n.node_type === 'file');
  const chunkNode = dag.nodes.find(n => n.node_type === 'chunk');
  const danglingNode = dag.nodes.find(n => n.node_type === 'dangling');

  assert.ok(fileNode);
  assert.equal(fileNode.id, 'node:file:docs/readme.md');
  assert.equal(fileNode.status, 'valid');

  assert.ok(chunkNode);
  assert.equal(chunkNode.id, 'node:chunk:docs/readme.md#setup');
  assert.deepEqual(chunkNode.tags, ['intro', 'setup']); // sorted and lowercased without #

  assert.ok(danglingNode);
  assert.equal(danglingNode.id, 'node:file:missing-page.md');
  assert.equal(danglingNode.status, 'missing');

  // 2. Assert edges count and relation types
  assert.equal(dag.edges.length, 2);
  const containsEdge = dag.edges.find(e => e.relation === 'contains');
  const wikilinkEdge = dag.edges.find(e => e.relation === 'wikilink');
  assert.ok(containsEdge);
  assert.ok(wikilinkEdge);

  // 3. Assert contentHash format and determinism
  assert.ok(contentHash.startsWith('sha256:'));
  assert.equal(contentHash.length, 7 + 64);
  assert.ok(genId);

  // 4. Assert adjacency forward and reverse maps
  assert.ok(adjacency.forward['node:file:docs/readme.md']);
  assert.deepEqual(adjacency.forward['node:file:docs/readme.md'], [
    { relation: 'contains', target: 'node:chunk:docs/readme.md#setup' },
    { relation: 'wikilink', target: 'node:file:missing-page.md' }
  ]);

  assert.ok(adjacency.reverse['node:file:missing-page.md']);
  assert.deepEqual(adjacency.reverse['node:file:missing-page.md'], [
    { relation: 'wikilink', source: 'node:file:docs/readme.md' }
  ]);

  // 5. Test canonicalize function
  const uncanonical = { z: 1, a: 2, m: { b: 3, a: 4 } };
  const canonical = canonicalize(uncanonical);
  assert.deepEqual(Object.keys(canonical), ['a', 'm', 'z']);
  assert.deepEqual(Object.keys(canonical.m), ['a', 'b']);
});
