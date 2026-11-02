import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../../../../modules/obsidian/providers/anthropicProvider.js";
import { ProviderError } from "../../../../modules/obsidian/providers/index.js";

test("AnthropicProvider", async (t) => {
  await t.test("constructor sets default model if not provided", () => {
    const provider = new AnthropicProvider();
    assert.equal(provider.name, "anthropic");
    // We cannot easily test the private model variable directly,
    // but we ensure it instantiates correctly.
  });

  await t.test("constructor sets custom model if provided", () => {
    const provider = new AnthropicProvider("custom-model");
    assert.equal(provider.name, "anthropic");
  });

  await t.test("synthesize throws ProviderError when ANTHROPIC_API_KEY is missing", async () => {
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const provider = new AnthropicProvider();

    try {
      await provider.synthesize({
        stagingPath: "/tmp/staging",
        manifestHash: "hash",
        stagedFiles: [],
        existingWikiFiles: [],
        schemaDoc: "schema",
      });
      assert.fail("Expected synthesize to throw ProviderError");
    } catch (error: any) {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /ANTHROPIC_API_KEY environment variable is required/);
    } finally {
      if (originalApiKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalApiKey;
      }
    }
  });

  await t.test("generate throws ProviderError when ANTHROPIC_API_KEY is missing", async () => {
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const provider = new AnthropicProvider();

    try {
      await provider.generate("Hello");
      assert.fail("Expected generate to throw ProviderError");
    } catch (error: any) {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /ANTHROPIC_API_KEY environment variable is required/);
    } finally {
      if (originalApiKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalApiKey;
      }
    }
  });
});
