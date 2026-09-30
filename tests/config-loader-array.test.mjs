import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfigValue } from "../core/config-loader.mjs";

console.log("[TEST] Running: config-loader array parsing...");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "config-loader-"));
const file = path.join(dir, "cfg.yaml");
fs.writeFileSync(
  file,
  [
    "skip_patterns:",
    "  - package-lock.json",
    '  - "*_kb-sync-staging/*"',
    "  # a comment",
    "  - \"*.ijfw/*\"  # trailing comment",
    "other: value",
    "",
  ].join("\n"),
);

const actual = readConfigValue(file, "skip_patterns", true);
const expected = ["package-lock.json", "*_kb-sync-staging/*", "*.ijfw/*"];
fs.rmSync(dir, { recursive: true, force: true });

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log("[PASS] ✓ config-loader keeps hyphens inside array values");
