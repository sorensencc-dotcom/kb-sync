import { describe, it, expect } from "vitest";
import { enrichLessonNode } from "../modules/obsidian/synthesize-wiki.js";

describe("enrichLessonNode", () => {
  it("preserves Section 1 and Section 4 byte-for-byte via case-insensitive heading matcher, updates Section 2 and 3, and strips needs-enrichment", async () => {
    const initialContent = `---
title: "Unallowed Diff Failure - Run test-999"
category: "lessons"
status: "active"
tags: ["failure-pattern", "remediation", "pipeline", "needs-enrichment"]
---

### Unallowed Diff Failure - Run test-999

#### 1. Context & Symptom
* **Target Subsystem / File:** [[kb-sync/wiki/Test]]
* **Error Signature / Output:** \`UNALLOWED_DIFF_REJECTED\`

#### 2. Root Cause Analysis
Pending analysis.

#### 3. Resolution & Prevention
Pending resolution.

#### 4. Source Citations
* **Staged Snapshot:** \`_quarantine/test-999\`
`;

    const enriched = await enrichLessonNode(initialContent, {
      rootCause: "Path normalization mismatch on Windows causing diff rejection.",
      prevention: "Apply normalizePath before evaluating diff guard boundaries.",
    });

    expect(enriched).not.toContain("needs-enrichment");
    expect(enriched).toContain('tags: ["failure-pattern", "remediation", "pipeline"]');
    expect(enriched).toContain("#### 1. Context & Symptom\n* **Target Subsystem / File:** [[kb-sync/wiki/Test]]");
    expect(enriched).toContain("Path normalization mismatch on Windows");
    expect(enriched).toContain("Apply normalizePath before evaluating diff guard boundaries");
    expect(enriched).toContain("#### 4. Source Citations\n* **Staged Snapshot:** `_quarantine/test-999`\n");
  });

  it("handles case-insensitive section headings", async () => {
    const initialContent = `---
title: "Case Insensitive Test"
category: "lessons"
status: "active"
tags: ["failure-pattern", "needs-enrichment"]
---

### Case Insensitive Test

#### 1. Context & Symptom
* **Target Subsystem / File:** [[kb-sync/wiki/Test]]

#### 2. root cause analysis
Old root cause.

#### 3. resolution & prevention
Old resolution.

#### 4. source citations
* **Staged Snapshot:** \`_quarantine/test-100\`
`;

    const enriched = await enrichLessonNode(initialContent, {
      rootCause: "Case-insensitive root cause.",
      prevention: "Case-insensitive prevention.",
    });

    expect(enriched).not.toContain("needs-enrichment");
    expect(enriched).toContain("Case-insensitive root cause.");
    expect(enriched).toContain("Case-insensitive prevention.");
    expect(enriched).toContain("#### 4. source citations");
  });

  it("rejects payloads exceeding 10,000 characters or missing required fields (fail-soft)", async () => {
    const initialContent = `---
title: "Fail Soft Test"
category: "lessons"
status: "active"
tags: ["failure-pattern", "needs-enrichment"]
---

#### 1. Context & Symptom
Symptom data

#### 2. Root Cause Analysis
Pending.

#### 3. Resolution & Prevention
Pending.

#### 4. Source Citations
Citations
`;

    // 1. Missing fields -> returns original content unchanged
    const res1 = await enrichLessonNode(initialContent, null as any);
    expect(res1).toBe(initialContent);

    const res2 = await enrichLessonNode(initialContent, { rootCause: "", prevention: "Valid" });
    expect(res2).toBe(initialContent);

    const res3 = await enrichLessonNode(initialContent, { rootCause: "Valid", prevention: "" });
    expect(res3).toBe(initialContent);

    // 2. Exceeding 10,000 characters -> returns original content unchanged
    const hugePayload = {
      rootCause: "A".repeat(6000),
      prevention: "B".repeat(5000),
    };
    const res4 = await enrichLessonNode(initialContent, hugePayload);
    expect(res4).toBe(initialContent);
  });
});
