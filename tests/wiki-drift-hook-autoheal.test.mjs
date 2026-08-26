import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const installerPath = path.join(repoRoot, "scripts", "install-git-hooks.mjs");
const installerSource = fs.readFileSync(installerPath, "utf8");

test("git hook installer wires documentation drift hooks for checkout and merge", () => {
  assert.match(installerSource, /post-checkout/);
  assert.match(installerSource, /post-merge/);
  assert.match(installerSource, /LOCAL DOCUMENTATION DRIFT DETECTED/);
});

test("documentation drift hook autoheals with offline provider and does not invoke cloud auto", () => {
  assert.match(installerSource, /--provider offline-template/);
  assert.doesNotMatch(installerSource, /npm run wiki:ingest:obsidian/);
  assert.doesNotMatch(installerSource, /wiki:ingest:obsidian:auto/);
  assert.doesNotMatch(installerSource, /--provider anthropic/);
});


test("shell stale-count interpolation is escaped for installer runtime", () => {
  assert.match(installerSource, /Found \\[$][{]STALE_COUNT[}]/);
});


test("documentation drift hook refreshes staging before offline synthesis", () => {
  const staging = installerSource.indexOf("modules/obsidian/ingest-obsidian.sh --incremental");
  const synthesis = installerSource.indexOf("modules/obsidian/ingest-wiki.sh --provider offline-template");
  assert.notEqual(staging, -1);
  assert.notEqual(synthesis, -1);
  assert.ok(staging < synthesis);
});
