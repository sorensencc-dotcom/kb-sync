import { execFileSync as defaultExecFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Clamp limit to a safe positive integer in [1, 10].
 * @param {unknown} limit
 * @returns {number}
 */
function clampLimit(limit) {
  const n = Number.parseInt(String(limit ?? 3), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 10) return 10;
  return n;
}

/**
 * Sanitize search query: strip quotes/newlines, trim, max 150 chars.
 * @param {unknown} query
 * @returns {string}
 */
function sanitizeQuery(query) {
  return String(query ?? '')
    .replace(/["\n\r]/g, ' ')
    .trim()
    .slice(0, 150);
}

/**
 * Keep only http(s) URLs.
 * @param {unknown} url
 * @returns {boolean}
 */
function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/**
 * Best-effort temp file cleanup.
 * @param {string} tempFile
 */
function cleanupTemp(tempFile) {
  try {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Searches the live web using parallel-cli with fail-soft fallback to tinyfish or empty list.
 *
 * Uses execFileSync with an argv array (never a shell string) to avoid command injection.
 *
 * @param {string} query - Search query
 * @param {Object} [options]
 * @param {number} [options.limit=3] - Maximum results (clamped to 1–10)
 * @param {number} [options.timeoutMs=10000] - Process timeout in milliseconds
 * @param {typeof defaultExecFileSync} [options.execFileSync] - Injectable runner for tests
 * @returns {Array<{ id: string, topic: string, file_path: string, snippet: string, retrieval_mode: string }>}
 */
export function searchWebFallback(query, options = {}) {
  const limit = clampLimit(options.limit);
  const timeoutMs = options.timeoutMs || 10000;
  const execFileSync = options.execFileSync || defaultExecFileSync;
  const cleanQuery = sanitizeQuery(query);

  if (!cleanQuery) return [];

  const tempFile = path.join(
    os.tmpdir(),
    `trm-search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`
  );

  // Tier 1: Try parallel-cli
  try {
    execFileSync(
      'parallel-cli',
      ['search', cleanQuery, '--json', '--max-results', String(limit), '-o', tempFile],
      { timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    if (fs.existsSync(tempFile)) {
      const rawData = fs.readFileSync(tempFile, 'utf8');
      cleanupTemp(tempFile);
      const parsed = JSON.parse(rawData);

      if (Array.isArray(parsed.results) && parsed.results.length > 0) {
        return parsed.results
          .filter((r) => isHttpUrl(r?.url))
          .slice(0, limit)
          .map((r) => ({
            id: r.url,
            topic: r.title || 'Web Search Result',
            file_path: r.url,
            snippet: (r.excerpts && r.excerpts.length > 0 ? r.excerpts.join(' ') : r.title || '')
              .replace(/\s+/g, ' ')
              .trim(),
            retrieval_mode: 'web-parallel'
          }));
      }
    }
  } catch {
    // Fail-soft to Tier 2
    cleanupTemp(tempFile);
  }

  // Tier 2: Try tinyfish search
  try {
    const output = execFileSync(
      'tinyfish',
      ['search', 'query', cleanQuery],
      { timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    const parsed = JSON.parse(output);

    if (Array.isArray(parsed.results) && parsed.results.length > 0) {
      return parsed.results
        .filter((r) => isHttpUrl(r?.url))
        .slice(0, limit)
        .map((r) => ({
          id: r.url,
          topic: r.title || 'TinyFish Result',
          file_path: r.url,
          snippet: (r.snippet || r.title || '').replace(/\s+/g, ' ').trim(),
          retrieval_mode: 'web-tinyfish'
        }));
    }
  } catch {
    // Fail-soft: return empty array if all web search providers fail
  }

  return [];
}

export { clampLimit, sanitizeQuery, isHttpUrl };
