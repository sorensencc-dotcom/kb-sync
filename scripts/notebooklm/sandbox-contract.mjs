export const KB_TESTING_SANDBOX_UUID = 'd721ed70-5b37-497f-a279-10ba362c744e';
export const KB_TESTING_FIXTURE_SOURCE_ID = 'cc06bd53-1793-4ea0-b723-6f77eb1dd490';
export const KB_TESTING_FIXTURE_TITLE = 'Test Harness Specification & Live Verification Fixtures';

export function isProtectedSandboxFixture(source) {
  return [source?.id, source?.sourceId, source?.source_id].includes(KB_TESTING_FIXTURE_SOURCE_ID)
    || [source?.title, source?.name, source?.displayName].includes(KB_TESTING_FIXTURE_TITLE);
}

export function assertLiveSandbox(notebookId, env = process.env) {
  if (notebookId !== KB_TESTING_SANDBOX_UUID) throw new Error('LIVE_SANDBOX_ONLY: exact sandbox UUID required');
  if (Object.entries(env).some(([key, value]) => value && (/MOCK/i.test(key) || /^(NLM_CLI|NOTEBOOKLM_CLI)$/.test(key)))) {
    throw new Error('LIVE_MOCK_OVERRIDE_FORBIDDEN: remove mock and CLI override variables');
  }
}

export function findActiveUploadedSource(sources, sourceId) {
  return sources.find(s => (s.id || s.sourceId || s.source_id) === sourceId
    && [2, '2', 'ACTIVE', 'active', 'READY', 'ready'].includes(s.status));
}
