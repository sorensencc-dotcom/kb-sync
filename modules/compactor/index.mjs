import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { classifyFile } from './classifier.mjs';
import { skeletonizeFile } from './skeletonizer.mjs';
import { outlineFile } from './outliner.mjs';
import { getGitDirtyFiles, getBulkRecentlyModifiedFiles, getFileContentHash } from './git-inspector.mjs';
import { loadActiveOverrides } from './overrides-manager.mjs';
import { loadCompactionConfig } from './config-loader.mjs';
import { loadNormalizedManifest } from './manifest-loader.mjs';
import { countTokens } from './telemetry.mjs';
import { replaceFileAtomically } from './atomic-file.mjs';
import { runCompactCli } from './cli.mjs';

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await new Promise((resolve, reject) => {
      const onDrain = () => { stream.off('error', onError); resolve(); };
      const onError = (err) => { stream.off('drain', onDrain); reject(err); };
      stream.once('drain', onDrain);
      stream.once('error', onError);
    });
  }
}

export async function buildCompactedPack({ repoRoot, manifestPath, outputPath, configPath, skipPatterns }) {
  const config = loadCompactionConfig(configPath);
  const manifestFiles = loadNormalizedManifest(manifestPath, repoRoot);

  const dirtyFilesSet = getGitDirtyFiles(repoRoot);
  const recentFilesSet = getBulkRecentlyModifiedFiles(repoRoot, config.compaction.git_window_days);
  const overridesResult = loadActiveOverrides(repoRoot);

  const tmpOutputPath = `${outputPath}.tmp.${Date.now()}`;
  const outStream = fs.createWriteStream(tmpOutputPath, { encoding: 'utf8' });

  let totalRawBytes = 0;
  let totalCompactedBytes = 0;
  let totalRawTokens = 0;
  let totalCompactedTokens = 0;

  const stateCounts = { Full: 0, Skeleton: 0, Outline: 0, Excluded: 0 };
  const compactorWarnings = [];

  const headerText = [
    "================================================================================",
    "REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK (COMPACTED CONTEXT ENGINE)",
    `Generated: ${new Date().toISOString()}`,
    "================================================================================\n\n"
  ].join('\n');

  await writeChunk(outStream, headerText);
  const headerBytes = Buffer.byteLength(headerText, 'utf8');
  totalCompactedBytes += headerBytes;
  totalCompactedTokens += countTokens(headerText);

  for (const relativePath of manifestFiles) {
    const classification = classifyFile({
      repoRoot,
      rawPath: relativePath,
      config,
      overridesResult,
      dirtyFilesSet,
      recentFilesSet,
      skipPatterns
    });

    if (classification.state === 'Excluded') {
      stateCounts.Excluded++;
      continue;
    }

    const fullFilePath = path.join(repoRoot, relativePath);
    let rawContent;
    try {
      rawContent = fs.readFileSync(fullFilePath, 'utf8');
    } catch (err) {
      compactorWarnings.push({ file: relativePath, requestedState: classification.state, finalState: 'Excluded', reason: `Read failed: ${err.message}` });
      continue;
    }

    const rawBytes = Buffer.byteLength(rawContent, 'utf8');
    const rawTokens = countTokens(rawContent);
    totalRawBytes += rawBytes;
    totalRawTokens += rawTokens;

    let finalContent = rawContent;
    let finalState = classification.state;
    const contentHash = getFileContentHash(fullFilePath);

    if (classification.state === 'Skeleton') {
      const res = skeletonizeFile(fullFilePath, relativePath, contentHash, classification.reason);
      finalContent = res.content;
      finalState = res.state;
      if (res.warning) {
        compactorWarnings.push({ file: relativePath, requestedState: 'Skeleton', finalState: res.state, reason: res.warning });
      }
    } else if (classification.state === 'Outline') {
      const res = outlineFile(fullFilePath, relativePath, contentHash, classification.reason);
      finalContent = res.content;
      finalState = res.state;
      if (res.warning) {
        compactorWarnings.push({ file: relativePath, requestedState: 'Outline', finalState: res.state, reason: res.warning });
      }
    }

    stateCounts[finalState]++;

    const payloadBlock = `\n--- START FILE: ${relativePath} ---\n${finalContent}\n--- END FILE: ${relativePath} ---\n`;
    const finalBytes = Buffer.byteLength(payloadBlock, 'utf8');
    const finalTokens = countTokens(payloadBlock);

    totalCompactedBytes += finalBytes;
    totalCompactedTokens += finalTokens;

    await writeChunk(outStream, payloadBlock);
  }

  await new Promise((resolve, reject) => {
    outStream.on('error', reject);
    outStream.end(resolve);
  });

  const stats = {
    total_raw_size_bytes: totalRawBytes,
    compacted_size_bytes: totalCompactedBytes,
    total_raw_tokens: totalRawTokens,
    compacted_tokens: totalCompactedTokens,
    byte_reduction_percentage: totalRawBytes > 0 ? parseFloat(((1 - totalCompactedBytes / totalRawBytes) * 100).toFixed(2)) : 0,
    token_reduction_percentage: totalRawTokens > 0 ? parseFloat(((1 - totalCompactedTokens / totalRawTokens) * 100).toFixed(2)) : 0,
    state_counts: stateCounts,
    warnings_count: compactorWarnings.length
  };

  replaceFileAtomically(tmpOutputPath, outputPath);
  updateSyncStatusAtomically(repoRoot, stats, compactorWarnings);
  return stats;
}

function updateSyncStatusAtomically(repoRoot, stats, warnings) {
  const statusFile = path.join(repoRoot, '.sync-status.json');
  const tmpStatusFile = `${statusFile}.tmp.${Date.now()}`;
  let status = {};
  if (fs.existsSync(statusFile)) {
    try { status = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch (_) {}
  }

  status.compaction_stats = stats;
  status.compactor_warnings = warnings;

  fs.writeFileSync(tmpStatusFile, JSON.stringify(status, null, 2), 'utf8');
  replaceFileAtomically(tmpStatusFile, statusFile);
}

// Main CLI Execution Guard
if (process.argv[1] && process.argv[1].endsWith('index.mjs')) {
  const rawArgs = process.argv.slice(2);

  if (rawArgs[0] && !rawArgs[0].startsWith('--')) {
    runCompactCli(rawArgs, process.cwd()).catch(err => {
      console.error(`CLI Error: ${err.message}`);
      process.exit(1);
    });
  } else {
    const { values } = parseArgs({
      args: rawArgs,
      options: {
        'repo-root': { type: 'string' },
        'manifest': { type: 'string' },
        'output': { type: 'string' },
        'config': { type: 'string' },
        'global-config': { type: 'string' }
      }
    });

    buildCompactedPack({
      repoRoot: values['repo-root'] || process.cwd(),
      manifestPath: values['manifest'],
      outputPath: values['output'],
      configPath: values['config'],
      skipPatterns: []
    }).catch(err => {
      console.error(`Batch Pack Build Error: ${err.message}`);
      process.exit(1);
    });
  }
}
