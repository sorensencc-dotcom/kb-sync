#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consolidatePacks, DEFAULT_OUT_DIR, DEFAULT_ROOT_DIR } from './consolidate-pack.mjs';

/**
 * Canonical pack-builder CLI entrypoint forwarding to consolidatePacks().
 * Defaults outDir to <kb-sync>/.nlm_pack where cluster-sync-runner searches.
 */
export function buildPacks(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT_DIR;
  const outDir = options.outDir || DEFAULT_OUT_DIR;
  return consolidatePacks({ rootDir, outDir });
}

const mainFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
const thisFile = fs.realpathSync(fileURLToPath(import.meta.url));
if (mainFile === thisFile) {
  try {
    const outArg = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
    buildPacks(outArg ? { outDir: path.resolve(outArg) } : {});
  } catch (err) {
    console.error(`[BUILD-PACKS] [ERROR] ${err.message}`);
    process.exit(1);
  }
}
