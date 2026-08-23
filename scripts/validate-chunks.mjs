#!/usr/bin/env node
// ==============================================================================
// Research Frontmatter & Provenance Validator (Stage 3)
// Enforces mandatory provenance metadata on research markdown notes:
// - source_title
// - repository
// - document_date
// - verification_status
// - category
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLOR = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const logInfo = (msg) => console.log(`${COLOR.green}[VALIDATE-PROVENANCE] [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.log(`${COLOR.yellow}[VALIDATE-PROVENANCE] [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.error(`${COLOR.red}[VALIDATE-PROVENANCE] [ERROR]${COLOR.reset} ${msg}`);

export const REQUIRED_PROVENANCE_FIELDS = [
  'source_title',
  'repository',
  'document_date',
  'verification_status',
  'category'
];

export function extractFrontmatter(content) {
  if (typeof content !== 'string') return null;
  const parts = content.split(/^---\r?\n/m);
  if (parts.length < 3) return null;
  const fmRaw = parts[1];
  const data = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (m) {
      data[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return data;
}

export function validateFileProvenance(filePath, content) {
  const fileContent = content !== undefined ? content : fs.readFileSync(filePath, 'utf8');
  const frontmatter = extractFrontmatter(fileContent);

  const errors = [];

  if (!frontmatter) {
    errors.push('Missing required YAML frontmatter block (--- ... ---)');
    return { valid: false, errors, frontmatter: null };
  }

  for (const field of REQUIRED_PROVENANCE_FIELDS) {
    const val = frontmatter[field];
    if (val === undefined || val === null || String(val).trim() === '') {
      errors.push(`Missing mandatory provenance field: '${field}'`);
    }
  }

  // Validate verification_status value if present
  if (frontmatter.verification_status) {
    const allowedStatuses = ['verified', 'unverified', 'pending', 'active', 'archived'];
    if (!allowedStatuses.includes(String(frontmatter.verification_status).toLowerCase())) {
      errors.push(`Invalid verification_status: '${frontmatter.verification_status}'. Must be one of: ${allowedStatuses.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    frontmatter
  };
}

export function validateResearchDirectories(targetDirs, rootDir = path.resolve(__dirname, '../..')) {
  const dirs = targetDirs && targetDirs.length > 0 
    ? targetDirs 
    : [
        path.join(rootDir, 'wiki/research'),
        path.join(rootDir, '_kb-sync-staging/trm')
      ];

  logInfo(`Scanning directories for research provenance validation:`);
  dirs.forEach(d => logInfo(` - ${path.relative(rootDir, d)}`));

  const results = [];
  let totalFiles = 0;
  let failedFiles = 0;

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== '.nlm_pack') {
          walk(full);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        totalFiles++;
        const res = validateFileProvenance(full);
        const rel = path.relative(rootDir, full).replace(/\\/g, '/');
        if (!res.valid) {
          failedFiles++;
          results.push({ file: rel, ...res });
          logError(`✗ ${rel}:`);
          res.errors.forEach(e => console.error(`    - ${e}`));
        } else {
          logInfo(`✓ ${rel} [Category: ${res.frontmatter.category}, Repo: ${res.frontmatter.repository}]`);
        }
      }
    }
  }

  for (const d of dirs) {
    walk(d);
  }

  logInfo(`\nProvenance Validation Summary:`);
  logInfo(`Total files inspected: ${totalFiles}`);
  logInfo(`Passed: ${totalFiles - failedFiles}`);
  logInfo(`Failed: ${failedFiles}`);

  return {
    totalFiles,
    failedFiles,
    passed: failedFiles === 0,
    failures: results
  };
}

const mainFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
const thisFile = fs.realpathSync(__filename);
if (mainFile === thisFile) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const outcome = validateResearchDirectories(args.length ? args : null);
  process.exit(outcome.passed ? 0 : 1);
}
