import { classifySourceDrift as classifyTs } from "../modules/wiki/detect-drift.ts";
import { classifySourceDrift as classifyJs } from "../modules/wiki/detect-drift.js";

console.log("[TEST] Running: Drift classification...");

const lastSync = new Date("2026-09-29T02:56:27Z");
const before = new Date("2026-09-28T12:00:00Z");
const after = new Date("2026-09-29T17:00:00Z");

function expect(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

for (const [impl, classifySourceDrift] of [["ts", classifyTs], ["js", classifyJs]] as const) {
  // Committed after the last publish, but staging already holds identical content:
  // the pipeline has ingested it, so it is not drift.
  expect(
    `${impl}: staged identical, committed after publish`,
    classifySourceDrift({ commitDate: after, lastSyncDate: lastSync, sourceHash: "a", stagedHash: "a" }),
    null,
  );

  expect(
    `${impl}: staged content differs`,
    classifySourceDrift({ commitDate: before, lastSyncDate: lastSync, sourceHash: "a", stagedHash: "b" }),
    "HASH_MISMATCH",
  );

  expect(
    `${impl}: not staged, committed after publish`,
    classifySourceDrift({ commitDate: after, lastSyncDate: lastSync, sourceHash: "a", stagedHash: null }),
    "STALE",
  );

  expect(
    `${impl}: not staged, committed before publish`,
    classifySourceDrift({ commitDate: before, lastSyncDate: lastSync, sourceHash: "a", stagedHash: null }),
    null,
  );
}

console.log("[PASS] ✓ Drift classification trusts staging hashes over commit dates");
