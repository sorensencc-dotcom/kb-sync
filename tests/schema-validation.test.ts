import { test, expect } from 'vitest';
import { resolveCanonicalVaultPath, validateLessonSchema, ALLOWED_CATEGORIES } from '../modules/wiki/validate-contract.mjs';

test('resolveCanonicalVaultPath returns canonical vaultPath and wikiLink', () => {
  const result = resolveCanonicalVaultPath('kb-sync/lessons/unallowed-diff-run1-a1b2c3d4.md');
  expect(result.vaultPath).toBe('lessons/unallowed-diff-run1-a1b2c3d4.md');
  expect(result.wikiLink).toBe('[[kb-sync/lessons/unallowed-diff-run1-a1b2c3d4]]');
});

test('validateLessonSchema checks required frontmatter and headings', () => {
  const validLesson = `---
title: "Unallowed Diff Failure - Run test-1"
category: "lessons"
status: "active"
tags: ["failure-pattern", "remediation", "pipeline"]
---

### Unallowed Diff Failure - Run test-1

#### 1. Context & Symptom
* **Target Subsystem / File:** [[kb-sync/wiki/Test]]

#### 2. Root Cause Analysis
Test cause

#### 3. Resolution & Prevention
Test prevention

#### 4. Source Citations
* **Staged Snapshot:** \`_quarantine/test-1\`
`;

  const errors = validateLessonSchema(validLesson, 'lessons/unallowed-diff-test-1.md');
  expect(errors).toHaveLength(0);
});

test('ALLOWED_CATEGORIES contains lessons', () => {
  expect(ALLOWED_CATEGORIES.has('lessons')).toBe(true);
});
