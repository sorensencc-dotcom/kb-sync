import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GraphSyncError,
  GraphSyncQueue,
  createFilePreflightAdapter,
  createGitMergeAdapter,
  createJsonFilePersistence,
  parseGraphSnapshot,
} from './queue.mjs';

export const CLI_EXIT_CODES = Object.freeze({ OK: 0, USAGE: 2, BLOCKED: 3, FAILED: 4 });

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    if (equals !== -1) {
      args[arg.slice(2, equals)] = arg.slice(equals + 1);
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[arg.slice(2)] = argv[++index];
    } else {
      args[arg.slice(2)] = true;
    }
  }
  return args;
}

function required(args, name) {
  if (typeof args[name] !== 'string' || args[name].length === 0) throw new GraphSyncError('USAGE', `Missing --${name}`);
  return args[name];
}

function output(ok, command, payload = {}) {
  return { ok, command, ...payload };
}

function queueFor(args, dependencies, cwd) {
  const statePath = path.resolve(cwd, args.state ?? '.graph-sync/queue.json');
  return new GraphSyncQueue({
    persistence: dependencies.persistence ?? createJsonFilePersistence(statePath),
    preflightAdapter: dependencies.preflightAdapter,
    mergeAdapter: dependencies.mergeAdapter,
    clock: dependencies.clock,
    idGenerator: dependencies.idGenerator,
  });
}

export async function runCli(argv, dependencies = {}) {
  const args = parseArgs(argv);
  const command = args._[0] ?? 'status';
  const cwd = dependencies.cwd ?? process.cwd();
  try {
    const queue = queueFor(args, dependencies, cwd);
    if (command === 'enqueue') {
      const snapshotPath = path.resolve(cwd, required(args, 'snapshot'));
      const snapshot = parseGraphSnapshot(fs.readFileSync(snapshotPath, 'utf8'));
      const item = queue.enqueue({ sourceVersion: snapshot.sourceVersion, targetVersion: snapshot.targetVersion, snapshot });
      return { exitCode: CLI_EXIT_CODES.OK, result: output(true, command, { item }) };
    }
    if (command === 'preflight') {
      const id = required(args, 'id');
      const preflightAdapter = dependencies.preflightAdapter ?? createFilePreflightAdapter({ baseDir: path.resolve(cwd, required(args, 'base-dir')) });
      queue.preflightAdapter = preflightAdapter;
      const item = await queue.preflight(id);
      return { exitCode: item.status === 'ready' || item.status === 'merged' ? CLI_EXIT_CODES.OK : CLI_EXIT_CODES.BLOCKED, result: output(item.status === 'ready' || item.status === 'merged', command, { item }) };
    }
    if (command === 'retry') {
      const item = queue.retry(required(args, 'id'));
      return { exitCode: CLI_EXIT_CODES.OK, result: output(true, command, { item }) };
    }
    if (command === 'merge') {
      const id = required(args, 'id');
      const token = required(args, 'token');
      if (args.apply !== true) throw new GraphSyncError('USAGE', 'Merge requires explicit --apply');
      queue.mergeAdapter = dependencies.mergeAdapter ?? createGitMergeAdapter({ cwd: path.resolve(cwd, args.cwd ?? '.') });
      const item = await queue.merge(id, token);
      return { exitCode: CLI_EXIT_CODES.OK, result: output(true, command, { item }) };
    }
    if (command === 'status') {
      const item = args.id ? queue.get(args.id) : null;
      return { exitCode: CLI_EXIT_CODES.OK, result: output(true, command, item ? { item } : { items: queue.list() }) };
    }
    throw new GraphSyncError('USAGE', `Unknown command: ${command}`);
  } catch (error) {
    const code = error.code === 'USAGE' ? CLI_EXIT_CODES.USAGE : error.code === 'TOKEN_MISMATCH' ? CLI_EXIT_CODES.BLOCKED : error.code === 'NOT_READY' ? CLI_EXIT_CODES.BLOCKED : CLI_EXIT_CODES.FAILED;
    return { exitCode: code, result: output(false, command, { error: { code: error.code ?? 'CLI_FAILED', message: error.message } }) };
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { exitCode, result } = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode;
}
