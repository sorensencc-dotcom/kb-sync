import { SynthesisProvider, SynthesisInput, ProviderOutput, SynthesisProposal, ProviderError } from "./index.js";

/**
 * AnthropicProvider
 * Cloud AI synthesis provider using Anthropic Claude API via @anthropic-ai/sdk.
 * Dynamically loads @anthropic-ai/sdk so offline/local modes run without requiring the package.
 */
export class AnthropicProvider implements SynthesisProvider {
  public name = "anthropic";
  private model: string;

  constructor(model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022") {
    this.model = model;
  }

  async synthesize(input: SynthesisInput): Promise<ProviderOutput> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ProviderError("[ERROR] ANTHROPIC_API_KEY environment variable is required for --provider anthropic.", false);
    }

    let AnthropicModule: any;
    try {
      // Dynamic lazy import of optional dependency
      AnthropicModule = await import("@anthropic-ai/sdk");
    } catch (err) {
      throw new ProviderError(
        `[ERROR] @anthropic-ai/sdk package is not installed. Run 'npm install @anthropic-ai/sdk' to use the anthropic provider.`,
        false
      );
    }

    const Anthropic = AnthropicModule.default || AnthropicModule.Anthropic || AnthropicModule;
    const client = new Anthropic({ apiKey });

    const timestamp = new Date().toISOString();

    const systemPrompt = `You are an operator-grade wiki synthesis engine.
Synthesize staged raw sources into wiki proposals for an Obsidian vault.
You MUST respond with a single valid JSON object matching this schema:
{
  "proposals": [
    {
      "title": "<PageTitle>",
      "category": "wiki" | "daemons" | "utilities" | "sync-tools" | "adapters" | "mcp-servers" | "scaffolds" | "prototypes",
      "status": "active" | "beta" | "archived",
      "summary": "<1-2 sentence summary>",
      "citations": ["<staged_relative_path>", ...],
      "body": "<Full markdown body of page with vault-absolute [[kb-sync/category/filename]] links>",
      "vaultPath": "kb-sync/<category>/<PageTitle>.md"
    }
  ]
}
Rules:
- citations MUST contain exact staged relative file paths from the input.
- Outbound wiki links in body MUST be written as vault-absolute links: [[kb-sync/category/filename]].
- Return raw JSON only, no surrounding Markdown text outside JSON.`;

    const stagedSummary = input.stagedFiles
      .map((f) => `### File: ${f.relativePath}\n${f.content.slice(0, 3000)}`)
      .join("\n\n");

    const userMessage = `<untrusted_source_content>\n${stagedSummary}\n</untrusted_source_content>`;
    const targetModel = input.model || this.model;

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new ProviderError("Anthropic API request timed out after 30 seconds", true)), 30000)
        );

        const apiPromise = client.messages.create({
          model: targetModel,
          max_tokens: 4000,
          temperature: 0.1,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }).catch((err: any) => {
          const status = err?.status || err?.statusCode;
          const isTransient = status === 429 || (status >= 500 && status < 600) || err?.code === "ETIMEDOUT";
          throw new ProviderError(`Anthropic API error: ${err.message}`, isTransient);
        });

        const response = await Promise.race([apiPromise, timeoutPromise]);
        const textBlock = response.content.find((c: any) => c.type === "text");

        if (!textBlock || !textBlock.text) {
          throw new ProviderError("Anthropic API returned empty or non-text content.", false);
        }

        let parsedOutput: { proposals: SynthesisProposal[] };
        try {
          const cleaned = textBlock.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
          parsedOutput = JSON.parse(cleaned);
        } catch (err) {
          throw new ProviderError(`Failed to parse JSON output from Anthropic API: ${err instanceof Error ? err.message : String(err)}`, false);
        }

        if (!Array.isArray(parsedOutput.proposals)) {
          throw new ProviderError("Anthropic API response missing 'proposals' array.", false);
        }

        return {
          providerName: this.name,
          model: targetModel,
          timestamp,
          proposals: parsedOutput.proposals,
        };
      } catch (err: any) {
        const providerErr = err instanceof ProviderError ? err : new ProviderError(err.message || String(err), false);
        if (!providerErr.isTransient || attempt >= maxRetries) {
          throw providerErr;
        }
        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }

    throw new ProviderError(`Anthropic synthesis failed after ${maxRetries} attempts.`, true);
  }
}
