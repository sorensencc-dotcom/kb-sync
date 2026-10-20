import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveBashExecutable } from '../../../../modules/notebooklm/lib/bash-resolver.mjs';

describe('resolveBashExecutable', () => {
  const originalPlatform = process.platform;
  const originalProgramFiles = process.env.ProgramFiles;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  let existsSyncDescriptor;

  beforeEach(() => {
    // Save original fs.existsSync to be able to mock it properly
    existsSyncDescriptor = Object.getOwnPropertyDescriptor(fs, 'existsSync');
  });

  afterEach(() => {
    // Restore platform
    Object.defineProperty(process, 'platform', { value: originalPlatform });

    // Restore env vars
    if (originalProgramFiles !== undefined) {
      process.env.ProgramFiles = originalProgramFiles;
    } else {
      delete process.env.ProgramFiles;
    }

    if (originalLocalAppData !== undefined) {
      process.env.LOCALAPPDATA = originalLocalAppData;
    } else {
      delete process.env.LOCALAPPDATA;
    }

    // Restore fs.existsSync
    if (existsSyncDescriptor) {
        Object.defineProperty(fs, 'existsSync', existsSyncDescriptor);
    }
  });

  it('returns "bash" on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    assert.equal(resolveBashExecutable(), 'bash');

    Object.defineProperty(process, 'platform', { value: 'darwin' });
    assert.equal(resolveBashExecutable(), 'bash');
  });

  describe('on Windows (win32)', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.ProgramFiles = 'C:\\Program Files';
      process.env.LOCALAPPDATA = 'C:\\Users\\Test\\AppData\\Local';
    });

    it('returns the first existing candidate', () => {
      const existingCandidate = 'C:\\Program Files\\Git\\bin\\bash.exe';

      fs.existsSync = (path) => {
        return path === existingCandidate;
      };

      assert.equal(resolveBashExecutable(), existingCandidate);
    });

    it('returns the second existing candidate if first does not exist', () => {
      const existingCandidate = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';

      fs.existsSync = (path) => {
        return path === existingCandidate;
      };

      assert.equal(resolveBashExecutable(), existingCandidate);
    });

    it('returns the environment variable based candidate if others do not exist', () => {
      const existingCandidate = 'C:\\Users\\Test\\AppData\\Local\\Programs\\Git\\bin\\bash.exe';

      fs.existsSync = (path) => {
        return path === existingCandidate;
      };

      assert.equal(resolveBashExecutable(), existingCandidate);
    });

    it('returns "bash.exe" if no candidates exist', () => {
      fs.existsSync = () => false;

      assert.equal(resolveBashExecutable(), 'bash.exe');
    });

    it('handles missing environment variables gracefully', () => {
      delete process.env.ProgramFiles;
      delete process.env.LOCALAPPDATA;

      // Make sure the code still works without throwing
      fs.existsSync = () => false;
      assert.equal(resolveBashExecutable(), 'bash.exe');

      // Let's verify standard path still works when env vars are missing
      const standardCandidate = 'C:\\Program Files\\Git\\bin\\bash.exe';
      fs.existsSync = (path) => path === standardCandidate;
      assert.equal(resolveBashExecutable(), standardCandidate);
    });
  });
});
