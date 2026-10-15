import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const repoRoot = process.cwd();
const bashCandidates = process.platform === "win32"
  ? [
      "C:/Users/soren/AppData/Local/Programs/Git/bin/bash.exe",
      "C:/Program Files/Git/bin/bash.exe",
      "C:/Users/soren/AppData/Local/Programs/Git/usr/bin/bash.exe",
      "C:/Program Files/Git/usr/bin/bash.exe",
    ]
  : ["bash"];
const bash = process.platform === "win32"
  ? bashCandidates.find((candidate) => existsSync(candidate))
  : bashCandidates[0];

if (!bash) {
  console.error("Git Bash executable not found; install Git for Windows.");
  process.exit(1);
}

for (const script of ["tests/notebooklm-submodule-guard.test.sh", "tests/notebooklm-polling.test.sh"]) {
  const result = spawnSync(bash, [join(repoRoot, script)], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
