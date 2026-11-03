import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { enrichPendingLessons } from "../modules/obsidian/synthesize-wiki.ts";

test("enrichPendingLessons", async (t) => {
  const validContent = `---
title: "Test Lesson"
category: "lessons"
status: "active"
tags: ["failure-pattern", "needs-enrichment"]
---

#### 1. Context & Symptom
Context.

#### 2. Root Cause Analysis
Pending.

#### 3. Resolution & Prevention
Pending.

#### 4. Source Citations
Citations.
`;

  const validEnrichedContent = `---
title: "Test Lesson"
category: "lessons"
status: "active"
tags: ["failure-pattern"]
---

#### 1. Context & Symptom
Context.

#### 2. Root Cause Analysis
Analyzed root cause.

#### 3. Resolution & Prevention
Analyzed resolution.

#### 4. Source Citations
Citations.
`;

  await t.test("updates files with needs-enrichment and ignores others", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-test-"));
    const vaultRoot = path.join(tmpDir, "vault");
    const lessonsDir = path.join(vaultRoot, "wiki", "lessons");
    fs.mkdirSync(lessonsDir, { recursive: true });

    const fileToEnrich = path.join(lessonsDir, "enrich-me.md");
    fs.writeFileSync(fileToEnrich, validContent, "utf-8");

    const fileToIgnore = path.join(lessonsDir, "ignore-me.md");
    const contentToIgnore = validContent.replace("needs-enrichment", "other-tag");
    fs.writeFileSync(fileToIgnore, contentToIgnore, "utf-8");

    let providerCalled = 0;
    const mockProvider = {
      generate: async (prompt) => {
        providerCalled++;
        return validEnrichedContent;
      }
    };

    await enrichPendingLessons(vaultRoot, mockProvider);

    assert.equal(providerCalled, 1, "Provider should be called exactly once");

    const afterEnrich = fs.readFileSync(fileToEnrich, "utf-8");
    assert.equal(afterEnrich, validEnrichedContent);

    const afterIgnore = fs.readFileSync(fileToIgnore, "utf-8");
    assert.equal(afterIgnore, contentToIgnore);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("does not update file if schema validation fails", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-test-"));
    const vaultRoot = path.join(tmpDir, "vault");
    const lessonsDir = path.join(vaultRoot, "wiki", "lessons");
    fs.mkdirSync(lessonsDir, { recursive: true });

    const fileToEnrich = path.join(lessonsDir, "enrich-me.md");
    fs.writeFileSync(fileToEnrich, validContent, "utf-8");

    const mockProvider = {
      generate: async (prompt) => {
        return "Invalid content!";
      }
    };

    await enrichPendingLessons(vaultRoot, mockProvider);

    const afterEnrich = fs.readFileSync(fileToEnrich, "utf-8");
    assert.equal(afterEnrich, validContent, "Content should not be updated if schema validation fails");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("does not update file if provider throws error", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-test-"));
    const vaultRoot = path.join(tmpDir, "vault");
    const lessonsDir = path.join(vaultRoot, "wiki", "lessons");
    fs.mkdirSync(lessonsDir, { recursive: true });

    const fileToEnrich = path.join(lessonsDir, "enrich-me.md");
    fs.writeFileSync(fileToEnrich, validContent, "utf-8");

    const mockProvider = {
      generate: async (prompt) => {
        throw new Error("Provider API connection refused");
      }
    };

    await enrichPendingLessons(vaultRoot, mockProvider);

    const afterEnrich = fs.readFileSync(fileToEnrich, "utf-8");
    assert.equal(afterEnrich, validContent, "Content should not be updated if provider fails");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
