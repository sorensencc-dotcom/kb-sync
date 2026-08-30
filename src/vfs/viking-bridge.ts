export type VikingResolutionTier = 'L1' | 'AST' | 'L2';

export interface VikingBridgeEvidence {
  uri: string;
  content?: string;
  requestedTier: 'L1';
  resolvedTier?: VikingResolutionTier;
  stale?: boolean;
  fallbackReason?: 'TIER_UNAVAILABLE' | 'LINE_VERIFICATION_REQUIRED' | 'SKELETON_UNAVAILABLE';
  error?: { code: string; message: string };
}

interface VikingBatchItem {
  uri: string;
  ok: boolean;
  value?: { content: string; stale?: boolean; resolution_tier: 'L0' | 'L1' | 'L2' };
  error?: { vikingCode: string; message: string };
}

interface VikingClientLike {
  batchRead(items: Array<{ uri: string; tier: 'L1' | 'L2' }>): Promise<{ results: VikingBatchItem[] }>;
  telemetry?: { snapshot(): Record<string, number> };
}

interface SkeletonResult {
  content: string;
  state: 'Skeleton' | 'Full';
  warning?: string;
}

interface ResolveVikingContextOptions {
  client: VikingClientLike;
  uris: string[];
  isRelevant?: (overview: { uri: string; content: string; stale: boolean }) => boolean;
  needsDetail?: (overview: { uri: string; content: string; stale: boolean }) => boolean;
  loadSkeleton?: (uri: string) => Promise<SkeletonResult>;
  needsLineVerification?: (context: { uri: string; overview: string; skeleton: SkeletonResult }) => boolean;
}

export interface VikingBridgeResult {
  evidence: VikingBridgeEvidence[];
  filteredUris: string[];
  staleUris: string[];
  prunedCount: number;
  l2EscalationRate: number;
  telemetry: Record<string, number>;
}

export async function resolveVikingContext(options: ResolveVikingContextOptions): Promise<VikingBridgeResult> {
  const { client, uris } = options;
  if (!client || typeof client.batchRead !== 'function') throw new TypeError('client.batchRead is required');
  if (!Array.isArray(uris)) throw new TypeError('uris must be an array');
  if (uris.length === 0) return { evidence: [], filteredUris: [], staleUris: [], prunedCount: 0, l2EscalationRate: 0, telemetry: client.telemetry?.snapshot() ?? {} };

  const l1 = await client.batchRead(uris.map((uri) => ({ uri, tier: 'L1' })));
  const evidence = new Map<string, VikingBridgeEvidence>();
  const filteredUris: string[] = [];
  const staleUris: string[] = [];
  const fallbackReasons = new Map<string, VikingBridgeEvidence['fallbackReason']>();

  for (const item of l1.results) {
    if (!item.ok) {
      if (item.error?.vikingCode === 'TIER_UNAVAILABLE') fallbackReasons.set(item.uri, 'TIER_UNAVAILABLE');
      else evidence.set(item.uri, { uri: item.uri, requestedTier: 'L1', error: { code: item.error?.vikingCode ?? 'INTERNAL_ERROR', message: item.error?.message ?? 'Viking L1 read failed' } });
      continue;
    }

    const overview = { uri: item.uri, content: item.value?.content ?? '', stale: item.value?.stale ?? false };
    if (overview.stale) staleUris.push(item.uri);
    if (options.isRelevant && !options.isRelevant(overview)) {
      filteredUris.push(item.uri);
      continue;
    }
    if (!options.needsDetail?.(overview)) {
      evidence.set(item.uri, { uri: item.uri, content: overview.content, requestedTier: 'L1', resolvedTier: 'L1', stale: overview.stale });
      continue;
    }

    if (!options.loadSkeleton) {
      fallbackReasons.set(item.uri, 'SKELETON_UNAVAILABLE');
      continue;
    }
    const skeleton = await options.loadSkeleton(item.uri);
    if (skeleton.state !== 'Skeleton') {
      fallbackReasons.set(item.uri, 'SKELETON_UNAVAILABLE');
      continue;
    }
    if (options.needsLineVerification?.({ uri: item.uri, overview: overview.content, skeleton })) {
      fallbackReasons.set(item.uri, 'LINE_VERIFICATION_REQUIRED');
      continue;
    }
    evidence.set(item.uri, { uri: item.uri, content: skeleton.content, requestedTier: 'L1', resolvedTier: 'AST', stale: overview.stale });
  }

  if (fallbackReasons.size > 0) {
    const l2 = await client.batchRead([...fallbackReasons.keys()].map((uri) => ({ uri, tier: 'L2' })));
    for (const item of l2.results) {
      const fallbackReason = fallbackReasons.get(item.uri);
      if (item.ok) evidence.set(item.uri, { uri: item.uri, content: item.value?.content, requestedTier: 'L1', resolvedTier: 'L2', stale: false, fallbackReason });
      else evidence.set(item.uri, { uri: item.uri, requestedTier: 'L1', fallbackReason, error: { code: item.error?.vikingCode ?? 'INTERNAL_ERROR', message: item.error?.message ?? 'Viking L2 read failed' } });
    }
  }

  const orderedEvidence = uris.filter((uri) => !filteredUris.includes(uri)).map((uri) => evidence.get(uri) ?? ({ uri, requestedTier: 'L1', error: { code: 'MISSING_RESULT', message: 'Viking batch response omitted the resource' } } as VikingBridgeEvidence));
  const l2Reads = orderedEvidence.filter((item) => item.resolvedTier === 'L2').length;
  return {
    evidence: orderedEvidence,
    filteredUris,
    staleUris,
    prunedCount: filteredUris.length,
    l2EscalationRate: l2Reads / (uris.length + l2Reads),
    telemetry: client.telemetry?.snapshot() ?? {},
  };
}
