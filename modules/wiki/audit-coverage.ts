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
  if (stat.isFile()) return [dirOrFile.replace(/\\/g, "/")];
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
    basenameSet.add(path.basename(docFile));
    basenameSet.add(path.basename(docFile, ".md"));
  }

  // Check unmapped sources
  const unmappedSources: string[] = [];
  for (const fileRel of sourceFiles) {
    let isMapped = false;
    for (const rule of mappingRules) {
      if (fileRel.startsWith(rule.prefix)) {
        isMapped = true;
        break;
      }
    }
    if (!isMapped) {
      const fileBasename = path.basename(fileRel);
      if (basenameSet.has(fileBasename) || basenameSet.has(path.basename(fileRel, path.extname(fileRel)))) {
        isMapped = true;
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

    lines.forEach((line, lineIndex) => {
      // Check standard Markdown links: [text](target)
      const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = mdLinkRegex.exec(line)) !== null) {
        const rawTarget = match[2].trim();
        // Ignore external links, mailto, anchor-only links
        if (
          rawTarget.startsWith("http://") ||
          rawTarget.startsWith("https://") ||
          rawTarget.startsWith("mailto:") ||
          rawTarget.startsWith("#")
        ) {
          continue;
        }

        totalLinks++;
        // Clean target path (strip fragment or query string)
        const cleanTarget = rawTarget.split("#")[0].split("?")[0].trim();
        if (!cleanTarget) continue;

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
      while ((wMatch = wikiLinkRegex.exec(line)) !== null) {
        const rawTarget = wMatch[1].trim();
        if (!rawTarget) continue;

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
          const targetBase = path.basename(rawTarget, ".md");
          if (basenameSet.has(targetBase) || basenameSet.has(rawTarget)) {
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
