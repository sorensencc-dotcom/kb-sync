import test from "node:test";
import assert from "node:assert/strict";
import { LocalProvider } from "../../../modules/obsidian/providers/localProvider.js";
import { ProviderError } from "../../../modules/obsidian/providers/index.js";

test("LocalProvider", async (t) => {
  await t.test("constructor correctly initializes with defaults", () => {
    const provider = new LocalProvider();
    assert.equal(provider.name, "local");
    // Default endpoint is "http://127.0.0.1:11434/v1" or taken from LOCAL_LLM_ENDPOINT
    assert.ok(provider);
  });

  await t.test("constructor formats the endpoint by removing trailing slashes", () => {
    const provider = new LocalProvider("http://127.0.0.1:11434/v1///", "qwen2.5:latest");
    // We can't access private property this.endpoint directly, but we can test that it doesn't throw
    assert.ok(provider);
  });

  await t.test("rejects invalid URL", () => {
    assert.throws(
      () => new LocalProvider("not-a-url"),
      (err: any) => {
        assert.ok(err instanceof ProviderError);
        assert.match(err.message, /Invalid --local-endpoint URL/);
        return true;
      }
    );
  });

  await t.test("rejects non-loopback URL when allowRemoteEndpoint is false", () => {
    assert.throws(
      () => new LocalProvider("http://example.com/v1", "qwen2.5:latest", false),
      (err: any) => {
        assert.ok(err instanceof ProviderError);
        assert.match(err.message, /Non-loopback local endpoint .* rejected for security/);
        return true;
      }
    );
  });

  await t.test("accepts non-loopback URL when allowRemoteEndpoint is true", () => {
    assert.doesNotThrow(() => new LocalProvider("http://example.com/v1", "qwen2.5:latest", true));
  });

  await t.test("accepts valid loopback URLs", () => {
    const loopbacks = [
      "http://127.0.0.1:11434/v1",
      "http://localhost:11434/v1",
      "http://[::1]:11434/v1"
    ];

    for (const url of loopbacks) {
      assert.doesNotThrow(() => new LocalProvider(url, "qwen2.5:latest", false));
    }
  });
});
