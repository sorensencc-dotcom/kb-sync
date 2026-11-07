import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * SPUR Content Telemetry v1.0 Schema-Compatible Emitter and Validator
 * Normative reference: SPUR Content Telemetry Specification v1.0
 * 
 * Note: This module implements SPUR v1 schema compatibility for observed content usage
 * within kb-sync. It does not claim SPUR profile compliance or publisher endpoint delivery.
 */

export const SPUR_SCHEMA_VERSION = '1.0';

export const SUPPORTED_EVENT_TYPES = Object.freeze([
  'content_retrieved',
  'content_grounded',
  'content_cited',
  'content_presented',
  'content_engaged'
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function isValidUtcIsoString(str) {
  if (typeof str !== 'string' || !ISO_DATE_REGEX.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

export function isValidUuid(str) {
  return typeof str === 'string' && UUID_REGEX.test(str);
}

/**
 * Validates a single SPUR v1 event document.
 * @param {object} event
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSpurEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { valid: false, errors: ['Event must be a non-null object'] };
  }

  if (!event.type || typeof event.type !== 'string') {
    errors.push("Event 'type' must be a non-empty string");
  } else if (!SUPPORTED_EVENT_TYPES.includes(event.type)) {
    errors.push(`Unsupported or unknown event type '${event.type}'`);
  }

  if (!isValidUtcIsoString(event.timestamp)) {
    errors.push("Event 'timestamp' must be a valid UTC ISO 8601 string");
  }

  const hasContentId = typeof event.content_id === 'string' && event.content_id.trim().length > 0;
  const hasContentUrl = typeof event.content_url === 'string' && event.content_url.trim().length > 0;
  if (!hasContentId && !hasContentUrl) {
    errors.push("Event must include at least one valid 'content_id' or 'content_url'");
  }

  // Preserve license_ref and terms_ref as opaque references when provided
  if (event.license_ref !== undefined && typeof event.license_ref !== 'string') {
    errors.push("'license_ref' must be an opaque string reference when provided");
  }
  if (event.terms_ref !== undefined && typeof event.terms_ref !== 'string') {
    errors.push("'terms_ref' must be an opaque string reference when provided");
  }

  // Type-specific required fields
  switch (event.type) {
    case 'content_retrieved':
      if (!event.source_role || typeof event.source_role !== 'string') {
        errors.push("'content_retrieved' requires non-empty string 'source_role'");
      }
      if (!event.data || typeof event.data !== 'object' || typeof event.data.media_type !== 'string' || !event.data.media_type.trim()) {
        errors.push("'content_retrieved' requires 'data.media_type'");
      }
      break;

    case 'content_grounded':
      if (!event.data || typeof event.data !== 'object') {
        errors.push("'content_grounded' requires 'data' object with 'scope' and boolean 'cached'");
      } else {
        if (!event.data.scope || typeof event.data.scope !== 'string') {
          errors.push("'content_grounded' requires string 'data.scope'");
        }
        if (typeof event.data.cached !== 'boolean') {
          errors.push("'content_grounded' requires boolean 'data.cached'");
        }
      }
      break;

    case 'content_cited':
      if (!event.id || typeof event.id !== 'string') {
        errors.push("'content_cited' requires string 'id'");
      }
      if (!event.output_id || typeof event.output_id !== 'string') {
        errors.push("'content_cited' requires string 'output_id'");
      }
      break;

    case 'content_presented':
      if (!event.id || typeof event.id !== 'string') {
        errors.push("'content_presented' requires string 'id'");
      }
      if (!event.output_id || typeof event.output_id !== 'string') {
        errors.push("'content_presented' requires string 'output_id'");
      }
      if (!event.data || typeof event.data !== 'object') {
        errors.push("'content_presented' requires 'data.presentation_kind' and 'data.presentation_type'");
      } else {
        if (!event.data.presentation_kind || typeof event.data.presentation_kind !== 'string') {
          errors.push("'content_presented' requires 'data.presentation_kind'");
        }
        if (!event.data.presentation_type || typeof event.data.presentation_type !== 'string') {
          errors.push("'content_presented' requires 'data.presentation_type'");
        }
      }
      break;

    case 'content_engaged':
      if (!event.presentation_id || typeof event.presentation_id !== 'string') {
        errors.push("'content_engaged' requires string 'presentation_id'");
      }
      if (!event.data || typeof event.data !== 'object' || !event.data.engagement_type || typeof event.data.engagement_type !== 'string') {
        errors.push("'content_engaged' requires string 'data.engagement_type'");
      }
      break;
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a SPUR v1 session document.
 * @param {object} session
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSpurSession(session) {
  const errors = [];
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return { valid: false, errors: ['Session document must be a non-null object'] };
  }

  if (session.schema_version !== SPUR_SCHEMA_VERSION) {
    errors.push(`Expected schema_version "${SPUR_SCHEMA_VERSION}", got "${session.schema_version}"`);
  }

  if (!isValidUuid(session.session_id)) {
    errors.push("Session 'session_id' must be a valid UUID string");
  }

  if (!isValidUtcIsoString(session.started_at)) {
    errors.push("Session 'started_at' must be a valid UTC ISO 8601 string");
  }

  if (session.ended_at !== undefined && !isValidUtcIsoString(session.ended_at)) {
    errors.push("Session 'ended_at' must be a valid UTC ISO 8601 string when provided");
  }

  if (!Array.isArray(session.events)) {
    errors.push("Session 'events' must be an array");
  } else {
    session.events.forEach((event, index) => {
      const eventRes = validateSpurEvent(event);
      if (!eventRes.valid) {
        errors.push(`Event at index ${index} invalid: ${eventRes.errors.join('; ')}`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * SPUR v1 Telemetry Session Builder and Outbox Emitter
 */
export class SpurTelemetrySession {
  #events = [];
  #clock;
  #idGenerator;
  #sessionId;
  #startedAt;
  #agentId;
  #contentScope;
  #manifestRef;
  #endedAt;
  #conformanceLevel;
  #outboxDir;

  constructor(options = {}) {
    this.#clock = options.clock || (() => new Date().toISOString());
    this.#idGenerator = options.idGenerator || (() => crypto.randomUUID());
    this.#sessionId = options.sessionId || this.#idGenerator();
    this.#startedAt = options.startedAt || this.#clock();
    this.#agentId = options.agentId || null;
    this.#contentScope = options.contentScope || null;
    this.#manifestRef = options.manifestRef || null;
    this.#endedAt = options.endedAt || null;
    this.#conformanceLevel = options.conformanceLevel || null;
    this.#outboxDir = options.outboxDir || process.env.SPUR_TELEMETRY_OUTBOX || '.kb_cache/spur-telemetry';
  }

  get sessionId() {
    return this.#sessionId;
  }

  get startedAt() {
    return this.#startedAt;
  }

  get outboxDir() {
    return this.#outboxDir;
  }

  recordEvent(event) {
    const raw = {
      timestamp: event.timestamp || this.#clock(),
      ...event
    };
    const validation = validateSpurEvent(raw);
    if (!validation.valid) {
      throw new Error(`Cannot record invalid SPUR event: ${validation.errors.join(', ')}`);
    }
    this.#events.push(raw);
    return raw;
  }

  recordRetrieved({ contentId, contentUrl, sourceRole, mediaType, licenseRef, termsRef, metadata = {} }) {
    const event = {
      type: 'content_retrieved',
      source_role: sourceRole,
      data: {
        media_type: mediaType,
        ...metadata
      }
    };
    if (contentId) event.content_id = contentId;
    if (contentUrl) event.content_url = contentUrl;
    if (licenseRef) event.license_ref = licenseRef;
    if (termsRef) event.terms_ref = termsRef;
    return this.recordEvent(event);
  }

  recordGrounded({ contentId, contentUrl, scope, cached, licenseRef, termsRef, metadata = {} }) {
    const event = {
      type: 'content_grounded',
      data: {
        scope,
        cached: Boolean(cached),
        ...metadata
      }
    };
    if (contentId) event.content_id = contentId;
    if (contentUrl) event.content_url = contentUrl;
    if (licenseRef) event.license_ref = licenseRef;
    if (termsRef) event.terms_ref = termsRef;
    return this.recordEvent(event);
  }

  recordCited({ id, outputId, contentId, contentUrl, licenseRef, termsRef, metadata = {} }) {
    const event = {
      type: 'content_cited',
      id: id || this.#idGenerator(),
      output_id: outputId,
      data: { ...metadata }
    };
    if (contentId) event.content_id = contentId;
    if (contentUrl) event.content_url = contentUrl;
    if (licenseRef) event.license_ref = licenseRef;
    if (termsRef) event.terms_ref = termsRef;
    return this.recordEvent(event);
  }

  recordPresented({ id, outputId, presentationKind, presentationType, contentId, contentUrl, licenseRef, termsRef, metadata = {} }) {
    const event = {
      type: 'content_presented',
      id: id || this.#idGenerator(),
      output_id: outputId,
      data: {
        presentation_kind: presentationKind,
        presentation_type: presentationType,
        ...metadata
      }
    };
    if (contentId) event.content_id = contentId;
    if (contentUrl) event.content_url = contentUrl;
    if (licenseRef) event.license_ref = licenseRef;
    if (termsRef) event.terms_ref = termsRef;
    return this.recordEvent(event);
  }

  recordEngaged({ presentationId, engagementType, contentId, contentUrl, licenseRef, termsRef, metadata = {} }) {
    const event = {
      type: 'content_engaged',
      presentation_id: presentationId,
      data: {
        engagement_type: engagementType,
        ...metadata
      }
    };
    if (contentId) event.content_id = contentId;
    if (contentUrl) event.content_url = contentUrl;
    if (licenseRef) event.license_ref = licenseRef;
    if (termsRef) event.terms_ref = termsRef;
    return this.recordEvent(event);
  }

  end(endedAt = null) {
    this.#endedAt = endedAt || this.#clock();
    return this;
  }

  toJSON() {
    const doc = {
      schema_version: SPUR_SCHEMA_VERSION,
      session_id: this.#sessionId,
      started_at: this.#startedAt,
      events: [...this.#events]
    };
    if (this.#agentId) doc.agent_id = this.#agentId;
    if (this.#contentScope) doc.content_scope = this.#contentScope;
    if (this.#manifestRef) doc.manifest_ref = this.#manifestRef;
    if (this.#endedAt) doc.ended_at = this.#endedAt;
    if (this.#conformanceLevel) doc.conformance_level = this.#conformanceLevel;
    return doc;
  }

  /**
   * Writes the validated session document to the outbox sidecar.
   * Never mutates Markdown or text packs.
   * @param {{ outboxDir?: string, filename?: string }} [options]
   * @returns {string} Written file path
   */
  flush(options = {}) {
    const targetDir = options.outboxDir || this.#outboxDir;
    fs.mkdirSync(targetDir, { recursive: true });

    const doc = this.toJSON();
    const validation = validateSpurSession(doc);
    if (!validation.valid) {
      throw new Error(`Cannot flush invalid SPUR session: ${validation.errors.join('; ')}`);
    }

    const filename = options.filename || `session-${this.#sessionId}.json`;
    const targetPath = path.join(targetDir, filename);
    fs.writeFileSync(targetPath, JSON.stringify(doc, null, 2), 'utf8');
    return targetPath;
  }
}

/**
 * Audits a directory containing SPUR telemetry session sidecars.
 * Sanitizes output: never prints query text, document contents, credentials, or personal data.
 * @param {string} outboxDir
 * @returns {{ documentCount: number, eventCountByType: Record<string, number>, invalidDocuments: Array<{ file: string, errors: string[] }>, missingContentIdEvents: number, valid: boolean }}
 */
export function auditSpurTelemetryDirectory(outboxDir) {
  const result = {
    documentCount: 0,
    eventCountByType: {
      content_retrieved: 0,
      content_grounded: 0,
      content_cited: 0,
      content_presented: 0,
      content_engaged: 0
    },
    invalidDocuments: [],
    missingContentIdEvents: 0,
    valid: true
  };

  if (!fs.existsSync(outboxDir)) {
    return result;
  }

  const entries = fs.readdirSync(outboxDir).filter(f => f.endsWith('.json'));
  for (const entry of entries) {
    const filePath = path.join(outboxDir, entry);
    let parsed;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      result.documentCount++;
      result.invalidDocuments.push({
        file: entry,
        errors: [`JSON parse failure: ${parseErr.message}`]
      });
      result.valid = false;
      continue;
    }

    result.documentCount++;
    const sessionRes = validateSpurSession(parsed);
    if (!sessionRes.valid) {
      result.invalidDocuments.push({
        file: entry,
        errors: sessionRes.errors
      });
      result.valid = false;
    }

    if (Array.isArray(parsed?.events)) {
      for (const ev of parsed.events) {
        if (ev && typeof ev === 'object') {
          if (result.eventCountByType[ev.type] !== undefined) {
            result.eventCountByType[ev.type]++;
          }
          if (!ev.content_id && !ev.content_url) {
            result.missingContentIdEvents++;
          }
        }
      }
    }
  }

  if (result.invalidDocuments.length > 0) {
    result.valid = false;
  }

  return result;
}
