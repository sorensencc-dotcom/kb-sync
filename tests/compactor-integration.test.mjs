import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { buildCompactedPack } from '../modules/compactor/index.mjs';

const repoRoot = path.resolve('.');

test('buildCompactedPack executes end-to-end and outputs valid pack and status metrics', async () => {
  const tmpManifest = path.join(repoRoot, '.tmp-test-manifest.txt');
  const tmpOutput = path.join(repoRoot, '.tmp-test-pack.txt');
  const tmpConfig = path.join(repoRoot, '.tmp-test-config.yaml');

  const configContent = `
compaction:
  enabled: true
  git_window_days: 14
  default_level: "Full"
  high_risk_prefixes:
    - "auth/"
  rules:
    - prefix: "core/"
      level: "Skeleton"
    - prefix: "tests/"
      level: "Outline"
`;

  const manifestContent = `
package.json
core/flatten.sh
`;

  fs.writeFileSync(tmpConfig, configContent, 'utf8');
  fs.writeFileSync(tmpManifest, manifestContent, 'utf8');

  try {
    const stats = await buildCompactedPack({
      repoRoot,
      manifestPath: tmpManifest,
      outputPath: tmpOutput,
      configPath: tmpConfig,
      skipPatterns: []
    });

    assert.ok(stats.total_raw_size_bytes > 0);
    assert.ok(stats.compacted_size_bytes > 0);
    assert.ok(fs.existsSync(tmpOutput));

    const packContent = fs.readFileSync(tmpOutput, 'utf8');
    assert.ok(packContent.includes('REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK'));
    assert.ok(packContent.includes('--- START FILE: package.json ---'));
    assert.ok(packContent.includes('--- START FILE: core/flatten.sh ---'));
  } finally {
    if (fs.existsSync(tmpManifest)) fs.unlinkSync(tmpManifest);
    if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
    if (fs.existsSync(tmpConfig)) fs.unlinkSync(tmpConfig);
  }
});
