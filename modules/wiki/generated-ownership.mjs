/**
 * Generated-output ownership records and flat-name policy.
 *
 * Shared by the entity synthesizer, the fleet wiki reconciler, the GitHub wiki
 * publisher and the pipeline runner so that every stage agrees on:
 *   1. which files a generator OWNS (and may therefore remove when their source
 *      disappears), and
 *   2. which flat (basename-only) copies are unambiguous enough to publish.
 *
 * Invariant: a file is only ever removed when (a) a manifest recorded this
 * generator wrote it and (b) its current content still hashes to what was
 * recorded. Anything else (human-authored, hand-edited, unknown) is preserved.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const OWNERSHIP_MANIFEST_VERSION = 1;
/** Written inside a published wiki checkout; records files the publisher wrote. */
export const PUBLISH_MANIFEST_NAME = '.kb-sync-published-manifest.json';
/** Written inside a generated wiki dir; records entity pages the synthesizer wrote. */
export const GENERATED_MANIFEST_NAME = '.generated-manifest.json';

export function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256File(filePath) {
  try {
    return sha256Buffer(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

/** Atomic JSON write: temp file in the same directory, then rename. */
export function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Read an ownership manifest. Returns null when absent or unreadable/corrupt.
 * A null manifest means "ownership unknown": callers must not delete anything.
 */
export function readOwnershipManifest(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.files !== 'object' || parsed.files === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function resolveInside(baseDir, rel) {
  const base = path.resolve(baseDir);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

/**
 * Decide which previously-owned files should be removed.
 *
 * @param {{ baseDir: string, previous: {files: Record<string,{sha256:string}>} | null, keep: Set<string> }} args
 * @returns {{ remove: string[], preservedModified: string[], alreadyGone: string[], unsafe: string[], ownershipKnown: boolean }}
 */
export function planOwnedRemovals({ baseDir, previous, keep }) {
  const plan = { remove: [], preservedModified: [], alreadyGone: [], unsafe: [], ownershipKnown: !!previous };
  if (!previous) return plan;
  for (const [rel, record] of Object.entries(previous.files)) {
    if (keep.has(rel)) continue;
    const abs = resolveInside(baseDir, rel);
    if (!abs) {
      plan.unsafe.push(rel);
      continue;
    }
    if (!fs.existsSync(abs)) {
      plan.alreadyGone.push(rel);
      continue;
    }
    const current = sha256File(abs);
    if (current && record && record.sha256 === current) plan.remove.push(rel);
    else plan.preservedModified.push(rel);
  }
  return plan;
}

/** Apply removals from planOwnedRemovals and prune now-empty parent directories. */
export function applyOwnedRemovals(baseDir, plan, { dryRun = false } = {}) {
  if (dryRun) return plan.remove.length;
  let removed = 0;
  const base = path.resolve(baseDir);
  for (const rel of plan.remove) {
    const abs = resolveInside(baseDir, rel);
    if (!abs) continue;
    try {
      fs.rmSync(abs, { force: true });
      removed += 1;
      let dir = path.dirname(abs);
      while (dir !== base && dir.startsWith(base + path.sep)) {
        if (fs.readdirSync(dir).length > 0) break;
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      }
    } catch {
      /* best effort: a locked file is simply left in place */
    }
  }
  return removed;
}

/**
 * Flat-copy policy. GitHub-wiki URLs are flat, so the publishers historically
 * copied every file to both `<rel>` and `<basename>`; two files sharing a
 * basename silently overwrote each other at the root.
 *
 * A flat (basename) copy is allowed only when it is unambiguous:
 *   - exactly one file has that basename (case-insensitive), or
 *   - exactly one of them already lives at the source root (it keeps the name).
 * Everything else is reported as a collision and is published only at its
 * nested path.
 *
 * @param {string[]} relPaths paths relative to the source root
 * @returns {{ flat: Set<string>, collisions: Array<{basename:string, files:string[], flatWinner:string|null}> }}
 */
export function planFlatCopies(relPaths) {
  const groups = new Map();
  for (const raw of relPaths) {
    const rel = toPosix(raw);
    const key = path.posix.basename(rel).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rel);
  }
  const flat = new Set();
  const collisions = [];
  for (const [basename, members] of groups) {
    if (members.length === 1) {
      flat.add(members[0]);
      continue;
    }
    const rootLevel = members.filter((m) => !m.includes('/'));
    const winner = rootLevel.length === 1 ? rootLevel[0] : null;
    if (winner) flat.add(winner);
    collisions.push({ basename, files: [...members].sort(), flatWinner: winner });
  }
  collisions.sort((a, b) => a.basename.localeCompare(b.basename));
  return { flat, collisions };
}
