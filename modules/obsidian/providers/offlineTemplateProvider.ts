import { SynthesisProvider, SynthesisInput, ProviderOutput, SynthesisProposal } from "./index.js";
import path from "path";

/**
 * OfflineTemplateProvider
 * Scaffolds draft pages locally with canonical status: "active" and draft: true frontmatter.
 * Requires zero network calls or external dependencies.
 */
export class OfflineTemplateProvider implements SynthesisProvider {
  public name = "offline-template";

  async synthesize(input: SynthesisInput): Promise<ProviderOutput> {
    const timestamp = new Date().toISOString();
    const proposals: SynthesisProposal[] = [];

    const existingBasenames = new Set(
      input.existingWikiFiles.map((f) => path.basename(f.relativePath, path.extname(f.relativePath)).toLowerCase())
    );
    const seenBasenames = new Set<string>();

    for (const file of input.stagedFiles) {
      const ext = path.extname(file.relativePath).toLowerCase();
      const validExts = [".md", ".ts", ".js", ".mjs", ".json", ".sh", ".ps1", ".py", ".yaml", ".yml", ".txt"];
      if (ext && !validExts.includes(ext)) {
        continue;
      }

      const rawBasename = path.basename(file.relativePath, path.extname(file.relativePath));
      if (existingBasenames.has(rawBasename.toLowerCase())) {
        continue;
      }

      // Normalize title (e.g. ingest-wiki -> IngestWiki)
      const cleanTitle = rawBasename
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .replace(/\s+/g, "");

      if (!cleanTitle || cleanTitle.length < 2) continue;

      const lowerTitle = cleanTitle.toLowerCase();
      if (seenBasenames.has(lowerTitle) || existingBasenames.has(lowerTitle)) {
        continue;
      }
      seenBasenames.add(lowerTitle);

      const category = file.relativePath.endsWith(".sh") ? "utilities" : "wiki";
      const summary = `Offline draft template for ${cleanTitle} staged from ${file.relativePath}.`;
      const vaultPath = `kb-sync/${category}/${cleanTitle}.md`;

      const body = `---
title: "${cleanTitle}"
category: "${category}"
status: "active"
draft: true
created: "${timestamp}"
---

# ${cleanTitle}

## Summary
${summary}

## Purpose & Scope
Draft specification for ${cleanTitle}. Synthesized via OfflineTemplateProvider.

## Operations & Details
- Source: \`${file.relativePath}\`
- Staged Pack: \`${input.stagingPath}\`

## Related Pages
- [[kb-sync/wiki/Index]]
`;

      proposals.push({
        title: cleanTitle,
        category,
        status: "active",
        draft: true,
        summary,
        citations: [file.relativePath],
        body,
        vaultPath,
      });
    }

    return {
      providerName: this.name,
      model: "offline-scaffold-v1",
      timestamp,
      proposals,
    };
  }
}
