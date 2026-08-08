import crypto from 'node:crypto';

export function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(canonicalize);
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

export function buildDagGraph({ chunks = [], backlinks = [], fileList = [], commitTimestamp = '2026-08-08T00:00:00.000Z' } = {}) {
  const nodesMap = new Map();
  const edgesMap = new Map();
  const forwardMap = {};
  const reverseMap = {};

  // 1. Process files
  for (const f of fileList.slice().sort()) {
    const normPath = f.toLowerCase().replace(/\\/g, '/');
    const id = `node:file:${normPath}`;
    nodesMap.set(id, {
      id,
      node_type: 'file',
      label: normPath.split('/').pop(),
      path: normPath,
      status: 'valid',
      target_kind: 'file',
      tags: []
    });
  }

  // 2. Process chunks
  const slugCounts = new Map();
  for (const c of chunks) {
    const normPath = c.file.toLowerCase().replace(/\\/g, '/');
    const baseSlug = c.anchor ? c.anchor.toLowerCase() : 'section';
    const slugKey = `${normPath}#${baseSlug}`;
    const count = (slugCounts.get(slugKey) || 0) + 1;
    slugCounts.set(slugKey, count);
    const anchor = count > 1 ? `${baseSlug}_L${c.line}` : baseSlug;
    const chunkId = `node:chunk:${normPath}#${anchor}`;
    const fileId = `node:file:${normPath}`;

    const tags = Array.from(new Set((c.tags || []).map(t => t.replace(/^#/, '').toLowerCase()))).sort();

    nodesMap.set(chunkId, {
      id: chunkId,
      node_type: 'chunk',
      label: c.anchor || 'Chunk',
      path: normPath,
      status: 'valid',
      target_kind: 'chunk',
      tags,
      anchor,
      line_number: c.line || 1
    });

    const edgeId = `edge:${fileId}->${chunkId}:contains`;
    edgesMap.set(edgeId, { id: edgeId, source: fileId, target: chunkId, relation: 'contains' });
  }

  // 3. Process backlinks
  for (const b of backlinks) {
    const srcNorm = b.source.toLowerCase().replace(/\\/g, '/');
    const tgtNorm = b.target.toLowerCase().replace(/\\/g, '/');
    const srcId = `node:file:${srcNorm}`;
    const tgtId = `node:file:${tgtNorm}`;

    if (!nodesMap.has(tgtId)) {
      nodesMap.set(tgtId, {
        id: tgtId,
        node_type: 'dangling',
        label: tgtNorm.split('/').pop(),
        path: tgtNorm,
        status: 'missing',
        target_kind: 'file',
        tags: []
      });
    }

    const edgeId = `edge:${srcId}->${tgtId}:${b.type || 'wikilink'}`;
    edgesMap.set(edgeId, { id: edgeId, source: srcId, target: tgtId, relation: b.type || 'wikilink' });
  }

  const nodes = Array.from(nodesMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  const edges = Array.from(edgesMap.values()).sort((a, b) => a.id.localeCompare(b.id));

  // Build Adjacency
  for (const n of nodes) {
    forwardMap[n.id] = [];
    reverseMap[n.id] = [];
  }
  for (const e of edges) {
    forwardMap[e.source].push({ relation: e.relation, target: e.target });
    reverseMap[e.target].push({ relation: e.relation, source: e.source });
  }
  for (const k of Object.keys(forwardMap)) {
    forwardMap[k].sort((a, b) => a.target.localeCompare(b.target) || a.relation.localeCompare(b.relation));
  }
  for (const k of Object.keys(reverseMap)) {
    reverseMap[k].sort((a, b) => a.source.localeCompare(b.source) || a.relation.localeCompare(b.relation));
  }

  // Content Hash (over input raw content representations)
  const contentHashInput = JSON.stringify(canonicalize({ nodes, edges }));
  const contentHash = 'sha256:' + crypto.createHash('sha256').update(contentHashInput).digest('hex');

  const isoDate = commitTimestamp ? new Date(commitTimestamp).toISOString() : new Date().toISOString();
  const genId = `${isoDate.replace(/[-:T.]/g, '').slice(0, 15)}_${contentHash.slice(7, 15)}`;

  const dag = canonicalize({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    version: '2.0.0',
    metadata: {
      content_hash: contentHash,
      created_at: commitTimestamp,
      cycles_count: 0,
      generation_id: genId,
      source_file_count: fileList.length,
      total_edges: edges.length,
      total_nodes: nodes.length
    },
    nodes,
    edges
  });

  const adjacency = canonicalize({
    version: '2.0.0',
    forward: forwardMap,
    reverse: reverseMap
  });

  let mermaidSection = '';
  if (nodes.length <= 50) {
    mermaidSection = '\n## Graph Topology\n```mermaid\ngraph TD\n';
    for (const n of nodes) {
      mermaidSection += `  ${n.id.replace(/[:.#]/g, '_')}["${n.label}"]\n`;
    }
    for (const e of edges) {
      const src = e.source.replace(/[:.#]/g, '_');
      const tgt = e.target.replace(/[:.#]/g, '_');
      mermaidSection += `  ${src} -->|${e.relation}| ${tgt}\n`;
    }
    mermaidSection += '```\n';
  } else {
    mermaidSection = '\n## Graph Topology\n> Note: Topology exceeds 50 nodes. Complete node/edge graph stored in .nlm_pack/dag.json and adjacency.json\n';
  }

  const markdownDoc = `<!-- AUTO-GENERATED BY KB-SYNC DAG BUILDER - DO NOT EDIT MANUALLY -->
# KB-Sync Directed Graph & Structural DAG Specification

> [!NOTE]
> Static operational reference documentation for operators and AI assistants. Contains no executable code or instructions.

## Status & Telemetry
- **Generation ID:** \`${genId}\`
- **Content Hash:** \`${contentHash}\`
- **Created At:** ${commitTimestamp}
- **Source Files:** ${fileList.length}
- **Total Nodes:** ${nodes.length}
- **Total Edges:** ${edges.length}
${mermaidSection}`;

  return { dag, adjacency, markdownDoc, contentHash, genId };
}
