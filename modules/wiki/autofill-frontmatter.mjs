#!/usr/bin/env node
// DEPRECATED: this tool hardcodes `category: "wiki"` on every file it touches, which the
// metadata-extraction ruleset's deterministic path/heading precedence is meant to replace.
// Run `npm run wiki:verify-frontmatter` first -- it is non-mutating and reports what each
// file's category/tags *should* be. This script's own mutation behavior is left unchanged
// pending an operator decision on migrating consumers off the hardcoded fallback.
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', '_kb-sync-staging']);

function walk(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) count += walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      let content = fs.readFileSync(full, 'utf8');
      const hasFrontmatter = content.startsWith('---');
      if (!hasFrontmatter) {
        const basename = path.basename(entry.name, '.md').replace(/[-_]/g, ' ');
        const yaml = `---\ntitle: "${basename}"\ncategory: "wiki"\nstatus: "active"\n---\n\n`;
        fs.writeFileSync(full, yaml + content, 'utf8');
        count++;
      }
    }
  }
  return count;
}

console.warn('[AUTOFILL-FRONTMATTER] Deprecated: hardcodes category: "wiki". Run `npm run wiki:verify-frontmatter` for the deterministic, non-mutating replacement.');

const targetDir = process.argv[2] || path.join(process.cwd(), 'docs');
if (fs.existsSync(targetDir)) {
  const updated = walk(targetDir);
  console.log(`[AUTOFILL-FRONTMATTER] Applied canonical frontmatter to ${updated} markdown file(s) in ${targetDir}.`);
} else {
  console.error(`[AUTOFILL-FRONTMATTER] Directory not found: ${targetDir}`);
  process.exit(1);
}
