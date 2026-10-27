import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError, createProvider } from '../modules/obsidian/providers/index.js';
import { AnthropicProvider } from '../modules/obsidian/providers/anthropicProvider.js';
import { LocalProvider } from '../modules/obsidian/providers/localProvider.js';
import { OfflineTemplateProvider } from '../modules/obsidian/providers/offlineTemplateProvider.js';

test('ProviderError', async (t) => {
  await t.test('sets correct name and message', () => {
    const err = new ProviderError('Test error message');
    assert.equal(err.name, 'ProviderError');
    assert.equal(err.message, 'Test error message');
    assert.equal(err.isTransient, false);
  });

  await t.test('respects isTransient parameter', () => {
    const err = new ProviderError('Transient error', true);
    assert.equal(err.isTransient, true);
  });
});

test('createProvider', async (t) => {
  await t.test('creates AnthropicProvider for "anthropic" and "claude"', async () => {
    const provider1 = await createProvider('anthropic');
    assert.ok(provider1 instanceof AnthropicProvider);

    const provider2 = await createProvider('claude');
    assert.ok(provider2 instanceof AnthropicProvider);
  });

  await t.test('creates LocalProvider for "local" and "ollama"', async () => {
    const provider1 = await createProvider('local');
    assert.ok(provider1 instanceof LocalProvider);

    const provider2 = await createProvider('ollama');
    assert.ok(provider2 instanceof LocalProvider);
  });

  await t.test('creates OfflineTemplateProvider for "offline-template", "offline", and "template"', async () => {
    const provider1 = await createProvider('offline-template');
    assert.ok(provider1 instanceof OfflineTemplateProvider);

    const provider2 = await createProvider('offline');
    assert.ok(provider2 instanceof OfflineTemplateProvider);

    const provider3 = await createProvider('template');
    assert.ok(provider3 instanceof OfflineTemplateProvider);
  });

  await t.test('normalizes input names (case insensitive and trims whitespace)', async () => {
    const provider1 = await createProvider('  Anthropic  ');
    assert.ok(provider1 instanceof AnthropicProvider);

    const provider2 = await createProvider('OLLAMA');
    assert.ok(provider2 instanceof LocalProvider);
  });

  await t.test('throws ProviderError for unknown providers', async () => {
    await assert.rejects(
      async () => { await createProvider('unknown-provider'); },
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.match(err.message, /Unknown provider 'unknown-provider'/);
        assert.equal(err.isTransient, false);
        return true;
      }
    );
  });

  await t.test('passes options to provider constructors', async () => {
    // We can indirectly check if options were passed by looking at provider properties
    // LocalProvider takes endpoint, model, allowRemoteEndpoint
    const localProvider = await createProvider('local', {
        localEndpoint: 'http://custom:11434',
        model: 'custom-model',
        allowRemoteEndpoint: true
    }) as LocalProvider;

    assert.equal(localProvider['endpoint'], 'http://custom:11434');
    assert.equal(localProvider['model'], 'custom-model');
    assert.equal(localProvider['allowRemoteEndpoint'], true);
  });
});
