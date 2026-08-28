#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { runAdversarialCrossAudit } from '../../modules/healing/adversarial-auditor.js';

export function validatePacket(packet) {
  if (!packet || typeof packet !== 'object') throw new Error('Packet must be an object');
  for (const field of ['packetId', 'specGoal', 'testOutput', 'appliedDiff']) {
    if (typeof packet[field] !== 'string' || packet[field].length === 0) {
      throw new Error(`Packet field ${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(packet.declaredScope) || !Array.isArray(packet.historyLog)) {
    throw new Error('Packet fields declaredScope and historyLog must be arrays');
  }
  return packet;
}

export async function runCrossAudit(packet, provider) {
  validatePacket(packet);
  const verdict = await runAdversarialCrossAudit(packet, provider);
  if (!verdict || typeof verdict.consensus !== 'boolean' ||
      typeof verdict.blockerAnalysis !== 'string' ||
      typeof verdict.targetedFixRecipe !== 'string') {
    throw new Error('Cross-audit returned an invalid verdict');
  }
  return verdict;
}

async function main() {
  const packetPath = process.argv[2];
  if (!packetPath) throw new Error('Usage: npm run cross-audit -- <packet.json>');
  const packet = JSON.parse(await readFile(packetPath, 'utf8'));
  const verdict = await runCrossAudit(packet);
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  if (!verdict.consensus) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((error) => {
    console.error(`cross-audit: ${error.message}`);
    process.exitCode = 1;
  });
}
