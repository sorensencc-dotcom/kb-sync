import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { verifySigilEnvelope, canonicalizeJson } from '../watch-competitors-v2.mjs';

const COLOR_GREEN = '\x1b[32m';
const COLOR_YELLOW = '\x1b[33m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_RED = '\x1b[31m';
const COLOR_RESET = '\x1b[0m';

/**
 * Loads pending Sigil approval envelopes from JSONL queue.
 * @param {string} queuePath 
 * @returns {Array<object>}
 */
export function loadPendingEnvelopes(queuePath = './sigil-queue.jsonl') {
  const resolved = path.resolve(queuePath);
  if (!fs.existsSync(resolved)) {
    return [];
  }
  const lines = fs.readFileSync(resolved, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Process and resolve approval tasks.
 * @param {object} options
 */
export async function processApprovals(options = {}) {
  const queuePath = options.queuePath || './sigil-queue.jsonl';
  const watchlistsDir = options.watchlistsDir || './trm/watchlists';
  const envelopes = loadPendingEnvelopes(queuePath);

  if (envelopes.length === 0) {
    console.log(`${COLOR_GREEN}[SIGIL APPROVALS]${COLOR_RESET} No pending approval tasks found in ${queuePath}.`);
    return { processed: 0, approved: 0 };
  }

  console.log(`\n================================================================================`);
  console.log(`${COLOR_CYAN}[SIGIL APPROVALS]${COLOR_RESET} Found ${envelopes.length} pending high-assurance envelope(s):`);
  console.log(`================================================================================\n`);

  let approvedCount = 0;
  const remainingEnvelopes = [];

  for (const env of envelopes) {
    console.log(`Envelope ID:      ${COLOR_CYAN}${env.message_id}${COLOR_RESET}`);
    console.log(`Sender Endpoint:  ${env.sender?.endpoint_id} (${env.sender?.owner_id})`);
    console.log(`Task Scope:       ${env.body?.watchlist_id} -> ${env.body?.target_id}`);
    console.log(`Observed Hash:    ${env.body?.observed_hash}`);
    console.log(`Created At:       ${env.created_at}`);
    console.log(`Expires At:       ${env.expires_at}`);

    if (env.body?.diff_summary?.patch_preview) {
      console.log(`\nDiff Preview:`);
      console.log(`${COLOR_YELLOW}${env.body.diff_summary.patch_preview}${COLOR_RESET}\n`);
    }

    const shouldApprove = options.approveAll || (options.approveId === env.message_id);

    if (shouldApprove) {
      console.log(`${COLOR_GREEN}✓ Action: APPROVED.${COLOR_RESET} Promoting observed hash to baseline...`);
      approvedCount++;

      // Promote baseline in watchlist JSON file if available
      const watchlistId = env.body?.watchlist_id?.replace(/^trm:watchlist:/, '');
      if (watchlistId && fs.existsSync(watchlistsDir)) {
        const watchlistFile = path.join(watchlistsDir, `${watchlistId}.json`);
        if (fs.existsSync(watchlistFile)) {
          const config = JSON.parse(fs.readFileSync(watchlistFile, 'utf8'));
          const target = config.targets?.find(t => t.target_id === env.body.target_id);
          if (target) {
            target.hash_baseline = env.body.observed_hash;
            config.memory_alignment.status = 'stable';
            config.last_monitored_at = new Date().toISOString();
            fs.writeFileSync(watchlistFile, JSON.stringify(config, null, 2), 'utf8');
            console.log(`  -> Updated baseline for target '${target.target_id}' in ${watchlistFile}`);
          }
        }
      }
    } else {
      console.log(`${COLOR_YELLOW}○ Status: RETAINED (Pending Step-Up Decision).${COLOR_RESET}\n`);
      remainingEnvelopes.push(env);
    }
  }

  // Rewrite remaining queue
  const resolved = path.resolve(queuePath);
  if (remainingEnvelopes.length > 0) {
    fs.writeFileSync(resolved, remainingEnvelopes.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  } else if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }

  console.log(`\nSummary: ${approvedCount} approved, ${remainingEnvelopes.length} remaining in queue.\n`);
  return { processed: envelopes.length, approved: approvedCount, remaining: remainingEnvelopes.length };
}

// CLI boundary
if (process.argv[1] && process.argv[1].endsWith('process-sigil-approvals.mjs')) {
  const args = process.argv.slice(2);
  const approveAll = args.includes('--approve-all');
  const approveIdArg = args.find(a => a.startsWith('--approve='))?.split('=')[1];
  const queuePath = args.find(a => a.startsWith('--queue='))?.split('=')[1] || './sigil-queue.jsonl';

  processApprovals({ approveAll, approveId: approveIdArg, queuePath }).catch(err => {
    console.error(`${COLOR_RED}Fatal Error:${COLOR_RESET}`, err.message);
    process.exit(1);
  });
}
