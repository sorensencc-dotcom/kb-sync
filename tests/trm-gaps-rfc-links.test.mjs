import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

test('all RFC links in trm-research-gaps.md resolve to existing files', () => {
  const gapsPath = path.join(REPO_ROOT, 'trm-research-gaps.md');
  const content = fs.readFileSync(gapsPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const broken = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = line.matchAll(/\[RFC\]\(([^)]+)\)/g);
    for (const match of matches) {
      const target = match[1].split('#')[0];
      if (/^https?:\/\//i.test(target)) continue;
      const resolved = path.resolve(REPO_ROOT, target);
      if (!fs.existsSync(resolved)) {
        broken.push(`line ${i + 1}: ${target}`);
      }
    }
  }

  assert.deepEqual(broken, [], `Found broken RFC links in trm-research-gaps.md:\n${broken.join('\n')}`);
});
