#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { materializeApprovedResult } from '../modules/wiki/materialize-approved-result.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--approved') args.approved = true;
    else if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
      args[key] = value;
    } else throw new Error(`unexpected argument: ${token}`);
  }
  return args;
}

function required(args, name) {
  if (!args[name]) throw new Error(`--${name} is required`);
  return args[name];
}

async function main(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stdout.write('Usage: npm run trm:materialize-approved -- --result <file> --sources <file> --staging-root <dir> --batch-id <id> --approved\\n');
    return;
  }
  const args = parseArgs(argv);
  if (!args.approved) throw new Error('research result must be explicitly approved with --approved');
  const batchId = required(args, 'batch-id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(batchId)) throw new Error('--batch-id contains unsafe characters');

  const result = JSON.parse(fs.readFileSync(path.resolve(required(args, 'result')), 'utf8'));
  const sources = JSON.parse(fs.readFileSync(path.resolve(required(args, 'sources')), 'utf8'));
  const receipt = await materializeApprovedResult(result, {
    stagingRoot: path.resolve(required(args, 'staging-root')),
    batchId,
    approved: true,
    resolveSource: (sourceId) => sources[sourceId] ?? null
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
