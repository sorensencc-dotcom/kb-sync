import crypto from 'node:crypto';
import yaml from 'js-yaml';

export const GAP_ID_REGEX = /^GAP-[0-9]{2,3}(-[A-Z0-9]+)?$/;
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function computeFindingId(gapId, canonicalPayloadSha256) {
  return crypto.createHash('sha256')
    .update(gapId)
    .update(Buffer.from([0x1f]))
    .update(canonicalPayloadSha256)
    .digest('hex');
}

export function normalizePayloadBody(body) {
  return body.replace(/\r\n/g, '\n').trim();
}

export function unwrapCodeFences(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:markdown|yaml)?\r?\n([\s\S]*)\r?\n```$/);
  if (match) return match[1].trim();
  
  const preambleMatch = trimmed.match(/^[^\n]*\r?\n```(?:markdown|yaml)?\r?\n([\s\S]*)\r?\n```$/);
  if (preambleMatch) return preambleMatch[1].trim();

  return trimmed;
}

export function validateFinding(rawContent) {
  const errors = [];
  const unwrapped = unwrapCodeFences(rawContent);

  const fmMatch = unwrapped.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    return { valid: false, errors: ['Missing or malformed YAML frontmatter'], quarantine_reason: 'malformed_frontmatter' };
  }

  let fm = {};
  try {
    fm = yaml.load(fmMatch[1]) || {};
  } catch (err) {
    return { valid: false, errors: [`YAML parse error: ${err.message}`], quarantine_reason: 'yaml_syntax_error' };
  }

  const body = normalizePayloadBody(fmMatch[2]);

  if (!fm.gap_id || !GAP_ID_REGEX.test(fm.gap_id)) {
    errors.push(`Invalid gap_id: '${fm.gap_id}'. Must match ${GAP_ID_REGEX}`);
  }

  if (fm.body_sha256 === EMPTY_SHA256 || fm.payload_sha256 === EMPTY_SHA256) {
    errors.push('Empty-string SHA-256 rejected');
  }

  if (fm.verification_status && fm.verification_status !== 'inferred') {
    errors.push(`Arrival verification_status must be 'inferred', got '${fm.verification_status}'`);
  }

  if (fm.provenance_type && fm.provenance_type !== 'remote_agent_finding') {
    errors.push(`provenance_type must be 'remote_agent_finding', got '${fm.provenance_type}'`);
  }

  const canonical_payload_sha256 = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const finding_id = fm.gap_id ? computeFindingId(fm.gap_id, canonical_payload_sha256) : null;

  return {
    valid: errors.length === 0,
    errors,
    finding_id,
    canonical_payload_sha256,
    frontmatter: fm,
    body,
    unwrapped
  };
}

const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function sanitizeSlug(input) {
  if (!input || typeof input !== 'string') return 'untitled-drop';
  let slug = input.toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  if (!slug || WINDOWS_RESERVED_NAMES.test(slug)) {
    slug = `${slug || 'drop'}-item`;
  }
  return slug;
}

export function validateMobileInboxDrop(rawContent, filename = '') {
  const errors = [];
  const unwrapped = unwrapCodeFences(rawContent);

  const fmMatch = unwrapped.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    return { valid: false, errors: ['Missing or malformed YAML frontmatter'], quarantine_reason: 'malformed_frontmatter' };
  }

  let fm = {};
  try {
    fm = yaml.load(fmMatch[1]) || {};
  } catch (err) {
    return { valid: false, errors: [`YAML parse error: ${err.message}`], quarantine_reason: 'yaml_syntax_error' };
  }

  const body = normalizePayloadBody(fmMatch[2]);

  if (!fm.source || typeof fm.source !== 'string') {
    errors.push("Missing or invalid 'source' in frontmatter");
  }
  if (!fm.skill || typeof fm.skill !== 'string') {
    errors.push("Missing or invalid 'skill' in frontmatter");
  }
  if (fm.status !== 'drop') {
    errors.push(`Expected status 'drop', got '${fm.status}'`);
  }
  if (!fm.topic || typeof fm.topic !== 'string') {
    errors.push("Missing or invalid 'topic' in frontmatter");
  }

  // Parse ISO date
  let date = null;
  if (fm.created) {
    const parsedDate = new Date(fm.created);
    if (!isNaN(parsedDate.getTime())) {
      date = parsedDate.toISOString().slice(0, 10);
    }
  }

  // Fallback date from filename YYYY-MM-DD
  if (!date && filename) {
    const fnDateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    if (fnDateMatch) {
      date = fnDateMatch[1];
    }
  }

  if (!date) {
    errors.push("Unable to determine valid UTC date from 'created' or filename");
  }

  // Determine slug
  let slug = '';
  if (filename) {
    const fnSlugMatch = filename.match(/^\d{4}-\d{2}-\d{2}T[0-9A-Z_-]+?__[a-zA-Z0-9_-]+?__(.+)\.md$/i);
    if (fnSlugMatch) {
      slug = sanitizeSlug(fnSlugMatch[1]);
    }
  }
  if (!slug && fm.title) {
    slug = sanitizeSlug(fm.title);
  }
  if (!slug) {
    slug = 'mobile-research-drop';
  }

  const content_sha256 = crypto.createHash('sha256').update(rawContent, 'utf8').digest('hex');
  const body_sha256 = crypto.createHash('sha256').update(body, 'utf8').digest('hex');

  return {
    valid: errors.length === 0,
    errors,
    quarantine_reason: errors.length > 0 ? 'invalid_schema' : null,
    frontmatter: fm,
    body,
    date,
    slug,
    content_sha256,
    body_sha256,
    unwrapped
  };
}

