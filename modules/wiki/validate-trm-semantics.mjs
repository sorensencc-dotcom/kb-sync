import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Normalizes file paths for cross-platform containment and reparse checks.
 * Converts backslashes to slashes and lowercases Windows drive letters.
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  if (!p) return '';
  let norm = p.replace(/\\/g, '/');
  const driveMatch = norm.match(/^([A-Za-z]):/);
  if (driveMatch) {
    norm = driveMatch[1].toLowerCase() + norm.slice(1);
  }
  return norm.replace(/\/+$/, '');
}

/**
 * Computes single-pass SHA-256 hash and byte size via 64 KB chunked streams.
 * @param {string} filePath
 * @returns {Promise<{ sha256: string, byteLength: number }>}
 */
export function computeStreamHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let byteLength = 0;
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

    stream.on('data', (chunk) => {
      byteLength += chunk.length;
      hash.update(chunk);
    });
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), byteLength }));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Programmatic cross-field semantic and stream validator for TRM staged batches.
 * @param {string} stagingDir Path to batch directory (containing payload.json, sources.manifest.json, sources/)
 * @param {object} payload Parsed payload.json
 * @param {Record<string, { content_sha256: string, byte_size: number }>} manifest Parsed sources.manifest.json
 * @returns {Promise<{ valid: boolean, errors: Array<{ rule_id: string, message: string }> }>}
 */
export async function validateTrmPayloadSemantics(stagingDir, payload, manifest) {
  const errors = [];
  const seenSourceIds = new Set();
  const seenFilenames = new Set();

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.sources)) {
    return {
      valid: false,
      errors: [{ rule_id: 'RULE_SEMANTIC_SCHEMA_INVALID', message: "Missing or non-array 'sources' in payload" }]
    };
  }

  if (!manifest || typeof manifest !== 'object') {
    return {
      valid: false,
      errors: [{ rule_id: 'RULE_SEMANTIC_MANIFEST_INVALID', message: 'Missing or invalid sources.manifest.json' }]
    };
  }

  const rawSourcesDir = path.join(stagingDir, 'sources');
  if (!fs.existsSync(rawSourcesDir)) {
    return {
      valid: false,
      errors: [{ rule_id: 'RULE_SEMANTIC_DIR_MISSING', message: `Sources directory not found: ${rawSourcesDir}` }]
    };
  }

  let canonicalSourcesDir;
  try {
    canonicalSourcesDir = normalizePath(fs.realpathSync(rawSourcesDir));
  } catch (err) {
    return {
      valid: false,
      errors: [{ rule_id: 'RULE_SEMANTIC_REALPATH_ERROR', message: `Failed resolving sources directory: ${err.message}` }]
    };
  }

  // 1. Enforce flat file policy & reject Windows junctions/reparse points
  try {
    const diskEntries = fs.readdirSync(rawSourcesDir, { withFileTypes: true });
    for (const entry of diskEntries) {
      const rawPath = path.join(rawSourcesDir, entry.name);
      let lstat;
      try {
        lstat = fs.lstatSync(rawPath);
      } catch (err) {
        errors.push({ rule_id: 'RULE_SEMANTIC_IO_FAILURE', message: `Failed stating entry '${entry.name}': ${err.message}` });
        continue;
      }

      if (!lstat.isFile() || lstat.isSymbolicLink()) {
        errors.push({ rule_id: 'RULE_SEMANTIC_ILLEGAL_FILE_TYPE', message: `Illegal non-flat or symlink entry in sources/: '${entry.name}'` });
        continue;
      }

      try {
        const canonicalEntry = normalizePath(fs.realpathSync(rawPath));
        if (!canonicalEntry.startsWith(canonicalSourcesDir + '/')) {
          errors.push({ rule_id: 'RULE_SEMANTIC_REPARSE_POINT', message: `Reparse point escape detected in sources/: '${entry.name}'` });
        }
      } catch (err) {
        errors.push({ rule_id: 'RULE_SEMANTIC_REALPATH_ERROR', message: `Realpath failed for '${entry.name}': ${err.message}` });
      }
    }
  } catch (err) {
    return {
      valid: false,
      errors: [{ rule_id: 'RULE_SEMANTIC_IO_FAILURE', message: `Disk scan failed: ${err.message}` }]
    };
  }

  // 2. Validate payload sources against manifest and compute streamed SHA-256
  for (const src of payload.sources) {
    if (!src.source_id || typeof src.source_id !== 'string' || !/^src-[a-z0-9-]+$/.test(src.source_id)) {
      errors.push({ rule_id: 'RULE_SEMANTIC_SOURCE_ID_INVALID', message: `Invalid source_id format: '${src?.source_id}'` });
    } else {
      if (seenSourceIds.has(src.source_id)) {
        errors.push({ rule_id: 'RULE_SEMANTIC_DUPLICATE_ID', message: `Duplicate source_id detected: '${src.source_id}'` });
      }
      seenSourceIds.add(src.source_id);
    }

    if (!src.staged_filename || typeof src.staged_filename !== 'string') {
      errors.push({ rule_id: 'RULE_SEMANTIC_FILENAME_MISSING', message: `Missing staged_filename for source '${src?.source_id}'` });
      continue;
    }

    if (seenFilenames.has(src.staged_filename)) {
      errors.push({ rule_id: 'RULE_SEMANTIC_DUPLICATE_FILENAME', message: `Duplicate staged_filename detected: '${src.staged_filename}'` });
    }
    seenFilenames.add(src.staged_filename);

    if (/[/\\]|\.\./.test(src.staged_filename)) {
      errors.push({ rule_id: 'RULE_SEMANTIC_TRAVERSAL_DETECTED', message: `Illegal path traversal characters in staged_filename: '${src.staged_filename}'` });
      continue;
    }

    const extMatch = src.staged_filename.match(/\.([a-zA-Z0-9]+)$/);
    if (!extMatch || !src.staged_filename.startsWith(src.source_id + '.')) {
      errors.push({ rule_id: 'RULE_SEMANTIC_FILENAME_BINDING', message: `staged_filename '${src.staged_filename}' must strictly derive from source_id '${src.source_id}'` });
    }

    if (!/^[a-f0-9]{64}$/.test(src.content_sha256 || '')) {
      errors.push({ rule_id: 'RULE_SEMANTIC_HASH_FORMAT_INVALID', message: `Invalid SHA-256 format in payload for '${src.staged_filename}'` });
    }

    const manifestEntry = manifest[src.staged_filename];
    if (!manifestEntry) {
      errors.push({ rule_id: 'RULE_SEMANTIC_MANIFEST_MISSING_ENTRY', message: `staged_filename '${src.staged_filename}' not present in sources.manifest.json` });
    } else {
      if (!/^[a-f0-9]{64}$/.test(manifestEntry.content_sha256 || '')) {
        errors.push({ rule_id: 'RULE_SEMANTIC_MANIFEST_HASH_INVALID', message: `Invalid hash format in manifest for '${src.staged_filename}'` });
      }
      if (manifestEntry.content_sha256 !== src.content_sha256) {
        errors.push({ rule_id: 'RULE_SEMANTIC_PAYLOAD_MANIFEST_MISMATCH', message: `Checksum mismatch for '${src.staged_filename}': manifest=${manifestEntry.content_sha256}, payload=${src.content_sha256}` });
      }
      if (manifestEntry.byte_size !== src.byte_size) {
        errors.push({ rule_id: 'RULE_SEMANTIC_PAYLOAD_SIZE_MISMATCH', message: `Byte size mismatch for '${src.staged_filename}': manifest=${manifestEntry.byte_size}, payload=${src.byte_size}` });
      }

      const diskFilePath = path.join(rawSourcesDir, src.staged_filename);
      if (!fs.existsSync(diskFilePath)) {
        errors.push({ rule_id: 'RULE_SEMANTIC_FILE_NOT_FOUND', message: `Source file missing on disk: '${src.staged_filename}'` });
      } else {
        try {
          const { sha256, byteLength } = await computeStreamHash(diskFilePath);
          if (sha256 !== src.content_sha256) {
            errors.push({ rule_id: 'RULE_SEMANTIC_CHECKSUM_MISMATCH', message: `Disk hash (${sha256}) !== payload hash (${src.content_sha256}) for '${src.staged_filename}'` });
          }
          if (byteLength !== src.byte_size) {
            errors.push({ rule_id: 'RULE_SEMANTIC_BYTE_SIZE_MISMATCH', message: `Disk size (${byteLength}) !== payload size (${src.byte_size}) for '${src.staged_filename}'` });
          }
        } catch (err) {
          errors.push({ rule_id: 'RULE_SEMANTIC_STREAM_ERROR', message: `Stream read failure for '${src.staged_filename}': ${err.message}` });
        }
      }
    }
  }

  // 3. Reject orphan files on disk
  try {
    const diskEntries = fs.readdirSync(rawSourcesDir);
    for (const file of diskEntries) {
      if (!seenFilenames.has(file)) {
        errors.push({ rule_id: 'RULE_SEMANTIC_ORPHAN_FILE', message: `Orphan unindexed file in sources/: '${file}'` });
      }
    }
  } catch {}

  // 4. Reject orphan entries in manifest
  for (const manifestFile of Object.keys(manifest)) {
    if (!seenFilenames.has(manifestFile)) {
      errors.push({ rule_id: 'RULE_SEMANTIC_ORPHAN_MANIFEST_ENTRY', message: `Orphan entry in sources.manifest.json: '${manifestFile}'` });
    }
  }

  return { valid: errors.length === 0, errors };
}
