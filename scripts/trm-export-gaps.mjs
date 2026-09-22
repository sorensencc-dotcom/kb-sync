import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { loadDriveConfig, KB_SYNC_ROOT } from './trm-drive-common.mjs';

const DENY_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // emails
  /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g, // phone numbers (7 or 10+ digits)
  /[a-zA-Z]:\\[^\s\n]+/g, // local Windows paths
  /\/home\/[^\s\n]+/g, // local POSIX paths
  /kroll[^\s\n]*/gi // kroll private logs
];

export function redactContext(raw) {
  if (!raw) return '';
  let cleaned = raw;
  for (const pat of DENY_PATTERNS) {
    cleaned = cleaned.replace(pat, '[REDACTED]');
  }
  return cleaned;
}

export function parseGapsRegistry(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('Gap ID')) continue;
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 4) {
      rows.push({
        gap_id: parts[0],
        topic: parts[1],
        priority: parts[2],
        status: parts[3]
      });
    }
  }
  return rows;
}

export async function exportGapsToDrive(options = {}) {
  const config = loadDriveConfig();
  const driveRoot = options.driveRoot || config.drive_buffer_root;
  const registryPath = options.registryPath || path.join(KB_SYNC_ROOT, 'trm-research-gaps.md');
  const targetPriority = options.priority || 'HIGH';
  const limit = options.limit || 5;

  const gapsDir = path.join(driveRoot, '01_actionable_gaps');
  const contextDir = path.join(driveRoot, '02_reference_context');
  const locksDir = path.join(driveRoot, '_locks');

  fs.mkdirSync(gapsDir, { recursive: true });
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(locksDir, { recursive: true });

  const allGaps = parseGapsRegistry(registryPath);
  const activeGaps = allGaps.filter(g => 
    (g.status === 'active' || g.status === 'reopened') &&
    (!targetPriority || g.priority.toUpperCase() === targetPriority.toUpperCase())
  );

  const exported = [];
  for (const gap of activeGaps) {
    if (exported.length >= limit) break;

    const cardPath = path.join(gapsDir, `${gap.gap_id}.md`);
    const readyPath = path.join(gapsDir, `${gap.gap_id}.ready`);

    // Skip if card already exported or locked
    if (fs.existsSync(cardPath)) continue;
    
    // Check locks
    const lockFiles = fs.readdirSync(locksDir).filter(f => f.startsWith(gap.gap_id));
    if (lockFiles.length > 0) continue;

    const bodyText = `# RESEARCH TASK: Corroborate ${gap.gap_id}\n\n## Objective\nInvestigate topic '${gap.topic}' and resolve open ambiguities.\n\n## Open Question\nWhat primary accession filings or historical records corroborate this topic?`;
    const body_sha256 = crypto.createHash('sha256').update(bodyText, 'utf8').digest('hex');

    const frontmatter = {
      gap_id: gap.gap_id,
      topic: gap.topic,
      urgency: gap.priority,
      created_at: new Date().toISOString(),
      body_sha256
    };

    const cardContent = `---\n${yaml.dump(frontmatter)}---\n\n${bodyText}\n`;
    fs.writeFileSync(cardPath, cardContent, 'utf8');

    // Context pack
    const contextContent = `# Reference Context: ${gap.gap_id}\n\n${redactContext(`Topic reference notes for ${gap.topic}`)}`;
    fs.writeFileSync(path.join(contextDir, `${gap.gap_id}-context-pack.md`), contextContent, 'utf8');

    // Touch sidecar
    fs.writeFileSync(readyPath, 'ready', 'utf8');

    exported.push(gap);
  }

  return exported;
}

if (process.argv[1] && process.argv[1].endsWith('trm-export-gaps.mjs')) {
  exportGapsToDrive().then(res => {
    console.log(`[trm-export-gaps] Exported ${res.length} gap cards to Drive.`);
  }).catch(err => {
    console.error('[trm-export-gaps] Error:', err);
    process.exit(1);
  });
}
