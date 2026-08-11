import fs from 'node:fs';
import path from 'node:path';

// Restricted strictly to Markdown and JSON until dedicated YAML structural parsers are added
export const OUTLINE_ALLOWLIST_EXT = new Set(['.md', '.json']);

export function isOutlineAllowedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return OUTLINE_ALLOWLIST_EXT.has(ext);
}

export function outlineFile(filePath, relativePath, contentHash, reason) {
  let rawContent;
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { content: '', state: 'Full', warning: `Read error: ${err.message}` };
  }

  const ext = path.extname(filePath).toLowerCase();

  try {
    let outlinedText = '';

    if (ext === '.md') {
      const lines = rawContent.split(/\r?\n/);
      const headingLines = lines.filter(line => /^#{1,6}\s+/.test(line));
      outlinedText = [
        `<!-- [COMPACTED OUTLINE: MARKDOWN HEADINGS ONLY (${headingLines.length} sections)] -->`,
        ...headingLines
      ].join('\n');
    } else if (ext === '.json') {
      const parsed = JSON.parse(rawContent);
      const keys = Object.keys(parsed);
      outlinedText = [
        `// [COMPACTED OUTLINE: TOP-LEVEL JSON KEYS ONLY]`,
        JSON.stringify({ _keys: keys, _count: keys.length }, null, 2)
      ].join('\n');
    } else {
      return { content: rawContent, state: 'Full', warning: `Outline unsupported for extension "${ext}"` };
    }

    const banner = [
      '// =================================================================================',
      `// [COMPACTED OUTLINE]`,
      `// Source Path:      ${relativePath}`,
      `// Source Content Hash: ${contentHash}`,
      `// Compaction State: Outline`,
      `// Selection Reason: ${reason}`,
      '// ================================================================================='
    ].join('\n');

    return { content: `${banner}\n\n${outlinedText}`, state: 'Outline' };
  } catch (err) {
    return { content: rawContent, state: 'Full', warning: `Outline processing failed: ${err.message}` };
  }
}
