import { parseDocument } from './normalized-diff-guard.mjs';

/**
 * Abstract Base RepairProvider interface
 */
export class RepairProvider {
  /**
   * @param {string} documentContent 
   * @param {Array<object>|object} diagnostics 
   * @param {object} [options]
   * @returns {Promise<string>}
   */
  async repair(documentContent, diagnostics, options = {}) {
    throw new Error('Method repair() must be implemented by subclass.');
  }
}

/**
 * Ollama HTTP API repair provider sending prompts with XML tags.
 * Default model: llama3.1:70b
 * Endpoint: POST /api/generate
 */
export class OllamaRepairProvider extends RepairProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.endpoint='http://localhost:11434']
   * @param {string} [options.model='llama3.1:70b']
   * @param {typeof fetch} [options.fetchFn=globalThis.fetch]
   */
  constructor(options = {}) {
    super();
    this.endpoint = options.endpoint || 'http://localhost:11434';
    this.model = options.model || 'llama3.1:70b';
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  async repair(documentContent, diagnostics, options = {}) {
    const prompt = [
      'You are an automated Markdown document repair assistant.',
      'Repair the document according to the following validator diagnostics.',
      'Do NOT change any text outside the frontmatter required to resolve diagnostics.',
      '',
      '<DETERMINISTIC_VALIDATOR_DIAGNOSTICS>',
      typeof diagnostics === 'string' ? diagnostics : JSON.stringify(diagnostics, null, 2),
      '</DETERMINISTIC_VALIDATOR_DIAGNOSTICS>',
      '',
      '<UNTRUSTED_DOCUMENT_CONTENT>',
      documentContent,
      '</UNTRUSTED_DOCUMENT_CONTENT>',
      '',
      'Return ONLY the repaired raw Markdown document text without markdown code blocks or explanation.'
    ].join('\n');

    const modelToUse = options.model || this.model;
    const baseUrl = this.endpoint.replace(/\/+$/, '');
    const url = `${baseUrl}/api/generate`;

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelToUse,
        prompt: prompt,
        stream: false
      })
    });

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.response;
  }
}

/**
 * Helper to patch frontmatter while keeping document body byte-for-byte immutable.
 * @param {string} content 
 * @param {Record<string, string>} patch 
 * @returns {string}
 */
export function applyFrontmatterPatch(content, patch) {
  const { frontmatter, body } = parseDocument(content);
  const updated = { ...frontmatter, ...patch };

  const yamlLines = [];
  for (const [k, v] of Object.entries(updated)) {
    yamlLines.push(`${k}: ${v}`);
  }

  const yamlStr = `---\n${yamlLines.join('\n')}\n---`;
  return yamlStr + body;
}

/**
 * Rule-based offline repair provider for testing and deterministic fixes.
 */
export class OfflineDeterministicRepairProvider extends RepairProvider {
  /**
   * @param {Record<string, object|function|string>|function} [ruleMap={}]
   */
  constructor(ruleMap = {}) {
    super();
    this.ruleMap = ruleMap;
  }

  async repair(documentContent, diagnostics, options = {}) {
    if (typeof this.ruleMap === 'function') {
      return this.ruleMap(documentContent, diagnostics, options);
    }

    let content = documentContent;
    const diagList = Array.isArray(diagnostics) ? diagnostics : (diagnostics ? [diagnostics] : []);

    for (const diag of diagList) {
      if (!diag) continue;
      const ruleId = diag.rule_id || diag.rule || diag.code;
      if (ruleId && this.ruleMap[ruleId]) {
        const patch = this.ruleMap[ruleId];
        if (typeof patch === 'function') {
          content = patch(content, diag);
        } else if (typeof patch === 'object') {
          content = applyFrontmatterPatch(content, patch);
        } else if (typeof patch === 'string') {
          content = patch;
        }
      }
    }
    return content;
  }
}
