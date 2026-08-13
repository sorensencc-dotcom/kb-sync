import fs from 'node:fs';
import path from 'node:path';

/**
 * Universal platform-agnostic configuration parser.
 * Safely handles CRLF/LF line endings, single/double quotes, YAML lists, and inline comments.
 */
export function readConfigValue(filePath, key, isArray = false) {
  if (!filePath || !fs.existsSync(filePath)) {
    return isArray ? [] : '';
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  
  let keyFound = false;
  let rawValueLines = [];

  const keyPattern = new RegExp(`^\\s*${key}\\s*[:=](.*)$`, 'i');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!keyFound) {
      const match = line.match(keyPattern);
      if (match) {
        keyFound = true;
        const remainder = match[1].trim();
        if (remainder) {
          rawValueLines.push(remainder);
        }
      }
    } else {
      // If we are looking for array/list lines, continue until next top-level key or EOF
      if (isArray) {
        if (/^\s*-[ \t]+/.test(line) || /^\s*[\[\]"',a-zA-Z0-9_.-]+/.test(line)) {
          // Stop if a new top-level key starts (no leading whitespace, contains :)
          if (/^[a-zA-Z0-9_-]+\s*[:=]/.test(line)) {
            break;
          }
          rawValueLines.push(line.trim());
        } else if (line.trim() === '' || /^\s*#/.test(line)) {
          // Skip empty lines & comments
          continue;
        } else {
          break;
        }
      } else {
        break;
      }
    }
  }

  if (!keyFound) {
    return isArray ? [] : '';
  }

  if (isArray) {
    const combined = rawValueLines.join(' ');
    // Strip comments
    const noComments = combined.replace(/#.*$/gm, '');
    // Clean brackets, quotes, list markers
    const cleaned = noComments
      .replace(/[\[\]"]/g, '')
      .replace(/'/g, '')
      .replace(/-\s*/g, ' ')
      .replace(/,/g, ' ');

    const tokens = cleaned
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length > 0);

    return tokens;
  } else {
    let val = rawValueLines[0] || '';
    // Strip inline comments
    val = val.replace(/#.*$/, '').trim();
    // Strip leading and trailing quotes if matching
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).trim();
    }
    return val;
  }
}

// CLI Interface when run directly
const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (scriptPath && (scriptPath.endsWith('config-loader.mjs') || scriptPath.endsWith('config-loader.js'))) {
  const args = process.argv.slice(2);
  let filePath = '';
  let key = '';
  let isArray = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' || args[i] === '-f') {
      filePath = args[++i];
    } else if (args[i] === '--key' || args[i] === '-k') {
      key = args[++i];
    } else if (args[i] === '--array' || args[i] === '-a') {
      isArray = true;
    } else if (!filePath) {
      filePath = args[i];
    } else if (!key) {
      key = args[i];
    }
  }

  if (filePath && key) {
    const res = readConfigValue(filePath, key, isArray);
    if (Array.isArray(res)) {
      console.log(res.join('\n'));
    } else if (res) {
      console.log(res);
    }
  }
}
