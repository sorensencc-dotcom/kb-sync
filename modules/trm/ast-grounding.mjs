import { execSync } from 'node:child_process';
import path from 'node:path';

const COMMON_STOP_SYMBOLS = new Set([
  'the', 'this', 'that', 'with', 'from', 'have', 'been', 'will', 'what', 'when',
  'where', 'which', 'their', 'there', 'about', 'would', 'could', 'should', 'other',
  'true', 'false', 'null', 'undefined', 'async', 'await', 'return', 'import', 'export'
]);

/**
 * Extracts candidate code symbols (functions, classes, variables, file paths) from text.
 *
 * @param {string} text
 * @returns {string[]} Deduplicated list of symbol candidates
 */
export function extractCodeSymbols(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const symbols = new Set();

  // 1. Backtick enclosed code tokens: `symbolName`
  const backtickMatches = text.matchAll(/`([^`\s]+)`/g);
  for (const m of backtickMatches) {
    const sym = m[1].replace(/[[\](),;]/g, '').trim();
    if (sym && sym.length >= 3 && !COMMON_STOP_SYMBOLS.has(sym.toLowerCase())) {
      symbols.add(sym);
    }
  }

  // 2. camelCase and PascalCase identifiers: handleQueryContextCache, DatabaseSync
  const camelMatches = text.matchAll(/\b([a-z]+[A-Z0-9][a-zA-Z0-9]*|[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*)\b/g);
  for (const m of camelMatches) {
    const sym = m[1].trim();
    if (sym.length >= 3 && !COMMON_STOP_SYMBOLS.has(sym.toLowerCase())) {
      symbols.add(sym);
    }
  }

  // 3. snake_case or kebab-case file references: query_expander, run-closed-loop
  const slugMatches = text.matchAll(/\b([a-zA-Z0-9_-]+\.(?:mjs|js|ts|json|sql|md|ps1|py))\b/g);
  for (const m of slugMatches) {
    const sym = m[1].trim();
    symbols.add(sym);
  }

  return Array.from(symbols);
}

/**
 * Executes graft callers CLI to extract call graph and blast radius for a symbol.
 * Fail-soft: returns null if graft CLI is unavailable or symbol is not indexed.
 *
 * @param {string} symbol - Code symbol or identifier
 * @param {Object} [options]
 * @param {string} [options.cwd] - Execution working directory
 * @param {number} [options.depth=2] - Traversal depth
 * @param {number} [options.timeoutMs=4000] - Process timeout
 * @param {Function} [options.execFn] - Custom execSync for testing
 * @returns {{ symbol: string, callers: string[], callees: string[], spans: string[], rawOutput: string } | null}
 */
export function fetchSymbolAstGraph(symbol, options = {}) {
  const cwd = options.cwd || process.cwd();
  const depth = options.depth || 2;
  const timeout = options.timeoutMs || 4000;
  const exec = options.execFn || execSync;

  if (!symbol || typeof symbol !== 'string') {
    return null;
  }

  try {
    const cmd = `graft callers "${symbol}" --depth ${depth}`;
    const rawOutput = exec(cmd, {
      cwd,
      timeout: Math.min(timeout, 1500),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (!rawOutput || rawOutput.trim().length === 0) {
      return null;
    }

    const lines = rawOutput.split(/\r?\n/);
    const callers = [];
    const callees = [];
    const spans = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Extract file:line spans (e.g., path/to/file.js:45)
      const spanMatch = trimmed.match(/([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+:\d+(?:-\d+)?)/);
      if (spanMatch) {
        spans.push(spanMatch[1]);
      }

      if (trimmed.includes('<-') || trimmed.toLowerCase().includes('called by')) {
        callers.push(trimmed);
      } else if (trimmed.includes('->') || trimmed.toLowerCase().includes('calls')) {
        callees.push(trimmed);
      }
    }

    return {
      symbol,
      callers,
      callees,
      spans,
      rawOutput: rawOutput.trim(),
    };
  } catch {
    // Fail-soft: graft not installed, timed out, or symbol not found
    return null;
  }
}

/**
 * Fetches AST blast-radius trees for multiple candidate symbols.
 *
 * @param {string[]} symbols
 * @param {Object} [options]
 * @returns {Array<{ symbol: string, callers: string[], callees: string[], spans: string[], rawOutput: string }>}
 */
export function fetchAstBlastRadius(symbols, options = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return [];
  }

  const results = [];
  const maxSymbols = options.maxSymbols || 4;

  for (const sym of symbols.slice(0, maxSymbols)) {
    const graph = fetchSymbolAstGraph(sym, options);
    if (graph) {
      results.push(graph);
    }
  }

  return results;
}

/**
 * Formats AST call graph results into markdown for inclusion in RFC decision notes.
 *
 * @param {Array<Object>} astResults - List of AST graph results
 * @returns {string} Markdown section
 */
export function formatAstGroundingSection(astResults = []) {
  if (!Array.isArray(astResults) || astResults.length === 0) {
    return `### 3. AST Call-Graph & Blast Radius Analysis\n*No static call-graph symbols detected in target codebase for this item.*\n`;
  }

  let md = `### 3. AST Call-Graph & Blast Radius Analysis\n\n`;
  md += `Static analysis computed via Graft symbol indexing:\n\n`;

  for (const item of astResults) {
    md += `#### Symbol: \`${item.symbol}\`\n\n`;

    if (item.spans && item.spans.length > 0) {
      md += `* **Associated Spans**: ${item.spans.map(s => `\`${s}\``).join(', ')}\n`;
    }

    if (item.callers && item.callers.length > 0) {
      md += `* **Callers**: ${item.callers.slice(0, 5).map(c => `\`${c}\``).join(', ')}\n`;
    }

    if (item.callees && item.callees.length > 0) {
      md += `* **Callees**: ${item.callees.slice(0, 5).map(c => `\`${c}\``).join(', ')}\n`;
    }

    if (item.rawOutput) {
      md += `\n\`\`\`text\n${item.rawOutput.slice(0, 500)}\n\`\`\`\n\n`;
    }
  }

  return md;
}
