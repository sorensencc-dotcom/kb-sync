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

  const baseUrl = options.jevBaseUrl ?? process.env.JEV_BASE_URL ?? 'http://127.0.0.1:4173';
  const timeoutMs = options.timeoutMs ?? 3000;
  const questions = {};
  matchedDocuments.forEach((doc, i) => {
    const snippet = String(doc.content || doc.snippet || '').slice(0, 200);
    questions[`doc_${i}`] = {
      type: 'score',
      instructions: `How relevant is this document to the research gap? Topic: "${doc.topic || 'untitled'}". Excerpt: "${snippet}"`,
    };
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/systemone`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { title: gap.title, description: gap.description }, questions }),
    });
    if (!res.ok) throw new Error(`jev returned HTTP ${res.status}`);
    const answers = (await res.json())?.answers;
    if (!answers || typeof answers !== 'object') throw new Error('jev response missing answers');
    const scored = matchedDocuments.map((doc, i) => {
      const answer = answers[`doc_${i}`];
      if (!answer || typeof answer.value !== 'number' || typeof answer.certainty !== 'number') throw new Error(`jev response missing valid answer for doc_${i}`);
      return { ...doc, jev_score: answer.value, jev_certainty: answer.certainty };
    });
    const rrfScores = scored.map((d) => Number(d.rrf_score) || 0);
    const minRrf = Math.min(...rrfScores);
    const range = Math.max(...rrfScores) - minRrf || 1;
    const reranked = scored.map((doc) => ({
      doc,
      blended: (((Number(doc.rrf_score) || 0) - minRrf) / range) * 0.4 + doc.jev_score * 0.6,
    })).sort((a, b) => b.blended - a.blended).map(({ doc }) => doc);
    circuitBreaker?.recordSuccess();
    return { matchedDocuments: reranked, applied: true };
  } catch {
    circuitBreaker?.recordFailure();
    return { matchedDocuments, applied: false };
  } finally {
    clearTimeout(timer);
  }
}
