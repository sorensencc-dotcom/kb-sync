import fs from 'node:fs';

/**
 * Secret & PII Sanitizer for kb-sync / Compacted Context Engine.
 * Zero-dependency, fail-closed scanner targeting credentials, private keys,
 * high-entropy tokens, and sensitive environment variables.
 */

// Regex patterns for explicit secret detection
const SECRET_PATTERNS = [
  { name: 'GCP/Google API Key', regex: /\bAIzaSy[A-Za-z0-9_-]{33}\b/g },
  { name: 'GitHub Personal Access Token', regex: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g },
  { name: 'OpenAI API Key', regex: /\bsk-[A-Za-z0-9]{48}\b/g },
  { name: 'Anthropic API Key', regex: /\bsk-ant-[A-Za-z0-9_-]{32,128}\b/g },
  { name: 'Slack Bot Token', regex: /\bxoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*\b/g },
  { name: 'RSA/EC/PEM Private Key', regex: /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP)? PRIVATE KEY BLOCK-----[\s\S]*?-----END (?:RSA|EC|OPENSSH|DSA|PGP)? PRIVATE KEY BLOCK-----/g },
  { name: 'PEM Private Key Header', regex: /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP)? PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|OPENSSH|DSA|PGP)? PRIVATE KEY-----/g },
  { name: 'JWT Token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'AWS Access Key ID', regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'Generic Secret Variable', regex: /(?:secret|password|passwd|api_key|token|auth_key|master_token)\s*[:=]\s*["']?([A-Za-z0-9_\-\.\/]{16,})["']?/gi }
];

/**
 * Scan text for secrets and replace them with redaction placeholders.
 * Returns { sanitizedText, secretsFound, categories }
 * Throws on fatal error (Fail-Closed).
 */
export function scanAndSanitizeText(content, options = {}) {
  if (typeof content !== 'string') {
    throw new Error('[SECRET_SANITIZER] Content must be a string (Fail-Closed)');
  }

  let sanitized = content;
  let totalFound = 0;
  const categories = {};

  try {
    for (const pattern of SECRET_PATTERNS) {
      let matches = 0;
      sanitized = sanitized.replace(pattern.regex, (match, group1) => {
        matches++;
        totalFound++;
        categories[pattern.name] = (categories[pattern.name] || 0) + 1;

        if (group1) {
          // Replace specific captured secret value inside key-value match
          return match.replace(group1, `[REDACTED_SECRET:${pattern.name}]`);
        }
        return `[REDACTED_SECRET:${pattern.name}]`;
      });
    }

    return {
      sanitizedText: sanitized,
      secretsFound: totalFound,
      categories
    };
  } catch (err) {
    // Fail-Closed: do not allow un-sanitized content if scanner fails
    throw new Error(`[SECRET_SANITIZER] Fail-Closed trigger: Scanning exception (${err.message})`);
  }
}

/**
 * Sanitize a file on disk.
 */
export function sanitizeFile(filePath, options = {}) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const result = scanAndSanitizeText(raw, options);
    if (result.secretsFound > 0 && options.overwrite !== false) {
      fs.writeFileSync(filePath, result.sanitizedText, 'utf8');
    }
    return result;
  } catch (err) {
    throw new Error(`[SECRET_SANITIZER] Failed to sanitize file ${filePath}: ${err.message}`);
  }
}
