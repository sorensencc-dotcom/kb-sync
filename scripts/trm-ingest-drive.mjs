import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { loadDriveConfig, KB_SYNC_ROOT } from './trm-drive-common.mjs';
import { validateFinding, validateMobileInboxDrop } from './validate-drive-findings.mjs';

export function detectReadySignal(entry) {
  if (entry.hasSidecar) return 'sidecar';
  if (entry.frontmatter && (entry.frontmatter.ready === true || entry.frontmatter.completed === true)) return 'frontmatter';
  if (/\.(READY|COMPLETED)\./i.test(entry.filename)) return 'filename';
  if (/\s(READY|COMPLETED)(\.[^.]+)?$/i.test(entry.filename)) return 'gdoc_title';
  return null;
}

export function resolveTopicTargetDir({ topic, date, KB_SYNC_ROOT, conversationsDir, customTargets = {} }) {
  const normalizedTopic = (topic || '').toLowerCase().trim();
  if (customTargets[normalizedTopic]) return customTargets[normalizedTopic];

  switch (normalizedTopic) {
    case 'cic':
      return path.join(conversationsDir || path.join(KB_SYNC_ROOT, 'obsidian', 'vault', 'wiki', 'conversations'), date);
    case 'spec':
    case 'specs':
      return path.join(KB_SYNC_ROOT, 'wiki', 'specs', date);
    case 'rewrite':
      return path.join(KB_SYNC_ROOT, 'wiki', 'rewrite', date);
    case 'trm':
      return path.join(KB_SYNC_ROOT, 'wiki', 'research', date);
    case 'kb':
      return path.join(KB_SYNC_ROOT, 'wiki', 'concepts', date);
    default:
      return path.join(KB_SYNC_ROOT, 'wiki', 'inbox', date);
  }
}

export function hashFile(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    // For virtual cloud files or unreadable stubs, return mtime string as stable surrogate
    try {
      const stat = fs.statSync(filePath);
      return `stat-${stat.mtimeMs}-${stat.size}`;
    } catch {
      return null;
    }
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

export async function resolveGoogleDocId(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        if (parsed.doc_id) return parsed.doc_id;
        if (parsed.id) return parsed.id;
      } catch {}
    }
  } catch {}

  // Fallback: Query local Google DriveFS SQLite metadata database
  const baseName = path.basename(filePath).replace(/\.gdoc$/i, '').replace(/\s+READY$/i, '').trim();
  const driveFsBase = path.join(process.env.LOCALAPPDATA || '', 'Google', 'DriveFS');
  if (fs.existsSync(driveFsBase)) {
    try {
      const entries = fs.readdirSync(driveFsBase);
      for (const entry of entries) {
        const dbPath = path.join(driveFsBase, entry, 'mirror_metadata_sqlite.db');
        if (fs.existsSync(dbPath)) {
          try {
            const Database = (await import('better-sqlite3')).default;
            const db = new Database(dbPath, { readonly: true });
            const row = db.prepare("SELECT id FROM items WHERE local_title LIKE ? AND mime_type = 'application/vnd.google-apps.document' LIMIT 1").get(`%${baseName}%`);
            db.close();
            if (row && row.id) return row.id;
          } catch {}
        }
      }
    } catch {}
  }

  return null;
}

export async function fetchGoogleDocContent(docId, options = {}) {
  if (options.docFetcher) {
    const res = await options.docFetcher(docId);
    if (res && res.ok) return res.content;
    return null;
  }

  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  try {
    const headers = {};
    if (options.authBearer) {
      headers['Authorization'] = `Bearer ${options.authBearer}`;
    } else if (process.env.GOOGLE_OAUTH_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GOOGLE_OAUTH_TOKEN}`;
    }
    const resp = await fetch(exportUrl, { headers });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (text.trim().startsWith('<!DOCTYPE html>') || text.includes('<html')) {
      return null;
    }
    return text;
  } catch {
    return null;
  }
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
  const conversationsDir = options.conversationsDir || path.join(KB_SYNC_ROOT, 'obsidian', 'vault', 'wiki', 'conversations');
  const registryPath = options.registryPath || path.join(KB_SYNC_ROOT, 'trm-research-gaps.md');
  const logPath = options.logPath || path.join(KB_SYNC_ROOT, 'wiki', 'Log.md');
  const repoRoot = options.repoRoot || KB_SYNC_ROOT;
  const debounceMs = options.debounceMs ?? (config.ingest_debounce_seconds * 1000);
  const doCommit = options.commit ?? false;

  const completedDir = options.completedDir || path.join(driveRoot, '03_grok_completed');
  const mobileInboxDir = options.mobileInboxDir || path.join(driveRoot, 'mobile-inbox');
  const gapsOutDir = path.join(driveRoot, '01_actionable_gaps');
  const archiveCompletedDir = options.archiveCompletedDir || path.join(driveRoot, '04_archive', 'completed');
  const archiveMobileInboxDir = options.archiveMobileInboxDir || path.join(driveRoot, '04_archive', 'mobile-inbox');
  const archiveGapsDir = path.join(driveRoot, '04_archive', 'gaps');
  const archiveRejectedDir = options.archiveRejectedDir || path.join(driveRoot, '04_archive', 'rejected');
  const locksDir = options.locksDir || path.join(driveRoot, '_locks');

  fs.mkdirSync(archiveCompletedDir, { recursive: true });
  fs.mkdirSync(archiveMobileInboxDir, { recursive: true });
  fs.mkdirSync(archiveGapsDir, { recursive: true });
  fs.mkdirSync(archiveRejectedDir, { recursive: true });
  fs.mkdirSync(locksDir, { recursive: true });

  let ingestedCount = 0;
  let mobileIngestedCount = 0;
  const touchedFiles = [];

  // ==========================================
  // 1. Ingest Scheduled GAP RFC Findings
  // ==========================================
  if (fs.existsSync(completedDir)) {
    const allFiles = fs.readdirSync(completedDir).map(f => path.join(completedDir, f)).filter(f => fs.statSync(f).isFile());
    const candidateFiles = allFiles.filter(f => !f.endsWith('.ready'));

    const stableFiles = await batchDebounceFiles(candidateFiles, debounceMs);

    for (const filePath of stableFiles) {
      const filename = path.basename(filePath);
      let rawContent = '';
      const isGDoc = filePath.endsWith('.gdoc');

      if (isGDoc) {
        const docId = await resolveGoogleDocId(filePath);
        if (docId) {
          const docContent = await fetchGoogleDocContent(docId, options);
          if (docContent) {
            rawContent = docContent;
          }
        }
        if (!rawContent) {
          try { rawContent = fs.readFileSync(filePath, 'utf8'); } catch {}
        }
      } else {
        try {
          rawContent = fs.readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }
      }

      const sidecarPath = filePath.replace(/\.[^.]+$/, '') + '.ready';
      const hasSidecar = fs.existsSync(sidecarPath);

      let validation = validateFinding(rawContent);
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
      touchedFiles.push(rfcFile, registryPath);

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
  }

  // ==========================================
  // 2. Ingest Unscheduled Mobile & Copilot Inbox Drops
  // ==========================================
  const defaultOneDriveInbox = path.join(process.env.USERPROFILE || 'C:/Users/soren', 'OneDrive', 'Copilot', 'inbox');
  const defaultOneDriveArchive = path.join(process.env.USERPROFILE || 'C:/Users/soren', 'OneDrive', 'Copilot', 'archive');
  const defaultCoworkInbox = path.join(process.env.USERPROFILE || 'C:/Users/soren', 'OneDrive', 'Documents', 'Cowork', 'inbox');
  const defaultCoworkArchive = path.join(process.env.USERPROFILE || 'C:/Users/soren', 'OneDrive', 'Documents', 'Cowork', 'archive');
  const oneDriveInboxDir = options.oneDriveInboxDir || config.onedrive_inbox_root || defaultOneDriveInbox;
  const oneDriveArchiveDir = options.oneDriveArchiveDir || config.onedrive_archive_root || defaultOneDriveArchive;
  const coworkInboxDir = options.coworkInboxDir || config.cowork_inbox_root || defaultCoworkInbox;
  const coworkArchiveDir = options.coworkArchiveDir || config.cowork_archive_root || defaultCoworkArchive;

  const inboxSources = options.inboxSources || (
    options.mobileInboxDir && !options.includeAllInboxes
      ? [{ inboxDir: mobileInboxDir, archiveDir: archiveMobileInboxDir, name: 'gdrive-mobile-inbox' }]
      : [
          { inboxDir: mobileInboxDir, archiveDir: archiveMobileInboxDir, name: 'gdrive-mobile-inbox' },
          { inboxDir: coworkInboxDir, archiveDir: coworkArchiveDir, name: 'cowork-inbox' },
          { inboxDir: oneDriveInboxDir, archiveDir: oneDriveArchiveDir, name: 'onedrive-copilot-inbox' }
        ]
  );

  for (const source of inboxSources) {
    if (!fs.existsSync(source.inboxDir)) continue;
    fs.mkdirSync(source.archiveDir, { recursive: true });

    const allMobileFiles = fs.readdirSync(source.inboxDir).map(f => path.join(source.inboxDir, f)).filter(f => fs.statSync(f).isFile());
    const candidateMobileFiles = allMobileFiles.filter(f => !f.endsWith('.ready'));

    const stableMobileFiles = await batchDebounceFiles(candidateMobileFiles, debounceMs);

    for (const filePath of stableMobileFiles) {
      if (!fs.existsSync(filePath)) continue;
      const filename = path.basename(filePath);
      let rawContent = '';
      try {
        rawContent = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }

      const validation = validateMobileInboxDrop(rawContent, filename);
      const utcSuffix = new Date().toISOString().replace(/[:.]/g, '-');

      if (!validation.valid) {
        if (fs.existsSync(filePath)) {
          try { fs.renameSync(filePath, path.join(archiveRejectedDir, `${filename}.${utcSuffix}`)); } catch {}
        }
        continue;
      }

      const { date, slug, frontmatter, body, content_sha256 } = validation;
      const targetTopic = frontmatter.topic || 'default';
      const targetDir = resolveTopicTargetDir({
        topic: targetTopic,
        date,
        KB_SYNC_ROOT,
        conversationsDir,
        customTargets: options.topicTargets || {}
      });
      fs.mkdirSync(targetDir, { recursive: true });

      let targetFile = path.join(targetDir, `${slug}.md`);

      // Idempotency and conflict handling
      if (fs.existsSync(targetFile)) {
        const existingContent = fs.readFileSync(targetFile, 'utf8');
        if (existingContent.includes(content_sha256)) {
          // Idempotent skip: identical content already in place
          if (fs.existsSync(filePath)) {
            try { fs.renameSync(filePath, path.join(source.archiveDir, `${filename}.${utcSuffix}`)); } catch {}
          }
          mobileIngestedCount++;
          continue;
        }
        // Conflict with different content: use collision suffix
        const timeSuffix = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19);
        targetFile = path.join(targetDir, `${slug}.${timeSuffix}.md`);
      }

      const docContent = `---\nsource: ${frontmatter.source || 'grok'}\nskill: ${frontmatter.skill || 'drive-it'}\ntopic: ${frontmatter.topic || 'general'}\ntitle: "${(frontmatter.title || slug).replace(/"/g, '\\"')}"\ncreated: ${frontmatter.created || new Date().toISOString()}\nfolder_id: ${frontmatter.folder_id || ''}\nstatus: drop\nprovenance_type: mobile_inbox_drop\ncontent_sha256: ${content_sha256}\n---\n\n${body}\n`;

      fs.writeFileSync(targetFile, docContent, 'utf8');
      touchedFiles.push(targetFile);

      if (fs.existsSync(logPath)) {
        fs.appendFileSync(logPath, `\n- [${new Date().toISOString()}] Ingested mobile drop ${filename} (${source.name}) into ${targetTopic}/${date}/${path.basename(targetFile)}`);
      }

      // Archive source drop
      if (fs.existsSync(filePath)) {
        try { fs.renameSync(filePath, path.join(source.archiveDir, `${filename}.${utcSuffix}`)); } catch {}
      }

      mobileIngestedCount++;
    }
  }

  // Git commit if requested
  if (doCommit && touchedFiles.length > 0) {
    if (fs.existsSync(path.join(repoRoot, '.git', 'MERGE_HEAD'))) {
      throw new Error('Cannot commit: .git/MERGE_HEAD exists');
    }
    try {
      const uniqueTouched = Array.from(new Set(touchedFiles));
      if (fs.existsSync(logPath)) uniqueTouched.push(logPath);
      const stageArgs = uniqueTouched.map(f => `"${f}"`).join(' ');
      execSync(`git add -- ${stageArgs} && git commit --only -- ${stageArgs} -m "chore(trm): ingest drive findings and mobile drops"`, {
        cwd: repoRoot,
        stdio: 'pipe'
      });
    } catch (err) {
      throw new Error(`Git commit failed: ${err.message}`);
    }
  }

  return {
    ingestedCount,
    mobileIngestedCount,
    total: ingestedCount + mobileIngestedCount
  };
}

if (process.argv[1] && process.argv[1].endsWith('trm-ingest-drive.mjs')) {
  ingestDriveFindings().then(res => {
    const summary = res.mobileIngestedCount > 0 
      ? `Ingested ${res.ingestedCount} GAP findings and ${res.mobileIngestedCount} mobile inbox drops (${res.total} total).`
      : `Ingested ${res.ingestedCount} findings.`;
    console.log(`[trm-ingest-drive] ${summary}`);
  }).catch(err => {
    console.error('[trm-ingest-drive] Error:', err);
    process.exit(1);
  });
}

