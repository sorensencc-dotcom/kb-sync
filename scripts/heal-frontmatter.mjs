import fs from 'node:fs';
import path from 'node:path';

const wikiDir = path.resolve('obsidian/vault/wiki');

function scan(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.transact')) continue;
      scan(full);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      const content = fs.readFileSync(full, 'utf8');
      const rel = path.relative(wikiDir, full).replace(/\\/g, '/');
      const base = path.basename(full, '.md');
      const title = base.replace(/[-_]+/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const now = new Date().toISOString().slice(0, 10);
      const isResearch = rel.includes('research/');
      const defaultCategory = isResearch ? 'research' : 'wiki';

      if (!content.startsWith('---')) {
        const header = `---\ntitle: "${title}"\ncategory: "${defaultCategory}"\nstatus: "active"\ncreated_at: "${now}"\ntags:\n  - auto-healed\n  - ${defaultCategory}\n---\n\n`;
        fs.writeFileSync(full, header + content.trimStart(), 'utf8');
        console.log('Added FM to:', rel);
      } else {
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        if (match) {
          let fm = match[1];
          const body = match[2];
          let changed = false;

          if (fm.includes('category: "knowledge"') || fm.includes('category: knowledge')) {
            fm = fm.replace(/category:\s*["']?knowledge["']?/g, 'category: "wiki"');
            changed = true;
          }
          if (!/category:\s*/.test(fm)) {
            fm += `\ncategory: "${defaultCategory}"`;
            changed = true;
          }
          if (fm.includes('status: "drop"') || fm.includes('status: drop')) {
            fm = fm.replace(/status:\s*["']?drop["']?/g, 'status: "draft"');
            changed = true;
          }
          if (changed) {
            fs.writeFileSync(full, `---\n${fm}\n---\n${body}`, 'utf8');
            console.log('Fixed FM in:', rel);
          }
        }
      }
    }
  }
}

scan(wikiDir);
console.log('Vault frontmatter scan & healing complete.');
