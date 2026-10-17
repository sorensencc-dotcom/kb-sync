#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanAndSanitizeText } from '../modules/compactor/secret-pii-sanitizer.mjs';
import {
  PUBLISH_MANIFEST_NAME,
  applyOwnedRemovals,
  planFlatCopies,
  planOwnedRemovals,
  readOwnershipManifest,
  sha256Buffer,
  toPosix,
  writeJsonAtomic,
} from '../modules/wiki/generated-ownership.mjs';

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
const shouldPush = args.includes('--push') || process.env.AUTO_PUSH === 'true';
const commitMessage = value('--commit-msg', 'docs(wiki): flatten and publish all wiki pages, RFCs, and diagram assets');
const buildOnlyDir = value('--build-only', null);

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
  const out = encodeTextFile(sanitizedText, encoding, bom);
  fs.writeFileSync(dest, out);
  return sha256Buffer(out);
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
  if (!fs.existsSync(srcDir)) return { copied: 0, written: {}, flatCollisions: [] };
  const findings = [];
  const files = []; // { fullSrc, rel (posix), text }

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullSrc = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        walk(fullSrc);
      } else if (entry.isFile() && SANITIZED_EXTENSIONS.test(entry.name)) {
        files.push({ fullSrc, rel: toPosix(path.relative(srcDir, fullSrc)), text: true });
      } else if (entry.isFile() && BINARY_EXTENSIONS.test(entry.name)) {
        files.push({ fullSrc, rel: toPosix(path.relative(srcDir, fullSrc)), text: false });
      }
    }
  }

  walk(srcDir);

  // Every file is written at its nested path. A flat (basename) copy is added only
  // when unambiguous: two files sharing a basename used to silently overwrite each
  // other at the wiki root (last writer won).
  const { flat, collisions } = planFlatCopies(files.map((f) => f.rel));
  const written = {};
  const put = (f, destRel) => {
    const dest = path.join(destDir, destRel);
    if (f.text) {
      written[destRel] = writeSanitized(f.fullSrc, dest, findings);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.fullSrc, dest);
      written[destRel] = sha256Buffer(fs.readFileSync(dest));
    }
  };
  for (const f of files) {
    put(f, f.rel);
    if (f.rel.includes('/') && flat.has(f.rel)) put(f, path.posix.basename(f.rel));
  }

  if (findings.length > 0) {
    const summary = findings
      .map(f => `  - ${f.file}: ${f.secretsFound} secret(s) [${Object.keys(f.categories).join(', ')}]`)
      .join('\n');
    throw new Error(
      `[KB-SYNC WIKI PUBLISHER] Refusing to publish: secret material detected in wiki/ source content:\n${summary}\n` +
      `Remove or redact the flagged values in the source files under "wiki/" and re-run.`
    );
  }

  return { copied: files.length, written, flatCollisions: collisions };
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
  const footerContent = `---\n*Automated Knowledge Base Synchronization*`;
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

/**
 * Remove a scratch directory. Git marks object/pack files read-only (and local clones hard-link them), which makes a
 * plain fs.rmSync fail with EPERM on Windows; clear the read-only bit and retry before giving up.
 */
export function removeDirRobust(dir) {
  const opts = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };
  try {
    fs.rmSync(dir, opts);
    return;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'EBUSY'].includes(error && error.code)) throw error;
  }
  const clear = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    try { fs.chmodSync(p, st.isDirectory() ? 0o777 : 0o666); } catch { /* best effort */ }
    if (st.isDirectory()) for (const name of fs.readdirSync(p)) clear(path.join(p, name));
  };
  clear(dir);
  fs.rmSync(dir, opts);
}

export async function publishWiki(customOptions = {}) {
  const currentRoot = customOptions.repoRoot || root;
  // When a caller supplies its own repoRoot, EVERY default must derive from it. The module-level defaults
  // point at kb-sync's own wiki/ and .wiki-publish-temp and must never be used for another root
  // (the temp dir is deleted and re-cloned on every publish).
  const ownRoot = !!customOptions.repoRoot;
  const currentSource = customOptions.sourceDir
    ? path.resolve(currentRoot, customOptions.sourceDir)
    : (ownRoot ? path.resolve(currentRoot, 'wiki') : wikiSourceDir);
  const currentUrl = customOptions.repoUrl || repoUrl;
  let currentTarget = customOptions.targetDir
    ? path.resolve(currentRoot, customOptions.targetDir)
    : (ownRoot ? path.resolve(currentRoot, '.wiki-publish-temp') : targetWikiDir);
  const repositoryName = customOptions.repoName || path.basename(currentRoot);
  const buildOnlyTarget = customOptions.buildOnly || buildOnlyDir;
  const pushEnabled = buildOnlyTarget ? false : (customOptions.push !== undefined ? customOptions.push : shouldPush);

  console.log(`=== [KB-SYNC WIKI PUBLISHER] ===`);
  console.log(`Source directory: ${currentSource}`);
  console.log(`Target publish directory: ${currentTarget}`);
  console.log(`Remote Wiki Repository: ${currentUrl}`);

  if (buildOnlyTarget) {
    currentTarget = path.resolve(buildOnlyTarget);
    fs.mkdirSync(currentTarget, { recursive: true });
  }

  if (!buildOnlyTarget) {
    if (fs.existsSync(currentTarget)) {
      removeDirRobust(currentTarget);
    }

    console.log(`Cloning remote wiki git repository...`);
    execSync(`git clone "${currentUrl}" "${currentTarget}"`, { stdio: 'inherit' });
  }

  const rootDiagramPng = path.join(currentRoot, 'trm-gap-triage-architecture.png');
  if (fs.existsSync(rootDiagramPng)) {
    fs.copyFileSync(rootDiagramPng, path.join(currentTarget, 'trm-gap-triage-architecture.png'));
  }

  console.log(`Copying and flattening wiki documents and assets into publishing working tree...`);
  const copy = copyFlatAndPreserve(currentSource, currentTarget);
  const copiedCount = copy.copied;
  console.log(`✓ Transferred ${copiedCount} file(s).`);
  if (copy.flatCollisions.length > 0) {
    console.warn(
      `[KB-SYNC WIKI PUBLISHER] ${copy.flatCollisions.length} basename collision(s): flat copies skipped for ambiguous names ` +
      `(nested paths are still published): ${copy.flatCollisions.slice(0, 8).map((c) => c.basename).join(', ')}`
    );
  }

  // Reconcile pages this publisher wrote earlier but no longer produces. Only files recorded in the
  // previous publish manifest AND still byte-identical are removed; unknown or edited files stay.
  const publishManifestPath = path.join(currentTarget, PUBLISH_MANIFEST_NAME);
  const removal = planOwnedRemovals({
    baseDir: currentTarget,
    previous: buildOnlyTarget ? null : readOwnershipManifest(publishManifestPath),
    keep: new Set(Object.keys(copy.written)),
  });
  const staleRemoved = applyOwnedRemovals(currentTarget, removal);
  if (staleRemoved > 0) console.log(`Removed ${staleRemoved} obsolete generated page(s) (ownership manifest).`);
  if (removal.preservedModified.length > 0) {
    console.warn(`[KB-SYNC WIKI PUBLISHER] Kept ${removal.preservedModified.length} previously published page(s) that changed on the remote: ${removal.preservedModified.slice(0, 8).join(', ')}`);
  }
  const manifestFiles = {};
  for (const rel of Object.keys(copy.written).sort()) manifestFiles[rel] = { sha256: copy.written[rel] };
  writeJsonAtomic(publishManifestPath, { version: 1, generator: 'sync-github-wiki', repository: repositoryName, files: manifestFiles });

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

  let pushedChanges = false;
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
      pushedChanges = true;
      console.log(`\nGitHub Wiki push completed (remote head is verified below before a receipt is written).`);
    } else {
      console.log(`✓ GitHub Wiki working tree is already up to date with remote.`);
    }

    try {
      remoteHeadSha = execSync('git rev-parse HEAD', { cwd: currentTarget, encoding: 'utf8' }).trim();
    } catch {}

    // Verify against the remote itself. A receipt must never name a head the remote does not have.
    let remoteSeen = '';
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: currentTarget, encoding: 'utf8' }).trim();
      remoteSeen = (execSync(`git ls-remote origin "refs/heads/${branch}"`, { cwd: currentTarget, encoding: 'utf8' }).trim().split(/\s+/)[0]) || '';
    } catch {}
    if (!remoteHeadSha || remoteSeen !== remoteHeadSha) {
      throw new Error(`[KB-SYNC WIKI PUBLISHER] publication not verified: local wiki head ${remoteHeadSha || '<none>'} != remote head ${remoteSeen || '<none>'}`);
    }

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
    repository: repositoryName,
    remote_wiki_url: currentUrl,
    local_code_head: localCodeHead,
    remote_wiki_head: remoteHeadSha,
    verified_at: new Date().toISOString(),
    system_time_epoch_ms: Date.now(),
    total_pages_published: copiedCount,
    // Honest status: nothing is "SYNCHRONIZED" unless a push happened and the remote head was verified.
    sync_status: pushEnabled ? (pushedChanges ? 'SYNCHRONIZED' : 'UP_TO_DATE') : 'PREPARED_NOT_PUSHED',
    published: pushEnabled,
    flat_name_collisions: copy.flatCollisions.length,
    stale_pages_removed: staleRemoved
  };

  if (pushEnabled) {
    // Only a verified publication replaces the receipt; a prepare-only run must not overwrite the
    // evidence of the last real publication (its staleness is judged by age + revision instead).
    const receiptPath = path.join(currentRoot, '.wiki-sync-receipt.json');
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    console.log(`✓ Sync receipt (verified remote head ${remoteHeadSha}) written to ${receiptPath}`);
  } else {
    console.log(`Publish tree prepared only (push not enabled): status=PREPARED_NOT_PUSHED; no receipt written. Pass --push (or AUTO_PUSH=true) to publish.`);
  }

  return receipt;
}

if (process.argv[1] && process.argv[1].endsWith('sync-github-wiki.mjs')) {
  publishWiki().catch((err) => {
    console.error(`❌ [KB-SYNC WIKI PUBLISHER] Failed:`, err);
    process.exit(1);
  });
}
