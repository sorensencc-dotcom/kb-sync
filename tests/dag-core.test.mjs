import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDagGraph, canonicalize, countNonTrivialSCCs } from '../core/dag.mjs';

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

test('countNonTrivialSCCs reports 0 for an acyclic graph', () => {
  const nodes = [{ id: 'node:file:a.md' }, { id: 'node:file:b.md' }];
  const edges = [{ source: 'node:file:a.md', target: 'node:file:b.md' }];
  assert.equal(countNonTrivialSCCs(nodes, edges), 0);
});

test('countNonTrivialSCCs detects a self-loop as one non-trivial SCC', () => {
  const nodes = [{ id: 'node:file:a.md' }];
  const edges = [{ source: 'node:file:a.md', target: 'node:file:a.md' }];
  assert.equal(countNonTrivialSCCs(nodes, edges), 1);
});

test('countNonTrivialSCCs detects a multi-node cycle as one non-trivial SCC', () => {
  const nodes = [{ id: 'node:file:a.md' }, { id: 'node:file:b.md' }, { id: 'node:file:c.md' }];
  const edges = [
    { source: 'node:file:a.md', target: 'node:file:b.md' },
    { source: 'node:file:b.md', target: 'node:file:a.md' },
    { source: 'node:file:b.md', target: 'node:file:c.md' }
  ];
  assert.equal(countNonTrivialSCCs(nodes, edges), 1);
});

test('buildDagGraph populates cycles_count from real backlink cycles, not hardcoded 0', () => {
  const backlinks = [
    { source: 'a.md', target: 'b.md', type: 'wikilink' },
    { source: 'b.md', target: 'a.md', type: 'wikilink' }
  ];
  const { dag } = buildDagGraph({
    chunks: [],
    backlinks,
    fileList: ['a.md', 'b.md'],
    commitTimestamp: '2026-08-08T00:00:00.000Z'
  });
  assert.equal(dag.metadata.cycles_count, 1);
});

test('buildDagGraph deduplicates chunk anchors on the same file and handles default anchor', () => {
  const chunks = [
    { file: 'docs/guide.md', anchor: 'intro', line: 10, content: 'First intro' },
    { file: 'docs/guide.md', anchor: 'intro', line: 45, content: 'Second intro' },
    { file: 'docs/guide.md', line: 80, content: 'No anchor specified' },
    { file: 'docs/guide.md', line: 120, content: 'Another no anchor' }
  ];
  const fileList = ['docs/guide.md'];

  const { dag } = buildDagGraph({ chunks, fileList });

  const chunkNodes = dag.nodes.filter(n => n.node_type === 'chunk');
  assert.equal(chunkNodes.length, 4);

  // First 'intro' keeps base anchor
  assert.equal(chunkNodes[0].anchor, 'intro');
  assert.equal(chunkNodes[0].id, 'node:chunk:docs/guide.md#intro');

  // Second 'intro' gets line number suffix
  assert.equal(chunkNodes[1].anchor, 'intro_L45');
  assert.equal(chunkNodes[1].id, 'node:chunk:docs/guide.md#intro_L45');

  // First chunk without anchor defaults to 'section'
  assert.equal(chunkNodes[2].anchor, 'section');
  assert.equal(chunkNodes[2].id, 'node:chunk:docs/guide.md#section');

  // Second chunk without anchor gets 'section_L120'
  assert.equal(chunkNodes[3].anchor, 'section_L120');
  assert.equal(chunkNodes[3].id, 'node:chunk:docs/guide.md#section_L120');
});

test('buildDagGraph links a backlink to an existing file node instead of creating a dangling one', () => {
  const backlinks = [
    { source: 'a.md', target: 'b.md', type: 'wikilink' }
  ];
  const { dag } = buildDagGraph({ chunks: [], backlinks, fileList: ['a.md', 'b.md'] });

  assert.equal(dag.nodes.length, 2);
  const targetNode = dag.nodes.find(n => n.id === 'node:file:b.md');
  assert.ok(targetNode);
  assert.equal(targetNode.node_type, 'file');
  assert.equal(targetNode.status, 'valid');
});

test('buildDagGraph defaults backlink relation to wikilink when type is omitted', () => {
  const backlinks = [{ source: 'a.md', target: 'b.md' }];
  const { dag } = buildDagGraph({ chunks: [], backlinks, fileList: ['a.md'] });

  const edge = dag.edges.find(e => e.source === 'node:file:a.md' && e.target === 'node:file:b.md');
  assert.ok(edge);
  assert.equal(edge.relation, 'wikilink');
});

test('buildDagGraph collapses duplicate backlink edges with the same source/target/relation', () => {
  const backlinks = [
    { source: 'a.md', target: 'b.md', type: 'wikilink' },
    { source: 'a.md', target: 'b.md', type: 'wikilink' }
  ];
  const { dag } = buildDagGraph({ chunks: [], backlinks, fileList: ['a.md', 'b.md'] });

  const matching = dag.edges.filter(e => e.source === 'node:file:a.md' && e.target === 'node:file:b.md');
  assert.equal(matching.length, 1);
});

test('buildDagGraph renders a truncation notice instead of a mermaid diagram past 50 nodes', () => {
  const fileList = Array.from({ length: 51 }, (_, i) => `file-${i}.md`);
  const { markdownDoc } = buildDagGraph({ chunks: [], backlinks: [], fileList });

  assert.ok(markdownDoc.includes('Topology exceeds 50 nodes'));
  assert.ok(!markdownDoc.includes('```mermaid'));
});

test('buildDagGraph renders a mermaid diagram at or under 50 nodes', () => {
  const fileList = Array.from({ length: 50 }, (_, i) => `file-${i}.md`);
  const { markdownDoc } = buildDagGraph({ chunks: [], backlinks: [], fileList });

  assert.ok(markdownDoc.includes('```mermaid'));
  assert.ok(!markdownDoc.includes('Topology exceeds 50 nodes'));
});

test('canonicalize sorts keys inside arrays of objects, not just top-level objects', () => {
  const input = { list: [{ z: 1, a: 2 }, { b: 3, a: 4 }] };
  const canonical = canonicalize(input);

  assert.deepEqual(Object.keys(canonical.list[0]), ['a', 'z']);
  assert.deepEqual(Object.keys(canonical.list[1]), ['a', 'b']);
});

