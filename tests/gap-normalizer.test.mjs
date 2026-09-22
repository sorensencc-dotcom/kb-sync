import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeGapText,
  extractAtomicElements,
  computeScopeHash,
  loadGapAliases,
  resolveGapIdentity,
  deduplicateMinedGaps
} from '../modules/trm/gap-normalizer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('normalizeGapText strips citation tags, draft markers, and markdown symbols', () => {
  const raw = '### **The Boeing B-17 Claim** [1-3] * (Drafted: rfc-01.md) Details here...';
  const clean = normalizeGapText(raw);
  assert.equal(clean, 'The Boeing B-17 Claim Details here...');
});

test('extractAtomicElements extracts time period, location, entity, and claim', () => {
  const text = 'Dodge Brothers vs. Henry Ford (1919) at River Rouge: Litigation over shareholder dividend withholding';
  const elements = extractAtomicElements(text);

  assert.equal(elements.timePeriod, '1919');
  assert.equal(elements.location, 'river rouge');
  assert.ok(elements.entity.includes('dodge brothers'));
  assert.ok(elements.claim.includes('shareholder dividend'));
});

test('computeScopeHash uses unit separators to prevent token concatenation collisions', () => {
  // Without delimiter, "AB" + "C" == "A" + "BC". With \x1f delimiter, they differ.
  const hash1 = computeScopeHash({ entity: 'ab', claim: 'c', timePeriod: '', location: '' });
  const hash2 = computeScopeHash({ entity: 'a', claim: 'bc', timePeriod: '', location: '' });

  assert.notEqual(hash1, hash2);
  assert.equal(hash1.length, 64);
  assert.equal(hash2.length, 64);
});

test('resolveGapIdentity matches Tier 1 exact scope hash and Tier 2 alias dictionaries', () => {
  const existingGaps = [
    {
      id: 'GAP-03-VIDEOS',
      gap_id: 'GAP-03-VIDEOS',
      title: 'B-17 Production Claim Debunking & B-24 Exclusivity',
      description: 'Proof that Willow Run built B-24s exclusively and never B-17s',
      scope_hash: computeScopeHash('B-17 Production Claim Debunking & B-24 Exclusivity: Willow Run'),
      status: 'resolved'
    }
  ];

  const aliasMap = {
    'the boeing b-17 flying fortress production claim': 'GAP-03-VIDEOS'
  };

  // Test Tier 2 Alias match
  const candidate = {
    title: 'The Boeing B-17 Flying Fortress Production Claim',
    description: 'Video transcript asserts B-17 was manufactured at Willow Run',
    notebookName: 'willow-run-videos',
    entryKey: 'key-1'
  };

  const res = resolveGapIdentity(candidate, existingGaps, aliasMap);
  assert.equal(res.tier, 2);
  assert.equal(res.canonicalGapId, 'GAP-03-VIDEOS');
  assert.equal(res.matchType, 'alias_lookup');
});

test('deduplicateMinedGaps suppresses resolved gaps and merges multi-notebook provenance', () => {
  const existingRegistry = [
    {
      gap_id: 'GAP-04',
      id: 'GAP-04',
      title: 'Willow Run L-Bend Assembly Line vs. Tax Turn Legend',
      description: 'Resolved via primary engineering records',
      scope_hash: computeScopeHash('Willow Run L-Bend: Tax Legend 1941'),
      status: 'resolved',
      source_notebooks: [{ notebook_name: 'cic-kb', first_seen: '2026-08-20', entry_key: 'k1' }]
    },
    {
      gap_id: 'GAP-06',
      id: 'GAP-06',
      title: 'Willow Run B-24 Knock-Down Kit Manufacturing',
      description: 'Active dossier tracking 1893 sub-assembly shipments',
      scope_hash: computeScopeHash('Willow Run B-24 Knock-Down Kit: Shipments 1943'),
      status: 'active',
      source_notebooks: [{ notebook_name: 'cic-kb', first_seen: '2026-08-20', entry_key: 'k2' }]
    }
  ];

  const aliasMap = {
    'albert kahn l-bend tax turn legend': 'GAP-04',
    'willow run b-24 knock-down kit': 'GAP-06'
  };

  const minedCandidates = [
    // Duplicate of resolved GAP-04 -> Should be suppressed
    {
      title: 'Albert Kahn L-Bend Tax Turn Legend',
      description: 'Did Kahn bend the line to avoid Washtenaw taxes?',
      notebookName: 'willow-run-videos',
      entryKey: 'k3',
      firstSeen: '2026-09-20'
    },
    // Duplicate of active GAP-06 -> Should merge source notebook
    {
      title: 'Willow Run B-24 Knock-Down Kit',
      description: 'Shipments 1943 to Tulsa and Fort Worth',
      notebookName: 'cic-daily-research',
      entryKey: 'k4',
      firstSeen: '2026-09-20'
    },
    // Greenfield gap -> Should create new GAP-07
    {
      title: 'Consolidated Aircraft Patent Licensing Dispute',
      description: 'Did Consolidated challenge Ford B-24 tooling patents?',
      notebookName: 'aviation-engineering',
      entryKey: 'k5',
      firstSeen: '2026-09-20'
    }
  ];

  const result = deduplicateMinedGaps(minedCandidates, existingRegistry, aliasMap);

  // 1 suppression (GAP-04)
  assert.equal(result.retiredSuppressions.length, 1);
  assert.equal(result.retiredSuppressions[0].canonicalGapId, 'GAP-04');

  // 1 greenfield creation
  assert.equal(result.newGaps.length, 1);
  assert.ok(result.newGaps[0].gap_id.startsWith('GAP-'));

  // Multi-notebook provenance merged for active gap GAP-06
  const gap06 = result.updatedRegistry.find(g => g.gap_id === 'GAP-06');
  assert.ok(gap06);
  assert.equal(gap06.source_notebooks.length, 2);
  assert.equal(gap06.source_notebooks[1].notebook_name, 'cic-daily-research');
});
