#!/usr/bin/env node

import { runCli } from '../modules/graph-sync/cli.mjs';

const { exitCode, result } = await runCli(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = exitCode;
