/**
 * SynthesisProvider Interface & Factory
 * Defines the contract for wiki synthesis providers (Anthropic, Local LLM, Offline Template)
 */

export class ProviderError extends Error {
  constructor(message: string, public isTransient: boolean = false) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface SynthesisProposal {
  title: string;
  category: string;       // daemons, utilities, sync-tools, adapters, mcp-servers, scaffolds, prototypes, wiki
  status: string;         // active, beta, archived
  draft?: boolean;
  summary: string;
  citations: string[];    // Staged relative file paths (e.g. ["modules/obsidian/ingest-wiki.sh"])
  body: string;           // Markdown body containing vault-absolute [[kb-sync/...]] links
  vaultPath: string;      // Vault-relative target path (e.g. "kb-sync/wiki/Headless-Synthesis-Worker.md")
}

export interface ProviderOutput {
  providerName: string;
  model: string;
  timestamp: string;
  proposals: SynthesisProposal[];
}

export interface SynthesisInput {
  stagingPath: string;
  manifestHash: string;
  stagedFiles: Array<{ relativePath: string; content: string }>;
  existingWikiFiles: Array<{ relativePath: string; content: string }>;
  schemaDoc: string;
  model?: string;
  localEndpoint?: string;
  allowRemoteEndpoint?: boolean;
}

export interface SynthesisProvider {
  name: string;
  synthesize(input: SynthesisInput): Promise<ProviderOutput>;
}

export async function createProvider(
  name: string,
  options: { model?: string; localEndpoint?: string; allowRemoteEndpoint?: boolean } = {}
): Promise<SynthesisProvider> {
  const normalized = name.toLowerCase().trim();

  if (normalized === "anthropic" || normalized === "claude") {
    const { AnthropicProvider } = await import("./anthropicProvider.js");
    return new AnthropicProvider(options.model);
  }

  if (normalized === "local" || normalized === "ollama") {
    const { LocalProvider } = await import("./localProvider.js");
    return new LocalProvider(options.localEndpoint, options.model, options.allowRemoteEndpoint);
  }

  if (normalized === "offline-template" || normalized === "offline" || normalized === "template") {
    const { OfflineTemplateProvider } = await import("./offlineTemplateProvider.js");
    return new OfflineTemplateProvider();
  }

  throw new ProviderError(`Unknown provider '${name}'. Valid options: anthropic, local, offline-template`, false);
}
