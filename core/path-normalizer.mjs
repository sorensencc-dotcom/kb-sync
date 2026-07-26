import path from 'node:path';

/**
 * Normalizes mixed slashes (e.g. C:\dev/kb-sync) to standard POSIX forward slashes (C:/dev/kb-sync).
 */
export function toPosixPath(inputPath) {
  if (!inputPath) return '';
  return String(inputPath).replace(/\\/g, '/');
}

/**
 * Converts Linux/WSL paths (/mnt/c/dev/kb-sync or /c/dev/kb-sync) to Windows paths (C:\dev\kb-sync).
 */
export function toWindowsPath(inputPath) {
  if (!inputPath) return '';
  let str = String(inputPath);
  
  // Handle /mnt/c/...
  if (/^\/mnt\/([a-zA-Z])\/(.*)/.test(str)) {
    str = str.replace(/^\/mnt\/([a-zA-Z])\/(.*)/, '$1:/$2');
  }
  // Handle /c/...
  else if (/^\/([a-zA-Z])\/(.*)/.test(str)) {
    str = str.replace(/^\/([a-zA-Z])\/(.*)/, '$1:/$2');
  }

  // Convert forward slashes to backslashes for native Windows
  return str.replace(/\//g, '\\');
}

/**
 * Converts Windows paths (C:\dev\kb-sync or C:/dev/kb-sync) to WSL paths (/mnt/c/dev/kb-sync).
 */
export function toWslPath(inputPath) {
  if (!inputPath) return '';
  let str = toPosixPath(inputPath);
  if (/^([a-zA-Z]):\/(.*)/.test(str)) {
    return str.replace(/^([a-zA-Z]):\/(.*)/, (match, drive, rest) => `/mnt/${drive.toLowerCase()}/${rest}`);
  }
  return str;
}

/**
 * Normalizes inputPath into native operating system format based on current platform.
 */
export function normalizeNativePath(inputPath) {
  if (process.platform === 'win32') {
    return toWindowsPath(inputPath);
  }
  return toPosixPath(inputPath);
}

export default {
  toPosixPath,
  toWindowsPath,
  toWslPath,
  normalizeNativePath
};
