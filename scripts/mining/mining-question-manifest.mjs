import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { updateJsonLocked } from '../../modules/trm/storage/transaction-manager.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_MINING_QUESTION_MANIFEST_PATH = path.join(REPO_ROOT, '.kb_cache', 'mining-question-manifest.json');

export function miningQuestionKey(notebookId, question) {
  const text = typeof question === 'string' ? question : question?.text;
  if (!text) return null;
  const entityId = typeof question === 'string' ? '' : (question.entityId || question.id || '');
  const questionHash = crypto.createHash('sha256').update(text.trim().replace(/\s+/g, ' ').toLowerCase()).digest('hex');
  return JSON.stringify([notebookId, String(entityId), questionHash]);
}

export function filterUnminedQuestions(notebookId, questions, manifestPath = DEFAULT_MINING_QUESTION_MANIFEST_PATH) {
  let answeredKeys = [];
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    answeredKeys = manifest.last_mined_answer_keys;
    if (!Array.isArray(answeredKeys)) throw new Error(`Invalid last_mined_answer_keys in ${manifestPath}`);
  }

  const seen = new Set(answeredKeys);
  return questions.filter((question) => {
    const key = miningQuestionKey(notebookId, question);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function recordMinedQuestion(notebookId, question, manifestPath = DEFAULT_MINING_QUESTION_MANIFEST_PATH) {
  const key = miningQuestionKey(notebookId, question);
  if (!key) return;
  if (fs.existsSync(manifestPath)) {
    const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(current.last_mined_answer_keys)) {
      throw new Error(`Invalid last_mined_answer_keys in ${manifestPath}`);
    }
  }
  updateJsonLocked(manifestPath, (manifest) => {
    if (!Array.isArray(manifest.last_mined_answer_keys)) {
      if (Object.keys(manifest).length > 0) throw new Error(`Invalid last_mined_answer_keys in ${manifestPath}`);
      manifest.last_mined_answer_keys = [];
    }
    if (!manifest.last_mined_answer_keys.includes(key)) manifest.last_mined_answer_keys.push(key);
    return manifest;
  });
}
