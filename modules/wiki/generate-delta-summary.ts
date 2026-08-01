import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

export interface FileDiff {
  path: string;
  status: "ADDED" | "MODIFIED" | "DELETED";
}

export interface DeltaSummaryResult {
  repo: string;
  previousSnapshot: string | null;
  currentSnapshot: string | null;
  isBaseline: boolean;
  diffs: FileDiff[];
  summaryText: string;
}

function getFileHash(filePath: string): string {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch {
    return "";
  }
}

function collectFiles(dir: string, baseDir: string = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      results.push(relPath);
    }
  }

  return results;
}

function findStagingRoot(repoName: string = "kb-sync", overrideStagingRoot?: string): string | null {
  if (overrideStagingRoot && fs.existsSync(overrideStagingRoot)) {
    return overrideStagingRoot;
  }

  if (process.env.STAGING_ROOT && fs.existsSync(process.env.STAGING_ROOT)) {
    return process.env.STAGING_ROOT;
  }

  const candidates = [
    path.join(REPO_ROOT, "_kb-sync-staging", repoName),
    path.join(REPO_ROOT, ".test_obsidian_vault", "_kb-sync-staging", repoName),
    path.join(REPO_ROOT, "obsidian", "vault", "_kb-sync-staging", repoName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function generateDeltaSummary(repoName: string = "kb-sync", overrideStagingRoot?: string): string {
  const stagingRoot = findStagingRoot(repoName, overrideStagingRoot);

  if (!stagingRoot || !fs.existsSync(stagingRoot)) {
    return "📦 Delta Summary: No prior staging snapshots found (Initial Baseline).";
  }

  const entries = fs
    .readdirSync(stagingRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();

  if (entries.length === 0) {
    return "📦 Delta Summary: No prior staging snapshots found (Initial Baseline).";
  }

  if (entries.length === 1) {
    const singleSnapshot = entries[0];
    const snapshotDir = path.join(stagingRoot, singleSnapshot);
    const files = collectFiles(snapshotDir).sort();

    let output = `📦 Delta Summary: Baseline staging snapshot created (${singleSnapshot}). ${files.length} file(s) staged.`;
    if (files.length > 0) {
      output += "\n" + files.map((f) => `  + [ADDED] ${f}`).join("\n");
    }
    return output;
  }

  const prevSnapshot = entries[entries.length - 2];
  const currSnapshot = entries[entries.length - 1];
  const prevDir = path.join(stagingRoot, prevSnapshot);
  const currDir = path.join(stagingRoot, currSnapshot);

  const prevFiles = collectFiles(prevDir);
  const currFiles = collectFiles(currDir);

  const prevMap = new Map<string, string>();
  for (const f of prevFiles) {
    prevMap.set(f, getFileHash(path.join(prevDir, f)));
  }

  const currMap = new Map<string, string>();
  for (const f of currFiles) {
    currMap.set(f, getFileHash(path.join(currDir, f)));
  }

  const allFilesSet = new Set<string>([...prevFiles, ...currFiles]);
  const sortedFiles = Array.from(allFilesSet).sort();

  const diffs: FileDiff[] = [];
  let addedCount = 0;
  let modifiedCount = 0;
  let deletedCount = 0;

  for (const f of sortedFiles) {
    const inPrev = prevMap.has(f);
    const inCurr = currMap.has(f);

    if (!inPrev && inCurr) {
      diffs.push({ path: f, status: "ADDED" });
      addedCount++;
    } else if (inPrev && !inCurr) {
      diffs.push({ path: f, status: "DELETED" });
      deletedCount++;
    } else if (inPrev && inCurr) {
      const prevHash = prevMap.get(f)!;
      const currHash = currMap.get(f)!;
      if (prevHash !== currHash) {
        diffs.push({ path: f, status: "MODIFIED" });
        modifiedCount++;
      }
    }
  }

  if (diffs.length === 0) {
    return `📦 Delta Summary (Comparing ${prevSnapshot} -> ${currSnapshot}): Staging diff clean (no changes).`;
  }

  let output = `📦 Delta Summary (Comparing ${prevSnapshot} -> ${currSnapshot}): ${addedCount} Added, ${modifiedCount} Modified, ${deletedCount} Deleted`;
  const breakdown = diffs
    .map((d) => {
      const symbol = d.status === "ADDED" ? "+" : d.status === "MODIFIED" ? "~" : "-";
      return `  ${symbol} [${d.status}] ${d.path}`;
    })
    .join("\n");

  output += "\n" + breakdown;
  return output;
}

if (process.argv[1] && process.argv[1].endsWith("generate-delta-summary.ts")) {
  console.log(generateDeltaSummary());
}
