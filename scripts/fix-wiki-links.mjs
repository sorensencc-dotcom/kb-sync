import fs from 'fs';
import path from 'path';

const wikiDir = path.resolve('wiki');

function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDir(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      let content = fs.readFileSync(full, 'utf8');
      let updated = content.replace(/\[\[Index\]\]/g, '[[kb-sync/wiki/Index]]');
      updated = updated.replace(/\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g, (match, target, hash = '', label = '') => {
        let clean = target.trim();
        if (clean.includes('/')) {
          return match; // Already absolute path
        }
        if (clean.toLowerCase() === 'index' || clean.toLowerCase() === 'index.md') {
          return `[[kb-sync/wiki/Index]]`;
        }
        let folder = 'entities';
        if (clean.toLowerCase() === 'log' || clean.toLowerCase() === 'log.md') {
          folder = 'wiki';
        } else {
          // Check if target file lives in concepts
          if (fs.existsSync(path.join(wikiDir, 'concepts', clean)) || fs.existsSync(path.join(wikiDir, 'concepts', clean + '.md'))) {
            folder = 'concepts';
          }
        }
        const cleanNoExt = clean.replace(/\.md$/, '');
        return `[[kb-sync/${folder}/${cleanNoExt}${hash}${label}]]`;
      });
      if (updated !== content) {
        fs.writeFileSync(full, updated, 'utf8');
        console.log(`Updated links in: ${path.relative(wikiDir, full)}`);
      }
    }
  }
}

processDir(wikiDir);
