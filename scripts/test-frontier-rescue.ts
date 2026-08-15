import fs from "fs";
import path from "path";
import { enrichPendingLessons } from "../modules/obsidian/synthesize-wiki.js";
import { AnthropicProvider } from "../modules/obsidian/providers/index.js";

async function runFrontierRescueTest() {
  // Using active vault root 
  const vaultRoot = path.resolve(process.cwd(), "obsidian/vault"); 
  const lessonsDir = path.join(vaultRoot, "wiki", "lessons");

  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }

  const mockFilePath = path.join(lessonsDir, "test-timeout-failure.md");

  // 1. Generate the mock quarantined lesson matching the schema
  const mockContent = `---
title: "Local Agent Timeout Failure"
category: "lessons"
status: "active"
tags: ["failure-pattern", "remediation", "pipeline", "needs-enrichment"]
---

### Local Agent Timeout Failure

#### 1. Context & Symptom
* **Target Subsystem / File:** [[kb-sync/wiki/validate-contract]]
* **Error Signature / Output:** \`TRIPWIRE_WALL_CLOCK_TIMEOUT: Elapsed execution time 900s exceeded limit 900s\`
* **First Identified:** 2026-08-15 via Log entry [[kb-sync/wiki/Log]]

#### 2. Root Cause Analysis
Pending.

#### 3. Resolution & Prevention
Pending.

#### 4. Source Citations
* **Staged Snapshot:** \`_quarantine/climb-test-timeout\`
* **Diagnostic Reference:** [[kb-sync/wiki/concepts/deterministic-sync-pipeline]]
`;

  // 2. Write the failure state to disk
  fs.writeFileSync(mockFilePath, mockContent, "utf8");
  console.log(`[Test] 🛑 Mock quarantine lesson written to: ${mockFilePath}`);

  // 3. Boot the Frontier Tier and run the rescue
  console.log("[Test] 🚀 Booting Frontier Tier (Claude) for Rescue Analysis...");
  const frontierProvider = new AnthropicProvider(); 
  
  await enrichPendingLessons(vaultRoot, frontierProvider);

  // 4. Verify results
  const enrichedContent = fs.readFileSync(mockFilePath, "utf8");
  if (!enrichedContent.includes("needs-enrichment") && !enrichedContent.includes("Pending.")) {
    console.log("[Test] ✅ SUCCESS: Frontier model analyzed the failure, updated the root cause, and stripped the enrichment tag!");
  } else {
    console.log("[Test] ⚠️ WARNING: Rescue did not complete as expected.");
  }
}

runFrontierRescueTest().catch(console.error);
