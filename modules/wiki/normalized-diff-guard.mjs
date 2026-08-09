/**
 * Allowed enum values from contract schema
 */
export const ALLOWED_CATEGORIES = new Set([
  "daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki",
  "manifest", "spec", "readme", "pipeline"
]);

export const ALLOWED_STATUSES = new Set([
  "active", "beta", "archived", "draft"
]);

/**
 * Parses markdown document into frontmatter object and body content.
 * @param {string} content 
 * @returns {{ frontmatter: Record<string, string>, body: string, rawYaml: string|null }}
 */
export function parseDocument(content) {
  if (typeof content !== 'string') {
    return { frontmatter: {}, body: '', rawYaml: null };
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)?$/);
  if (!match) {
    return { frontmatter: {}, body: content, rawYaml: null };
  }

  const rawYaml = match[1];
  const body = match[2] ?? '';
  const frontmatter = {};

  const lines = rawYaml.split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const key = line.slice(0, colonIndex).trim();
      let val = line.slice(colonIndex + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) {
        frontmatter[key] = val;
      }
    }
  }

  return { frontmatter, body, rawYaml };
}

/**
 * Validates that a repaired document's diff against original is strictly allowed.
 * - Body text below frontmatter must be byte-for-byte immutable.
 * - Frontmatter changes must only target keys permitted by validator diagnostics.
 * - Changed frontmatter values must be valid per contract schema.
 * 
 * @param {string} original 
 * @param {string} repaired 
 * @param {Array<object>|object} diagnostics 
 * @returns {{ valid: true, original: object, repaired: object }}
 */
export function validateAllowedDiff(original, repaired, diagnostics = []) {
  const origDoc = parseDocument(original);
  const repDoc = parseDocument(repaired);

  // 1. Body content byte-for-byte immutability check
  if (origDoc.body !== repDoc.body) {
    const err = new Error('UNALLOWED_DIFF_REJECTED: Body content below frontmatter was modified');
    err.code = 'UNALLOWED_DIFF_REJECTED';
    throw err;
  }

  // 2. Identify frontmatter changes
  const origFM = origDoc.frontmatter;
  const repFM = repDoc.frontmatter;
  const allKeys = new Set([...Object.keys(origFM), ...Object.keys(repFM)]);
  const changedKeys = [];

  for (const k of allKeys) {
    if (origFM[k] !== repFM[k]) {
      changedKeys.push(k);
    }
  }

  if (changedKeys.length === 0) {
    return { valid: true, original: origDoc, repaired: repDoc };
  }

  // 3. Determine permitted frontmatter keys from diagnostics
  const diagList = Array.isArray(diagnostics) ? diagnostics : (diagnostics ? [diagnostics] : []);
  const allowedKeys = new Set();

  for (const diag of diagList) {
    if (!diag) continue;

    // Explicit field / key
    if (diag.field) allowedKeys.add(diag.field);
    if (diag.key) allowedKeys.add(diag.key);

    const ruleId = diag.rule_id || diag.rule || diag.code;
    if (typeof ruleId === 'string') {
      const upper = ruleId.toUpperCase();
      if (upper.includes('CATEGORY')) allowedKeys.add('category');
      if (upper.includes('STATUS')) allowedKeys.add('status');
      if (upper.includes('TITLE')) allowedKeys.add('title');
      if (upper === 'MANDATORY_KEY_MISSING' || upper === 'FRONTMATTER_SCHEMA_MISSING') {
        const msg = String(diag.message || '');
        if (msg.includes('category')) allowedKeys.add('category');
        if (msg.includes('status')) allowedKeys.add('status');
        if (msg.includes('title')) allowedKeys.add('title');
        if (!msg.includes('category') && !msg.includes('status') && !msg.includes('title')) {
          allowedKeys.add('category');
          allowedKeys.add('status');
          allowedKeys.add('title');
        }
      }
    }
  }

  // 4. Verify that every changed key is in allowedKeys
  for (const key of changedKeys) {
    if (!allowedKeys.has(key)) {
      const err = new Error(`UNALLOWED_DIFF_REJECTED: Frontmatter key '${key}' was modified but is not permitted by diagnostics`);
      err.code = 'UNALLOWED_DIFF_REJECTED';
      throw err;
    }
  }

  // 5. Validate repaired values for category, status, title
  if (repFM.category !== undefined && changedKeys.includes('category')) {
    if (!ALLOWED_CATEGORIES.has(repFM.category)) {
      const err = new Error(`UNALLOWED_DIFF_REJECTED: Invalid category value '${repFM.category}'`);
      err.code = 'UNALLOWED_DIFF_REJECTED';
      throw err;
    }
  }

  if (repFM.status !== undefined && changedKeys.includes('status')) {
    if (!ALLOWED_STATUSES.has(repFM.status)) {
      const err = new Error(`UNALLOWED_DIFF_REJECTED: Invalid status value '${repFM.status}'`);
      err.code = 'UNALLOWED_DIFF_REJECTED';
      throw err;
    }
  }

  if (repFM.title !== undefined && changedKeys.includes('title')) {
    if (typeof repFM.title !== 'string' || repFM.title.trim() === '') {
      const err = new Error(`UNALLOWED_DIFF_REJECTED: Invalid title value '${repFM.title}'`);
      err.code = 'UNALLOWED_DIFF_REJECTED';
      throw err;
    }
  }

  return { valid: true, original: origDoc, repaired: repDoc };
}
