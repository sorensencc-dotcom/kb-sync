import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const OVERRIDES_FILENAME = '.compaction-overrides.yaml';

/**
 * Loads .compaction-overrides.yaml. Returns { map, error }.
 * Fail-closed: malformed file yields { map: null, error } — callers must
 * force Full on error rather than treating an empty map as "no overrides".
 * Expired entries are dropped silently (not an error).
 */
export function loadActiveOverrides(repoRoot) {
  const filePath = path.join(repoRoot, OVERRIDES_FILENAME);

  if (!fs.existsSync(filePath)) {
    return { map: new Map(), error: null };
  }

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { map: null, error: `Failed to parse ${OVERRIDES_FILENAME}: ${err.message}` };
  }

  if (parsed == null) {
    return { map: new Map(), error: null };
  }

  const entries = parsed.overrides;
  if (!Array.isArray(entries)) {
    return { map: null, error: `${OVERRIDES_FILENAME}: "overrides" must be an array` };
  }

  const now = Date.now();
  const map = new Map();

  for (const [i, entry] of entries.entries()) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.expire_at !== 'string') {
      return { map: null, error: `${OVERRIDES_FILENAME}: overrides[${i}] missing required "path" or "expire_at"` };
    }
    const expireMs = Date.parse(entry.expire_at);
    if (Number.isNaN(expireMs)) {
      return { map: null, error: `${OVERRIDES_FILENAME}: overrides[${i}] has invalid expire_at "${entry.expire_at}"` };
    }
    if (expireMs <= now) continue; // expired: drop silently, not an error
    map.set(entry.path, entry);
  }

  return { map, error: null };
}

/**
 * Persists only non-expired entries back to disk (used by both `restore`
 * and `prune-overrides` CLI subcommands — the map passed in is expected to
 * already be the post-mutation/pruned set).
 */
export function saveOverrides(repoRoot, map) {
  const filePath = path.join(repoRoot, OVERRIDES_FILENAME);
  const now = Date.now();
  const overrides = [...map.values()].filter(entry => {
    const expireMs = Date.parse(entry.expire_at);
    return !Number.isNaN(expireMs) && expireMs > now;
  });

  const doc = {
    overrides: overrides.map(({ path: p, created_at, expire_at, reason }) => ({
      path: p, created_at, expire_at, reason
    }))
  };

  fs.writeFileSync(filePath, yaml.dump(doc), 'utf8');
}
