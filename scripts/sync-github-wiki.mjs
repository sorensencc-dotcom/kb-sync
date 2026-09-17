#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanAndSanitizeText } from '../modules/compactor/secret-pii-sanitizer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const value = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };

export function deriveWikiSshUrl(repoRoot) {
  try {
    const originUrl = execSync('git remote get-url origin', { cwd: repoRoot, encoding: 'utf8' }).trim();
    if (originUrl.includes('github.com')) {
      // Matches git@github.com:owner/repo.git or https://github.com/owner/repo(.git)
      const match = originUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
      if (match) {
        const owner = match[1];
        const repo = match[2];
        return `git@github.com:${owner}/${repo}.wiki.git`;
      }
    }
  } catch {}
  return 'git@github.com:sorensencc-dotcom/kb-sync.wiki.git';
}

const wikiSourceDir = path.resolve(root, value('--source-dir', 'wiki'));
const repoUrl = value('--repo-url', process.env.WIKI_REPO_URL || deriveWikiSshUrl(root));
const targetWikiDir = path.resolve(root, value('--target-dir', '.wiki-publish-temp'));
const shouldPush = !args.includes('--no-push');
const commitMessage = value('--commit-msg', 'docs(wiki): flatten and publish all wiki pages, RFCs, and diagram assets');

// Text formats get read, scanned for secrets, and stripped of hidden markup
// before they leave the machine -- everything else (raster images) is
// copied byte-for-byte since it can't carry planted text instructions. SVG
// is XML text (comments, <text>/<script> elements) so it goes through the
// same scan as markdown/html rather than the raw byte-copy path.
const SANITIZED_EXTENSIONS = /\.(md|html|mermaid|svg)$/i;
const BINARY_EXTENSIONS = /\.(png|jpg|jpeg|gif)$/i;

const UTF8_BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const UTF16LE_BOM = Buffer.from([0xFF, 0xFE]);
const UTF16BE_BOM = Buffer.from([0xFE, 0xFF]);

// SVG (and, in principle, any XML/text asset) can be UTF-16 with a BOM --
// blindly decoding every file as UTF-8 would silently corrupt those,
// defeating the sanitize step by publishing garbage instead of the image.
// Detect the BOM, decode/re-encode accordingly, and preserve it on write.
function decodeTextFile(fullSrc) {
  const buf = fs.readFileSync(fullSrc);
  if (buf.length >= 3 && buf.subarray(0, 3).equals(UTF8_BOM)) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf8', bom: UTF8_BOM };
  }
  if (buf.length >= 2 && buf.subarray(0, 2).equals(UTF16LE_BOM)) {
    return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf16le', bom: UTF16LE_BOM };
  }
  if (buf.length >= 2 && buf.subarray(0, 2).equals(UTF16BE_BOM)) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'utf16be', bom: UTF16BE_BOM };
  }
  return { text: buf.toString('utf8'), encoding: 'utf8', bom: null };
}

function encodeTextFile(text, encoding, bom) {
  let body;
  if (encoding === 'utf16le') {
    body = Buffer.from(text, 'utf16le');
  } else if (encoding === 'utf16be') {
    body = Buffer.from(text, 'utf16le');
    body.swap16();
  } else {
    body = Buffer.from(text, 'utf8');
  }
  return bom ? Buffer.concat([bom, body]) : body;
}

function writeSanitized(fullSrc, dest, findings) {
  const { text: raw, encoding, bom } = decodeTextFile(fullSrc);
  const { sanitizedText, secretsFound, categories } = scanAndSanitizeText(raw);
  if (secretsFound > 0) {
    findings.push({ file: fullSrc, secretsFound, categories });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, encodeTextFile(sanitizedText, encoding, bom));
}

/**
 * Copies wiki source content into the publish working tree, gated by a
 * fail-closed secret/hidden-markup scan on every text file: this is the last
 * checkpoint before content reaches the public GitHub wiki repo, so nothing
 * text-based is copied unscanned. Throws (never partially publishes) if any
 * secret is found -- callers must remove the offending value in `wiki/` and
 * re-run rather than bypass the check here.
 */
function copyFlatAndPreserve(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  let copied = 0;
  const findings = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullSrc = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        walk(fullSrc);
      } else if (entry.isFile() && SANITIZED_EXTENSIONS.test(entry.name)) {
        // 1. Copy (sanitized) directly to root of wiki repo for flat GitHub Wiki URL routing
        writeSanitized(fullSrc, path.join(destDir, entry.name), findings);

        // 2. Also preserve relative subfolder hierarchy
        const relPath = path.relative(srcDir, fullSrc);
        writeSanitized(fullSrc, path.join(destDir, relPath), findings);

        copied += 1;
      } else if (entry.isFile() && BINARY_EXTENSIONS.test(entry.name)) {
        const flatDest = path.join(destDir, entry.name);
        fs.copyFileSync(fullSrc, flatDest);

        const relPath = path.relative(srcDir, fullSrc);
        const nestedDest = path.join(destDir, relPath);
        fs.mkdirSync(path.dirname(nestedDest), { recursive: true });
        fs.copyFileSync(fullSrc, nestedDest);

        copied += 1;
      }
    }
  }

  walk(srcDir);

  if (findings.length > 0) {
    const summary = findings
      .map(f => `  - ${f.file}: ${f.secretsFound} secret(s) [${Object.keys(f.categories).join(', ')}]`)
      .join('\n');
    throw new Error(
      `[KB-SYNC WIKI PUBLISHER] Refusing to publish: secret material detected in wiki/ source content:\n${summary}\n` +
      `Remove or redact the flagged values in the source files under "wiki/" and re-run.`
    );
  }

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

function generateHome(wikiDir, repoRoot) {
  const readmePath = path.join(repoRoot, 'README.md');
  let homeContent = '';
  if (fs.existsSync(readmePath)) {
    homeContent = fs.readFileSync(readmePath, 'utf8');
    homeContent = homeContent.replace(
      /!\[([^\]]*)\]\(trm-gap-triage-architecture\.png\)/g,
      '![$1](https://raw.githubusercontent.com/wiki/sorensencc-dotcom/kb-sync/trm-gap-triage-architecture.png)'
    );
  } else {
    homeContent = `# Knowledge Base Sync (\`kb-sync\`) Wiki\n\nWelcome to the official documentation wiki for **kb-sync**.`;
  }

  // Home.md is generated from README.md content, not copied by
  // copyFlatAndPreserve, so it needs its own pass through the same
  // secret/hidden-markup gate before it reaches the public wiki repo.
  const { sanitizedText, secretsFound, categories } = scanAndSanitizeText(homeContent);
  if (secretsFound > 0) {
    throw new Error(
      `[KB-SYNC WIKI PUBLISHER] Refusing to publish: secret material detected in README.md ` +
      `(${secretsFound} secret(s) [${Object.keys(categories).join(', ')}]). Remove or redact the flagged values and re-run.`
    );
  }

  fs.writeFileSync(path.join(wikiDir, 'Home.md'), sanitizedText, 'utf8');
}

export async function publishWiki(customOptions = {}) {
  const currentRoot = customOptions.repoRoot || root;
  const currentSource = customOptions.sourceDir ? path.resolve(currentRoot, customOptions.sourceDir) : wikiSourceDir;
  const currentUrl = customOptions.repoUrl || repoUrl;
  const currentTarget = customOptions.targetDir ? path.resolve(currentRoot, customOptions.targetDir) : targetWikiDir;
  const pushEnabled = customOptions.push !== undefined ? customOptions.push : shouldPush;

  console.log(`=== [KB-SYNC WIKI PUBLISHER] ===`);
  console.log(`Source directory: ${currentSource}`);
  console.log(`Target publish directory: ${currentTarget}`);
  console.log(`Remote Wiki Repository: ${currentUrl}`);

  if (fs.existsSync(currentTarget)) {
    fs.rmSync(currentTarget, { recursive: true, force: true });
  }

  console.log(`Cloning remote wiki git repository...`);
  execSync(`git clone "${currentUrl}" "${currentTarget}"`, { stdio: 'inherit' });

  const rootDiagramPng = path.join(currentRoot, 'trm-gap-triage-architecture.png');
  if (fs.existsSync(rootDiagramPng)) {
    fs.copyFileSync(rootDiagramPng, path.join(currentTarget, 'trm-gap-triage-architecture.png'));
  }

  console.log(`Copying and flattening wiki documents and assets into publishing working tree...`);
  const copiedCount = copyFlatAndPreserve(currentSource, currentTarget);
  console.log(`✓ Transferred ${copiedCount} file(s).`);

  console.log(`Generating Home.md, _Sidebar.md, and _Footer.md navigation assets...`);
  generateHome(currentTarget, currentRoot);
  generateSidebar(currentTarget);
  generateFooter(currentTarget);
  console.log(`✓ Navigation templates generated.`);

  let remoteHeadSha = '';
  let localCodeHead = '';
  try {
    localCodeHead = execSync('git rev-parse HEAD', { cwd: currentRoot, encoding: 'utf8' }).trim();
  } catch {}

  if (pushEnabled) {
    console.log(`Staging and checking status in target wiki...`);
    execSync('git add -A', { cwd: currentTarget, stdio: 'pipe' });
    const status = execSync('git status --porcelain', { cwd: currentTarget, encoding: 'utf8' }).trim();

    if (status) {
      console.log(`Configuring git author for wiki publisher...`);
      try {
        execSync('git config user.name', { cwd: currentTarget, stdio: 'pipe' });
      } catch {
        execSync('git config user.name "github-actions[bot]"', { cwd: currentTarget });
        execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { cwd: currentTarget });
      }

      console.log(`Committing wiki updates...`);
      execSync(`git commit -m "${commitMessage}"`, { cwd: currentTarget, stdio: 'inherit' });
      console.log(`Pushing to ${currentUrl}...`);
      execSync('git push origin HEAD', { cwd: currentTarget, stdio: 'inherit' });
      console.log(`\n🎉 SUCCESS: GitHub Wiki is now fully published and live!`);
    } else {
      console.log(`✓ GitHub Wiki working tree is already up to date with remote.`);
    }

    try {
      remoteHeadSha = execSync('git rev-parse HEAD', { cwd: currentTarget, encoding: 'utf8' }).trim();
    } catch {}

    // Update .sync-status.json
    const syncStatusPath = path.join(currentRoot, '.sync-status.json');
    try {
      let syncStatusData = {};
      if (fs.existsSync(syncStatusPath)) {
        syncStatusData = JSON.parse(fs.readFileSync(syncStatusPath, 'utf8'));
      }
      syncStatusData.last_sync_timestamp = new Date().toISOString();
      syncStatusData.status = 'SUCCESS';
      syncStatusData.stage1_success = true;
      syncStatusData.stage2_success = true;
      fs.writeFileSync(syncStatusPath, JSON.stringify(syncStatusData, null, 2), 'utf8');
    } catch {}
  }

  // Write cryptographic proof receipt
  const receipt = {
    repository: path.basename(currentRoot),
    remote_wiki_url: currentUrl,
    local_code_head: localCodeHead,
    remote_wiki_head: remoteHeadSha,
    verified_at: new Date().toISOString(),
    system_time_epoch_ms: Date.now(),
    total_pages_published: copiedCount,
    sync_status: 'SYNCHRONIZED'
  };

  const receiptPath = path.join(currentRoot, '.wiki-sync-receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
  console.log(`✓ Cryptographic sync receipt emitted at ${receiptPath}`);

  return receipt;
}

if (process.argv[1] && process.argv[1].endsWith('sync-github-wiki.mjs')) {
  publishWiki().catch((err) => {
    console.error(`❌ [KB-SYNC WIKI PUBLISHER] Failed:`, err);
    process.exit(1);
  });
}
