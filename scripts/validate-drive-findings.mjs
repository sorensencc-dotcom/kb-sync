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
