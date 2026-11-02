import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderError } from '../../../../modules/obsidian/providers/index.js';
import { AnthropicProvider } from '../../../../modules/obsidian/providers/anthropicProvider.js';
import { LocalProvider } from '../../../../modules/obsidian/providers/localProvider.js';
import { OfflineTemplateProvider } from '../../../../modules/obsidian/providers/offlineTemplateProvider.js';

test('createProvider instantiates AnthropicProvider', async () => {
  const provider = await createProvider('anthropic', { model: 'claude-test' });
  assert.ok(provider instanceof AnthropicProvider);
  assert.equal(provider.name, 'anthropic');
});

test('createProvider instantiates AnthropicProvider with claude alias', async () => {
  const provider = await createProvider('claude');
  assert.ok(provider instanceof AnthropicProvider);
});

test('createProvider instantiates LocalProvider', async () => {
  const provider = await createProvider('local', { localEndpoint: 'http://127.0.0.1:11434' });
  assert.ok(provider instanceof LocalProvider);
  assert.equal(provider.name, 'local');
});

test('createProvider instantiates LocalProvider with ollama alias', async () => {
  const provider = await createProvider('ollama');
  assert.ok(provider instanceof LocalProvider);
});

test('createProvider instantiates OfflineTemplateProvider', async () => {
  const provider = await createProvider('offline-template');
  assert.ok(provider instanceof OfflineTemplateProvider);
  assert.equal(provider.name, 'offline-template');
});

test('createProvider instantiates OfflineTemplateProvider with template alias', async () => {
  const provider = await createProvider('template');
  assert.ok(provider instanceof OfflineTemplateProvider);
});

test('createProvider throws ProviderError for unknown provider', async () => {
  await assert.rejects(
    async () => {
      await createProvider('unknown-provider');
    },
    (err: any) => {
      assert.ok(err instanceof ProviderError);
      assert.match(err.message, /Unknown provider 'unknown-provider'/);
      assert.equal(err.isTransient, false);
      return true;
    }
  );
});
