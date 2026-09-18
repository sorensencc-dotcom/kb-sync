import fs from 'node:fs';

/**
 * Locates a bash executable to run a .sh script under. spawnSync-ing a .sh
 * file directly works on POSIX (the shebang line is enough) and under Git
 * Bash/WSL, but native Windows has no association for .sh files at all --
 * spawnSync would fail with ENOENT. Mirrors the Git-Bash-candidate-path
 * pattern already established in scripts/notebooklm/kb-sync-nightly.ps1 for
 * this exact problem.
 *
 * Shared by modules/wiki/gated-climb-repair.mjs (incident push, via
 * push-source.sh) and scripts/notebooklm/verify-grounding-gate.mjs
 * (grounding check, via run-nlm-chat.sh) -- both spawn a .sh bridge script
 * and need the same resolution.
 *
 * @returns {string} path or bare command to invoke as `bash <script> <args>`
 */
export function resolveBashExecutable() {
  if (process.platform !== 'win32') {
    return 'bash';
  }
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Git\\bin\\bash.exe` : null,
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe` : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'bash.exe';
}
