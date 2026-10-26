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

export const BANNED_MODERN_TERMS = /\b(sigil|ed25519|cryptographic|keypair|websocket|heartbeat|notebook instances?|ingestion gaps?|document silos?|relay|mcp server|agent framework)\b/i;

export function validateGapCardForExport(gap) {
  if (!gap || !gap.topic) {
    return { valid: false, reason: 'missing_topic' };
  }

  // 1. Topic and description must not contain modern non-historical contamination
  if (BANNED_MODERN_TERMS.test(gap.topic) || (gap.description && BANNED_MODERN_TERMS.test(gap.description))) {
    return { valid: false, reason: 'topic_contamination' };
  }

  // 2. Body length and sentence completeness checks
  if (gap.description) {
    const desc = gap.description.trim();
    if (desc.length < 25) {
      return { valid: false, reason: 'body_too_short' };
    }
    // Must end with terminal punctuation (. ! ?)
    if (!/[.!?]["']?$/.test(desc)) {
      return { valid: false, reason: 'incomplete_sentence_truncation' };
    }
    // Check for obvious mid-sentence cut-off words
    if (/\b(and|or|the|a|an|with|by|at|in|to|for|of|trav)\s*$/i.test(desc)) {
      return { valid: false, reason: 'trailing_conjunction_or_preposition' };
    }
  }

  return { valid: true };
}

export function evaluateCardIntegrity(cardContent) {
  if (!cardContent || typeof cardContent !== 'string') {
    return { valid: false, verdict: 'GARBAGE_GAP', reason: 'empty_or_unreadable' };
  }

  // Check topic contamination
  if (BANNED_MODERN_TERMS.test(cardContent)) {
    return { valid: false, verdict: 'INVALID_CARD', reason: 'modern_non_historical_contamination' };
  }

  // Check frontmatter
  const fmMatch = cardContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const body = fmMatch ? fmMatch[2].trim() : cardContent.trim();

  // Check truncation indicators in Specific Research Targets or body
  const targetMatch = body.match(/## Specific Research Targets\s*\n([\s\S]*?)(?:\n##|$)/);
  const targetText = targetMatch ? targetMatch[1].trim() : '';

  if (targetText) {
    if (!/[.!?]["']?$/.test(targetText) || /\b(and|or|the|a|an|with|by|at|in|to|for|of|trav)\s*$/i.test(targetText)) {
      return { valid: false, verdict: 'GARBAGE_GAP', reason: 'truncated_research_target' };
    }
  }

  if (body.length < 50) {
    return { valid: false, verdict: 'GARBAGE_GAP', reason: 'body_too_short' };
  }

  return { valid: true, verdict: 'VALID' };
}

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
    const trimmed = line.trim();
    // Handle Markdown table format
    if (trimmed.startsWith('|') && !trimmed.includes('---') && !trimmed.includes('Gap ID')) {
      const parts = trimmed.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 4) {
        rows.push({
          gap_id: parts[0],
          topic: parts[1],
          priority: parts[2],
          status: parts[3]
        });
      }
      continue;
    }
    // Handle Markdown list format: - [/] [GAP-01] **Topic**: Details (Drafted: [RFC](path))
    const listMatch = trimmed.match(/^-\s*\[([ x/.-]*)\]\s*\[(GAP-[0-9]{2,3}(?:-[A-Z0-9]+)?)\]\s*\*\*([^*]+)\*\*:\s*(.*)$/i);
    if (listMatch) {
      const statusMark = listMatch[1].trim().toLowerCase();
      const status = (statusMark === 'x') ? 'resolved' : 'active';
      let rawTopic = listMatch[3].trim().replace(/:\s*$/, '').replace(/\(\s*([^)]*?)\s*:\s*\)/g, '($1)').trim();
      let rawDetails = listMatch[4].trim();
      
      let rfcPath = null;
      const rfcMatch = rawDetails.match(/\(Drafted:\s*\[RFC\]\(([^)]+)\)\)/i);
      if (rfcMatch) {
        rfcPath = rfcMatch[1];
        rawDetails = rawDetails.replace(rfcMatch[0], '').trim();
      }

      rows.push({
        gap_id: listMatch[2],
        topic: rawTopic,
        description: rawDetails,
        rfc_path: rfcPath,
        priority: 'HIGH',
        status
      });
      continue;
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
  const completedDir = path.join(driveRoot, '03_grok_completed');
  const locksDir = path.join(driveRoot, '_locks');

  fs.mkdirSync(gapsDir, { recursive: true });
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(completedDir, { recursive: true });
  fs.mkdirSync(locksDir, { recursive: true });

  // Pre-research gate: sweep existing cards in 01_actionable_gaps to quarantine corrupted/contaminated inputs
  if (fs.existsSync(gapsDir)) {
    const existingCards = fs.readdirSync(gapsDir).filter(f => f.endsWith('.md'));
    for (const cardFile of existingCards) {
      const cardPath = path.join(gapsDir, cardFile);
      try {
        const content = fs.readFileSync(cardPath, 'utf8');
        const integrity = evaluateCardIntegrity(content);
        if (!integrity.valid) {
          const gapIdMatch = cardFile.match(/^(GAP-[0-9]{2,3}(?:-[A-Z0-9]+)?)/i);
          const gapId = gapIdMatch ? gapIdMatch[1] : path.basename(cardFile, '.md');
          const findingsPath = path.join(completedDir, `${gapId}-findings.md`);
          const findingsContent = [
            '---',
            `gap_id: ${gapId}`,
            'agent_origin: grok',
            'agent_version: pre-research-gate',
            'source_type: validation',
            `verdict: ${integrity.verdict}`,
            'verification_status: inferred',
            'provenance_type: remote_agent_finding',
            'not_primary_evidence: true',
            'ready: true',
            `rejection_reason: "${integrity.reason}"`,
            '---',
            '',
            `# RESEARCH TERMINATED: ${integrity.verdict}`,
            '',
            `Card ${gapId} was rejected by the pre-research gate: ${integrity.reason}.`,
            'Deep research skipped to prevent burning compute on corrupted or non-historical input.',
            ''
          ].join('\n');

          fs.writeFileSync(findingsPath, findingsContent, 'utf8');
          fs.unlinkSync(cardPath);
          console.warn(`[pre-research-gate] Quarantined ${cardFile} (${integrity.reason}) -> Emitted ${integrity.verdict} findings.`);
        }
      } catch (err) {
        console.error(`[pre-research-gate] Error evaluating card ${cardFile}:`, err);
      }
    }
  }

  const allGaps = parseGapsRegistry(registryPath);
  const activeGaps = allGaps.filter(g => 
    (g.status === 'active' || g.status === 'reopened') &&
    (!targetPriority || g.priority.toUpperCase() === targetPriority.toUpperCase()) &&
    validateGapCardForExport(g).valid
  );

  const exported = [];
  for (const gap of activeGaps) {
    if (exported.length >= limit) break;

    const cardPath = path.join(gapsDir, `${gap.gap_id}.md`);
    // Skip if card already exported or locked
    if (fs.existsSync(cardPath)) continue;
    
    // Check locks
    const lockFiles = fs.readdirSync(locksDir).filter(f => f.startsWith(gap.gap_id));
    if (lockFiles.length > 0) continue;

    const description = gap.description ? `\n\n## Specific Research Targets\n${gap.description}` : '';
    const bodyText = `# RESEARCH TASK: Corroborate ${gap.gap_id}\n\n## Topic\n${gap.topic}${description}\n\n## Open Questions & Targets\n- What primary accession filings, corporate archives, or court dockets corroborate ${gap.gap_id}?\n- What specific contradictions exist between primary witness accounts and secondary publications regarding this record?`;
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

    // Context pack: embed actual RFC draft content if available
    let rawContext = '';
    if (gap.rfc_path) {
      const resolvedRfc = path.resolve(KB_SYNC_ROOT, gap.rfc_path);
      if (fs.existsSync(resolvedRfc)) {
        rawContext = fs.readFileSync(resolvedRfc, 'utf8');
      }
    }

    const contextFilePath = path.join(contextDir, `${gap.gap_id}-context-pack.md`);
    if (rawContext && rawContext.trim().length >= 80) {
      const contextContent = `# Reference Context: ${gap.gap_id}\n\n${redactContext(rawContext)}`;
      fs.writeFileSync(contextFilePath, contextContent, 'utf8');
    } else if (gap.source_pointers) {
      const contextContent = `# Reference Context: ${gap.gap_id}\n\n## Source Pointers\n${gap.source_pointers}`;
      fs.writeFileSync(contextFilePath, contextContent, 'utf8');
    } else if (options.allowFallbackContext) {
      rawContext = `# Context: ${gap.gap_id}\n\n**Topic:** ${gap.topic}\n\n**Details:** ${gap.description || 'No additional context provided.'}`;
      const contextContent = `# Reference Context: ${gap.gap_id}\n\n${redactContext(rawContext)}`;
      fs.writeFileSync(contextFilePath, contextContent, 'utf8');
    } else {
      // Stop auto-generating packs that merely restate a truncated card
      if (fs.existsSync(contextFilePath)) {
        fs.unlinkSync(contextFilePath);
      }
    }

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
