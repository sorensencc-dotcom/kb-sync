import fs from 'node:fs';
import yaml from 'js-yaml';

const REQUIRED_LEVELS = new Set(['Full', 'Skeleton', 'Outline', 'Excluded']);

/**
 * Loads and validates configs/compaction.yaml. Fail-closed: any parse or
 * schema error is thrown, not swallowed — callers must catch and force Full.
 */
export function loadCompactionConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    throw new Error(`Config Error: compaction config not found at "${configPath}"`);
  }

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Config Error: failed to parse YAML at "${configPath}": ${err.message}`);
  }

  const compaction = parsed && parsed.compaction;
  if (!compaction || typeof compaction !== 'object') {
    throw new Error(`Config Error: missing top-level "compaction" key in "${configPath}"`);
  }

  if (typeof compaction.enabled !== 'boolean') {
    throw new Error('Config Error: compaction.enabled must be a boolean');
  }
  if (!REQUIRED_LEVELS.has(compaction.default_level)) {
    throw new Error(`Config Error: compaction.default_level must be one of ${[...REQUIRED_LEVELS].join(', ')}`);
  }
  if (typeof compaction.git_window_days !== 'number' || compaction.git_window_days < 0) {
    throw new Error('Config Error: compaction.git_window_days must be a non-negative number');
  }

  compaction.high_risk_prefixes = Array.isArray(compaction.high_risk_prefixes) ? compaction.high_risk_prefixes : [];
  compaction.rules = Array.isArray(compaction.rules) ? compaction.rules : [];

  for (const [i, rule] of compaction.rules.entries()) {
    if (!rule || typeof rule.prefix !== 'string' || !REQUIRED_LEVELS.has(rule.level)) {
      throw new Error(`Config Error: rules[${i}] must have a string "prefix" and valid "level"`);
    }
  }

  return { compaction };
}
