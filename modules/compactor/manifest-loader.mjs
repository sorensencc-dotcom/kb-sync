import fs from 'node:fs';
import { normalizeRepoPath } from './path-utils.mjs';

/**
 * Loads, cleans, normalizes, and validates the manifest file list.
 * Preserves exact spaces in filenames while stripping trailing CRLF/LF newlines.
 * Throws a ManifestError on unresolvable path boundaries or missing files.
 */
export function loadNormalizedManifest(manifestPath, repoRoot) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest Error: File not found at "${manifestPath}"`);
  }
  const rawText = fs.readFileSync(manifestPath, 'utf8');
  const lines = rawText.split(/\r?\n/);
  const normalizedSet = new Set();
  const manifestErrors = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' || line.startsWith('#')) continue; // Skip empty lines and comment headers
    try {
      const normPath = normalizeRepoPath(line, repoRoot);
      normalizedSet.add(normPath);
    } catch (err) {
      manifestErrors.push(`Line ${i + 1}: ${err.message}`);
    }
  }

  if (manifestErrors.length > 0) {
    throw new Error(`Manifest Boundary Errors:\n${manifestErrors.join('\n')}`);
  }

  return Array.from(normalizedSet);
}
