import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const envPath = path.resolve(REPO_ROOT, ".env");
if (fs.existsSync(envPath)) {
  try {
    const envLines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of envLines) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {}
}

export function validateIsoUtcTimestamp(timestamp: string, maxSkewMs: number = 60000): boolean {
  if (!timestamp || typeof timestamp !== "string") return false;
  const parsed = Date.parse(timestamp);
  if (isNaN(parsed)) return false;
  if (parsed > Date.now() + maxSkewMs) return false;
  return true;
}

export interface DriftReport {
  version?: string;
  repository?: string;
  timestamp: string;
  system_time_epoch_ms?: number;
  status: "NO_DRIFT" | "DRIFT_DETECTED";
  drifted_sources: Array<{
    repo: string;
    file: string;
    last_code_commit: string;
    last_wiki_sync: string;
    status: string;
    wiki_page: string;
  }>;
  summary: {
    total_sources_checked: number;
    stale_pages_count: number;
    untracked_paths_count?: number;
  };
}

interface MappingRule {
  prefix: string;
  folder: string;
}

export interface StagingPathOptions {
  repoRoot?: string;
  vaultRoot?: string;
  stagingDir?: string;
  repoName?: string;
}

export interface SyncMeta {
  schema_version: string;
  run_id: string;
  timestamp: string;
  mode: "INCREMENTAL" | "FULL";
  status: "COMPLETE" | "INCOMPLETE";
  source_root: string;
  repo_name: string;
  previous_snapshot: string | null;
  transfer_method: "HARD_LINK" | "COPY_FALLBACK";
  stats: {
    total_files: number;
    added_files: number;
    modified_files: number;
    deleted_files: number;
    reused_unchanged_files: number;
  };
  deleted_paths: string[];
}

// -----------------------------------------------------------------------------
// 1. SECURITY & PATH SANITIZATION
// -----------------------------------------------------------------------------
export function sanitizeRelativePath(relPath: string, repoRoot: string = REPO_ROOT): string {
  if (!relPath || typeof relPath !== "string") {
    throw new Error("Invalid relative path: path must be a non-empty string");
  }

  const normalized = relPath.replace(/\\/g, "/").trim();
  if (!normalized) {
    throw new Error("Invalid relative path: empty after normalization");
  }

  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith("/")) {
    throw new Error(`Security Violation: Absolute path rejected: ${relPath}`);
  }

  const segments = normalized.split("/");
  if (segments.includes("..") || segments.includes(".")) {
    for (const seg of segments) {
      if (seg === "..") {
        throw new Error(`Security Violation: Path traversal '..' rejected: ${relPath}`);
      }
    }
  }

  const resolved = path.resolve(repoRoot, normalized);
  const resolvedRepoRoot = path.resolve(repoRoot);

  if (!resolved.startsWith(resolvedRepoRoot)) {
    throw new Error(`Security Violation: Path escapes repository root: ${relPath}`);
  }

  return normalized;
}

// -----------------------------------------------------------------------------
// 2. PATH RESOLUTION & SNAPSHOT VALIDATION
// -----------------------------------------------------------------------------
export function resolveStagingPaths(options: StagingPathOptions = {}) {
  let repoRoot = options.repoRoot || REPO_ROOT;
  if (process.platform === "win32" && repoRoot) {
    if (/^\/mnt\/([a-zA-Z])\/(.*)/i.test(repoRoot)) {
      const match = repoRoot.match(/^\/mnt\/([a-zA-Z])\/(.*)/i);
      repoRoot = `${match![1].toUpperCase()}:/${match![2]}`;
    } else if (/^\/([a-zA-Z])\/(.*)/.test(repoRoot)) {
      const match = repoRoot.match(/^\/([a-zA-Z])\/(.*)/);
      repoRoot = `${match![1].toUpperCase()}:/${match![2]}`;
    }
  }

  const repoName = options.repoName || path.basename(repoRoot);
  const stagingDirName = options.stagingDir || ("staging_dir" in options ? (options.stagingDir as string) : "_kb-sync-staging");

  let vaultRoot = options.vaultRoot || process.env.OBSIDIAN_VAULT_ROOT || "";

  if (process.platform === "win32" && vaultRoot) {
    if (/^\/mnt\/([a-zA-Z])\/(.*)/i.test(vaultRoot)) {
      const match = vaultRoot.match(/^\/mnt\/([a-zA-Z])\/(.*)/i);
      vaultRoot = `${match![1].toUpperCase()}:/${match![2]}`;
    } else if (/^\/([a-zA-Z])\/(.*)/.test(vaultRoot)) {
      const match = vaultRoot.match(/^\/([a-zA-Z])\/(.*)/);
      vaultRoot = `${match![1].toUpperCase()}:/${match![2]}`;
    }
  }

  if (!vaultRoot) {
    const configPath = path.join(repoRoot, "configs/obsidian.yaml");
    if (fs.existsSync(configPath)) {
      try {
        const rawConfig = fs.readFileSync(configPath, "utf8");
        const parsed = yaml.load(rawConfig) as any;
        if (parsed && parsed.vault_root) {
          vaultRoot = parsed.vault_root;
        }
      } catch {}
    }
  }

  if (!vaultRoot) {
    vaultRoot = repoRoot;
  }

  if (process.platform === "win32" && vaultRoot) {
    if (/^\/mnt\/([a-zA-Z])\/(.*)/i.test(vaultRoot)) {
      const match = vaultRoot.match(/^\/mnt\/([a-zA-Z])\/(.*)/i);
      vaultRoot = `${match![1].toUpperCase()}:/${match![2]}`;
    } else if (/^\/([a-zA-Z])\/(.*)/.test(vaultRoot)) {
      const match = vaultRoot.match(/^\/([a-zA-Z])\/(.*)/);
      vaultRoot = `${match![1].toUpperCase()}:/${match![2]}`;
    }
  }

  const stagingRoot = path.join(vaultRoot, stagingDirName, repoName);
  return { repoRoot, repoName, vaultRoot, stagingDirName, stagingRoot };
}

export function validateSnapshot(dirPath: string): { valid: boolean; meta?: SyncMeta; reason?: string } {
  if (!fs.existsSync(dirPath)) {
    return { valid: false, reason: "Directory does not exist" };
  }

  const metaPath = path.join(dirPath, "SYNC_META.json");
  const manifestPath = path.join(dirPath, "FILES.manifest.txt");

  if (!fs.existsSync(metaPath)) {
    return { valid: false, reason: "SYNC_META.json missing" };
  }

  if (!fs.existsSync(manifestPath)) {
    return { valid: false, reason: "FILES.manifest.txt missing" };
  }

  try {
    const meta: SyncMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (meta.status !== "COMPLETE") {
      return { valid: false, meta, reason: `Incomplete status: ${meta.status}` };
    }

    const manifestLines = fs
      .readFileSync(manifestPath, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    // Validate ALL manifest entries exist, are safe, and are regular non-symlink files
    for (const relFile of manifestLines) {
      try {
        const safeRel = sanitizeRelativePath(relFile, dirPath);
        const full = path.join(dirPath, safeRel);
        if (!fs.existsSync(full)) {
          return { valid: false, meta, reason: `Manifest file missing in snapshot: ${relFile}` };
        }
        const stat = fs.lstatSync(full);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          return { valid: false, meta, reason: `Manifest entry is not a regular file (symlink/directory rejected): ${relFile}` };
        }
      } catch (err: any) {
        return { valid: false, meta, reason: `Unsafe manifest entry in snapshot (${relFile}): ${err.message}` };
      }
    }

    return { valid: true, meta };
  } catch (err: any) {
    return { valid: false, reason: `Parse error: ${err.message}` };
  }
}

export function getLatestValidStagingDir(options: StagingPathOptions = {}): string | null {
  const { stagingRoot } = resolveStagingPaths(options);
  if (!fs.existsSync(stagingRoot)) return null;

  try {
    const entries = fs
      .readdirSync(stagingRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{8}-\d{6}(-\d{3})?$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();

    for (const folderName of entries) {
      const fullPath = path.join(stagingRoot, folderName);
      const val = validateSnapshot(fullPath);
      if (val.valid) {
        return fullPath;
      }
    }
  } catch {}

  return null;
}

// -----------------------------------------------------------------------------
// 3. CONCURRENCY LOCK MANAGEMENT (Atomic Exclusive Write with Safe Stale Unlink)
// -----------------------------------------------------------------------------
export function acquireLock(stagingRoot: string): string {
  fs.mkdirSync(stagingRoot, { recursive: true });
  const lockFile = path.join(stagingRoot, ".staging.lock");

  const payload = JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
    hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown",
  }, null, 2);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      fs.writeFileSync(fd, payload, "utf8");
      fs.closeSync(fd);
      return lockFile;
    } catch (err: any) {
      if (err.code === "EEXIST") {
        try {
          const rawContent = fs.readFileSync(lockFile, "utf8");
          const lockData = JSON.parse(rawContent);
          const lockTime = new Date(lockData.timestamp).getTime();
          const now = Date.now();
          const isStale = now - lockTime > 10 * 60 * 1000; // 10 minutes

          if (isStale) {
            try {
              const recheckContent = fs.readFileSync(lockFile, "utf8");
              if (recheckContent === rawContent) {
                fs.unlinkSync(lockFile);
              }
            } catch {}
            continue; // Retry acquisition after removing stale lock
          }
          throw new Error(`Concurrency Lock Error: Active staging run in progress (PID ${lockData.pid}, acquired ${lockData.timestamp})`);
        } catch (innerErr: any) {
          if (innerErr.message.includes("Concurrency Lock Error")) throw innerErr;
          continue;
        }
      }
      throw err;
    }
  }

  throw new Error("Concurrency Lock Error: Unable to acquire atomic lock");
}

export function releaseLock(lockFile: string) {
  if (fs.existsSync(lockFile)) {
    try { fs.unlinkSync(lockFile); } catch {}
  }
}

// -----------------------------------------------------------------------------
// 4. SHA256 HASH DIFFING & DELTA COMPUTATION
// -----------------------------------------------------------------------------
function getFileSha256(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

export function computeIncrementalDelta(
  manifestFiles: string[],
  options: StagingPathOptions = {}
) {
  const { repoRoot } = resolveStagingPaths(options);
  const sanitizedManifest = manifestFiles.map((f) => sanitizeRelativePath(f, repoRoot));

  const prevSnapshotDir = getLatestValidStagingDir(options);

  if (!prevSnapshotDir) {
    return {
      isBaseline: true,
      prevSnapshotDir: null,
      addedFiles: sanitizedManifest,
      modifiedFiles: [] as string[],
      deletedFiles: [] as string[],
      unchangedFiles: [] as string[],
    };
  }

  const prevManifestPath = path.join(prevSnapshotDir, "FILES.manifest.txt");
  let prevFiles: string[] = [];
  if (fs.existsSync(prevManifestPath)) {
    prevFiles = fs
      .readFileSync(prevManifestPath, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }

  const currentSet = new Set(sanitizedManifest);
  const prevSet = new Set(prevFiles);

  const addedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const unchangedFiles: string[] = [];
  const deletedFiles: string[] = [];

  for (const relFile of sanitizedManifest) {
    const fullSourcePath = path.join(repoRoot, relFile);
    const fullStagedPath = path.join(prevSnapshotDir, relFile);

    if (!prevSet.has(relFile) || !fs.existsSync(fullStagedPath)) {
      addedFiles.push(relFile);
    } else {
      const sourceHash = getFileSha256(fullSourcePath);
      const stagedHash = getFileSha256(fullStagedPath);

      if (sourceHash && stagedHash && sourceHash === stagedHash) {
        unchangedFiles.push(relFile);
      } else {
        modifiedFiles.push(relFile);
      }
    }
  }

  for (const prevFile of prevFiles) {
    if (!currentSet.has(prevFile)) {
      deletedFiles.push(prevFile);
    }
  }

  return {
    isBaseline: false,
    prevSnapshotDir,
    addedFiles,
    modifiedFiles,
    deletedFiles,
    unchangedFiles,
  };
}

// -----------------------------------------------------------------------------
// 5. ATOMIC MATERIALIZATION ENGINE
// -----------------------------------------------------------------------------
function safeRenameSync(srcDir: string, targetDir: string): string {
  let destDir = targetDir;
  if (fs.existsSync(destDir)) {
    let counter = 1;
    while (fs.existsSync(`${targetDir}-${counter}`)) {
      counter++;
    }
    destDir = `${targetDir}-${counter}`;
  }

  let attempts = 0;
  while (attempts < 5) {
    try {
      fs.renameSync(srcDir, destDir);
      return destDir;
    } catch (err: any) {
      if (err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES" || err.code === "EXDEV") {
        attempts++;
        if (attempts >= 5) {
          fs.cpSync(srcDir, destDir, { recursive: true });
          fs.rmSync(srcDir, { recursive: true, force: true });
          return destDir;
        }
        const end = Date.now() + 50;
        while (Date.now() < end) {}
      } else {
        throw err;
      }
    }
  }
  return destDir;
}

export function materializeIncrementalStaging(options: {
  repoRoot?: string;
  vaultRoot?: string;
  stagingDir?: string;
  repoName?: string;
  manifestFiles: string[];
  forceFull?: boolean;
}) {
  const { repoRoot, vaultRoot, stagingDirName, repoName, stagingRoot } = resolveStagingPaths(options);
  const lockFile = acquireLock(stagingRoot);

  try {
    const forceFull = options.forceFull === true;
    const delta = forceFull
      ? {
          isBaseline: true,
          prevSnapshotDir: null,
          addedFiles: options.manifestFiles.map((f) => sanitizeRelativePath(f, repoRoot)),
          modifiedFiles: [],
          deletedFiles: [],
          unchangedFiles: [],
        }
      : computeIncrementalDelta(options.manifestFiles, options);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    let timestampStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    
    let targetDir = path.join(stagingRoot, timestampStr);
    if (fs.existsSync(targetDir)) {
      timestampStr = `${timestampStr}-${String(now.getMilliseconds()).padStart(3, "0")}`;
      targetDir = path.join(stagingRoot, timestampStr);
    }

    const randSuffix = crypto.randomBytes(4).toString("hex");
    const tmpDir = path.join(stagingRoot, `.tmp-${timestampStr}-${randSuffix}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    let transferMethod: "HARD_LINK" | "COPY_FALLBACK" = "HARD_LINK";

    const copyFile = (relFile: string) => {
      const src = path.join(repoRoot, relFile);
      const dest = path.join(tmpDir, relFile);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    };

    const linkOrCopyUnchangedFile = (relFile: string, prevDir: string) => {
      const src = path.join(prevDir, relFile);
      const dest = path.join(tmpDir, relFile);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.linkSync(src, dest);
      } catch {
        transferMethod = "COPY_FALLBACK";
        fs.copyFileSync(src, dest);
      }
    };

    for (const relFile of delta.addedFiles) copyFile(relFile);
    for (const relFile of delta.modifiedFiles) copyFile(relFile);

    if (delta.unchangedFiles.length > 0 && delta.prevSnapshotDir) {
      for (const relFile of delta.unchangedFiles) {
        linkOrCopyUnchangedFile(relFile, delta.prevSnapshotDir);
      }
    }

    const sanitizedManifest = options.manifestFiles.map((f) => sanitizeRelativePath(f, repoRoot)).sort();
    fs.writeFileSync(path.join(tmpDir, "FILES.manifest.txt"), sanitizedManifest.join("\n") + "\n", "utf8");

    const syncMeta: SyncMeta = {
      schema_version: "1.0.0",
      run_id: crypto.randomUUID(),
      timestamp: timestampStr,
      mode: delta.isBaseline ? "FULL" : "INCREMENTAL",
      status: "COMPLETE",
      source_root: path.relative(vaultRoot, repoRoot).replace(/\\/g, "/") || ".",
      repo_name: repoName,
      previous_snapshot: delta.prevSnapshotDir ? path.basename(delta.prevSnapshotDir) : null,
      transfer_method: transferMethod,
      stats: {
        total_files: sanitizedManifest.length,
        added_files: delta.addedFiles.length,
        modified_files: delta.modifiedFiles.length,
        deleted_files: delta.deletedFiles.length,
        reused_unchanged_files: delta.unchangedFiles.length,
      },
      deleted_paths: delta.deletedFiles,
    };
    fs.writeFileSync(path.join(tmpDir, "SYNC_META.json"), JSON.stringify(syncMeta, null, 2), "utf8");

    const finalDir = safeRenameSync(tmpDir, targetDir);

    return {
      success: true,
      isBaseline: delta.isBaseline,
      publishedStagingDir: finalDir,
      syncMeta,
    };
  } catch (err: any) {
    throw err;
  } finally {
    releaseLock(lockFile);
  }
}

// -----------------------------------------------------------------------------
// 6. ORIGINAL DRIFT DETECTION WORKFLOW (Preserved)
// -----------------------------------------------------------------------------
function parseWikiLogTimestamp(): string | null {
  const { vaultRoot } = resolveStagingPaths();
  const possibleLogPaths = [
    path.join(vaultRoot, "wiki/Log.md"),
    path.join(REPO_ROOT, "wiki/Log.md"),
  ];

  let latestDate: Date | null = null;

  for (const logPath of possibleLogPaths) {
    if (!fs.existsSync(logPath)) continue;

    try {
      const content = fs.readFileSync(logPath, "utf8");
      const matches = content.matchAll(/##\s*\[([^\]]+)\]/g);

      for (const match of matches) {
        let dateStr = match[1].trim();
        if (dateStr.endsWith(" UTC")) {
          dateStr = dateStr.replace(" UTC", "Z").replace(" ", "T");
        } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(dateStr)) {
          dateStr = dateStr.replace(" ", "T") + ":00Z";
        }
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          if (!latestDate || d > latestDate) {
            latestDate = d;
          }
        }
      }
    } catch {}
  }

  if (latestDate) return latestDate.toISOString();
  return null;
}

function getWikiSyncTimestamp(): string {
  const receiptPath = path.join(REPO_ROOT, ".wiki-sync-receipt.json");
  if (fs.existsSync(receiptPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      if (data.verified_at) return data.verified_at;
    } catch {}
  }

  const syncStatusPath = path.join(REPO_ROOT, ".sync-status.json");
  if (fs.existsSync(syncStatusPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(syncStatusPath, "utf8"));
      if (data.last_sync_timestamp) return data.last_sync_timestamp;
    } catch {}
  }

  const logTimestamp = parseWikiLogTimestamp();
  if (logTimestamp) return logTimestamp;

  return new Date(0).toISOString();
}

function buildGitCommitMap(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const output = execSync('git log --format="COMMIT:%aI" --name-only', {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let currentCommitDate = "";
    const lines = output.split("\n");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("COMMIT:")) {
        currentCommitDate = line.substring(7);
      } else if (currentCommitDate) {
        const normalized = line.replace(/\\/g, "/");
        if (!map.has(normalized)) map.set(normalized, currentCommitDate);
      }
    }
  } catch {}
  return map;
}

function getLastCommitDate(relativeFilePath: string, commitMap: Map<string, string>): string {
  const normalized = relativeFilePath.replace(/\\/g, "/");
  if (commitMap.has(normalized)) return commitMap.get(normalized)!;

  const fullPath = path.join(REPO_ROOT, relativeFilePath);
  if (fs.existsSync(fullPath)) return fs.statSync(fullPath).mtime.toISOString();
  return new Date(0).toISOString();
}

function collectFiles(dirOrFile: string): string[] {
  const fullPath = path.join(REPO_ROOT, dirOrFile);
  if (!fs.existsSync(fullPath)) return [];
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) return [dirOrFile.replace(/\\/g, "/")];
  if (stat.isDirectory()) {
    const results: string[] = [];
    const entries = fs.readdirSync(fullPath);
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const subPath = path.join(dirOrFile, entry);
      results.push(...collectFiles(subPath));
    }
    return results;
  }
  return [];
}

function appendToTodos(taskLine: string, signatureKey: string) {
  const possiblePaths = [
    path.resolve(REPO_ROOT, "../TODOS.md"),
    "C:/dev/TODOS.md",
    "c:/dev/TODOS.md",
  ];
  let targetPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      targetPath = p;
      break;
    }
  }
  if (!targetPath) return;

  try {
    const content = fs.readFileSync(targetPath, "utf8");
    if (content.includes(signatureKey)) return;
    if (content.includes("## Open")) {
      const updated = content.replace(/## Open\r?\n/, `## Open\n\n${taskLine}\n`);
      fs.writeFileSync(targetPath, updated, "utf8");
    }
  } catch {}
}

export function runDriftDetection(): DriftReport {
  const repoName = "kb-sync";
  const lastSync = getWikiSyncTimestamp();

  let mappingRules: MappingRule[] = [];
  let defaultFolder = "Unsorted";
  const configPath = path.join(REPO_ROOT, "configs/obsidian.yaml");

  if (fs.existsSync(configPath)) {
    try {
      const rawConfig = fs.readFileSync(configPath, "utf8");
      const parsedConfig = yaml.load(rawConfig) as any;
      if (parsedConfig) {
        if (Array.isArray(parsedConfig.mapping_rules)) mappingRules = parsedConfig.mapping_rules;
        if (parsedConfig.default_folder) defaultFolder = parsedConfig.default_folder;
      }
    } catch {}
  }

  const sourceFilesSet = new Set<string>();

  for (const rule of mappingRules) {
    const files = collectFiles(rule.prefix);
    for (const f of files) sourceFilesSet.add(f);
  }

  if (sourceFilesSet.size === 0) {
    const fallbackDirs = ["core", "modules", "docs"];
    for (const dir of fallbackDirs) {
      const files = collectFiles(dir);
      for (const f of files) sourceFilesSet.add(f);
    }
  }

  const sourceFiles = Array.from(sourceFilesSet);
  const commitMap = buildGitCommitMap();
  const driftedSources: DriftReport["drifted_sources"] = [];
  const lastSyncDate = new Date(lastSync);

  const stagingBase = getLatestValidStagingDir();

  for (const fileRel of sourceFiles) {
    const fullSourcePath = path.join(REPO_ROOT, fileRel);
    const commitDateStr = getLastCommitDate(fileRel, commitMap);
    const commitDate = new Date(commitDateStr);

    let matchedFolder = defaultFolder;
    for (const rule of mappingRules) {
      if (fileRel.startsWith(rule.prefix)) {
        matchedFolder = rule.folder;
        break;
      }
    }

    const wikiPage = path.join(matchedFolder, path.basename(fileRel)).replace(/\\/g, "/");
    let isDrifted = commitDate > lastSyncDate;
    let statusReason = "STALE";

    if (stagingBase) {
      const stagedFilePath = path.join(stagingBase, fileRel);
      const sourceHash = getFileSha256(fullSourcePath);
      const stagedHash = getFileSha256(stagedFilePath);

      if (sourceHash && stagedHash && sourceHash !== stagedHash) {
        isDrifted = true;
        statusReason = "HASH_MISMATCH";
      }
    }

    if (isDrifted) {
      driftedSources.push({
        repo: "kb-sync",
        file: fileRel,
        last_code_commit: commitDateStr,
        last_wiki_sync: lastSync,
        status: statusReason,
        wiki_page: wikiPage,
      });
    }
  }

  let untrackedPathsCount = 0;
  try {
    const gitStatus = execSync("git status --porcelain", { cwd: REPO_ROOT, encoding: "utf8" });
    untrackedPathsCount = gitStatus.split(/\r?\n/).filter((line: string) => line.trim().length > 0).length;
  } catch {}

  const now = new Date();
  const report: DriftReport = {
    version: "1.0.0",
    repository: repoName,
    timestamp: now.toISOString(),
    system_time_epoch_ms: now.getTime(),
    status: driftedSources.length > 0 ? "DRIFT_DETECTED" : "NO_DRIFT",
    drifted_sources: driftedSources,
    summary: {
      total_sources_checked: sourceFiles.length,
      stale_pages_count: driftedSources.length,
      untracked_paths_count: untrackedPathsCount,
    },
  };

  if (report.summary.stale_pages_count > 5) {
    const taskLine = `- [ ] **kb-sync drift remediation** — Knowledge base drift detected (${report.summary.stale_pages_count} stale pages > threshold 5). Run kb-sync ingest.`;
    appendToTodos(taskLine, "kb-sync drift remediation");
  }

  const reportPath = path.join(REPO_ROOT, ".drift-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[KB-SYNC-DRIFT] status=${report.status} sources_checked=${report.summary.total_sources_checked} ` +
      `stale_pages=${report.summary.stale_pages_count} report=${reportPath}`,
  );
  return report;
}

// -----------------------------------------------------------------------------
// 7. CLI HANDLER FOR MATERIALIZATION & FILTERING
// -----------------------------------------------------------------------------
if (process.argv[1] && (process.argv[1].endsWith("detect-drift.ts") || process.argv[1].endsWith("detect-drift.js"))) {
  const args = process.argv.slice(2);
  
  if (args.includes("--materialize-staging")) {
    const manifestIdx = args.indexOf("--manifest");
    const manifestFile = manifestIdx !== -1 ? args[manifestIdx + 1] : null;
    const forceFull = args.includes("--full");

    if (!manifestFile || !fs.existsSync(manifestFile)) {
      console.error("[ERROR] Missing or invalid --manifest file path");
      process.exit(2);
    }

    try {
      const manifestLines = fs
        .readFileSync(manifestFile, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));

      const res = materializeIncrementalStaging({
        manifestFiles: manifestLines,
        forceFull: forceFull,
      });

      console.log(`STAGING_DIR:${res.publishedStagingDir}`);
      console.log(`MODE:${res.syncMeta.mode}`);
      console.log(`REUSED:${res.syncMeta.stats.reused_unchanged_files}`);
      console.log(`ADDED:${res.syncMeta.stats.added_files}`);
      console.log(`MODIFIED:${res.syncMeta.stats.modified_files}`);
      console.log(`DELETED:${res.syncMeta.stats.deleted_files}`);
      process.exit(0);
    } catch (err: any) {
      console.error(`[ERROR] Materialization failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    runDriftDetection();
  }
}
