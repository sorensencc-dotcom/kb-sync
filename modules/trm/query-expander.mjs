/**
 * TRM Cognitive Query Expansion Module
 *
 * Converts raw research gap text into structured SQLite FTS5 boolean queries
 * using local Ollama or remote OpenRouter providers, with direct SQLite
 * syntax validation and deterministic heuristic fallback.
 *
 * Provider execution order (auto mode): Ollama → OpenRouter → Heuristic
 * Fail-soft: any provider error, timeout, or bad FTS5 syntax routes to heuristic.
 *
 *                    ┌─────────────────────────────────────────────┐
 *                    │           expandSearchQuery()               │
 *                    │                                             │
 *  gap ─────────────►│ 1. Circuit breaker open? ──► Heuristic     │
 *                    │ 2. Prompt (XML-delimited, 500-char limit)   │
 *                    │ 3. callProviderWithTimeout()                │
 *                    │    ├─ Ollama  (OLLAMA_BASE_URL)            │
 *                    │    └─ OpenRouter (OPENROUTER_API_KEY)      │
 *                    │ 4. JSON parse → extract fts5_query         │
 *                    │ 5. validateFts5Query() via SQLite LIMIT 0  │
 *                    │    └─ Syntax error? ─────────► Heuristic   │
 *                    │ 6. Return validated FTS5 query             │
 *                    └─────────────────────────────────────────────┘
 */

const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'for', 'from', 'in', 'on', 'to', 'with', 'by', 'about', 'into', 'at',
  'of', 'or', 'and', 'not', 'but', 'so', 'if', 'as', 'do', 'did',
  'has', 'have', 'had', 'that', 'this', 'which', 'when', 'where', 'how',
  'it', 'its', 'we', 'our', 'they', 'their', 'can', 'will', 'should',
]);

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 2;
const MAX_INPUT_CHARS = 500;

/**
 * Creates a simple fail-fast circuit breaker.
 * After `failureThreshold` consecutive failures, `isOpen()` returns true,
 * bypassing further provider calls for the lifetime of the batch.
 *
 * @param {number} [failureThreshold=2]
 * @returns {{ recordFailure: () => void, recordSuccess: () => void, isOpen: () => boolean }}
 */
export function createCircuitBreaker(failureThreshold = DEFAULT_CIRCUIT_BREAKER_THRESHOLD) {
  let consecutiveFailures = 0;
  let tripped = false;
  return {
    recordFailure() {
      consecutiveFailures++;
      if (consecutiveFailures >= failureThreshold) {
        tripped = true;
      }
    },
    recordSuccess() {
      consecutiveFailures = 0;
    },
    isOpen() {
      return tripped;
    },
  };
}

/**
 * Validates a generated FTS5 query string directly against SQLite.
 * Executes a zero-row dry-run: if SQLite throws, the query is malformed.
 *
 * @param {import('node:sqlite').DatabaseSync} dbInstance
 * @param {string} fts5Query
 * @returns {boolean} true if valid, false if SQLite rejects the syntax
 */
export function validateFts5Query(dbInstance, fts5Query) {
  if (!fts5Query || typeof fts5Query !== 'string' || !fts5Query.trim()) {
    return false;
  }
  try {
    const stmt = dbInstance.prepare('SELECT 1 FROM kb_fts WHERE kb_fts MATCH ? LIMIT 0');
    stmt.all(fts5Query.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministic heuristic query expansion.
 * Extracts alphanumeric tokens, removes English stopwords, and produces
 * a blended wildcard OR query letting BM25 rank by term density.
 *
 * @param {{ title: string, description: string }} gap
 * @returns {string} FTS5 query string (always valid)
 */
export function heuristicFallbackExpand(gap) {
  const extract = (text) =>
    (text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !ENGLISH_STOPWORDS.has(t));

  const titleTokens = extract(gap.title || '');
  const descTokens = extract(gap.description || '');

  // Deduplicate while preserving title-first order
  const seen = new Set(titleTokens);
  const uniqueDesc = descTokens.filter((t) => !seen.has(t));

  const allTokens = [...titleTokens, ...uniqueDesc];

  if (allTokens.length === 0) {
    // Absolute last resort: use the raw title as a quoted literal
    const raw = (gap.title || 'unknown').trim().replace(/"/g, '""');
    return `"${raw}"`;
  }

  if (allTokens.length === 1) {
    return `"${allTokens[0]}"*`;
  }

  // Produce title group OR desc group so BM25 can score across both
  const titleGroup = titleTokens.length > 0
    ? titleTokens.map((t) => `"${t}"*`).join(' OR ')
    : null;
  const descGroup = uniqueDesc.length > 0
    ? uniqueDesc.map((t) => `"${t}"*`).join(' OR ')
    : null;

  if (titleGroup && descGroup) {
    return `(${titleGroup}) OR (${descGroup})`;
  }
  return allTokens.map((t) => `"${t}"*`).join(' OR ');
}

/**
 * Calls the Ollama /chat/completions endpoint with a strict timeout.
 *
 * @param {string} prompt
 * @param {{ baseUrl: string, model: string, timeoutMs: number }} options
 * @returns {Promise<string>} Raw completion text
 */
async function callOllamaProvider(prompt, options) {
  const { baseUrl, model, timeoutMs } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama returned HTTP ${res.status}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Ollama returned empty completion');
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls OpenRouter /chat/completions endpoint with a strict timeout.
 *
 * @param {string} prompt
 * @param {{ model: string, apiKey: string, timeoutMs: number }} options
 * @returns {Promise<string>} Raw completion text
 */
async function callOpenRouterProvider(prompt, options) {
  const { model, apiKey, timeoutMs } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter returned HTTP ${res.status}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('OpenRouter returned empty completion');
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the XML-delimited system prompt, truncating user input at 500 chars
 * to prevent prompt injection and context blowout.
 *
 * @param {{ title: string, description: string }} gap
 * @returns {string}
 */
function buildExpansionPrompt(gap) {
  const safeTitle = (gap.title || '').slice(0, MAX_INPUT_CHARS);
  const safeDesc = (gap.description || '').slice(0, MAX_INPUT_CHARS);
  return [
    'You are a search query expansion expert. Convert the following engineering research gap into a structured SQLite FTS5 full-text boolean query.',
    '',
    '<gap_title>',
    safeTitle,
    '</gap_title>',
    '',
    '<gap_description>',
    safeDesc,
    '</gap_description>',
    '',
    'Return ONLY a single valid JSON object with this exact structure, no markdown fences, no explanation:',
    '{',
    '  "core_concepts": ["concept1", "concept2"],',
    '  "synonyms": ["syn1", "syn2"],',
    '  "fts5_query": "(\\"term1\\" OR \\"syn1\\") AND (\\"term2\\" OR \\"syn2\\")"',
    '}',
  ].join('\n');
}

/**
 * Attempts to extract `fts5_query` from a model completion string.
 * Handles JSON wrapped in markdown code fences or trailing whitespace.
 *
 * @param {string} raw
 * @returns {string | null}
 */
function extractFts5QueryFromCompletion(raw) {
  // Strip markdown code fences if model disobeys instructions
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(stripped);
    const query = parsed?.fts5_query;
    if (typeof query === 'string' && query.trim()) {
      return query.trim();
    }
  } catch {
    // Fall through to null
  }
  return null;
}

/**
 * Dispatches the expansion prompt to the appropriate provider.
 * Returns null if the provider is unavailable, times out, or returns invalid content.
 *
 * @param {string} prompt
 * @param {string} providerName - 'ollama' | 'openrouter'
 * @param {ExpandOptions} resolvedOptions
 * @returns {Promise<string | null>}
 */
async function dispatchToProvider(prompt, providerName, resolvedOptions) {
  try {
    if (providerName === 'ollama') {
      return await callOllamaProvider(prompt, {
        baseUrl: resolvedOptions.ollamaBaseUrl,
        model: resolvedOptions.ollamaModel,
        timeoutMs: resolvedOptions.timeoutMs,
      });
    }
    if (providerName === 'openrouter') {
      const apiKey = resolvedOptions.openRouterApiKey;
      if (!apiKey) {
        return null;
      }
      return await callOpenRouterProvider(prompt, {
        model: resolvedOptions.openRouterModel,
        apiKey,
        timeoutMs: resolvedOptions.timeoutMs,
      });
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @typedef {Object} ExpandOptions
 * @property {string} [provider='auto'] - 'auto' | 'ollama' | 'openrouter' | 'offline'
 * @property {string} [ollamaModel]
 * @property {string} [ollamaBaseUrl]
 * @property {string} [openRouterModel]
 * @property {string} [openRouterApiKey]
 * @property {number} [timeoutMs]
 * @property {{ isOpen: () => boolean, recordFailure: () => void, recordSuccess: () => void } | null} [circuitBreaker]
 */

/**
 * Main entrypoint. Expands a gap into a validated FTS5 query string.
 * Falls back to heuristic expansion at each failure point.
 *
 * @param {{ title: string, description: string }} gap
 * @param {import('node:sqlite').DatabaseSync} dbInstance
 * @param {ExpandOptions} [options]
 * @returns {Promise<{ query: string, method: 'llm' | 'heuristic', provider: string | null }>}
 */
export async function expandSearchQuery(gap, dbInstance, options = {}) {
  const resolvedOptions = {
    provider: options.provider ?? process.env.TRM_LLM_PROVIDER ?? 'auto',
    ollamaModel: options.ollamaModel ?? process.env.TRM_OLLAMA_MODEL ?? 'qwen2.5-coder:7b',
    ollamaBaseUrl: options.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
    openRouterModel: options.openRouterModel ?? process.env.TRM_OPENROUTER_MODEL ?? 'google/gemini-flash-1.5',
    openRouterApiKey: options.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? null,
    timeoutMs: options.timeoutMs ?? Number(process.env.TRM_EXPANDER_TIMEOUT ?? DEFAULT_TIMEOUT_MS),
    circuitBreaker: options.circuitBreaker ?? null,
  };

  const fallback = () => ({
    query: heuristicFallbackExpand(gap),
    method: 'heuristic',
    provider: null,
  });

  // Skip provider calls when offline or circuit breaker is open
  if (resolvedOptions.provider === 'offline') {
    return fallback();
  }
  if (resolvedOptions.circuitBreaker?.isOpen()) {
    return fallback();
  }

  // Determine provider dispatch order
  const providerOrder = resolvedOptions.provider === 'auto'
    ? ['ollama', 'openrouter']
    : [resolvedOptions.provider];

  const prompt = buildExpansionPrompt(gap);

  for (const providerName of providerOrder) {
    const raw = await dispatchToProvider(prompt, providerName, resolvedOptions);
    if (!raw) {
      resolvedOptions.circuitBreaker?.recordFailure();
      continue;
    }

    const extracted = extractFts5QueryFromCompletion(raw);
    if (!extracted) {
      resolvedOptions.circuitBreaker?.recordFailure();
      continue;
    }

    // Validate against SQLite directly — the only ground truth for FTS5 syntax
    if (!validateFts5Query(dbInstance, extracted)) {
      resolvedOptions.circuitBreaker?.recordFailure();
      continue;
    }

    resolvedOptions.circuitBreaker?.recordSuccess();
    return { query: extracted, method: 'llm', provider: providerName };
  }

  // All providers failed or produced invalid FTS5 — use heuristic
  return fallback();
}
