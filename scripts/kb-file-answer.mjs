#!/usr/bin/env node
/**
 * File a verified agent answer back into the knowledge base.
 *
 * Writes a dated markdown note with frontmatter (source: agent-answer, verified: true, cites)
 * under docs/kb/agent-answers/YYYY-MM-DD/, a path the cache sync already ingests (docs/kb).
 * Notes without at least one citation are rejected.
 *
 * Usage:
 *   node scripts/kb-file-answer.mjs --title "..." --cite <url|path> [--cite ...] (--body-file answer.md | --body "..." | stdin)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ANSWERS_SUBDIR = path.join('docs', 'kb', 'agent-answers');

export function slugify(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'answer';
}

const yamlStr = (s) => JSON.stringify(String(s));

export function buildNote({ title, body, cites, now = new Date() }) {
  const t = String(title ?? '').trim();
  const b = String(body ?? '').trim();
  const c = (cites ?? []).map((x) => String(x).trim()).filter(Boolean);
  if (!t) throw new Error('title is required');
  if (!b) throw new Error('body is required');
  if (c.length === 0) throw new Error('at least one citation is required (--cite); unverified answers are not filed');
  const fm = [
    '---',
    `title: ${yamlStr(t)}`,
    'source: agent-answer',
    'verified: true',
    `created: ${now.toISOString()}`,
    'cites:',
    ...c.map((x) => `  - ${yamlStr(x)}`),
    '---',
    '',
  ].join('\n');
  const sources = ['', '## Sources', ...c.map((x) => `- ${x}`), ''].join('\n');
  return `${fm}# ${t}\n\n${b}\n${sources}`;
}

export function fileAnswer({ title, body, cites, repoRoot = REPO_ROOT, now = new Date() }) {
  const content = buildNote({ title, body, cites, now });
  const day = now.toISOString().slice(0, 10);
  const dir = path.join(repoRoot, ANSWERS_SUBDIR, day);
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `${slugify(title)}.md`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${slugify(title)}-${i}.md`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

function parseArgs(argv) {
  const out = { cites: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') out.title = argv[++i];
    else if (a === '--body') out.body = argv[++i];
    else if (a === '--body-file') out.body = fs.readFileSync(argv[++i], 'utf8');
    else if (a === '--cite') out.cites.push(argv[++i]);
    else if (a === '--repo-root') out.repoRoot = path.resolve(argv[++i]);
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('kb-file-answer.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  if (args.body === undefined && !process.stdin.isTTY) args.body = fs.readFileSync(0, 'utf8');
  try {
    const file = fileAnswer(args);
    console.log(`[kb-file-answer] filed ${path.relative(args.repoRoot || REPO_ROOT, file)}`);
  } catch (e) {
    console.error(`[kb-file-answer] rejected: ${e.message}`);
    process.exitCode = 1;
  }
}
