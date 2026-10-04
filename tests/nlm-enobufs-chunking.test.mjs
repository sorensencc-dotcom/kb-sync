import test from 'node:test';
import assert from 'node:assert/strict';
import {
  partitionPackIntoChunks,
  formatFactRegistrySection,
  MAX_PACK_BYTES,
  MAX_FACT_REGISTRY_BYTES
} from '../core/nlm-chunker.mjs';

test('NLMChunker - single small pack emits single un-sharded file', () => {
  const packDef = {
    category: 'willow-run',
    filename: 'pack_willow_run.txt',
    notebookId: 'nb-1234',
    title: 'CIC - Willow Run'
  };

  const items = [
    {
      relPath: 'docs/b24-assembly.md',
      frontmatter: { source_title: 'B-24 Assembly Spec' },
      content: 'Charles E. Sorensen streamlined subassembly flows at Willow Run.'
    }
  ];

  const facts = [
    { fact_id: 'sha256:abc123456789', subject: 'Willow Run', predicate: 'produced', object: 'B-24 Liberator' }
  ];

  const result = partitionPackIntoChunks(packDef, items, facts);

  assert.equal(result.length, 1);
  assert.equal(result[0].filename, 'pack_willow_run.txt');
  assert.equal(result[0].itemCount, 1);
  assert.ok(result[0].bytes < MAX_PACK_BYTES);
  assert.ok(result[0].payload.includes('B-24 Liberator'));
});

test('NLMChunker - oversized pack category auto-shards into multi-part files <= 380 KiB', () => {
  const packDef = {
    category: 'master-kb',
    filename: 'pack_master_kb.txt',
    notebookId: 'nb-master',
    title: 'CIC-KB Master'
  };

  // Generate items that will exceed 380 KiB in total
  const items = [];
  for (let i = 0; i < 15; i++) {
    items.push({
      relPath: `docs/volume_${i}.md`,
      frontmatter: { source_title: `Volume ${i}` },
      content: `Section data for volume ${i}. `.repeat(2000) // ~58 KB each
    });
  }

  const facts = [
    { fact_id: 'sha256:fact01', subject: 'Ford Motor Co', predicate: 'contracted', object: 'War Department' }
  ];

  const result = partitionPackIntoChunks(packDef, items, facts);

  assert.ok(result.length > 1, `Expected multi-part sharding, got ${result.length} shards`);
  assert.equal(result[0].filename, 'pack_master_kb_part1.txt');
  assert.equal(result[1].filename, 'pack_master_kb_part2.txt');

  for (const shard of result) {
    assert.ok(shard.bytes <= MAX_PACK_BYTES + 512, `Shard ${shard.filename} (${shard.bytes} B) exceeded ceiling!`);
    assert.ok(shard.payload.includes('FACT REGISTRY (EVIDENCE MODE)'));
    assert.ok(shard.payload.includes('THEMATIC KNOWLEDGE PACK: CIC-KB Master (Part'));
  }
});

test('NLMChunker - fact registry respects MAX_FACT_REGISTRY_BYTES ceiling', () => {
  const facts = [];
  for (let i = 0; i < 1000; i++) {
    facts.push({
      fact_id: `sha256:fact_${i}_abcdef123456`,
      subject: `Subject ${i}`,
      predicate: `predicate_${i}`,
      object: `Object value ${i}`
    });
  }

  const section = formatFactRegistrySection(facts, MAX_FACT_REGISTRY_BYTES);
  const bytes = Buffer.byteLength(section, 'utf8');

  assert.ok(bytes <= MAX_FACT_REGISTRY_BYTES);
  assert.ok(section.includes('=== FACT REGISTRY (EVIDENCE MODE) ==='));
});
