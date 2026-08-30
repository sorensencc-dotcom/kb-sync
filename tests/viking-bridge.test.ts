import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVikingContext } from '../src/vfs/viking-bridge.ts';

function clientFor(resultsByTier: Record<string, any>) {
  const calls: Array<{ items: any[] }> = [];
  return {
    calls,
    async batchRead(items: any[]) {
      calls.push({ items });
      return { snapshot_id: '20260830-130000', results: resultsByTier[items[0]?.tier] ?? [] };
    },
    telemetry: { snapshot: () => ({ rpc_call_count: calls.length }) },
  };
}

test('L1 relevance filtering prunes irrelevant modules before AST loading', async () => {
  const uris = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((name) => `viking://kb-sync/sources/${name}`);
  const client = clientFor({
    L1: uris.map((uri, index) => ({ uri, ok: true, value: { content: index === 0 ? 'target module' : 'unrelated module', stale: false, resolution_tier: 'L1' } })),
  });
  const skeletonLoads: string[] = [];

  const result = await resolveVikingContext({
    client,
    uris,
    isRelevant: (overview) => overview.content.includes('target'),
    needsDetail: () => true,
    loadSkeleton: async (uri) => { skeletonLoads.push(uri); return { content: 'export function target(): void;', state: 'Skeleton' }; },
  });

  assert.equal(result.prunedCount, 3);
  assert.deepEqual(skeletonLoads, [uris[0]]);
  assert.equal(result.evidence[0].resolvedTier, 'AST');
  assert.equal(client.calls.length, 1);
});

test('ambiguous AST skeleton escalates to one targeted L2 batch', async () => {
  const uri = 'viking://kb-sync/sources/core.ts';
  const client = clientFor({
    L1: [{ uri, ok: true, value: { content: 'core overview', stale: false, resolution_tier: 'L1' } }],
    L2: [{ uri, ok: true, value: { content: 'line-level source', stale: false, resolution_tier: 'L2' } }],
  });

  const result = await resolveVikingContext({
    client,
    uris: [uri],
    needsDetail: () => true,
    loadSkeleton: async () => ({ content: 'export interface Core {}', state: 'Skeleton' }),
    needsLineVerification: () => true,
  });

  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls[1].items, [{ uri, tier: 'L2' }]);
  assert.equal(result.evidence[0].content, 'line-level source');
  assert.equal(result.evidence[0].fallbackReason, 'LINE_VERIFICATION_REQUIRED');
});

test('unavailable L1 resources fall back directly to targeted L2', async () => {
  const uri = 'viking://kb-sync/sources/new.ts';
  const client = clientFor({
    L1: [{ uri, ok: false, error: { vikingCode: 'TIER_UNAVAILABLE', message: 'not indexed' } }],
    L2: [{ uri, ok: true, value: { content: 'new source', stale: false, resolution_tier: 'L2' } }],
  });

  const result = await resolveVikingContext({ client, uris: [uri] });

  assert.equal(result.evidence[0].resolvedTier, 'L2');
  assert.equal(result.evidence[0].fallbackReason, 'TIER_UNAVAILABLE');
  assert.equal(result.telemetry.rpc_call_count, 2);
});

test('fresh relevant overviews remain at L1 when detail is unnecessary', async () => {
  const uri = 'viking://kb-sync/sources/api.ts';
  const client = clientFor({
    L1: [{ uri, ok: true, value: { content: 'API overview', stale: false, resolution_tier: 'L1' } }],
  });

  const result = await resolveVikingContext({ client, uris: [uri] });

  assert.equal(result.evidence[0].resolvedTier, 'L1');
  assert.equal(result.l2EscalationRate, 0);
});
