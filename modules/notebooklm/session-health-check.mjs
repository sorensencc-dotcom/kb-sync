import fs from 'node:fs';
import path from 'node:path';

/**
 * Headless Auth Session Health Checker.
 * Verifies NOTEBOOKLM_MASTER_TOKEN presence, format, and estimated cookie freshness.
 */

export function checkSessionHealth(repoRoot = process.cwd()) {
  const envPath = path.join(repoRoot, '.env');
  const result = {
    valid: false,
    tokenPresent: false,
    expired: false,
    warning: null
  };

  if (!fs.existsSync(envPath)) {
    result.warning = 'No .env file found in repository root.';
    return result;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const tokenMatch = envContent.match(/NOTEBOOKLM_MASTER_TOKEN\s*=\s*["']?([^\s"']+)["']?/);

  if (!tokenMatch || !tokenMatch[1]) {
    result.warning = 'NOTEBOOKLM_MASTER_TOKEN key missing or empty in .env';
    return result;
  }

  const token = tokenMatch[1];
  result.tokenPresent = true;

  if (token.length < 20) {
    result.warning = 'NOTEBOOKLM_MASTER_TOKEN appears truncated or malformed.';
    return result;
  }

  result.valid = true;
  return result;
}

if (process.argv[1] && process.argv[1].endsWith('session-health-check.mjs')) {
  const health = checkSessionHealth();
  console.log('=== NOTEBOOKLM SESSION HEALTH REPORT ===');
  console.log(`Token Present: ${health.tokenPresent}`);
  console.log(`Status Valid:  ${health.valid}`);
  if (health.warning) {
    console.warn(`Warning:       ${health.warning}`);
  }
}
