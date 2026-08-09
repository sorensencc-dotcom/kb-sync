import fs from 'fs';
import path from 'path';

const wikiDir = path.resolve('wiki');

function fixFrontmatterInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const basename = path.basename(filePath, '.md');
  let category = 'wiki';
  if (filePath.includes(path.join('wiki', 'entities'))) category = 'utilities';
  if (filePath.includes(path.join('wiki', 'concepts'))) category = 'wiki';
  
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatterMatch) {
    let yamlBlock = frontmatterMatch[1];
    let lines = yamlBlock.split('\n');
    let hasTitle = false, hasCategory = false, hasStatus = false;
    for (const line of lines) {
      if (line.trim().startsWith('title:')) hasTitle = true;
      if (line.trim().startsWith('category:')) hasCategory = true;
      if (line.trim().startsWith('status:')) hasStatus = true;
    }
    let additions = [];
    if (!hasTitle) additions.push(`title: "${basename}"`);
    if (!hasCategory) additions.push(`category: "${category}"`);
    if (!hasStatus) additions.push(`status: "active"`);

    if (additions.length > 0) {
      const newYaml = additions.join('\n') + '\n' + yamlBlock;
      content = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newYaml}\n---`);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated frontmatter in: ${filePath}`);
    }
  } else {
    const yaml = `---\ntitle: "${basename}"\ncategory: "${category}"\nstatus: "active"\n---\n\n`;
    fs.writeFileSync(filePath, yaml + content, 'utf8');
    console.log(`Added frontmatter to: ${filePath}`);
  }
}

function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDir(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fixFrontmatterInFile(full);
    }
  }
}

processDir(wikiDir);
