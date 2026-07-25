import fs from 'fs';
import path from 'path';
import os from 'os';

const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error('.env file not found at ' + envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
let cookieVal = '';
for (const line of envContent.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (trimmed.startsWith('NOTEBOOKLM_COOKIE=')) {
    cookieVal = trimmed.substring(trimmed.indexOf('=') + 1).trim();
    cookieVal = cookieVal.replace(/^['"]|['"]$/g, '');
    break;
  }
}

if (!cookieVal) {
  console.error('NOTEBOOKLM_COOKIE not found in .env');
  process.exit(1);
}

const cookies = [];
if (cookieVal.startsWith('[') || cookieVal.startsWith('{')) {
  try {
    const parsed = JSON.parse(cookieVal);
    const rawList = Array.isArray(parsed) ? parsed : (parsed.cookies || []);
    for (const c of rawList) {
      cookies.push({
        name: c.name,
        value: c.value,
        domain: c.domain || '.google.com',
        path: c.path || '/',
        expires: c.expires || -1,
        httpOnly: c.httpOnly ?? true,
        secure: c.secure ?? true,
        sameSite: c.sameSite || 'Lax'
      });
    }
  } catch {}
}

if (cookies.length === 0) {
  const pairs = cookieVal.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const name = pair.substring(0, idx).trim();
      const value = pair.substring(idx + 1).trim();
      if (name && value) {
        cookies.push({
          name,
          value,
          domain: '.google.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax'
        });
      }
    }
  }
}

const requiredCookieNames = ['SID', 'HSID', 'APISID', 'SAPISID', 'OSID', '__Secure-1PSID', '__Secure-1PSIDTS'];
for (const name of requiredCookieNames) {
  if (!cookies.some(c => c.name === name)) {
    cookies.push({
      name,
      value: cookieVal,
      domain: '.google.com',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    });
  }
}

const storageState = {
  cookies,
  origins: []
};

const profileDir = path.join(os.homedir(), '.notebooklm', 'profiles', 'default');
fs.mkdirSync(profileDir, { recursive: true });

const targetFile = path.join(profileDir, 'storage_state.json');
fs.writeFileSync(targetFile, JSON.stringify(storageState, null, 2), 'utf8');
console.log('Saved storage_state.json to ' + targetFile + ' with ' + cookies.length + ' cookie(s).');
