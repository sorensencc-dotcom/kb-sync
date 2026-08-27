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
const shouldPush = args.includes('--push') || process.env.AUTO_PUSH === 'true' || true;
const commitMessage = value('--commit-msg', 'docs(wiki): flatten and publish all wiki pages, RFCs, and diagram assets');

function copyFlatAndPreserve(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  let copied = 0;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullSrc = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        walk(fullSrc);
      } else if (entry.isFile() && /\.(md|png|svg|jpg|jpeg|gif|html|mermaid)$/i.test(entry.name)) {
        // 1. Copy directly to root of wiki repo for flat GitHub Wiki URL routing
        const flatDest = path.join(destDir, entry.name);
        fs.copyFileSync(fullSrc, flatDest);

        // 2. Also preserve relative subfolder hierarchy
        const relPath = path.relative(srcDir, fullSrc);
        const nestedDest = path.join(destDir, relPath);
        fs.mkdirSync(path.dirname(nestedDest), { recursive: true });
        fs.copyFileSync(fullSrc, nestedDest);

        copied += 1;
      }
    }
  }

  walk(srcDir);
  return copied;
}

function generateSidebar(wikiDir) {
  let sidebarContent = `### Knowledge Base Sync (\`kb-sync\`)
- [[Home]]
- [[Documentation Index|Index]]
- [[Audit Log|Log]]

#### Core Subsystems
- [[TRM Gap Triage & Hybrid Synthesis|rfc-gap-01--cic-daily-research-follow-up]]
- [[Competitor Watchlist & Drift Engine|competitor-watchlist-drift-engine]]
- [[WhichLLM Model Selection Evaluator|whichllm-model-selection-evaluator]]
- [[Local Context Cache|local-context-cache]]
- [[TRM Closed-Loop Research|trm-closed-loop-research]]
- [[Fail-Soft Orchestration|fail-soft-orchestration]]
- [[Deterministic Sync Pipeline|deterministic-sync-pipeline]]

#### Key Research RFCs
`;

  const researchDir = path.join(wikiDir, 'research');
  if (fs.existsSync(researchDir)) {
    const researchFiles = fs.readdirSync(researchDir).filter(f => f.endsWith('.md')).slice(0, 15);
    for (const file of researchFiles) {
      const slug = file.replace(/\.md$/, '');
      const cleanTitle = slug
        .replace(/^rfc-gap-/, 'RFC ')
        .replace(/--/g, ' - ')
        .replace(/-/g, ' ')
        .split(' ')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
      sidebarContent += `- [[${cleanTitle}|${slug}]]\n`;
    }
  }

  sidebarContent += `\n#### Concepts & Architecture\n`;
  const conceptsDir = path.join(wikiDir, 'concepts');
  if (fs.existsSync(conceptsDir)) {
    const conceptFiles = fs.readdirSync(conceptsDir).filter(f => f.endsWith('.md'));
    for (const file of conceptFiles) {
      const slug = file.replace(/\.md$/, '');
      const title = slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
      sidebarContent += `- [[${title}|${slug}]]\n`;
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
    // Replace relative diagram image links with absolute raw wiki CDN paths
    homeContent = homeContent.replace(
      /!\[([^\]]*)\]\(trm-gap-triage-architecture\.png\)/g,
      '![$1](https://raw.githubusercontent.com/wiki/sorensencc-dotcom/kb-sync/trm-gap-triage-architecture.png)'
    );
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

  // 2. Copy root diagram assets if present
  const rootDiagramPng = path.join(root, 'trm-gap-triage-architecture.png');
  if (fs.existsSync(rootDiagramPng)) {
    fs.copyFileSync(rootDiagramPng, path.join(targetWikiDir, 'trm-gap-triage-architecture.png'));
  }

  // 3. Copy markdown hierarchy (both flat and nested)
  console.log(`Copying and flattening wiki documents and assets into publishing working tree...`);
  const copiedCount = copyFlatAndPreserve(wikiSourceDir, targetWikiDir);
  console.log(`✓ Transferred ${copiedCount} file(s).`);

  // 4. Generate Home, Sidebar, and Footer
  console.log(`Generating Home.md, _Sidebar.md, and _Footer.md navigation assets...`);
  generateHome(targetWikiDir);
  generateSidebar(targetWikiDir);
  generateFooter(targetWikiDir);
  console.log(`✓ Navigation templates generated.`);

  // 5. Commit and push
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
}

main().catch((err) => {
  console.error(`❌ [KB-SYNC WIKI PUBLISHER] Failed:`, err);
  process.exit(1);
});
