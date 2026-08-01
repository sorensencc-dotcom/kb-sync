import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

export interface DriftReport {
  timestamp: string;
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
  };
}

interface MappingRule {
  prefix: string;
  folder: string;
}

function parseWikiLogTimestamp(): string | null {
  const logPath = path.join(REPO_ROOT, "wiki/Log.md");
  if (!fs.existsSync(logPath)) return null;

  try {
    const content = fs.readFileSync(logPath, "utf8");
    const matches = content.matchAll(/##\s*\[([^\]]+)\]/g);
    let latestDate: Date | null = null;

    for (const match of matches) {
      let dateStr = match[1].trim();
      if (dateStr.endsWith(" UTC")) {
        dateStr = dateStr.replace(" UTC", "Z").replace(" ", "T");
      }
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        if (!latestDate || d > latestDate) {
          latestDate = d;
        }
      }
    }

    if (latestDate) {
      return latestDate.toISOString();
    }
  } catch {}

  return null;
}

function getWikiSyncTimestamp(): string {
  const logTimestamp = parseWikiLogTimestamp();
  if (logTimestamp) {
    return logTimestamp;
  }

  const syncStatusPath = path.join(REPO_ROOT, ".sync-status.json");
  if (fs.existsSync(syncStatusPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(syncStatusPath, "utf8"));
      if (data.last_sync_timestamp) {
        return data.last_sync_timestamp;
      }
    } catch {}
  }
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
        if (!map.has(normalized)) {
          map.set(normalized, currentCommitDate);
        }
      }
    }
  } catch {}
  return map;
}

function getLastCommitDate(relativeFilePath: string, commitMap: Map<string, string>): string {
  const normalized = relativeFilePath.replace(/\\/g, "/");
  if (commitMap.has(normalized)) {
    return commitMap.get(normalized)!;
  }

  const fullPath = path.join(REPO_ROOT, relativeFilePath);
  if (fs.existsSync(fullPath)) {
    return fs.statSync(fullPath).mtime.toISOString();
  }
  return new Date(0).toISOString();
}

function getFileSha256(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
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
    if (content.includes(signatureKey)) {
      return;
    }
    if (content.includes("## Open")) {
      const updated = content.replace(/## Open\r?\n/, `## Open\n\n${taskLine}\n`);
      fs.writeFileSync(targetPath, updated, "utf8");
    }
  } catch {}
}

export function runDriftDetection(): DriftReport {
  const lastSync = getWikiSyncTimestamp();

  // Read obsidian.yaml mapping rules
  let mappingRules: MappingRule[] = [];
  let defaultFolder = "Unsorted";
  const configPath = path.join(REPO_ROOT, "configs/obsidian.yaml");

  if (fs.existsSync(configPath)) {
    try {
      const rawConfig = fs.readFileSync(configPath, "utf8");
      const parsedConfig = yaml.load(rawConfig) as any;
      if (parsedConfig) {
        if (Array.isArray(parsedConfig.mapping_rules)) {
          mappingRules = parsedConfig.mapping_rules;
        }
        if (parsedConfig.default_folder) {
          defaultFolder = parsedConfig.default_folder;
        }
      }
    } catch {}
  }

  // Collect source files from mapping rules prefixes + key directories
  const sourceFilesSet = new Set<string>();

  for (const rule of mappingRules) {
    const files = collectFiles(rule.prefix);
    for (const f of files) sourceFilesSet.add(f);
  }

  // Also collect files from core/ modules/ docs/ if set empty
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

  // Find latest staging directory if available
  let stagingBase: string | null = null;
  const possibleStagingRoots = [
    path.join(REPO_ROOT, "_kb-sync-staging", "kb-sync"),
    path.join(REPO_ROOT, ".test_obsidian_vault", "_kb-sync-staging", "kb-sync"),
  ];

  for (const pRoot of possibleStagingRoots) {
    if (fs.existsSync(pRoot)) {
      const dirs = fs
        .readdirSync(pRoot)
        .filter((d) => fs.statSync(path.join(pRoot, d)).isDirectory())
        .sort();
      if (dirs.length > 0) {
        stagingBase = path.join(pRoot, dirs[dirs.length - 1]);
        break;
      }
    }
  }

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

  const report: DriftReport = {
    timestamp: new Date().toISOString(),
    status: driftedSources.length > 0 ? "DRIFT_DETECTED" : "NO_DRIFT",
    drifted_sources: driftedSources,
    summary: {
      total_sources_checked: sourceFiles.length,
      stale_pages_count: driftedSources.length,
    },
  };

  if (report.summary.stale_pages_count > 5) {
    const taskLine = `- [ ] **kb-sync drift remediation** — Knowledge base drift detected (${report.summary.stale_pages_count} stale pages > threshold 5). Run kb-sync ingest.`;
    appendToTodos(taskLine, "kb-sync drift remediation");
  }

  const reportPath = path.join(REPO_ROOT, ".drift-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  return report;
}

if (process.argv[1] && process.argv[1].endsWith("detect-drift.ts")) {
  runDriftDetection();
}
