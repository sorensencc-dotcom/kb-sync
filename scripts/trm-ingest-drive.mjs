import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { loadDriveConfig, KB_SYNC_ROOT } from './trm-drive-common.mjs';
import { validateFinding } from './validate-drive-findings.mjs';

export function detectReadySignal(entry) {
  if (entry.hasSidecar) return 'sidecar';
  if (entry.frontmatter && (entry.frontmatter.ready === true || entry.frontmatter.completed === true)) return 'frontmatter';
  if (/\.(READY|COMPLETED)\./i.test(entry.filename)) return 'filename';
  if (/\s(READY|COMPLETED)(\.[^.]+)?$/i.test(entry.filename)) return 'gdoc_title';
  return null;
}

export function hashFile(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

export async function batchDebounceFiles(filePaths, debounceMs = 15000) {
  const t0 = new Map();
  for (const fp of filePaths) {
    const c = hashFile(fp);
    if (c !== null) t0.set(fp, c);
  }
  if (t0.size === 0) return [];
  await new Promise(r => setTimeout(r, debounceMs));
  const stable = [];
  for (const [fp, content] of t0.entries()) {
    if (hashFile(fp) === content) stable.push(fp);
  }
  return stable;
}

export function updateRegistryRow(registryPath, gapId) {
  if (!fs.existsSync(registryPath)) return;
  const content = fs.readFileSync(registryPath, 'utf8');
  const lines = content.split('\n');
  const updated = lines.map(line => {
    if (line.includes(`| ${gapId} `) || line.startsWith(`| ${gapId}|`)) {
      if (!line.includes('needs_review')) {
        return line.trimEnd() + ' <!-- needs_review: true -->';
      }
    }
    return line;
  });
  fs.writeFileSync(registryPath, updated.join('\n'), 'utf8');
}

export async function ingestDriveFindings(options = {}) {
  const config = loadDriveConfig();
  const driveRoot = options.driveRoot || config.drive_buffer_root;
  const rfcDir = options.rfcDir || path.join(KB_SYNC_ROOT, 'wiki', 'research');
  const registryPath = options.registryPath || path.join(KB_SYNC_ROOT, 'trm-research-gaps.md');
  const logPath = options.logPath || path.join(KB_SYNC_ROOT, 'wiki', 'Log.md');
  const repoRoot = options.repoRoot || KB_SYNC_ROOT;
  const debounceMs = options.debounceMs ?? (config.ingest_debounce_seconds * 1000);
  const doCommit = options.commit ?? false;

  const completedDir = path.join(driveRoot, '03_grok_completed');
  const gapsOutDir = path.join(driveRoot, '01_actionable_gaps');
  const archiveCompletedDir = path.join(driveRoot, '04_archive', 'completed');
  const archiveGapsDir = path.join(driveRoot, '04_archive', 'gaps');
  const archiveRejectedDir = path.join(driveRoot, '04_archive', 'rejected');
  const locksDir = path.join(driveRoot, '_locks');

  fs.mkdirSync(archiveCompletedDir, { recursive: true });
  fs.mkdirSync(archiveGapsDir, { recursive: true });
  fs.mkdirSync(archiveRejectedDir, { recursive: true });

  if (!fs.existsSync(completedDir)) return { ingestedCount: 0 };

  const allFiles = fs.readdirSync(completedDir).map(f => path.join(completedDir, f));
  const candidateFiles = allFiles.filter(f => !f.endsWith('.ready'));

  const stableFiles = await batchDebounceFiles(candidateFiles, debounceMs);
  let ingestedCount = 0;

  for (const filePath of stableFiles) {
    const filename = path.basename(filePath);
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const sidecarPath = filePath.replace(/\.[^.]+$/, '') + '.ready';
    const hasSidecar = fs.existsSync(sidecarPath);

    const validation = validateFinding(rawContent);
    const readySignal = detectReadySignal({ filename, hasSidecar, frontmatter: validation.frontmatter });

    if (!readySignal) continue;

    if (!validation.valid) {
      const utcSuffix = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(filePath, path.join(archiveRejectedDir, `${filename}.${utcSuffix}`));
      if (hasSidecar) fs.unlinkSync(sidecarPath);
      continue;
    }

    const { gap_id } = validation.frontmatter;
    const rfcFile = path.join(rfcDir, `rfc-${gap_id.toLowerCase()}.md`);
    
    let rfcContent = fs.existsSync(rfcFile) ? fs.readFileSync(rfcFile, 'utf8') : `# RFC: ${gap_id}\n\n`;

    const findingMarker = `<!-- finding_id: ${validation.finding_id} -->`;
    if (rfcContent.includes(findingMarker)) {
      // Idempotent skip: already ingested, just archive
      const utcSuffix = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(filePath, path.join(archiveCompletedDir, `${filename}.${utcSuffix}`));
      if (hasSidecar) fs.unlinkSync(sidecarPath);
      continue;
    }

    const evidenceBlock = `\n## Candidate Evidence: Remote Agent Finding (${new Date().toISOString()})\n${findingMarker}\n- **Agent Origin**: \`${validation.frontmatter.agent_origin || 'unknown'}\`\n- **Verdict**: \`${validation.frontmatter.verdict || 'UNSPECIFIED'}\`\n- **Verification Status**: \`inferred\`\n- **Provenance**: \`remote_agent_finding\` (\`not_primary_evidence: true\`)\n\n### Findings Summary\n${validation.body}\n`;

    fs.writeFileSync(rfcFile, rfcContent + evidenceBlock, 'utf8');
    updateRegistryRow(registryPath, gap_id);

    if (fs.existsSync(logPath)) {
      fs.appendFileSync(logPath, `\n- [${new Date().toISOString()}] Ingested remote finding ${validation.finding_id} for ${gap_id}`);
    }

    // Git commit if requested
    if (doCommit) {
      if (fs.existsSync(path.join(repoRoot, '.git', 'MERGE_HEAD'))) {
        throw new Error('Cannot commit: .git/MERGE_HEAD exists');
      }
      try {
        execSync(`git add -- "${rfcFile}" "${registryPath}" "${logPath}" && git commit --only -- "${rfcFile}" "${registryPath}" "${logPath}" -m "chore(trm): ingest remote candidate evidence for ${gap_id}"`, {
          cwd: repoRoot,
          stdio: 'pipe'
        });
      } catch (err) {
        throw new Error(`Git commit failed: ${err.message}`);
      }
    }

    // Move to archive
    const utcSuffix = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(filePath, path.join(archiveCompletedDir, `${filename}.${utcSuffix}`));
    if (hasSidecar) fs.unlinkSync(sidecarPath);

    // Archive matching gap card in 01
    const outboundCard = path.join(gapsOutDir, `${gap_id}.md`);
    if (fs.existsSync(outboundCard)) {
      fs.renameSync(outboundCard, path.join(archiveGapsDir, `${gap_id}.${utcSuffix}.md`));
      const outReady = path.join(gapsOutDir, `${gap_id}.ready`);
      if (fs.existsSync(outReady)) fs.unlinkSync(outReady);
    }

    // Release lease
    if (fs.existsSync(locksDir)) {
      const locks = fs.readdirSync(locksDir).filter(f => f.startsWith(gap_id));
      for (const l of locks) {
        try { fs.unlinkSync(path.join(locksDir, l)); } catch {}
      }
    }

    ingestedCount++;
  }

  return { ingestedCount };
}

if (process.argv[1] && process.argv[1].endsWith('trm-ingest-drive.mjs')) {
  ingestDriveFindings().then(res => {
    console.log(`[trm-ingest-drive] Ingested ${res.ingestedCount} findings.`);
  }).catch(err => {
    console.error('[trm-ingest-drive] Error:', err);
    process.exit(1);
  });
}
