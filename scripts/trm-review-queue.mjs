import fs from 'node:fs';
import path from 'node:path';
import { KB_SYNC_ROOT } from './trm-drive-common.mjs';

export function listCandidateEvidence(rfcDir = path.join(KB_SYNC_ROOT, 'wiki', 'research')) {
  if (!fs.existsSync(rfcDir)) return [];
  const files = fs.readdirSync(rfcDir).filter(f => f.startsWith('rfc-') && f.endsWith('.md'));
  const results = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(rfcDir, file), 'utf8');
    const matches = content.matchAll(/<!-- finding_id:\s*([a-f0-9]+)\s*-->[\s\S]*?\*\*Verification Status\*\*:\s*`([^`]+)`/g);
    for (const m of matches) {
      results.push({
        file,
        finding_id: m[1],
        status: m[2]
      });
    }
  }
  return results;
}

export function promoteCandidateEvidence(options = {}) {
  const rfcDir = options.rfcDir || path.join(KB_SYNC_ROOT, 'wiki', 'research');
  const { gapId, findingId } = options;
  if (!gapId || !findingId) throw new Error('Missing gapId or findingId');

  const rfcFile = path.join(rfcDir, `rfc-${gapId.toLowerCase()}.md`);
  if (!fs.existsSync(rfcFile)) throw new Error(`RFC file not found: ${rfcFile}`);

  let content = fs.readFileSync(rfcFile, 'utf8');
  const marker = `<!-- finding_id: ${findingId} -->`;
  if (!content.includes(marker)) throw new Error(`Finding ID ${findingId} not found in RFC`);

  content = content.replace(
    new RegExp(`(<!-- finding_id:\\s*${findingId}\\s*-->[\\s\\S]*?\\*\\*Verification Status\\*\\*:\\s*\`)(inferred)(\`)`),
    `$1verified$3`
  );

  fs.writeFileSync(rfcFile, content, 'utf8');
  return { success: true, gapId, findingId, status: 'verified' };
}

if (process.argv[1] && process.argv[1].endsWith('trm-review-queue.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === 'promote') {
    const gapArg = args.find(a => a.startsWith('--gap='))?.split('=')[1];
    const findingArg = args.find(a => a.startsWith('--finding='))?.split('=')[1];
    const res = promoteCandidateEvidence({ gapId: gapArg, findingId: findingArg });
    console.log(`[trm-review-queue] Promoted finding ${res.findingId} on ${res.gapId} to verified.`);
  } else {
    const items = listCandidateEvidence();
    if (args.includes('--json')) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      console.log(`[trm-review-queue] Found ${items.length} candidate evidence items:`);
      for (const item of items) {
        console.log(` - [${item.status}] ${item.file} -> ${item.finding_id}`);
      }
    }
  }
}
