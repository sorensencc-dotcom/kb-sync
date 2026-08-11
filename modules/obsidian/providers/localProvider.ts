import { SynthesisProvider, SynthesisInput, ProviderOutput, SynthesisProposal, ProviderError } from "./index.js";
import { URL } from "url";
import path from "path";

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

  constructor(
    endpoint = process.env.LOCAL_LLM_ENDPOINT || "http://127.0.0.1:11434/v1",
    model = process.env.LOCAL_LLM_MODEL || "qwen2.5:latest",
    allowRemoteEndpoint = false
  ) {
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

  public async discoverAvailableModels(): Promise<string[]> {
    try {
      const resp = await fetch(`${this.endpoint}/models`, { method: "GET" });
      if (!resp.ok) return [];
      const data = (await resp.json()) as any;
      if (Array.isArray(data?.data)) {
        return data.data
          .map((m: any) => m.id)
          .filter((id: string) => typeof id === "string" && !id.toLowerCase().includes("embed"));
      }
    } catch {
      // Ignore discovery errors
    }
    return [];
  }

  private generateFallbackProposals(
    batchFiles: { relativePath: string; content: string }[],
    existingTitleToPathMap: Map<string, string>
  ): SynthesisProposal[] {
    return batchFiles.map((bf) => {
      const baseName = path.basename(bf.relativePath, path.extname(bf.relativePath));
      const cleanTitle = bf.relativePath
        .replace(/\.[^.]+$/, "")
        .replace(/[\/\-_.]+/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
        .replace(/\s+/g, "");

      const normalizeKey = (s: string) => s.toLowerCase().replace(/[\/\-_.\s]+/g, "");
      const normBase = normalizeKey(baseName);
      const normTitle = normalizeKey(cleanTitle);

      const vaultPath = existingTitleToPathMap.has(normBase)
        ? existingTitleToPathMap.get(normBase)!
        : existingTitleToPathMap.has(normTitle)
        ? existingTitleToPathMap.get(normTitle)!
        : `kb-sync/wiki/${cleanTitle}.md`;

      return {
        title: cleanTitle,
        category: "wiki",
        status: "active",
        summary: `Synthesized documentation node for ${bf.relativePath}`,
        citations: [bf.relativePath],
        body: `# ${cleanTitle}\n\nDocumentation node for \`${bf.relativePath}\`.\n\n## Source Citation\n- \`${bf.relativePath}\``,
        vaultPath,
      };
    });
  }

  async synthesize(input: SynthesisInput): Promise<ProviderOutput> {
    const timestamp = new Date().toISOString();
    const targetUrl = `${this.endpoint}/chat/completions`;

    const existingTitleToPathMap = new Map<string, string>();
    if (Array.isArray(input.existingWikiFiles)) {
      for (const ew of input.existingWikiFiles) {
        const targetPath = ew.relativePath.replace(/\\/g, "/");
        const fileName = path.basename(ew.relativePath);
        const baseNoMd = fileName.replace(/\.md$/i, "");
        const baseNoExt = baseNoMd.replace(/\.[^.]+$/, "");

        const normalizeKey = (s: string) => s.toLowerCase().replace(/[\/\-_.\s]+/g, "");
        existingTitleToPathMap.set(normalizeKey(fileName), targetPath);
        existingTitleToPathMap.set(normalizeKey(baseNoMd), targetPath);
        existingTitleToPathMap.set(normalizeKey(baseNoExt), targetPath);
      }
    }

    // Auto-discover model if default model is not found or empty
    let currentModel = input.model || this.model;
    const available = await this.discoverAvailableModels();
    if (available.length > 0) {
      if (!available.includes(currentModel)) {
        currentModel = available.includes("qwen2.5:latest") ? "qwen2.5:latest" : available[0];
        this.model = currentModel;
        if (input) input.model = currentModel;
      }
    }

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

    const batchSize = parseInt(process.env.LOCAL_LLM_BATCH_SIZE || "20", 10);
    const files = input.stagedFiles;
    const batches: (typeof files)[] = [];

    for (let i = 0; i < files.length; i += batchSize) {
      batches.push(files.slice(i, i + batchSize));
    }

    const allProposals: SynthesisProposal[] = [];

    for (let bIndex = 0; bIndex < batches.length; bIndex++) {
      const batchFiles = batches[bIndex];
      const stagedSummary = batchFiles
        .map((f) => `### File: ${f.relativePath}\n${f.content.slice(0, 3000)}`)
        .join("\n\n");

      const userMessage = `<untrusted_source_content>\n${stagedSummary}\n</untrusted_source_content>`;

      try {
        const timeoutMs = parseInt(process.env.LOCAL_LLM_TIMEOUT_MS || "900000", 10);
        console.log(`[LOCAL-PROVIDER] [INFO] Requesting batch ${bIndex + 1}/${batches.length} (${batchFiles.length} files) via model '${currentModel}'...`);

        let response: Response;
        try {
          response = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: currentModel,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
              ],
              temperature: 0.1,
              response_format: { type: "json_object" },
            }),
            signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
          });
        } catch (err: any) {
          console.warn(`[LOCAL-PROVIDER] [WARN] Batch ${bIndex + 1}/${batches.length} LLM request failed (${err.message}). Fallback to file citation proposals.`);
          allProposals.push(...this.generateFallbackProposals(batchFiles, existingTitleToPathMap));
          continue;
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          if (response.status === 404 && (errText.includes("not found") || errText.includes("model"))) {
            const availableModels = await this.discoverAvailableModels();
            if (availableModels.length > 0 && !availableModels.includes(currentModel)) {
              const fallback = availableModels[0];
              console.warn(
                `[LOCAL-PROVIDER] [WARN] Model '${currentModel}' not found on local endpoint. ` +
                  `Auto-falling back to installed model '${fallback}' (Installed: ${availableModels.join(", ")}).`
              );
              currentModel = fallback;
              this.model = fallback;
              if (input) input.model = fallback;
              bIndex--;
              continue;
            }
          }
          console.warn(`[LOCAL-PROVIDER] [WARN] Batch ${bIndex + 1}/${batches.length} HTTP ${response.status} error. Fallback to file citation proposals.`);
          allProposals.push(...this.generateFallbackProposals(batchFiles, existingTitleToPathMap));
          continue;
        }

        const data = (await response.json()) as any;
        const contentText = data?.choices?.[0]?.message?.content;
        if (!contentText || typeof contentText !== "string") {
          console.warn(`[LOCAL-PROVIDER] [WARN] Batch ${bIndex + 1}/${batches.length} empty response content. Fallback to file citation proposals.`);
          allProposals.push(...this.generateFallbackProposals(batchFiles, existingTitleToPathMap));
          continue;
        }

        let parsedOutput: any;
        try {
          const cleaned = contentText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
          parsedOutput = JSON.parse(cleaned);
        } catch {
          console.warn(`[LOCAL-PROVIDER] [WARN] Batch ${bIndex + 1}/${batches.length} JSON parse error. Fallback to file citation proposals.`);
          allProposals.push(...this.generateFallbackProposals(batchFiles, existingTitleToPathMap));
          continue;
        }

        let rawProposals: any[] = [];
        if (Array.isArray(parsedOutput)) {
          rawProposals = parsedOutput;
        } else if (Array.isArray(parsedOutput?.proposals)) {
          rawProposals = parsedOutput.proposals;
        } else if (Array.isArray(parsedOutput?.files)) {
          rawProposals = parsedOutput.files;
        } else if (Array.isArray(parsedOutput?.documents)) {
          rawProposals = parsedOutput.documents;
        } else if (Array.isArray(parsedOutput?.pages)) {
          rawProposals = parsedOutput.pages;
        } else if (Array.isArray(parsedOutput?.wiki_pages)) {
          rawProposals = parsedOutput.wiki_pages;
        } else if (Array.isArray(parsedOutput?.items)) {
          rawProposals = parsedOutput.items;
        } else if (typeof parsedOutput === "object" && parsedOutput !== null) {
          rawProposals = [parsedOutput];
        } else {
          allProposals.push(...this.generateFallbackProposals(batchFiles, existingTitleToPathMap));
          continue;
        }

        const batchProposals: SynthesisProposal[] = rawProposals.map((p: any, idx: number) => {
          let rawTitle = p.title || p.Name || p.name || p.filename || p.file_path || p.page_title || p.file_name || p.header || p.subject || p.topic || p.label || p.id;
          if (!rawTitle || String(rawTitle).trim() === "" || String(rawTitle).toLowerCase() === "untitled") {
            if (Array.isArray(p.citations) && p.citations[0]) {
              const base = String(p.citations[0]).split("/").pop() || "";
              rawTitle = base.replace(/\.[^.]+$/, "");
            } else if (Array.isArray(p.sources) && p.sources[0]) {
              const base = String(p.sources[0]).split("/").pop() || "";
              rawTitle = base.replace(/\.[^.]+$/, "");
            } else if (batchFiles[idx]) {
              rawTitle = path.basename(batchFiles[idx].relativePath, path.extname(batchFiles[idx].relativePath));
            } else {
              rawTitle = `Proposal_${bIndex + 1}_${idx + 1}`;
            }
          }

          const cleanTitle = String(rawTitle)
            .replace(/\.md$/i, "")
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (c: string) => c.toUpperCase())
            .replace(/\s+/g, "");

          const VALID_STATUSES = ["active", "beta", "archived"];
          const VALID_CATEGORIES = ["daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki"];

          let rawStatus = String(p.status || "active").toLowerCase();
          if (!VALID_STATUSES.includes(rawStatus)) {
            rawStatus = "active";
          }

          let rawCat = String(p.category || p.Type || "wiki").toLowerCase();
          if (!VALID_CATEGORIES.includes(rawCat)) {
            rawCat = "wiki";
          }

          const normalizeKey = (s: string) => s.toLowerCase().replace(/[\/\-_.\s]+/g, "");
          const normTitle = normalizeKey(cleanTitle);
          let rawVaultPath = String(p.vaultPath || p.path || "");
          if (existingTitleToPathMap.has(normTitle)) {
            rawVaultPath = existingTitleToPathMap.get(normTitle)!;
          } else if (!rawVaultPath.startsWith("kb-sync/")) {
            rawVaultPath = `kb-sync/${rawCat}/${cleanTitle}.md`;
          }

          return {
            title: cleanTitle,
            category: rawCat,
            status: rawStatus,
            summary: p.summary || p.Summary || p.description || p.Location || "",
            citations: Array.isArray(p.citations) ? p.citations : Array.isArray(p.source_citations) ? p.source_citations : Array.isArray(p.sources) ? p.sources : batchFiles[idx] ? [batchFiles[idx].relativePath] : [],
            body: p.body || p.content || p.markdown || p.text || `# ${cleanTitle}\n\n${p.summary || p.Summary || "Synthesized wiki page."}`,
            vaultPath: rawVaultPath,
          };
        });

        allProposals.push(...batchProposals);
      } catch (err: any) {
        console.warn(`[LOCAL-PROVIDER] [WARN] Batch ${bIndex + 1}/${batches.length} error: ${err.message}. Fallback to file citation proposals.`);
        allProposals.push(...this.generateFallbackProposals(batchFiles, existingTitleToPathMap));
      }
    }

    return {
      providerName: this.name,
      model: currentModel,
      timestamp,
      proposals: allProposals,
    };
  }
}
