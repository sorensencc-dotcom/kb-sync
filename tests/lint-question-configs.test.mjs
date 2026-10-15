import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANNED_BOILERPLATE_PATTERNS,
  MIN_ENTROPY_THRESHOLD,
  calculateContentEntropy,
} from '../scripts/notebooklm/chat-injection-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEV_ROOT = path.resolve(REPO_ROOT, '..');

describe('Question Configuration Lint & Zero-Boilerplate Guard', () => {
  const candidateConfigPaths = [
    path.join(DEV_ROOT, 'trm', 'config', 'mining-questions.json'),
    path.join(DEV_ROOT, 'trm', 'config', 'operational-questions.json'),
  ];

  for (const configPath of candidateConfigPaths) {
    const filename = path.basename(configPath);

    it(`enforces zero banned boilerplate patterns in ${filename}`, () => {
      if (!fs.existsSync(configPath)) {
        console.warn(`[LINT-SKIP] Optional config not found: ${configPath}`);
        return;
      }

      const raw = fs.readFileSync(configPath, 'utf8');
      const data = JSON.parse(raw);
      assert.ok(Array.isArray(data.questions), `${filename} must contain questions array`);
      assert.ok(data.questions.length > 0, `${filename} must have at least 1 question`);

      for (const q of data.questions) {
        const text = q.text || '';
        for (const pattern of BANNED_BOILERPLATE_PATTERNS) {
          assert.equal(
            pattern.test(text),
            false,
            `Violation in ${filename}: Question ID "${q.id}" matched banned boilerplate pattern ${pattern}: "${text}"`
          );
        }
      }
    });

    it(`enforces minimum Shannon entropy (>= ${MIN_ENTROPY_THRESHOLD}) for questions in ${filename}`, () => {
      if (!fs.existsSync(configPath)) return;

      const raw = fs.readFileSync(configPath, 'utf8');
      const data = JSON.parse(raw);

      for (const q of data.questions) {
        const text = q.text || '';
        const entropy = calculateContentEntropy(text);
        assert.ok(
          entropy >= MIN_ENTROPY_THRESHOLD,
          `Entropy failure in ${filename} for question "${q.id}": ${entropy} < ${MIN_ENTROPY_THRESHOLD}`
        );
      }
    });
  }
});
