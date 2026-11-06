#!/usr/bin/env node
import path from 'node:path';
import { auditSpurTelemetryDirectory } from '../modules/telemetry/spur-content-telemetry.mjs';

const args = process.argv.slice(2);
const outboxDir = args[0] || process.env.SPUR_TELEMETRY_OUTBOX || path.resolve('.kb_cache/spur-telemetry');

console.log(`[SPUR-AUDIT] Auditing telemetry outbox: ${outboxDir}`);
const report = auditSpurTelemetryDirectory(outboxDir);

console.log(`[SPUR-AUDIT] Documents Scanned: ${report.documentCount}`);
console.log(`[SPUR-AUDIT] Events By Type:`);
for (const [type, count] of Object.entries(report.eventCountByType)) {
  console.log(`  - ${type}: ${count}`);
}

if (report.missingContentIdEvents > 0) {
  console.log(`[SPUR-AUDIT] ⚠️ Events missing content identifier: ${report.missingContentIdEvents}`);
}

if (!report.valid) {
  console.error(`[SPUR-AUDIT] ❌ Audit failed with ${report.invalidDocuments.length} invalid document(s):`);
  for (const inv of report.invalidDocuments) {
    console.error(`  - File: ${inv.file}`);
    for (const err of inv.errors) {
      console.error(`    • ${err}`);
    }
  }
  process.exit(1);
}

console.log(`[SPUR-AUDIT] ✓ All ${report.documentCount} document(s) conform to SPUR v1 schema.`);
process.exit(0);
