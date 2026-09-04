import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Searches the live web using parallel-cli with fail-soft fallback to tinyfish or empty list.
 *
 * @param {string} query - Search query
 * @param {Object} [options]
 * @param {number} [options.limit=3] - Maximum results
 * @param {number} [options.timeoutMs=10000] - Process timeout in milliseconds
 * @returns {Array<{ id: string, topic: string, file_path: string, snippet: string, retrieval_mode: string }>}
 */
export function searchWebFallback(query, options = {}) {
  const limit = options.limit || 3;
  const timeoutMs = options.timeoutMs || 10000;
  const cleanQuery = query.replace(/["\n\r]/g, ' ').trim().slice(0, 150);

  if (!cleanQuery) return [];

  const tempFile = path.join(os.tmpdir(), `trm-search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);

  // Tier 1: Try parallel-cli
  try {
    const cmd = `parallel-cli search "${cleanQuery}" --json --max-results ${limit} -o "${tempFile}"`;
    execSync(cmd, { timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] });

    if (fs.existsSync(tempFile)) {
      const rawData = fs.readFileSync(tempFile, 'utf8');
      try { fs.unlinkSync(tempFile); } catch {}
      const parsed = JSON.parse(rawData);

      if (Array.isArray(parsed.results) && parsed.results.length > 0) {
        return parsed.results.slice(0, limit).map((r) => ({
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
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
  }

  // Tier 2: Try tinyfish search
  try {
    const cmd = `tinyfish search query "${cleanQuery}"`;
    const output = execSync(cmd, { timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
    const parsed = JSON.parse(output);

    if (Array.isArray(parsed.results) && parsed.results.length > 0) {
      return parsed.results.slice(0, limit).map((r) => ({
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
