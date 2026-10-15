import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import os from "node:os";
import { spawnSync } from "node:child_process";

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

test("documentation drift hook prints ingest stderr tail on failure", () => {
  assert.match(installerSource, /tail -n 20/);
  assert.match(installerSource, /INGEST_LOG/);
});

test("obsidian ingest accepts git worktrees (.git file, not directory)", () => {
  const ingest = fs.readFileSync(
    path.join(repoRoot, "modules/obsidian/ingest-obsidian.sh"),
    "utf8"
  );
  assert.match(ingest, /rev-parse --is-inside-work-tree/);
  assert.doesNotMatch(ingest, /! -d "\$REPO_ROOT\/\.git"/);
});

test("generated hook retains complete synthesis failure log without failing commit", (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hook-log-test-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  fs.mkdirSync(path.join(scratch, "scripts"));
  fs.mkdirSync(path.join(scratch, "modules/wiki"), { recursive: true });
  fs.writeFileSync(path.join(scratch, "modules/wiki/detect-drift.ts"), "");
  fs.writeFileSync(path.join(scratch, ".drift-report.json"), JSON.stringify({ status: "DRIFT_DETECTED", summary: { stale_pages_count: 1 } }));
  fs.copyFileSync(installerPath, path.join(scratch, "scripts/install-git-hooks.mjs"));
  for (const [exe, args] of [["git", ["init", "--quiet"]], [process.execPath, ["scripts/install-git-hooks.mjs"]]]) {
    const result = spawnSync(exe, args, { cwd: scratch, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  }
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  const result = spawnSync(bash, ["--noprofile", "--norc", "-c", `
    npx() { return 0; }
    node() { case "$*" in *summary*) echo 1;; *) echo DRIFT_DETECTED;; esac; }
    bash() {
      case "$*" in *ingest-wiki*)
        echo 'offending-note.md: unsupported status resolved'
        for ((i=0; i<25; i++)); do echo 'trailing diagnostic'; done
        return 1;;
        *) return 0;;
      esac
    }
    source .git/hooks/post-commit
  `], { cwd: scratch, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.match(result.stderr, /Full failure log retained:/);
  const logsDir = path.join(scratch, ".git/kb-sync-hook-logs");
  const logs = fs.readdirSync(logsDir);
  assert.equal(logs.length, 1);
  assert.match(fs.readFileSync(path.join(logsDir, logs[0]), "utf8"), /offending-note.md: unsupported status resolved/);
});

test("installer updates effective shared hooks when invoked from linked worktree", (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hook-worktree-test-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const main = path.join(scratch, "main");
  const linked = path.join(scratch, "linked");
  fs.mkdirSync(main);
  for (const args of [["init", "--quiet"], ["-c", "user.name=Hook test", "-c", "user.email=hook@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "fixture"], ["worktree", "add", "--quiet", "-b", "linked", linked]]) {
    const result = spawnSync("git", args, { cwd: main, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  }
  fs.mkdirSync(path.join(linked, "scripts"));
  fs.copyFileSync(installerPath, path.join(linked, "scripts/install-git-hooks.mjs"));
  const result = spawnSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: linked, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(main, ".git/hooks/post-commit"), "utf8"), /Full failure log retained/);
  assert.equal(fs.existsSync(path.join(main, ".git/worktrees/linked/hooks")), false);
});
