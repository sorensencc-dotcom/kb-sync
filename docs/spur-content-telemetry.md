# SPUR Content Telemetry v1.0 emitter

## 1. Overview and purpose

`modules/telemetry/spur-content-telemetry.mjs` provides a SPUR Content Telemetry Specification v1.0 schema-compatible session document emitter and audit validator for `kb-sync`.

The emitter observes actual content operations across cache retrieval, topic grounding, and RFC evidence citation. If an operation does not observe a real content event, no telemetry event is generated. Telemetry documents are never appended to Markdown or text knowledge packs and do not impact the 380 KiB pack byte limit.

## 2. Schema compatibility vs SPUR profile compliance

This implementation is strictly a **SPUR v1 schema-compatible emitter**:
- It produces session documents conforming to the SPUR Content Telemetry Specification v1.0 document format.
- It validates required fields, UUID session identifiers, UTC ISO 8601 timestamps, and content identifiers (`content_id` or `content_url`).
- It preserves upstream `license_ref` and `terms_ref` as opaque reference strings without inventing licensing categories.

This implementation does **not** claim **SPUR profile compliance**:
- Publisher endpoint delivery, mutual authentication, retry queues, and compliance audits defined by the SPUR publisher profile remain out of scope.
- Compliance status is only claimed when transport and delivery profile requirements are implemented.

## 3. Supported event types

The emitter records five event types when observed at pipeline boundaries:

1. `content_retrieved`:
   - Triggered when content is retrieved from cache or vault storage.
   - Requires `source_role` (for example, `'cache'` or `'vault'`) and `data.media_type` (such as `'text/markdown'`).
2. `content_grounded`:
   - Triggered when retrieved content is bound into a reasoning or research context.
   - Requires `data.scope` (the category or topic key) and boolean `data.cached`.
3. `content_cited`:
   - Triggered when grounded content is cited in an output artifact (such as an RFC or finding note).
   - Requires `id`, `output_id`, and a content identifier.
4. `content_presented`:
   - Triggered when cited content is rendered to an end user interface.
   - Requires `id`, `output_id`, `data.presentation_kind`, and `data.presentation_type`.
5. `content_engaged`:
   - Triggered when a user interacts with presented content.
   - Requires `presentation_id` and `data.engagement_type`.

## 4. Configurable output paths

Telemetry documents are written as sidecar JSON files named `session-${sessionId}.json`.

- Default outbox path: `.kb_cache/spur-telemetry/`
- Environment override: Set `SPUR_TELEMETRY_OUTBOX=/path/to/outbox`
- Programmatic override: Pass `outboxDir` to `SpurTelemetrySession` constructor or `flush({ outboxDir })`.

## 5. Audit commands

To audit generated telemetry sidecars without leaking credentials, query strings, or personal data:

```bash
npm run audit:spur
```

To run telemetry test suites:

```bash
npm run test:telemetry
```
