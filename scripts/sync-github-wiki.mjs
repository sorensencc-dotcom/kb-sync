#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const value = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };

const wikiSourceDir = path.resolve(root, value('--source-dir', 'wiki'));
const repoUrl = value('--repo-url', process.env.WIKI_REPO_URL || 'https://github.com/sorensencc-dotcom/kb-sync.wiki.git');
const targetWikiDir = path.resolve(root, value('--target-dir', '.wiki-publish-temp'));
const shouldPush = args.includes('--push') || process.env.AUTO_PUSH === 'true' || true; // Default to push when invoked
const commitMessage = value('--commit-msg', 'docs(wiki): synchronize full kb-sync documentation, concepts, and sidebar');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0;
  let copied = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      fs.mkdirSync(destPath, { recursive: true });
      copied += copyRecursive(srcPath, destPath);
    } else if (entry.isFile() && /\.(md|png|svg|jpg|jpeg|gif|mermaid)$/i.test(entry.name)) {
      fs.copyFileSync(srcPath, destPath);
      copied += 1;
    }
  }
  return copied;
}

function generateSidebar(wikiDir) {
  let sidebarContent = `### Knowledge Base Sync (\`kb-sync\`)
- [Home](Home)
- [Index](Index)
- [Log](Log)

#### Core Systems
- [TRM Gap Triage & Hybrid Synthesis](research/rfc-gap-01--cic-daily-research-follow-up)
- [Competitor Watchlist & Drift Engine](research/competitor-watchlist-drift-engine)
- [WhichLLM Model Selection Evaluator](research/whichllm-model-selection-evaluator)
- [Local Context Cache](concepts/local-context-cache)
- [TRM Closed-Loop Research](concepts/trm-closed-loop-research)
- [Fail-Soft Orchestration](concepts/fail-soft-orchestration)
- [Deterministic Sync Pipeline](concepts/deterministic-sync-pipeline)

#### Concepts
`;

  const conceptsDir = path.join(wikiDir, 'concepts');
  if (fs.existsSync(conceptsDir)) {
    const conceptFiles = fs.readdirSync(conceptsDir).filter(f => f.endsWith('.md'));
    for (const file of conceptFiles) {
      const name = file.replace(/\.md$/, '');
      const title = name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
      sidebarContent += `- [${title}](concepts/${name})\n`;
    }
  }

  sidebarContent += `\n#### Entities\n`;
  const entitiesDir = path.join(wikiDir, 'entities');
  if (fs.existsSync(entitiesDir)) {
    const entityFiles = fs.readdirSync(entitiesDir).filter(f => f.endsWith('.md')).slice(0, 15);
    for (const file of entityFiles) {
      const name = file.replace(/\.md$/, '');
      sidebarContent += `- [${name}](entities/${name})\n`;
    }
    if (fs.readdirSync(entitiesDir).length > 15) {
      sidebarContent += `- _And ${fs.readdirSync(entitiesDir).length - 15} more entities..._\n`;
    }
  }

  sidebarContent += `\n#### Research & RFCs\n`;
  const researchDir = path.join(wikiDir, 'research');
  if (fs.existsSync(researchDir)) {
    const researchFiles = fs.readdirSync(researchDir).filter(f => f.endsWith('.md')).slice(0, 12);
    for (const file of researchFiles) {
      const name = file.replace(/\.md$/, '');
      const title = name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
      sidebarContent += `- [${title}](research/${name})\n`;
    }
  }

  fs.writeFileSync(path.join(wikiDir, '_Sidebar.md'), sidebarContent, 'utf8');
}

function generateFooter(wikiDir) {
  const footerContent = `---\n*Automated Knowledge Base Synchronization • Generated at ${new Date().toISOString()}*`;
  fs.writeFileSync(path.join(wikiDir, '_Footer.md'), footerContent, 'utf8');
}

function generateHome(wikiDir) {
  const readmePath = path.join(root, 'README.md');
  let homeContent = '';
  if (fs.existsSync(readmePath)) {
    homeContent = fs.readFileSync(readmePath, 'utf8');
  } else {
    homeContent = `# Knowledge Base Sync (\`kb-sync\`) Wiki\n\nWelcome to the official documentation wiki for **kb-sync**.`;
  }
  fs.writeFileSync(path.join(wikiDir, 'Home.md'), homeContent, 'utf8');
}

async function main() {
  console.log(`=== [KB-SYNC WIKI PUBLISHER] ===`);
  console.log(`Source directory: ${wikiSourceDir}`);
  console.log(`Target publish directory: ${targetWikiDir}`);
  console.log(`Remote Wiki Repository: ${repoUrl}`);

  // 1. Prepare target clone
  if (fs.existsSync(targetWikiDir)) {
    fs.rmSync(targetWikiDir, { recursive: true, force: true });
  }

  console.log(`Cloning remote wiki git repository...`);
  execSync(`git clone "${repoUrl}" "${targetWikiDir}"`, { stdio: 'inherit' });

  // 2. Copy markdown hierarchy
  console.log(`Copying wiki markdown documents into publishing working tree...`);
  const copiedCount = copyRecursive(wikiSourceDir, targetWikiDir);
  console.log(`✓ Transferred ${copiedCount} markdown file(s).`);

  // 3. Generate Home, Sidebar, and Footer
  console.log(`Generating Home.md, _Sidebar.md, and _Footer.md navigation assets...`);
  generateHome(targetWikiDir);
  generateSidebar(targetWikiDir);
  generateFooter(targetWikiDir);
  console.log(`✓ Navigation templates generated.`);

  // 4. Commit and push
  if (shouldPush) {
    console.log(`Staging and checking status in target wiki...`);
    execSync('git add -A', { cwd: targetWikiDir, stdio: 'pipe' });
    const status = execSync('git status --porcelain', { cwd: targetWikiDir, encoding: 'utf8' }).trim();

    if (status) {
      console.log(`Committing wiki updates...`);
      execSync(`git commit -m "${commitMessage}"`, { cwd: targetWikiDir, stdio: 'inherit' });
      console.log(`Pushing to ${repoUrl}...`);
      execSync('git push origin HEAD', { cwd: targetWikiDir, stdio: 'inherit' });
      console.log(`\n🎉 SUCCESS: GitHub Wiki for kb-sync is now fully published and live!`);
    } else {
      console.log(`✓ GitHub Wiki working tree is already up to date with remote.`);
    }
  }

  // Cleanup temp dir
  try {
    fs.rmSync(targetWikiDir, { recursive: true, force: true });
  } catch {}
}

main().catch(err => {
  console.error(`Fatal wiki publish failure: ${err.message}`);
  process.exit(1);
});
