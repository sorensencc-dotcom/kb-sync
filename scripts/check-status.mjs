import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function readLogContent(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.toString('utf16le');
    }
    if (buffer.length > 10 && buffer[1] === 0x00 && buffer[3] === 0x00 && buffer[5] === 0x00) {
      return buffer.toString('utf16le');
    }
    return buffer.toString('utf8');
  } catch (err) {
    return null;
  }
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

console.log('\n==================================================');
console.log('            KB-SYNC STATUS DASHBOARD              ');
console.log('==================================================\n');

// 1. Check .sync-status.json
const statusJsonPath = path.join(repoRoot, '.sync-status.json');
if (fs.existsSync(statusJsonPath)) {
  try {
    const statusData = JSON.parse(fs.readFileSync(statusJsonPath, 'utf8'));
    const isSuccess = statusData.status === 'SUCCESS';
    const statusIcon = isSuccess ? '✅ SUCCESS' : '❌ FAILED';
    
    console.log(`[Telemetry Status]`);
    console.log(`  - Overall Status : ${statusIcon}`);
    console.log(`  - Last Sync Time : ${statusData.last_sync_timestamp || 'N/A'}`);
    console.log(`  - Files Ingested : ${statusData.file_count ?? 'N/A'}`);
    console.log(`  - Pack Size      : ${formatBytes(statusData.pack_size_bytes)}`);
    console.log(`  - URLs Tracked   : ${statusData.unique_urls_tracked ?? 'N/A'} unique (${statusData.total_url_references ?? 'N/A'} total refs)`);
    console.log(`  - Stage 1 (Sync) : ${statusData.stage1_success ? 'Pass' : 'Fail'}`);
    console.log(`  - Stage 2 (Report): ${statusData.stage2_success ? 'Pass' : 'Fail'}\n`);
  } catch (err) {
    console.log(`⚠️ Error reading .sync-status.json: ${err.message}\n`);
  }
} else {
  console.log(`⚠️ Telemetry file .sync-status.json not found.\n`);
}

// 2. Check Recent Logs
const logsDir = path.join(repoRoot, 'logs');
console.log(`[Recent Nightly Logs]`);
if (fs.existsSync(logsDir)) {
  const files = fs.readdirSync(logsDir);

  const findLatestLog = (prefix) => {
    const matching = files.filter(f => f.startsWith(prefix) && f.endsWith('.log')).sort().reverse();
    return matching.length > 0 ? path.join(logsDir, matching[0]) : null;
  };

  const nlmLogPath = findLatestLog('KB-Sync-Nightly-NotebookLM-');
  const obsLogPath = findLatestLog('KB-Sync-Nightly-Obsidian-');

  if (nlmLogPath) {
    const fileName = path.basename(nlmLogPath);
    const content = readLogContent(nlmLogPath) || '';
    const isCompleted = content.includes('Completed:') && (content.includes('Exit Code: 0') || content.includes('NotebookLM sync completed successfully'));
    const durationMatch = content.match(/Completed:.*Duration: ([^,\)]+)/);
    const duration = durationMatch ? durationMatch[1] : 'N/A';

    console.log(`  - NotebookLM Pipeline:`);
    console.log(`      File     : ${fileName}`);
    console.log(`      Status   : ${isCompleted ? '✅ Passed' : '❌ Failed or Incomplete'}`);
    console.log(`      Duration : ${duration}`);
  } else {
    console.log(`  - NotebookLM Pipeline: No log files found.`);
  }

  if (obsLogPath) {
    const fileName = path.basename(obsLogPath);
    const content = readLogContent(obsLogPath) || '';
    const isCompleted = content.includes('Completed:') && content.includes('Exit Code: 0');
    const durationMatch = content.match(/Completed:.*Duration: ([^,\)]+)/);
    const duration = durationMatch ? durationMatch[1] : 'N/A';

    console.log(`  - Obsidian Staging Pipeline:`);
    console.log(`      File     : ${fileName}`);
    console.log(`      Status   : ${isCompleted ? '✅ Passed' : '❌ Failed or Incomplete'}`);
    console.log(`      Duration : ${duration}`);
  } else {
    console.log(`  - Obsidian Staging Pipeline: No log files found.`);
  }
} else {
  console.log(`  No logs directory found at: ${logsDir}`);
}

// 3. Check Latest Staging Directory
const stagingRoot = path.resolve(repoRoot, '..', '_kb-sync-staging', 'kb-sync');
console.log(`\n[Obsidian Staging Status]`);
if (fs.existsSync(stagingRoot)) {
  const stagingDirs = fs.readdirSync(stagingRoot).filter(f => {
    return fs.statSync(path.join(stagingRoot, f)).isDirectory();
  }).sort().reverse();

  if (stagingDirs.length > 0) {
    const latestDir = stagingDirs[0];
    const latestPath = path.join(stagingRoot, latestDir);
    const manifestPath = path.join(latestPath, 'FILES.manifest.txt');

    console.log(`  - Latest Staging Dir : ${latestDir}`);
    if (fs.existsSync(manifestPath)) {
      const manifestContent = fs.readFileSync(manifestPath, 'utf8').trim().split('\n');
      console.log(`  - Staged Manifest    : ✅ ${manifestContent.length} files staged`);
    } else {
      console.log(`  - Staged Manifest    : ⚠️ Manifest file not found`);
    }
  } else {
    console.log(`  - No staging subdirectories found.`);
  }
} else {
  console.log(`  - Staging root directory not found.`);
}

console.log('\n==================================================\n');
