import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('verify-grounding-gate.mjs and run-nlm-chat.sh include timestamp prefix in prompts', () => {
  const verifyGatePath = path.resolve('scripts/notebooklm/verify-grounding-gate.mjs');
  const runNlmChatPath = path.resolve('scripts/notebooklm/run-nlm-chat.sh');

  const verifyGateContent = fs.readFileSync(verifyGatePath, 'utf8');
  const runNlmChatContent = fs.readFileSync(runNlmChatPath, 'utf8');

  // Assert verify-grounding-gate embeds ISO timestamp in GROUNDING_PROMPT
  assert.match(
    verifyGateContent,
    /const GROUNDING_PROMPT\s*=\s*`\[\${timestamp}\]/,
    'verify-grounding-gate.mjs should prepend ISO timestamp to GROUNDING_PROMPT'
  );

  // Assert run-nlm-chat.sh validates and prepends timestamp if missing
  assert.match(
    runNlmChatContent,
    /PROMPT_ARG="\[\$TIMESTAMP\] \$PROMPT_ARG"/,
    'run-nlm-chat.sh should auto-prepend ISO timestamp if missing'
  );
});
