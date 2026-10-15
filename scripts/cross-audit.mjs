#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  const commonDirectory = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 5000,
  }).trim();
  const auditorPath = path.resolve(commonDirectory, '../../modules/healing/adversarial-auditor.js');
  const { runAdversarialCrossAudit } = await import(pathToFileURL(auditorPath).href);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`cross-audit: ${error.message}`);
    process.exitCode = 1;
  });
}
