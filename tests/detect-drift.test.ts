import test from "node:test";
import assert from "node:assert/strict";
import { validateIsoUtcTimestamp } from "../modules/wiki/detect-drift.ts";

test("validateIsoUtcTimestamp validates timestamps correctly", async (t) => {
  await t.test("rejects invalid types and empty strings", () => {
    assert.equal(validateIsoUtcTimestamp(""), false);
    // @ts-ignore - testing invalid inputs
    assert.equal(validateIsoUtcTimestamp(null), false);
    // @ts-ignore
    assert.equal(validateIsoUtcTimestamp(undefined), false);
    // @ts-ignore
    assert.equal(validateIsoUtcTimestamp(123), false);
    // @ts-ignore
    assert.equal(validateIsoUtcTimestamp({}), false);
  });

  await t.test("rejects unparseable date strings", () => {
    assert.equal(validateIsoUtcTimestamp("not-a-date"), false);
    assert.equal(validateIsoUtcTimestamp("2023-13-45T25:99:99Z"), false);
  });

  await t.test("accepts valid past and current timestamps", () => {
    const now = new Date().toISOString();
    assert.equal(validateIsoUtcTimestamp(now), true);

    const past = new Date(Date.now() - 100000).toISOString();
    assert.equal(validateIsoUtcTimestamp(past), true);
  });

  await t.test("handles future timestamps based on maxSkewMs", () => {
    const futureWithinSkew = new Date(Date.now() + 30000).toISOString();
    assert.equal(validateIsoUtcTimestamp(futureWithinSkew, 60000), true);

    const futureExceedingSkew = new Date(Date.now() + 90000).toISOString();
    assert.equal(validateIsoUtcTimestamp(futureExceedingSkew, 60000), false);
  });
});
