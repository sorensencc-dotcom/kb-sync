import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

export interface CoverageReport {
  timestamp: string;
  source_files_count: number;
  wiki_pages_count: number;
  unmapped_sources: string[];
  link_health: {
    total_links: number;
    broken_links: string[];
    healthy_pct: number;
  };
  coverage_score_pct: number;
}

interface MappingRule {
  prefix: string;
  folder: string;
}

function collectFiles(dirOrFile: string): string[] {
  const fullPath = path.join(REPO_ROOT, dirOrFile);
  if (!fs.existsSync(fullPath)) return [];
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    const ext = path.extname(dirOrFile).toLowerCase();
    const codeExts = [".sh", ".mjs", ".ts", ".js", ".ps1", ".py"];
    if (codeExts.includes(ext)) {
      return [dirOrFile.replace(/\\/g, "/")];
    }
    return [];
  }
  if (stat.isDirectory()) {
    const results: string[] = [];
    const entries = fs.readdirSync(fullPath);
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules" || entry === "_kb-sync-staging") continue;
      const subPath = path.join(dirOrFile, entry);
      results.push(...collectFiles(subPath));
    }
    return results;
  }
  return [];
}

function findMdFiles(dir: string): string[] {
  const fullPath = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(fullPath)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(fullPath);
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const subPath = path.join(dir, entry);
    const stat = fs.statSync(path.join(REPO_ROOT, subPath));
    if (stat.isDirectory()) {
      results.push(...findMdFiles(subPath));
    } else if (stat.isFile() && entry.endsWith(".md")) {
      results.push(subPath.replace(/\\/g, "/"));
    }
  }
  return results;
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

export function runCoverageAudit(): CoverageReport {
  let mappingRules: MappingRule[] = [];
  const configPath = path.join(REPO_ROOT, "configs/obsidian.yaml");

  if (fs.existsSync(configPath)) {
    try {
      const rawConfig = fs.readFileSync(configPath, "utf8");
      const parsedConfig = yaml.load(rawConfig) as any;
      if (parsedConfig && Array.isArray(parsedConfig.mapping_rules)) {
        mappingRules = parsedConfig.mapping_rules;
      }
    } catch {}
  }

  // 1. Collect source files
  const sourceFilesSet = new Set<string>();
  for (const rule of mappingRules) {
    const files = collectFiles(rule.prefix);
    for (const f of files) sourceFilesSet.add(f);
  }

  if (sourceFilesSet.size === 0) {
    const fallbackDirs = ["core", "modules", "scripts", "docs"];
    for (const dir of fallbackDirs) {
      const files = collectFiles(dir);
      for (const f of files) sourceFilesSet.add(f);
    }
  }

  const sourceFiles = Array.from(sourceFilesSet);
  const wikiFiles = findMdFiles("wiki");
  const docsFiles = findMdFiles("docs");
  const allDocMdFiles = Array.from(new Set([...wikiFiles, ...docsFiles]));

  // Build lookup map for existing filenames and paths for wikilinks
  const basenameSet = new Set<string>();

  for (const docFile of allDocMdFiles) {
    const b = path.basename(docFile).toLowerCase();
    const bNoExt = path.basename(docFile, ".md").toLowerCase();
    basenameSet.add(b);
    basenameSet.add(bNoExt);
    basenameSet.add(b.replace(/[-_]/g, ""));
    basenameSet.add(bNoExt.replace(/[-_]/g, ""));
  }

  // Check unmapped sources
  const unmappedSources: string[] = [];
  for (const fileRel of sourceFiles) {
    let isMapped = false;
    const fileBasename = path.basename(fileRel);
    const nameWithoutExt = path.basename(fileRel, path.extname(fileRel));

    const fbLower = fileBasename.toLowerCase();
    const nweLower = nameWithoutExt.toLowerCase();
    const fbClean = fbLower.replace(/[-_]/g, "");
    const nweClean = nweLower.replace(/[-_]/g, "");

    if (
      basenameSet.has(fbLower) ||
      basenameSet.has(nweLower) ||
      basenameSet.has(fbClean) ||
      basenameSet.has(nweClean)
    ) {
      isMapped = true;
    } else {
      for (const rule of mappingRules) {
        if (fileRel.startsWith(rule.prefix)) {
          isMapped = true;
          break;
        }
      }
    }

    if (!isMapped) {
      unmappedSources.push(fileRel);
    }
  }

  // 2. Audit markdown links & wikilinks
  let totalLinks = 0;
  const brokenLinks: string[] = [];

  for (const mdRelPath of allDocMdFiles) {
    const fullMdPath = path.join(REPO_ROOT, mdRelPath);
    if (!fs.existsSync(fullMdPath)) continue;
    const content = fs.readFileSync(fullMdPath, "utf8");
    const lines = content.split("\n");

    let inCodeBlock = false;
    lines.forEach((line, lineIndex) => {
      if (line.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        return;
      }
      if (inCodeBlock) return;

      // Strip inline code spans from line to avoid checking code examples/placeholders
      const cleanLine = line.replace(/`[^`]+`/g, "");

      // Check standard Markdown links: [text](target)
      const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = mdLinkRegex.exec(cleanLine)) !== null) {
        const rawTarget = match[2].trim();
        // Ignore external http(s) links, mailto, anchor-only links
        if (
          rawTarget.startsWith("http://") ||
          rawTarget.startsWith("https://") ||
          rawTarget.startsWith("mailto:") ||
          rawTarget.startsWith("#") ||
          rawTarget.includes("<") ||
          rawTarget.includes(">") ||
          rawTarget.includes("...")
        ) {
          continue;
        }

        totalLinks++;
        // Clean target path (strip fragment or query string)
        let cleanTarget = rawTarget.split("#")[0].split("?")[0].trim();
        if (!cleanTarget) continue;

        if (cleanTarget.startsWith("file:///")) {
          let fileUriPath = cleanTarget.replace("file:///", "");
          if (process.platform === "win32") {
            fileUriPath = fileUriPath.replace(/\//g, "\\");
          }
          if (fs.existsSync(fileUriPath) || fs.existsSync(decodeURIComponent(fileUriPath))) {
            continue;
          }
        }

        let targetFullPath = cleanTarget.startsWith("/")
          ? path.join(REPO_ROOT, cleanTarget)
          : path.resolve(path.dirname(fullMdPath), cleanTarget);

        if (!fs.existsSync(targetFullPath)) {
          brokenLinks.push(`${mdRelPath}:${lineIndex + 1}: broken link '${rawTarget}'`);
        }
      }

      // Check Wikilinks: [[target]] or [[target|label]]
      const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
      let wMatch: RegExpExecArray | null;
      while ((wMatch = wikiLinkRegex.exec(cleanLine)) !== null) {
        const rawTarget = wMatch[1].trim();
        if (
          !rawTarget ||
          rawTarget.includes("<") ||
          rawTarget.includes(">") ||
          rawTarget.includes("...")
        ) {
          continue;
        }

        totalLinks++;
        let found = false;

        // Try direct relative paths or known extensions
        const targetWithMd = rawTarget.endsWith(".md") ? rawTarget : `${rawTarget}.md`;
        const candidates = [
          path.resolve(path.dirname(fullMdPath), rawTarget),
          path.resolve(path.dirname(fullMdPath), targetWithMd),
          path.join(REPO_ROOT, "wiki", rawTarget),
          path.join(REPO_ROOT, "wiki", targetWithMd),
          path.join(REPO_ROOT, "docs", rawTarget),
          path.join(REPO_ROOT, "docs", targetWithMd),
          path.join(REPO_ROOT, rawTarget),
          path.join(REPO_ROOT, targetWithMd),
        ];

        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            found = true;
            break;
          }
        }

        if (!found) {
          const targetBase = path.basename(rawTarget, ".md").toLowerCase();
          if (basenameSet.has(targetBase) || basenameSet.has(rawTarget.toLowerCase())) {
            found = true;
          }
        }

        if (!found) {
          brokenLinks.push(`${mdRelPath}:${lineIndex + 1}: broken wikilink '[[${rawTarget}]]'`);
        }
      }
    });
  }

  const sourceFilesCount = sourceFiles.length;
  const mappedCount = sourceFilesCount - unmappedSources.length;
  const coverageScorePct =
    sourceFilesCount === 0 ? 100.0 : parseFloat(((mappedCount / sourceFilesCount) * 100).toFixed(2));

  const totalLinkCount = totalLinks;
  const healthyPct =
    totalLinkCount === 0
      ? 100.0
      : parseFloat((((totalLinkCount - brokenLinks.length) / totalLinkCount) * 100).toFixed(2));

  const report: CoverageReport = {
    timestamp: new Date().toISOString(),
    source_files_count: sourceFilesCount,
    wiki_pages_count: wikiFiles.length > 0 ? wikiFiles.length : docsFiles.length,
    unmapped_sources: unmappedSources,
    link_health: {
      total_links: totalLinkCount,
      broken_links: brokenLinks,
      healthy_pct: healthyPct,
    },
    coverage_score_pct: coverageScorePct,
  };

  if (report.coverage_score_pct < 85) {
    const taskLine = `- [ ] **kb-sync coverage improvement** — Documentation coverage score dropped to ${report.coverage_score_pct}% (threshold < 85%). Update mapping rules or wiki pages.`;
    appendToTodos(taskLine, "kb-sync coverage improvement");
  }

  const reportPath = path.join(REPO_ROOT, ".coverage-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  return report;
}

if (process.argv[1] && process.argv[1].endsWith("audit-coverage.ts")) {
  runCoverageAudit();
}
