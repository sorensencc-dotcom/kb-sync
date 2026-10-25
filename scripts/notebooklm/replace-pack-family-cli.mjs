import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { replacePackFamilyAtomic } from '../nlm-pack-replace-gate.mjs';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const files = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--pack-file') files.push(args[index + 1]);
}

const cli = value('--cli') || 'nlm';
const dialect = value('--dialect') || 'nlm';
const notebookId = value('--notebook-id');
const expectedPartCount = Number(value('--expected-part-count'));
const timeoutMs = Number(value('--timeout-ms')) || 300000;
const waitMs = Number(value('--wait-ms')) || 3500;

if (!notebookId || files.some(file => typeof file !== 'string' || !file)) {
  console.error('Usage requires --notebook-id and at least one --pack-file.');
  process.exit(2);
}

const runCli = commandArgs => {
  const result = spawnSync(cli, commandArgs, {
    encoding: 'utf8',
    shell: true,
    timeout: 120000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'NotebookLM CLI failed');
  }
  return result.stdout;
};

try {
  const result = await replacePackFamilyAtomic({
    cli,
    notebookId,
    packFiles: files,
    expectedPartCount: Number.isFinite(expectedPartCount) && expectedPartCount > 0 ? expectedPartCount : null,
    timeoutMs,
    waitMs,
    runList: id => {
      const output = runCli(dialect === 'nlm'
        ? ['source', 'list', id, '--json']
        : ['source', 'list', '--notebook', id, '--json']);
      const parsed = JSON.parse(output);
      return Array.isArray(parsed) ? parsed : parsed.sources;
    },
    runUpload: (id, file) => {
      const output = runCli(dialect === 'nlm'
        ? ['source', 'add', id, '--file', path.resolve(file), '--json']
        : ['source', 'add', '--notebook', id, path.resolve(file), '--json']);
      return JSON.parse(output);
    },
    logInfo: message => console.error(message),
    logWarn: message => console.error(message),
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}
