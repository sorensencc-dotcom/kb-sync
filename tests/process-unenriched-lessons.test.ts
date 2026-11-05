import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { processUnenrichedLessons } from "../modules/obsidian/synthesize-wiki.js";

describe("processUnenrichedLessons", () => {
  let tmpDir: string;
  let lessonsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-test-"));
    lessonsDir = path.join(tmpDir, "lessons");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array if lessons directory does not exist", async () => {
    const result = await processUnenrichedLessons(tmpDir, {} as any, "lessons");
    expect(result).toEqual([]);
  });

  it("returns empty array if lessons directory exists but is empty", async () => {
    fs.mkdirSync(lessonsDir, { recursive: true });
    const result = await processUnenrichedLessons(tmpDir, {} as any, "lessons");
    expect(result).toEqual([]);
  });

  it("returns empty array if lessons directory has no markdown files", async () => {
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(path.join(lessonsDir, "test.txt"), "hello", "utf-8");

    const result = await processUnenrichedLessons(tmpDir, {} as any, "lessons");
    expect(result).toEqual([]);
  });

  it("skips files without needs-enrichment tag", async () => {
    fs.mkdirSync(lessonsDir, { recursive: true });
    const fileContent = `---
title: "No Tag"
tags: ["other"]
---
Content
`;
    fs.writeFileSync(path.join(lessonsDir, "no-tag.md"), fileContent, "utf-8");

    const provider: any = {
      name: "test-provider",
      enrichLesson: async () => { throw new Error("Should not be called"); }
    };

    const result = await processUnenrichedLessons(tmpDir, provider, "lessons");
    expect(result).toEqual([]);
    expect(fs.readFileSync(path.join(lessonsDir, "no-tag.md"), "utf-8")).toBe(fileContent);
  });

  it("skips files with needs-enrichment tag but provider missing enrichLesson function", async () => {
    fs.mkdirSync(lessonsDir, { recursive: true });
    const fileContent = `---
title: "Has Tag"
tags: ["needs-enrichment"]
---
Content
`;
    fs.writeFileSync(path.join(lessonsDir, "has-tag.md"), fileContent, "utf-8");

    const provider: any = { name: "test-provider" }; // Missing enrichLesson

    const result = await processUnenrichedLessons(tmpDir, provider, "lessons");
    expect(result).toEqual([]);
    expect(fs.readFileSync(path.join(lessonsDir, "has-tag.md"), "utf-8")).toBe(fileContent);
  });

  it("preserves file when enrichLesson throws an error (fail-soft)", async () => {
    fs.mkdirSync(lessonsDir, { recursive: true });
    const fileContent = `---
title: "Has Tag"
tags: ["needs-enrichment"]
---
Content
`;
    fs.writeFileSync(path.join(lessonsDir, "error-tag.md"), fileContent, "utf-8");

    const provider: any = {
      name: "error-provider",
      enrichLesson: async () => { throw new Error("Provider error"); }
    };

    const result = await processUnenrichedLessons(tmpDir, provider, "lessons");
    expect(result).toEqual([]);
    expect(fs.readFileSync(path.join(lessonsDir, "error-tag.md"), "utf-8")).toBe(fileContent);
  });

  it("preserves file when enrichLesson returns null", async () => {
    fs.mkdirSync(lessonsDir, { recursive: true });
    const fileContent = `---
title: "Has Tag"
tags: ["needs-enrichment"]
---
Content
`;
    fs.writeFileSync(path.join(lessonsDir, "null-tag.md"), fileContent, "utf-8");

    const provider: any = {
      name: "null-provider",
      enrichLesson: async () => null
    };

    const result = await processUnenrichedLessons(tmpDir, provider, "lessons");
    expect(result).toEqual([]);
    expect(fs.readFileSync(path.join(lessonsDir, "null-tag.md"), "utf-8")).toBe(fileContent);
  });

  it("successfully enriches a valid lesson file", async () => {
    fs.mkdirSync(lessonsDir, { recursive: true });
    const fileContent = `---
title: "Test Lesson"
category: "lessons"
status: "active"
tags: ["needs-enrichment", "failure-pattern"]
---

#### 1. Context & Symptom
Symptom

#### 2. Root Cause Analysis
Pending

#### 3. Resolution & Prevention
Pending

#### 4. Source Citations
Citation
`;
    fs.writeFileSync(path.join(lessonsDir, "valid-lesson.md"), fileContent, "utf-8");

    const provider: any = {
      name: "valid-provider",
      enrichLesson: async () => ({
        rootCause: "A valid root cause.",
        prevention: "A valid prevention step."
      })
    };

    const result = await processUnenrichedLessons(tmpDir, provider, "lessons");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("lessons/valid-lesson.md");

    const newContent = fs.readFileSync(path.join(lessonsDir, "valid-lesson.md"), "utf-8");
    expect(newContent).not.toContain("needs-enrichment");
    expect(newContent).toContain("A valid root cause.");
    expect(newContent).toContain("A valid prevention step.");
  });

  it("does not overwrite file if enriched content fails schema validation", async () => {
    fs.mkdirSync(lessonsDir, { recursive: true });
    const fileContent = `---
title: "Test Lesson"
category: "lessons"
status: "active"
tags: ["needs-enrichment"]
---

# No proper headings
`;
    fs.writeFileSync(path.join(lessonsDir, "invalid-schema.md"), fileContent, "utf-8");

    const provider: any = {
      name: "valid-provider",
      enrichLesson: async () => ({
        rootCause: "A valid root cause.",
        prevention: "A valid prevention step."
      })
    };

    const result = await processUnenrichedLessons(tmpDir, provider, "lessons");
    expect(result).toEqual([]);

    expect(fs.readFileSync(path.join(lessonsDir, "invalid-schema.md"), "utf-8")).toBe(fileContent);
  });
});
