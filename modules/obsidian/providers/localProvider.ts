import { SynthesisProvider, SynthesisInput, ProviderOutput, SynthesisProposal, ProviderError } from "./index.js";
import { URL } from "url";

/**
 * LocalProvider
 * Connects to local LLM REST endpoint (Ollama, llama.cpp, vLLM) via OpenAI-compatible Chat Completions API.
 * Enforces loopback security checks unless allowRemoteEndpoint is explicitly set.
 */
export class LocalProvider implements SynthesisProvider {
  public name = "local";
  private endpoint: string;
  private model: string;
  private allowRemoteEndpoint: boolean;

  constructor(endpoint = "http://127.0.0.1:11434/v1", model = "llama3.1:70b", allowRemoteEndpoint = false) {
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.model = model;
    this.allowRemoteEndpoint = allowRemoteEndpoint;

    this.validateEndpointSecurity();
  }

  private validateEndpointSecurity(): void {
    let parsed: URL;
    try {
      parsed = new URL(this.endpoint);
    } catch (err) {
      throw new ProviderError(`Invalid --local-endpoint URL: '${this.endpoint}'. Error: ${err instanceof Error ? err.message : String(err)}`, false);
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";

    if (!isLoopback && !this.allowRemoteEndpoint) {
      throw new ProviderError(
        `[ERROR] Non-loopback local endpoint '${this.endpoint}' rejected for security. ` +
        `Pass --allow-remote-endpoint to explicitly allow remote LLM calls.`,
        false
      );
    }
  }

  async synthesize(input: SynthesisInput): Promise<ProviderOutput> {
    const timestamp = new Date().toISOString();
    const targetUrl = `${this.endpoint}/chat/completions`;

    const systemPrompt = `You are a provider-neutral wiki synthesis engine.
Synthesize the provided staged raw sources into wiki proposals.
Respond ONLY with a valid JSON object matching this exact schema:
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
- Do NOT output markdown code fences outside JSON. Return raw JSON.`;

    const stagedSummary = input.stagedFiles
      .map((f) => `### File: ${f.relativePath}\n${f.content.slice(0, 3000)}`)
      .join("\n\n");

    const userMessage = `<untrusted_source_content>\n${stagedSummary}\n</untrusted_source_content>`;

    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        let response: Response;
        try {
          response = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: input.model || this.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
              ],
              temperature: 0.1,
              response_format: { type: "json_object" },
            }),
            signal: controller.signal,
          });
        } catch (err: any) {
          clearTimeout(timeoutId);
          if (err.name === "AbortError") {
            throw new ProviderError(`Local LLM request to '${targetUrl}' timed out after 30 seconds.`, true);
          }
          throw new ProviderError(`Failed to connect to local LLM endpoint '${targetUrl}': ${err.message}`, true);
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          const isTransient = response.status === 429 || response.status >= 500;
          throw new ProviderError(`Local LLM endpoint returned error HTTP ${response.status}: ${errText}`, isTransient);
        }

        const data = (await response.json()) as any;
        const contentText = data?.choices?.[0]?.message?.content;
        if (!contentText || typeof contentText !== "string") {
          throw new ProviderError("Local LLM response missing choices[0].message.content string.", false);
        }

        let parsedOutput: { proposals: SynthesisProposal[] };
        try {
          const cleaned = contentText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
          parsedOutput = JSON.parse(cleaned);
        } catch (err) {
          throw new ProviderError(`Failed to parse JSON response from local LLM: ${err instanceof Error ? err.message : String(err)}`, false);
        }

        if (!Array.isArray(parsedOutput.proposals)) {
          throw new ProviderError("Local LLM response missing 'proposals' array.", false);
        }

        return {
          providerName: this.name,
          model: input.model || this.model,
          timestamp,
          proposals: parsedOutput.proposals,
        };
      } catch (err: any) {
        const providerErr = err instanceof ProviderError ? err : new ProviderError(err.message || String(err), false);
        if (!providerErr.isTransient || attempt >= maxRetries) {
          throw providerErr;
        }
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }

    throw new ProviderError(`Local LLM synthesis failed after ${maxRetries} attempts.`, true);
  }
}
