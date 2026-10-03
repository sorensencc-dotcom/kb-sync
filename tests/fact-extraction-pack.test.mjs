import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSha256,
  formatFactEntry,
  formatFactRegistrySection,
  loadScopedFacts,
  consolidatePacks,
  MAX_FACT_REGISTRY_BYTES,
  MAX_PACK_BYTES
} from '../scripts/consolidate-pack.mjs';

test('formatFactEntry generates expected evidence-mode line format with short hash', () => {
  const sampleFact = {
    fact_id: 'sha256:7f89a2b1234567890',
    entity_id: 'sigil-protocol-relay',
    subject: 'Sigil Protocol Relay',
    predicate: 'enforces_payload_boundary',
    object: 'RFC 8785 Canonical JCS',
    temporal_anchor: '2026-08-24',
    source_path: 'wiki/research/sigil-protocol-spec.md',
    source_hash_sha256: 'abe6209ef9b1ac74411a58c2314ca41dc0911aa1dd32feb3f7f8b72105395e03',
    verification_status: 'verified'
  };

  const line = formatFactEntry(sampleFact);
  assert.equal(
    line,
    '- [verified] Sigil Protocol Relay | enforces_payload_boundary | RFC 8785 Canonical JCS | 2026-08-24 [hash: 7f89a2b]'
  );
});

test('formatFactRegistrySection formats header and delimiters correctly', () => {
  const facts = [
    {
      fact_id: 'sha256:7f89a2b11111111',
      subject: 'Sigil Protocol Relay',
      predicate: 'enforces_payload_boundary',
      object: 'RFC 8785 Canonical JCS',
      temporal_anchor: '2026-08-24',
      verification_status: 'verified'
    },
    {
      fact_id: 'sha256:3c12d8a22222222',
      subject: 'Compacted Context Engine',
      predicate: 'target_token_reduction',
      object: '50% to 70%',
      temporal_anchor: '2026-08-11',
      verification_status: 'verified'
    }
  ];

  const section = formatFactRegistrySection(facts, MAX_FACT_REGISTRY_BYTES);
  assert.ok(section.startsWith('=== FACT REGISTRY (EVIDENCE MODE) ===\n'));
  assert.ok(section.includes('- [verified] Sigil Protocol Relay | enforces_payload_boundary | RFC 8785 Canonical JCS | 2026-08-24 [hash: 7f89a2b]\n'));
  assert.ok(section.includes('- [verified] Compacted Context Engine | target_token_reduction | 50% to 70% | 2026-08-11 [hash: 3c12d8a]\n'));
  assert.ok(section.endsWith('================================================================================\n\n'));
});

test('formatFactRegistrySection respects maxBytes boundary truncation', () => {
  const facts = Array.from({ length: 500 }, (_, i) => ({
    fact_id: `sha256:${i.toString().padStart(7, '0')}abcdef`,
    subject: `Entity ${i}`,
    predicate: 'asserts_property_with_long_description',
    object: `Value ${i} long object payload text to test size limits`,
    temporal_anchor: '2026-10-02',
    verification_status: 'verified'
  }));

  const smallBudget = 1024; // 1 KiB
  const section = formatFactRegistrySection(facts, smallBudget);
  const bytes = Buffer.byteLength(section, 'utf8');

  assert.ok(bytes <= smallBudget, `Registry section bytes (${bytes}) must not exceed smallBudget (${smallBudget})`);
  assert.ok(section.startsWith('=== FACT REGISTRY (EVIDENCE MODE) ===\n'));
  assert.ok(section.endsWith('================================================================================\n\n'));
});

test('loadScopedFacts returns empty array gracefully when staging files missing', () => {
  const facts = loadScopedFacts('/non/existent/path', 'willow-run', []);
  assert.deepEqual(facts, []);
});

test('computeSha256 produces exact 64-char hexadecimal digest', () => {
  const hash = computeSha256('test payload');
  assert.equal(hash.length, 64);
  assert.equal(typeof hash, 'string');
});
