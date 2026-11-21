import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

let selfStartToken;

export function isPidAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// FILETIME and /proc start ticks do not fit the comparison as JSON numbers.
export function processStartToken(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return null;
  if (numericPid === process.pid && selfStartToken !== undefined) return selfStartToken;
  const token = readProcessStartToken(numericPid);
  if (numericPid === process.pid) selfStartToken = token;
  return token;
}

export function ownProcessStartToken() {
  return processStartToken(process.pid);
}

// A missing token is an older lock. A failed lookup stays held rather than reaping a live owner.
export function isSameOwner(pid, startToken) {
  if (!isPidAlive(pid)) return false;
  if (startToken == null || startToken === '') return true;
  const observed = processStartToken(pid);
  if (observed == null) return true;
  return observed === String(startToken);
}

function readProcessStartToken(pid) {
  try {
    if (process.platform === 'win32') return windowsStartToken(pid);
    if (process.platform === 'linux') return linuxStartToken(pid);
    if (process.platform === 'darwin') return darwinStartToken(pid);
  } catch {
    return null;
  }
  return null;
}

function windowsStartToken(pid) {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 },
  ).trim();
  return /^\d+$/.test(out) ? out : null;
}

function linuxStartToken(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  // proc stat field 22 is starttime, the first field that stays fixed for this process.
  const starttime = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  return starttime || null;
}

function darwinStartToken(pid) {
  const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
  return out || null;
}

// Rename before delete so a lock created after the liveness read is a different file.
export function removeDeadLockFile(lockPath) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed && isSameOwner(parsed.pid, parsed.ownerStartedAt)) {
    return { state: 'live', pid: parsed.pid, createdAt: parsed.createdAt ?? null };
  }
  const tomb = `${lockPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.aside`;
  try {
    fs.renameSync(lockPath, tomb);
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
  let moved = null;
  try {
    moved = JSON.parse(fs.readFileSync(tomb, 'utf8'));
  } catch {
    moved = null;
  }
  if (moved && isSameOwner(moved.pid, moved.ownerStartedAt)) {
    try {
      fs.renameSync(tomb, lockPath);
    } catch (error) {
      if (!fs.existsSync(lockPath)) throw error;
      return { state: 'live', pid: moved.pid, createdAt: moved.createdAt ?? null };
    }
    return { state: 'live', pid: moved.pid, createdAt: moved.createdAt ?? null };
  }
  fs.unlinkSync(tomb);
  return { state: 'removed', pid: moved?.pid ?? null, pidAlive: isPidAlive(moved?.pid) };
}
