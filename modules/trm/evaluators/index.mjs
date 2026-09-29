import {
  canDispatchCloudCall,
  recordCloudCallRateLimit,
  recordCloudCallSuccess,
} from './cloud-budget.mjs';

async function postJson(url, body, headers, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function tierC(payload) {
  return {
    data: `Extract explicit specs, measurements and citations regarding ${payload.targetGap || 'open topics'} from ${payload.sourceTitle || 'new sources'}.`,
    evaluator_used: 'deterministic:template',
    fallback_reason: 'TIER_A_B_UNAVAILABLE',
  };
}

export async function dispatchEvaluator(payload, notebookConfig = {}, options = {}) {
  const ollamaUrl = options.ollamaUrl || 'http://localhost:11434/api/generate';
  const budgetPath = options.budgetPath || '_kb-sync-staging/trm/cloud_evaluator_budget.json';

  try {
    const response = await postJson(
      ollamaUrl,
      {
        model: options.ollamaModel || 'llama3:8b-instruct-fp16',
        prompt: JSON.stringify(payload),
        stream: false,
      },
      {},
      options.ollamaTimeoutMs ?? 10000,
    );
    if (response.ok) {
      const json = await response.json();
      return { data: json.response, evaluator_used: 'ollama:llama3-8b' };
    }
  } catch {}

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (notebookConfig.remote_evaluator_allowed !== true || !apiKey || !canDispatchCloudCall(budgetPath)) {
    return tierC(payload);
  }

  try {
    const response = await postJson(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      },
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      options.claudeTimeoutMs ?? 15000,
    );
    if (response.ok) {
      const json = await response.json();
      recordCloudCallSuccess(budgetPath);
      return {
        data: json.content?.[0]?.text || '',
        evaluator_used: 'claude:3-5-haiku',
        fallback_reason: 'OLLAMA_TIMEOUT',
      };
    }
    if (response.status === 429) recordCloudCallRateLimit(budgetPath);
  } catch {}

  return tierC(payload);
}
