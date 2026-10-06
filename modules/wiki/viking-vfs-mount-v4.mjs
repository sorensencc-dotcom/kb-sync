import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';

/**
 * VikingVFSMount (v4 - Production Hardened)
 * 
 * Implements OpenViking's viking:// URI protocol with tiered context loading:
 * - L0 (Abstract): ~100-200 tokens (.abstract file) for rapid directory-level relevance checks
 * - L1 (Overview): ~200-500 tokens (.overview file) summarizing headers & key points
 * - L2 (Detail): Full raw file contents resolved via URI paths
 */
export class VikingVFSMount {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  /**
   * Safe path resolution to prevent directory traversal attacks.
   */
  resolveSafePath(relativePath) {
    const normalizedRelative = relativePath.replace(/^[\/\\]+/, '');
    const absolutePath = path.resolve(this.rootDir, normalizedRelative);
    
    // Strict path boundary check
    const rel = path.relative(this.rootDir, absolutePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`[SECURITY_ALERT] Path traversal attempt blocked: "${relativePath}" resolves outside root directory.`);
    }
    return absolutePath;
  }

  /**
   * Parse markdown frontmatter or extract first heading/paragraph as dynamic summary.
   */
  extractNoteSummary(filePath) {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check frontmatter for description or topic
    const fmMatch = content.match(/^---\r?\n[\s\S]*?description:\s*["']?([^"'\r\n]+)["']?[\s\S]*?\r?\n---/i) ||
                    content.match(/^---\r?\n[\s\S]*?topic:\s*["']?([^"'\r\n]+)["']?[\s\S]*?\r?\n---/i);
    if (fmMatch && fmMatch[1]) {
      return fmMatch[1].trim();
    }

    // Strip frontmatter before searching body lines
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const lines = body.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    
    for (const line of lines) {
      if (line.startsWith('#')) {
        const headingText = line.replace(/^#+\s*/, '').trim();
        if (headingText) return headingText;
      } else {
        return line.slice(0, 150);
      }
    }
    return 'Uncategorized research note';
  }

  /**
   * Compiles L0 (.abstract) and L1 (.overview) summary files dynamically from directory contents.
   */
  compileTieredSummaries(targetRelativeDir = 'wiki/research') {
    const targetAbsDir = this.resolveSafePath(targetRelativeDir);
    if (!fs.existsSync(targetAbsDir)) {
      fs.mkdirSync(targetAbsDir, { recursive: true });
    }

    const entries = fs.readdirSync(targetAbsDir, { withFileTypes: true });
    const markdownFiles = entries
      .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort();

    // Extract dynamic topic summaries
    const noteSummaries = markdownFiles.map(file => {
      const filePath = path.join(targetAbsDir, file);
      const topicName = file.replace(/\.md$/, '');
      const summary = this.extractNoteSummary(filePath);
      return { file, topicName, summary };
    });

    const topicsList = noteSummaries.map(n => n.topicName).join(', ') || 'none';
    const dynamicSummaryText = noteSummaries.length > 0
      ? `High-density semantic wiki notes covering: ${noteSummaries.map(n => `${n.topicName} (${n.summary})`).join('; ')}.`
      : 'Empty research directory.';

    const displayRelativeDir = targetRelativeDir.replace(/\\/g, '/');

    // L0 Abstract Compilation (.abstract)
    const abstractContent = `# Viking VFS L0 Abstract: ${displayRelativeDir}
URI: viking://resources/${displayRelativeDir}
Topics Covered: ${topicsList}
Total Research Notes: ${markdownFiles.length}
Last Synchronized: ${new Date().toISOString()}
Summary: ${dynamicSummaryText}
`;

    // L1 Overview Compilation (.overview)
    let overviewContent = `# Viking VFS L1 Overview: ${displayRelativeDir}
URI: viking://resources/${displayRelativeDir}
Generated At: ${new Date().toISOString()}

## Structural Index
`;

    for (const note of noteSummaries) {
      const filePath = path.join(targetAbsDir, note.file);
      const rawContent = fs.readFileSync(filePath, 'utf8');
      const bodyContent = rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      const excerpt = bodyContent
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .slice(0, 8)
        .join('\n');

      overviewContent += `\n### Document: \`viking://resources/${displayRelativeDir}/${note.file}\`
Summary: ${note.summary}
Key Excerpt:
${excerpt}
---
`;
    }

    const abstractPath = path.join(targetAbsDir, '.abstract');
    const overviewPath = path.join(targetAbsDir, '.overview');

    fs.writeFileSync(abstractPath, abstractContent, 'utf8');
    fs.writeFileSync(overviewPath, overviewContent, 'utf8');

    const abstractSize = fs.statSync(abstractPath).size;
    const overviewSize = fs.statSync(overviewPath).size;

    // Accurate token calculations at ~4 bytes/token
    const abstractTokens = Math.round(abstractSize / 4);
    const overviewTokens = Math.round(overviewSize / 4);

    return {
      abstractPath,
      abstractSize,
      abstractTokens,
      overviewPath,
      overviewSize,
      overviewTokens,
      noteCount: markdownFiles.length
    };
  }

  /**
   * Resolves viking:// URIs with explicit query parameter support for tiers and direct file access.
   */
  resolveVikingURI(vikingUri) {
    if (!vikingUri.startsWith('viking://resources/')) {
      throw new Error(`Invalid Viking URI scheme: "${vikingUri}". Must start with "viking://resources/".`);
    }

    const rawPathAndQuery = vikingUri.replace('viking://resources/', '');
    if (rawPathAndQuery.split(/[?#]/)[0].split(/[\\/]/).some(part => part === '..')) {
      throw new Error(`[SECURITY_ALERT] Path traversal attempt blocked: "${vikingUri}" contains relative parent references.`);
    }

    // Parse URI path and query parameters
    const dummyBase = 'http://viking.local/';
    const urlObj = new URL(rawPathAndQuery, dummyBase);

    const relativePath = decodeURIComponent(urlObj.pathname);
    const tierParam = urlObj.searchParams.get('tier')?.toLowerCase();

    const targetAbsPath = this.resolveSafePath(relativePath);

    // Direct file access (L2)
    if (fs.existsSync(targetAbsPath) && fs.statSync(targetAbsPath).isFile()) {
      return {
        uri: vikingUri,
        tier: tierParam || 'l2',
        path: targetAbsPath,
        content: fs.readFileSync(targetAbsPath, 'utf8')
      };
    }

    // Target path is a directory
    if (fs.existsSync(targetAbsPath) && fs.statSync(targetAbsPath).isDirectory()) {
      const requestedTier = tierParam || 'l0';

      if (requestedTier === 'l1' || requestedTier === 'overview') {
        const overviewPath = path.join(targetAbsPath, '.overview');
        if (!fs.existsSync(overviewPath)) {
          this.compileTieredSummaries(relativePath);
        }
        return {
          uri: vikingUri,
          tier: 'l1',
          path: overviewPath,
          content: fs.readFileSync(overviewPath, 'utf8')
        };
      }

      // Default to L0 / Abstract
      const abstractPath = path.join(targetAbsPath, '.abstract');
      if (!fs.existsSync(abstractPath)) {
        this.compileTieredSummaries(relativePath);
      }
      return {
        uri: vikingUri,
        tier: 'l0',
        path: abstractPath,
        content: fs.readFileSync(abstractPath, 'utf8')
      };
    }

    throw new Error(`Resource not found for Viking URI: "${vikingUri}" (Resolved path: ${targetAbsPath})`);
  }
}

/**
 * Standalone helper for sample fixture provisioning.
 */
export function provisionSampleFixtures(rootDir) {
  const researchDir = path.resolve(rootDir, 'wiki/research');
  fs.mkdirSync(researchDir, { recursive: true });

  const note1Path = path.join(researchDir, 'mobile-websocket-heartbeats.md');
  const note2Path = path.join(researchDir, 'historical-revocation-verification.md');

  if (!fs.existsSync(note1Path)) {
    fs.writeFileSync(note1Path, `---
category: research
topic: mobile-websocket-heartbeats
description: Guidance for background JS interval throttling on mobile browsers
status: active
---
# Mobile Browser WebSocket Heartbeats

Mobile operating systems heavily throttle background JS intervals.
1. Leverage Page Visibility API to trigger immediate pings upon focus.
2. Store WebSocket backoff state in client storage.
`, 'utf8');
  }

  if (!fs.existsSync(note2Path)) {
    fs.writeFileSync(note2Path, `---
category: research
topic: historical-revocation-verification
description: Sigil protocol rules for offline historical key revocation audits
status: active
---
# Historical Revocation Verification

When verifying historical signatures:
- Signatures generated before revocation timestamp remain cryptographically valid.
- Local connectors cache revoked key intervals in SQLite for offline checking.
`, 'utf8');
  }
}
