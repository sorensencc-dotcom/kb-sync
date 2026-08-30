import fs from 'fs';
import path from 'path';

export interface LinkValidationFinding {
  file: string;
  line: number;
  rawLink: string;
  type: 'LOCAL_FILESYSTEM_URI' | 'CROSS_REPO_RELATIVE' | 'BROKEN_WIKILINK' | 'WINDOWS_PATH';
  suggestion?: string;
}

export interface LinkSanitizerResult {
  totalFilesAudited: number;
  findings: LinkValidationFinding[];
  fixedCount: number;
}

export function sanitizeMarkdownContent(content: string, availablePageSlugs: Set<string>): { sanitized: string; findings: LinkValidationFinding[]; fixesApplied: number } {
  const lines = content.split(/\r?\n/);
  const findings: LinkValidationFinding[] = [];
  let fixesApplied = 0;

  const sanitizedLines = lines.map((line, idx) => {
    let modifiedLine = line;

    // 1. Detect and sanitize file:/// absolute URLs
    const fileUriRegex = /\[([^\]]+)\]\(file:\/\/\/[a-zA-Z]:[^\)]+\/([^\/\)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = fileUriRegex.exec(line)) !== null) {
      const label = match[1];
      const filename = match[2];
      const targetSlug = filename.replace(/\.(md|ts|js|mjs|py|json)$/i, '');
      findings.push({
        file: '',
        line: idx + 1,
        rawLink: match[0],
        type: 'LOCAL_FILESYSTEM_URI',
        suggestion: `[[${targetSlug}]]`
      });
      modifiedLine = modifiedLine.replace(match[0], `[[${targetSlug}|${label}]]`);
      fixesApplied++;
    }

    // 2. Detect plain file:/// URLs
    const plainFileUriRegex = /file:\/\/\/[a-zA-Z]:[^\s\)\>]+/g;
    while ((match = plainFileUriRegex.exec(modifiedLine)) !== null) {
      const fullUri = match[0];
      const base = path.basename(fullUri.replace(/file:\/\/\//, ''));
      findings.push({
        file: '',
        line: idx + 1,
        rawLink: fullUri,
        type: 'LOCAL_FILESYSTEM_URI',
        suggestion: `\`${base}\``
      });
      modifiedLine = modifiedLine.replace(fullUri, `\`${base}\``);
      fixesApplied++;
    }

    // 3. Detect cross-repository relative traversal links (e.g. ../../apps/...)
    const crossRepoRegex = /\[([^\]]+)\]\((\.\.\/\.\.\/[^\)]+)\)/g;
    while ((match = crossRepoRegex.exec(line)) !== null) {
      const label = match[1];
      const rawTarget = match[2];
      const base = path.basename(rawTarget);
      findings.push({
        file: '',
        line: idx + 1,
        rawLink: match[0],
        type: 'CROSS_REPO_RELATIVE',
        suggestion: `[[${base}]]`
      });
      modifiedLine = modifiedLine.replace(match[0], `\`${label} (${base})\``);
      fixesApplied++;
    }

    // 4. Validate internal wikilinks [[Target]]
    const wikilinkRegex = /\[\[([^\]\|]+)(?:\|([^\]]+))?\]\]/g;
    while ((match = wikilinkRegex.exec(line)) !== null) {
      const rawTarget = match[1].trim();
      const normalizedTarget = rawTarget.toLowerCase().replace(/[\s_-]+/g, '-');
      if (availablePageSlugs.size > 0 && !availablePageSlugs.has(normalizedTarget) && !availablePageSlugs.has(rawTarget.toLowerCase())) {
        findings.push({
          file: '',
          line: idx + 1,
          rawLink: match[0],
          type: 'BROKEN_WIKILINK',
          suggestion: `Target '${rawTarget}' not found in wiki pages`
        });
      }
    }

    return modifiedLine;
  });

  return {
    sanitized: sanitizedLines.join('\n'),
    findings,
    fixesApplied
  };
}

export function auditAndSanitizeWikiDirectory(wikiDir: string, options: { fix?: boolean } = {}): LinkSanitizerResult {
  if (!fs.existsSync(wikiDir)) {
    return { totalFilesAudited: 0, findings: [], fixedCount: 0 };
  }

  const allEntries = fs.readdirSync(wikiDir, { recursive: true }) as string[];
  const mdFiles = allEntries.filter(f => f.endsWith('.md'));

  const availableSlugs = new Set<string>();
  for (const f of mdFiles) {
    const base = path.basename(f, '.md');
    availableSlugs.add(base.toLowerCase());
    availableSlugs.add(base.toLowerCase().replace(/[\s_-]+/g, '-'));
  }

  const allFindings: LinkValidationFinding[] = [];
  let totalFixes = 0;

  for (const relFile of mdFiles) {
    const fullPath = path.join(wikiDir, relFile);
    let content = '';
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    const { sanitized, findings, fixesApplied } = sanitizeMarkdownContent(content, availableSlugs);

    for (const finding of findings) {
      finding.file = relFile;
      allFindings.push(finding);
    }

    if (options.fix && fixesApplied > 0) {
      fs.writeFileSync(fullPath, sanitized, 'utf8');
      totalFixes += fixesApplied;
    }
  }

  return {
    totalFilesAudited: mdFiles.length,
    findings: allFindings,
    fixedCount: totalFixes
  };
}

if (process.argv[1] && process.argv[1].endsWith('link-sanitizer.ts')) {
  const targetDir = process.argv[2] || path.resolve(process.cwd(), 'wiki');
  const shouldFix = process.argv.includes('--fix');
  console.log(`[LINK-SANITIZER] Auditing ${targetDir} (fix=${shouldFix})...`);
  const result = auditAndSanitizeWikiDirectory(targetDir, { fix: shouldFix });
  console.log(`[LINK-SANITIZER] Files Audited: ${result.totalFilesAudited}`);
  console.log(`[LINK-SANITIZER] Total Findings: ${result.findings.length}`);
  console.log(`[LINK-SANITIZER] Total Fixes Applied: ${result.fixedCount}`);
  if (result.findings.length > 0 && !shouldFix) {
    console.log(JSON.stringify(result.findings.slice(0, 20), null, 2));
  }
}
