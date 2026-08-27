import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  serializeVector,
  deserializeVector,
  cosineSimilarity,
  deterministicHeuristicVector,
  generateEmbedding,
  storeVector,
  searchDenseVectors,
  reciprocalRankFusion,
} from '../modules/cache/vector-store.mjs';
import { SCHEMA_SQL } from '../modules/cache/db-schema.mjs';

describe('Vector Store & Semantic Hybrid Retrieval (Path B)', () => {
  describe('Vector Serialization & Deserialization', () => {
    test('roundtrips Float32Array to Buffer and back with exact float precision', () => {
      const original = new Float32Array([0.1234, -0.5678, 1.0, 0.0, -1.0]);
      const buffer = serializeVector(original);
      assert.ok(Buffer.isBuffer(buffer));
      assert.equal(buffer.length, original.length * 4);

      const deserialized = deserializeVector(buffer);
      assert.equal(deserialized.length, original.length);
      for (let i = 0; i < original.length; i++) {
        assert.ok(Math.abs(deserialized[i] - original[i]) < 1e-6);
      }
    });

    test('handles empty buffers gracefully', () => {
      const empty = deserializeVector(Buffer.alloc(0));
      assert.equal(empty.length, 0);
    });
  });

  describe('Cosine Similarity Math', () => {
    test('computes exact 1.0 for identical vectors', () => {
      const vec = new Float32Array([1.0, 2.0, 3.0]);
      const sim = cosineSimilarity(vec, vec);
      assert.ok(Math.abs(sim - 1.0) < 1e-6);
    });

    test('computes -1.0 for opposite vectors', () => {
      const vecA = new Float32Array([1.0, 0.0]);
      const vecB = new Float32Array([-1.0, 0.0]);
      const sim = cosineSimilarity(vecA, vecB);
      assert.ok(Math.abs(sim - (-1.0)) < 1e-6);
    });

    test('computes 0.0 for orthogonal vectors', () => {
      const vecA = new Float32Array([1.0, 0.0]);
      const vecB = new Float32Array([0.0, 1.0]);
      const sim = cosineSimilarity(vecA, vecB);
      assert.ok(Math.abs(sim) < 1e-6);
    });

    test('handles zero vectors without NaN', () => {
      const vecA = new Float32Array([0.0, 0.0]);
      const vecB = new Float32Array([1.0, 2.0]);
      const sim = cosineSimilarity(vecA, vecB);
      assert.equal(sim, 0.0);
    });

    test('returns 0.0 on dimension mismatch', () => {
      const vecA = new Float32Array([1.0, 2.0]);
      const vecB = new Float32Array([1.0, 2.0, 3.0]);
      assert.equal(cosineSimilarity(vecA, vecB), 0.0);
    });
  });

  describe('Deterministic Heuristic Embedding', () => {
    test('produces normalized 384-dimensional unit vector', () => {
      const vec = deterministicHeuristicVector('Willow Run B-24 bomber assembly plant');
      assert.equal(vec.length, 384);

      let norm = 0;
      for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
      assert.ok(Math.abs(Math.sqrt(norm) - 1.0) < 1e-5);
    });

    test('produces higher similarity for semantically identical concepts than disjoint topics', () => {
      const vec1 = deterministicHeuristicVector('Willow Run assembly line bomber production');
      const vec2 = deterministicHeuristicVector('Willow Run aircraft assembly and bomber production');
      const vec3 = deterministicHeuristicVector('Danish probate estate and international property seizure in Havana');

      const simRelated = cosineSimilarity(vec1, vec2);
      const simDisjoint = cosineSimilarity(vec1, vec3);

      assert.ok(simRelated > simDisjoint, `Expected related (${simRelated}) > disjoint (${simDisjoint})`);
    });

    test('handles empty or non-string input safely', () => {
      const emptyVec = deterministicHeuristicVector('');
      assert.equal(emptyVec.length, 384);
      assert.equal(emptyVec[0], 0);
    });
  });

  describe('Offline Provider Routing', () => {
    test('routes offline provider request to heuristic vector', async () => {
      const result = await generateEmbedding('Charles Sorensen Edsel Ford meeting', { provider: 'offline' });
      assert.equal(result.provider, 'offline');
      assert.equal(result.dimensions, 384);
      assert.equal(result.vector.length, 384);
    });
  });

  describe('SQLite Vector Search & Storage', () => {
    let db;

    beforeEach(() => {
      db = new DatabaseSync(':memory:');
      db.exec(SCHEMA_SQL);

      // Seed documents
      db.prepare(`
        INSERT INTO kb_documents (id, category, topic, file_path, content, sha256)
        VALUES 
          ('doc-1', 'research', 'willow-run', 'wiki/research/willow-run.md', 'B-24 bomber mass production at Willow Run by Charles Sorensen', 'sha1'),
          ('doc-2', 'research', 'cuba-estate', 'wiki/research/cuba-estate.md', 'Cuban agricultural land seizures and Castro nationalization claims', 'sha2'),
          ('doc-3', 'research', 'sperry-gunsight', 'wiki/research/sperry.md', 'Sperry M-7 computing gunsight precision tooling at Ford', 'sha3')
      `).run();

      // Store vectors
      const vec1 = deterministicHeuristicVector('B-24 bomber mass production at Willow Run by Charles Sorensen');
      const vec2 = deterministicHeuristicVector('Cuban agricultural land seizures and Castro nationalization claims');
      const vec3 = deterministicHeuristicVector('Sperry M-7 computing gunsight precision tooling at Ford');

      storeVector(db, 'doc-1', 'willow-run', vec1);
      storeVector(db, 'doc-2', 'cuba-estate', vec2);
      storeVector(db, 'doc-3', 'sperry-gunsight', vec3);
    });

    test('retrieves top matching document by dense vector similarity', () => {
      const queryVec = deterministicHeuristicVector('Willow Run bomber line');
      const hits = searchDenseVectors(db, queryVec, { limit: 2 });

      assert.equal(hits.length, 2);
      assert.equal(hits[0].id, 'doc-1');
      assert.ok(hits[0].score > hits[1].score);
    });

    test('respects topic filter', () => {
      const queryVec = deterministicHeuristicVector('bomber');
      const hits = searchDenseVectors(db, queryVec, { topic: 'cuba-estate' });

      assert.equal(hits.length, 1);
      assert.equal(hits[0].id, 'doc-2');
    });

    test('deleting a document triggers vector cascade deletion', () => {
      db.prepare('DELETE FROM kb_documents WHERE id = ?').run('doc-1');
      const row = db.prepare('SELECT id FROM kb_vectors WHERE id = ?').get('doc-1');
      assert.equal(row, undefined);
    });
  });

  describe('Reciprocal Rank Fusion (RRF)', () => {
    test('blends lexical and vector hits correctly, boosting documents present in both lanes', () => {
      const lexicalHits = [
        { id: 'doc-A', topic: 'topic-a', file_path: 'a.md', content: 'content A' },
        { id: 'doc-B', topic: 'topic-b', file_path: 'b.md', content: 'content B' },
      ];

      const vectorHits = [
        { id: 'doc-B', topic: 'topic-b', file_path: 'b.md', content: 'content B' },
        { id: 'doc-C', topic: 'topic-c', file_path: 'c.md', content: 'content C' },
      ];

      const merged = reciprocalRankFusion(lexicalHits, vectorHits, { k: 60 });

      // doc-B is rank 2 in lexical and rank 1 in vector -> 1/(60+2) + 1/(60+1) = 0.016129 + 0.016393 = ~0.0325
      // doc-A is rank 1 in lexical only -> 1/(60+1) = ~0.016393
      // doc-C is rank 2 in vector only -> 1/(60+2) = ~0.016129
      assert.equal(merged[0].id, 'doc-B');
      assert.equal(merged[0].retrieval_mode, 'hybrid');
      assert.equal(merged[0].lexical_rank, 2);
      assert.equal(merged[0].vector_rank, 1);

      assert.equal(merged[1].id, 'doc-A');
      assert.equal(merged[1].retrieval_mode, 'lexical_only');

      assert.equal(merged[2].id, 'doc-C');
      assert.equal(merged[2].retrieval_mode, 'vector_only');
    });
  });
});
