/**
 * Reranks (never drops) RRF-retrieved documents against a cic-jev `score`
 * judgment of relevance to the gap. Fail-soft: any error leaves
 * matchedDocuments unchanged and returns { applied: false }.
 */
export async function filterMatchedDocuments(gap, matchedDocuments, options = {}) {
  const enabled = options.jevFilter ?? (process.env.TRM_JEV_FILTER === '1');
  if (!enabled || matchedDocuments.length === 0) {
    return { matchedDocuments, applied: false };
  }

  const circuitBreaker = options.circuitBreaker ?? null;
  if (circuitBreaker?.isOpen()) {
    return { matchedDocuments, applied: false };
  }

  return { matchedDocuments, applied: false };
}
