# Engineering Specification: Topic Research Mining (TRM) Ingestion Pipeline

| Metadata | Specification Detail |
| :--- | :--- |
| **Document Version** | `v2.3.0-final` |
| **Document Status** | **DRAFT — READY FOR TIER 1 REVIEW / APPROVED FOR IMPLEMENTATION PLANNING** |
| **Producer System** | `C:\dev\trm` (Multimodal Extraction & Triage Engine) |
| **Consumer System** | `C:\dev\kb-sync` (Three-Layer Knowledge Vault & AST Graph) |
| **Parent Ecosystem** | Cast Iron Charlie (CIC) Agentic Mesh & Three-Layer Vault |
| **Target Review Gate** | Swarm Review Gate (`swarm-review-2026-08-15-trm-v2.3.0-final`) |

---

## 1. System Architecture & Component Responsibilities

The Topic Research Mining (TRM) Ingestion Pipeline establishes a contract-guarded data highway between topic mining (`C:\dev\trm`) and the Three-Layer Knowledge Vault (`C:\dev\kb-sync`).

```
┌────────────────────────────────────────────────────────────────────────┐
│ PRODUCER: C:\dev\trm (Mining & Triage CLI)                             │
│ - Multimodal parsing (PDF, EPUB, HEIC, Web, Docs)                      │
│ - Fact compaction & JSON schema enforcement                            │
│ - Target Interface: trm triage-intake --export-staging=<path>          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Validated JSON Payload + Sources Manifest
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ CONSUMER: C:\dev\kb-sync (Three-Layer Knowledge Vault)                 │
│                                                                        │
│ Layer 1: Content-Addressed Staging                                     │
│   - Target Directory: _kb-sync-staging/trm/<batch_id>/                 │
│   - Bounded stream SHA-256 validation against sources.manifest.json    │
│                                                                        │
│ Layer 2: Semantic Wiki Synthesis                                      │
│   - Synthesis Engine: modules/obsidian/synthesize-wiki.ts              │
│   - AST Grounding via Graft (graft.cmd) with static DAG fallback       │
│   - Target Output: wiki/research/<slug>.md, wiki/concepts/<slug>.md    │
│                                                                        │
│ Layer 3: Governance, Logging & Knowledge Pack                          │
│   - Contract Guard: modules/wiki/validate-contract.mjs                 │
│   - Audit Trail: wiki/Log.md, Master Catalog: wiki/Index.md            │
│   - Compilation: .nlm_pack/repo_knowledge_pack.txt                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Canonical Contracts, Wikilink Resolution & Unified Provenance

### 2.1 Frontmatter Category & Status Compatibility
To prevent breaking changes across existing repositories and CI validators:
* **Frontmatter `category`**: Stamped as `category: "wiki"`. Classification is governed by frontmatter `tags`: `["research", "trm"]` for research deep-dives and `["concept", "trm"]` for conceptual notes.
* **Frontmatter `status`**: Stamped as `status: "beta"` (proposed/draft) or `status: "active"` (validated/curated).

### 2.2 Canonical Wikilink Target Resolver Contract
All synthesized wikilinks must conform to `validate-contract.mjs` namespace rules and resolve deterministically:
* **Canonical Wikilink Syntax**:
  * Research Pages: `[[kb-sync/wiki/research/<slug>]]` (or `[[kb-sync/wiki/research/<slug>#heading|Label]]`)
  * Concept Pages: `[[kb-sync/wiki/concepts/<slug>]]` (or `[[kb-sync/wiki/concepts/<slug>|Label]]`)
* **Deterministic Target Resolution Rules**:
  1. **Namespace & Category Guard**: Outbound link must match `^kb-sync/wiki/(research|concepts)/[a-z0-9-]+(#.*)?(\|.*)?$`. Any link attempting to target directories outside `research` or `concepts` is rejected with `RULE_LINK_CATEGORY_DISALLOWED`.
  2. **Slug Sanitization**: Strip aliases (`|Label`) and section anchors (`#Heading`). Ensure slug matches `^[a-z0-9-]+$` and contains no path traversal sequences (`..`).
  3. **Target Trust & Precedence**:
     * Check active transaction workspace `.transaction_<batch_id>/wiki/${category}/${slug}.md` for sibling notes.
     * Check live vault `wiki/${category}/${slug}.md` for established notes.
     * If absent in both locations, fail with `LINK_TARGET_NOT_FOUND`.
  4. **Target Scoping**: Target existence checking is evaluated strictly on **outbound links originating from notes in the active transaction batch**.

### 2.3 Authoritative Unified Provenance Chain
To eliminate disjoint source references, citation verification follows a single authoritative lookup chain:

```
[Markdown Body: [cite:<source_id>]]
              │
              ▼ (1. Must exist in Frontmatter)
[Frontmatter: source_citations[source_id]]
              │
              ▼ (2. Must match Payload Source Record)
[Payload: sources[source_id] (title, staged_filename, content_sha256, byte_size)]
              │
              ▼ (3. Must match Manifest Entry)
[Manifest: sources.manifest.json[staged_filename] (content_sha256, byte_size)]
              │
              ▼ (4. Must match Disk Stream SHA-256)
[Disk: _kb-sync-staging/trm/<batch_id>/sources/<staged_filename>]
```

* **Citation Verification Rules**:
  1. **Unresolved Citation**: Any `[cite:<id>]` not present in frontmatter `source_citations` fails with `RULE_CITATION_SOURCE_UNRESOLVED`.
  2. **Batch Containment**: `rel_path` must resolve to `_kb-sync-staging/trm/<batch_id>/sources/${source_id}.${ext}` and be strictly contained within the canonical batch directory (`canonicalPath.startsWith(canonicalBatchSourcesRoot + "/")`). Traversal fails with `RULE_CITATION_PATH_TRAVERSAL`.
  3. **File Existence**: Missing cited file on disk fails with `RULE_CITATION_FILE_MISSING`.
  4. **Hash Mismatch**: Computed SHA-256 mismatch against `content_sha256` fails with `RULE_CITATION_HASH_MISMATCH`.

---

## 3. Storage Contracts, Semantic Validation & Provider Boundaries

### 3.1 Layer 1 Storage Architecture
* **Directory Path**: `_kb-sync-staging/trm/<batch_id>/`
* **Batch ID Format**: `YYYYMMDD-HHMMSS-<nonce_4hex>` (e.g., `20260814-220000-8f1a`)
* **Strict Source ID Binding**:
  * Every source in `payload.json` must declare a unique `source_id` matching `^src-[a-z0-9-]+$`.
  * `staged_filename` **must strictly equal** `${source_id}.${ext}`.
  * No duplicate `source_id`s, duplicate `staged_filename`s, or orphan unindexed files in `sources/` are permitted.
  * `sources/` must contain only flat regular files (no subdirectories, symlinks, or Windows reparse points/junctions).

### 3.2 Programmatic Cross-Field Semantic & Stream Validator
```typescript
import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface SemanticValidationError {
  rule_id: string;
  message: string;
}

export interface SemanticValidationResult {
  valid: boolean;
  errors: SemanticValidationError[];
}

function normalizePath(p: string): string {
  let norm = p.replace(/\\/g, "/");
  const driveMatch = norm.match(/^([A-Za-z]):/);
  if (driveMatch) {
    norm = driveMatch[1].toLowerCase() + norm.slice(1);
  }
  return norm.replace(/\/+$/, "");
}

export async function validateTrmPayloadSemantics(
  stagingDir: string,
  payload: any,
  manifest: Record<string, { content_sha256: string; byte_size: number }>
): Promise<SemanticValidationResult> {
  const errors: SemanticValidationError[] = [];
  const seenSourceIds = new Set<string>();
  const seenFilenames = new Set<string>();

  if (!Array.isArray(payload.sources)) {
    return { valid: false, errors: [{ rule_id: "RULE_SEMANTIC_SCHEMA_INVALID", message: "Missing or non-array 'sources' in payload" }] };
  }

  const rawSourcesDir = path.join(stagingDir, "sources");
  if (!fs.existsSync(rawSourcesDir)) {
    return { valid: false, errors: [{ rule_id: "RULE_SEMANTIC_DIR_MISSING", message: `Sources directory not found: ${rawSourcesDir}` }] };
  }

  let canonicalSourcesDir: string;
  try {
    canonicalSourcesDir = normalizePath(fs.realpathSync(rawSourcesDir));
  } catch (err: any) {
    return { valid: false, errors: [{ rule_id: "RULE_SEMANTIC_REALPATH_ERROR", message: `Failed resolving sources directory: ${err.message}` }] };
  }

  // 1. Enforce flat file policy & reject Windows junctions/reparse points
  try {
    const diskEntries = fs.readdirSync(rawSourcesDir, { withFileTypes: true });
    for (const entry of diskEntries) {
      const rawPath = path.join(rawSourcesDir, entry.name);
      const lstat = fs.lstatSync(rawPath);
      if (!lstat.isFile() || lstat.isSymbolicLink()) {
        errors.push({ rule_id: "RULE_SEMANTIC_ILLEGAL_FILE_TYPE", message: `Illegal non-flat or symlink entry in sources/: '${entry.name}'` });
        continue;
      }
      const canonicalEntry = normalizePath(fs.realpathSync(rawPath));
      if (!canonicalEntry.startsWith(canonicalSourcesDir + "/")) {
        errors.push({ rule_id: "RULE_SEMANTIC_REPARSE_POINT", message: `Reparse point escape detected in sources/: '${entry.name}'` });
      }
    }
  } catch (err: any) {
    return { valid: false, errors: [{ rule_id: "RULE_SEMANTIC_IO_FAILURE", message: `Disk scan failed: ${err.message}` }] };
  }

  // 2. Validate payload sources against manifest and compute streamed SHA-256
  for (const src of payload.sources) {
    if (!/^src-[a-z0-9-]+$/.test(src.source_id)) {
      errors.push({ rule_id: "RULE_SEMANTIC_SOURCE_ID_INVALID", message: `Invalid source_id format: '${src.source_id}'` });
    }
    if (seenSourceIds.has(src.source_id)) {
      errors.push({ rule_id: "RULE_SEMANTIC_DUPLICATE_ID", message: `Duplicate source_id detected: '${src.source_id}'` });
    }
    seenSourceIds.add(src.source_id);

    if (seenFilenames.has(src.staged_filename)) {
      errors.push({ rule_id: "RULE_SEMANTIC_DUPLICATE_FILENAME", message: `Duplicate staged_filename detected: '${src.staged_filename}'` });
    }
    seenFilenames.add(src.staged_filename);

    if (/[/\\]|\.\./.test(src.staged_filename)) {
      errors.push({ rule_id: "RULE_SEMANTIC_TRAVERSAL_DETECTED", message: `Illegal path traversal characters in staged_filename: '${src.staged_filename}'` });
      continue;
    }

    const extMatch = src.staged_filename.match(/\.([a-zA-Z0-9]+)$/);
    if (!extMatch || !src.staged_filename.startsWith(src.source_id + ".")) {
      errors.push({ rule_id: "RULE_SEMANTIC_FILENAME_BINDING", message: `staged_filename '${src.staged_filename}' must strictly derive from source_id '${src.source_id}'` });
    }

    if (!/^[a-f0-9]{64}$/.test(src.content_sha256)) {
      errors.push({ rule_id: "RULE_SEMANTIC_HASH_FORMAT_INVALID", message: `Invalid SHA-256 format in payload for '${src.staged_filename}'` });
    }

    const manifestEntry = manifest[src.staged_filename];
    if (!manifestEntry) {
      errors.push({ rule_id: "RULE_SEMANTIC_MANIFEST_MISSING_ENTRY", message: `staged_filename '${src.staged_filename}' not present in sources.manifest.json` });
    } else {
      if (!/^[a-f0-9]{64}$/.test(manifestEntry.content_sha256)) {
        errors.push({ rule_id: "RULE_SEMANTIC_MANIFEST_HASH_INVALID", message: `Invalid hash format in manifest for '${src.staged_filename}'` });
      }
      if (manifestEntry.content_sha256 !== src.content_sha256) {
        errors.push({ rule_id: "RULE_SEMANTIC_PAYLOAD_MANIFEST_MISMATCH", message: `Checksum mismatch for '${src.staged_filename}': manifest=${manifestEntry.content_sha256}, payload=${src.content_sha256}` });
      }
      if (manifestEntry.byte_size !== src.byte_size) {
        errors.push({ rule_id: "RULE_SEMANTIC_PAYLOAD_SIZE_MISMATCH", message: `Byte size mismatch for '${src.staged_filename}': manifest=${manifestEntry.byte_size}, payload=${src.byte_size}` });
      }

      const diskFilePath = path.join(rawSourcesDir, src.staged_filename);
      if (!fs.existsSync(diskFilePath)) {
        errors.push({ rule_id: "RULE_SEMANTIC_FILE_NOT_FOUND", message: `Source file missing on disk: '${src.staged_filename}'` });
      } else {
        try {
          const { sha256, byteLength } = await computeStreamHash(diskFilePath);
          if (sha256 !== src.content_sha256) {
            errors.push({ rule_id: "RULE_SEMANTIC_CHECKSUM_MISMATCH", message: `Disk hash (${sha256}) !== payload hash (${src.content_sha256}) for '${src.staged_filename}'` });
          }
          if (byteLength !== src.byte_size) {
            errors.push({ rule_id: "RULE_SEMANTIC_BYTE_SIZE_MISMATCH", message: `Disk size (${byteLength}) !== payload size (${src.byte_size}) for '${src.staged_filename}'` });
          }
        } catch (err: any) {
          errors.push({ rule_id: "RULE_SEMANTIC_STREAM_ERROR", message: `Stream read failure for '${src.staged_filename}': ${err.message}` });
        }
      }
    }
  }

  // 3. Reject orphan files on disk
  try {
    const diskEntries = fs.readdirSync(rawSourcesDir);
    for (const file of diskEntries) {
      if (!seenFilenames.has(file)) {
        errors.push({ rule_id: "RULE_SEMANTIC_ORPHAN_FILE", message: `Orphan unindexed file in sources/: '${file}'` });
      }
    }
  } catch {}

  // 4. Reject orphan entries in manifest
  for (const manifestFile of Object.keys(manifest)) {
    if (!seenFilenames.has(manifestFile)) {
      errors.push({ rule_id: "RULE_SEMANTIC_ORPHAN_MANIFEST_ENTRY", message: `Orphan entry in sources.manifest.json: '${manifestFile}'` });
    }
  }

  return { valid: errors.length === 0, errors };
}

function computeStreamHash(filePath: string): Promise<{ sha256: string; byteLength: number }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    let byteLength = 0;
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

    stream.on("data", (chunk) => {
      byteLength += chunk.length;
      hash.update(chunk);
    });
    stream.on("end", () => resolve({ sha256: hash.digest("hex"), byteLength }));
    stream.on("error", (err) => reject(err));
  });
}
```

### 3.3 Provider Output Safety Contract
To prevent malicious or malformed provider output from corrupting the vault:
```typescript
export interface VerifiedSourceArtifact {
  source_id: string;
  staged_filename: string;
  content_sha256: string;
  byte_size: number;
  mime_type: string;
  text_content?: string; // Strictly capped at 512 KB per source
  is_truncated: boolean;
}

export interface SynthesisContext {
  batch_id: string;
  topic_id: string;
  title: string;
  domain: string;
  sources: VerifiedSourceArtifact[];
  extracted_concepts: Array<{
    concept_slug: string;
    concept_title: string;
    description: string;
    codebase_adjacency: Array<{ repository_id: string; target_file: string; symbol_name: string }>;
  }>;
}

export interface SynthesisProposal {
  path: string;
  content: string;
  frontmatter: Record<string, any>;
}

export interface SynthesisProvider {
  synthesize(context: SynthesisContext): Promise<SynthesisProposal[]>;
}

export function validateSynthesisProposal(proposal: SynthesisProposal, canonicalWikiRoot: string): void {
  // 1. Output Path Containment Check
  if (!/^wiki\/(research|concepts)\/[a-z0-9-]+\.md$/.test(proposal.path.replace(/\\/g, "/"))) {
    throw new Error(`[SECURITY] Proposal path '${proposal.path}' violates allowed output pattern ^wiki/(research|concepts)/[a-z0-9-]+.md$`);
  }

  // 2. Prohibited Destination Check
  const normPath = proposal.path.replace(/\\/g, "/");
  if (normPath.includes("/_kb-sync-staging/") || normPath.includes("/.git/") || normPath.includes("/.nlm_pack/")) {
    throw new Error(`[SECURITY] Prohibited write target in proposal: '${proposal.path}'`);
  }

  // 3. Frontmatter Schema Check
  if (!proposal.frontmatter || proposal.frontmatter.category !== "wiki") {
    throw new Error(`[CONTRACT] Proposal frontmatter must declare category: "wiki"`);
  }
}
```

---

## 4. Hardened JSON Schema (v2.3.0)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "TRMTopicIngestionPayload",
  "type": "object",
  "required": [
    "schema_version",
    "batch_id",
    "topic_id",
    "title",
    "domain",
    "status",
    "summary",
    "sources",
    "extracted_concepts"
  ],
  "additionalProperties": false,
  "properties": {
    "schema_version": {
      "type": "string",
      "enum": ["2.3.0"]
    },
    "batch_id": {
      "type": "string",
      "pattern": "^[0-9]{8}-[0-9]{6}-[a-f0-9]{4,8}$"
    },
    "topic_id": {
      "type": "string",
      "pattern": "^trm:[a-z0-9-]+$",
      "minLength": 5,
      "maxLength": 64
    },
    "title": {
      "type": "string",
      "minLength": 3,
      "maxLength": 100
    },
    "domain": {
      "type": "string",
      "enum": ["kb-sync", "wiki", "notebooklm", "obsidian", "general", "architecture", "toolforge", "trm"]
    },
    "status": {
      "type": "string",
      "enum": ["active", "beta", "archived"]
    },
    "summary": {
      "type": "string",
      "minLength": 10,
      "maxLength": 300
    },
    "sources": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": [
          "source_id",
          "title",
          "origin_uri",
          "staged_filename",
          "content_sha256",
          "byte_size",
          "retrieved_at"
        ],
        "additionalProperties": false,
        "properties": {
          "source_id": {
            "type": "string",
            "pattern": "^src-[a-z0-9-]+$"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 150
          },
          "origin_uri": {
            "type": "string",
            "minLength": 3
          },
          "staged_filename": {
            "type": "string",
            "pattern": "^src-[a-z0-9-]+\\.[a-zA-Z0-9]+$"
          },
          "content_sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "byte_size": {
            "type": "integer",
            "minimum": 1
          },
          "retrieved_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    },
    "extracted_concepts": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["concept_slug", "concept_title", "description", "codebase_adjacency"],
        "additionalProperties": false,
        "properties": {
          "concept_slug": {
            "type": "string",
            "pattern": "^[a-z0-9-]+$",
            "minLength": 2,
            "maxLength": 64
          },
          "concept_title": {
            "type": "string",
            "minLength": 2,
            "maxLength": 100
          },
          "description": {
            "type": "string",
            "minLength": 10,
            "maxLength": 500
          },
          "codebase_adjacency": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["repository_id", "target_file", "symbol_name"],
              "additionalProperties": false,
              "properties": {
                "repository_id": {
                  "type": "string",
                  "enum": ["kb-sync", "toolforge", "trm", "charlie-deep-research", "rewrite-mcp"]
                },
                "target_file": {
                  "type": "string",
                  "description": "Repo-relative POSIX file path"
                },
                "symbol_name": {
                  "type": "string",
                  "pattern": "^[a-zA-Z0-9_$]+$",
                  "description": "Exported symbol name"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 5. Hardened Graft Query Engine & Operational Fallback Policy

Adjacency verification incorporates explicit Windows `graft.cmd` resolution, strict `shell: false` execution, realpath containment on callers, and Git commit validation:

```typescript
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

export interface GraftAdjacencyResult {
  confidence: "graft_verified" | "degraded_fallback_dag" | "unverified";
  callers: string[];
  diagnostic_message?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(p: string): string {
  let norm = p.replace(/\\/g, "/");
  const driveMatch = norm.match(/^([A-Za-z]):/);
  if (driveMatch) {
    norm = driveMatch[1].toLowerCase() + norm.slice(1);
  }
  return norm.replace(/\/+$/, "");
}

function resolveTrustedGraftBinary(): string | null {
  if (process.platform === "win32") {
    // Probe global npm bin and verified PATH locations
    const candidatePaths = [
      path.join(process.env.APPDATA || "", "npm", "graft.cmd"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "graft.cmd"),
    ];

    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) return candidate;
    }

    try {
      const probe = spawnSync("where.exe", ["graft.cmd"], { encoding: "utf8" });
      if (probe.status === 0 && probe.stdout) {
        const binPath = probe.stdout.split(/\r?\n/)[0].trim();
        if (fs.existsSync(binPath)) return binPath;
      }
    } catch {}

    return null;
  }
  return "graft";
}

/**
 * Resolves codebase adjacency with shell-free execution, realpath caller containment, and AST-safe scanning.
 */
export function resolveCodebaseAdjacency(
  repoRoot: string,
  targetFile: string,
  symbolName: string
): GraftAdjacencyResult {
  if (!/^[a-zA-Z0-9_$]+$/.test(symbolName)) {
    return {
      confidence: "unverified",
      callers: [],
      diagnostic_message: `Symbol name '${symbolName}' failed identifier regex`
    };
  }

  let canonicalRepoRoot: string;
  let canonicalTargetPath: string;

  try {
    canonicalRepoRoot = normalizePath(fs.realpathSync(repoRoot));
    const rawTargetPath = path.resolve(repoRoot, targetFile);
    if (!fs.existsSync(rawTargetPath)) {
      return {
        confidence: "unverified",
        callers: [],
        diagnostic_message: `Target file does not exist: '${targetFile}'`
      };
    }
    canonicalTargetPath = normalizePath(fs.realpathSync(rawTargetPath));
  } catch (err: any) {
    return { confidence: "unverified", callers: [], diagnostic_message: `Path resolution error: ${err.message}` };
  }

  if (!canonicalTargetPath.startsWith(canonicalRepoRoot + "/")) {
    return {
      confidence: "unverified",
      callers: [],
      diagnostic_message: `Reparse point escape detected: '${targetFile}' resolves outside repo root`
    };
  }

  const fileContent = fs.readFileSync(canonicalTargetPath, "utf8");
  const escapedSymbol = escapeRegex(symbolName);
  const symbolRegex = new RegExp(`\\b${escapedSymbol}\\b`);
  if (!symbolRegex.test(fileContent)) {
    return {
      confidence: "unverified",
      callers: [],
      diagnostic_message: `Symbol '${symbolName}' not found in target file '${targetFile}'`
    };
  }

  const graftBin = resolveTrustedGraftBinary();
  if (graftBin) {
    try {
      const proc = spawnSync(graftBin, ["callers", symbolName, "--depth", "1"], {
        cwd: canonicalRepoRoot,
        timeout: 5000,
        encoding: "utf8",
        shell: false
      });

      if (proc.status === 0 && proc.stdout) {
        const cleanStdout = proc.stdout.replace(/\x1b\[[0-9;]*m/g, "");
        const lines = cleanStdout.split(/\r?\n/).filter((l) => l.trim().length > 0);

        const matchedCallers: string[] = [];
        for (const line of lines) {
          const match = line.match(/calls\s*←\s*([^\s(]+)\s*\(([A-Za-z]:[\\/][^:]+|[^:]+):L\d+(-L\d+)?\)/);
          if (match) {
            const callerSymbol = match[1];
            const callerPathRaw = match[2];
            const rawCallerFull = path.resolve(canonicalRepoRoot, callerPathRaw);
            
            // Validate that caller file exists on disk and is contained in repository
            if (fs.existsSync(rawCallerFull)) {
              try {
                const canonicalCaller = normalizePath(fs.realpathSync(rawCallerFull));
                if (canonicalCaller.startsWith(canonicalRepoRoot + "/")) {
                  const relCaller = path.relative(canonicalRepoRoot, canonicalCaller).replace(/\\/g, "/");
                  matchedCallers.push(`\`${callerSymbol}\` in \`${relCaller}\``);
                }
              } catch {}
            }
          }
        }

        if (matchedCallers.length > 0) {
          return {
            confidence: "graft_verified",
            callers: matchedCallers
          };
        }
      }
    } catch (err: any) {
      // Proceed to fallback
    }
  }

  return fallbackToStaticDag(canonicalRepoRoot, targetFile, symbolName);
}

/**
 * Fallback resolver requiring mandatory Git commit HEAD match and whole-repo clean tree.
 */
export function fallbackToStaticDag(
  canonicalRepoRoot: string,
  targetFile: string,
  symbolName: string
): GraftAdjacencyResult {
  const dagPath = path.join(canonicalRepoRoot, ".nlm_pack/generations/dag-adjacency.json");
  if (!fs.existsSync(dagPath)) {
    return {
      confidence: "unverified",
      callers: [],
      diagnostic_message: "Static DAG cache not found"
    };
  }

  try {
    const dag = JSON.parse(fs.readFileSync(dagPath, "utf8"));
    
    let currentGitHead = "";
    let isWorkingTreeClean = true;
    try {
      const gitProc = spawnSync("git", ["rev-parse", "HEAD"], { cwd: canonicalRepoRoot, encoding: "utf8" });
      if (gitProc.status === 0) currentGitHead = gitProc.stdout.trim();

      const statusProc = spawnSync("git", ["status", "--porcelain"], { cwd: canonicalRepoRoot, encoding: "utf8" });
      if (statusProc.status === 0 && statusProc.stdout.trim().length > 0) {
        isWorkingTreeClean = false;
      }
    } catch {}

    if (!dag.commit_hash || !currentGitHead || dag.commit_hash !== currentGitHead) {
      return {
        confidence: "unverified",
        callers: [],
        diagnostic_message: `DAG revision mismatch: dag.commit_hash (${dag.commit_hash || 'none'}) != current HEAD (${currentGitHead || 'unknown'})`
      };
    }

    if (!isWorkingTreeClean) {
      return {
        confidence: "unverified",
        callers: [],
        diagnostic_message: "Working tree has uncommitted modifications; static DAG is stale"
      };
    }

    const normTargetKey = path.normalize(targetFile).replace(/\\/g, "/").replace(/^\.\//, "");
    const node = dag.nodes?.[normTargetKey];
    if (node && Array.isArray(node.dependents) && node.dependents.length > 0) {
      const validDependents: string[] = [];
      for (const dep of node.dependents) {
        const fullDep = path.resolve(canonicalRepoRoot, dep);
        if (fs.existsSync(fullDep)) {
          try {
            const canonicalDep = normalizePath(fs.realpathSync(fullDep));
            if (canonicalDep.startsWith(canonicalRepoRoot + "/")) {
              validDependents.push(`Module \`${path.relative(canonicalRepoRoot, canonicalDep).replace(/\\/g, "/")}\``);
            }
          } catch {}
        }
      }

      if (validDependents.length > 0) {
        return {
          confidence: "degraded_fallback_dag",
          callers: validDependents
        };
      }
    }
  } catch (err: any) {
    return {
      confidence: "unverified",
      callers: [],
      diagnostic_message: `DAG parse failure: ${err.message}`
    };
  }

  return {
    confidence: "unverified",
    callers: [],
    diagnostic_message: `No callers found for ${targetFile}:${symbolName}`
  };
}
```

---

## 6. Two-Phase Journaled Promotion & Atomic Lock Protocol

To guarantee crash consistency and multi-process safety:

### 6.1 Lock Acquisition & Nonce Protocol
1. **Atomic Open**: Opens `.kb-sync.lock` via `fs.openSync('.kb-sync.lock', 'wx')`.
2. **Lock Payload**:
   ```json
   {
     "owner_nonce": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
     "pid": 14820,
     "hostname": "WORKSTATION-01",
     "batch_id": "20260814-220000-8f1a",
     "created_at": "2026-08-15T00:00:00.000Z",
     "heartbeat_at": "2026-08-15T00:00:03.000Z"
   }
   ```
3. **Heartbeat Timer**: Background interval updates `heartbeat_at` every 3 seconds.
4. **Stale Lock Recovery**: If a lock exists with `heartbeat_at` older than 15 seconds, inspect PID liveness (`tasklist.exe /FI "PID eq <pid>"` on Windows). If dead, overwrite lock with new nonce.
5. **Promotion Revalidation**: Re-read `.kb-sync.lock` immediately prior to file promotion and index updates to assert `owner_nonce` still matches.

### 6.2 Preimage Journaling & Atomic Two-Phase Promotion
```json
{
  "batch_id": "20260814-220000-8f1a",
  "owner_nonce": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "state": "COMMITTING_FILES",
  "backup_dir": ".backup-20260814-220000-8f1a",
  "transaction_dir": ".transaction-20260814-220000-8f1a",
  "preimages": {
    "index_sha256": "3a4f...",
    "log_sha256": "7b1c..."
  },
  "receipts": {
    "created_files": ["wiki/research/new-topic.md"],
    "modified_files": ["wiki/concepts/existing-concept.md"],
    "index_updated": false,
    "log_appended": false
  }
}
```

### 6.3 Idempotent Crash Recovery Protocol
1. **State `COMMITTING_INDEX` or `COMPLETED`**:
   * Inspect `wiki/Log.md` for `batch_id`. If absent, append transaction receipt.
   * Inspect `wiki/Index.md` for topic slug. If absent, append entry.
   * Remove transaction and backup directories, release lock, transition to `CLEAN`.
2. **State `STAGING`, `VALIDATING`, or `COMMITTING_FILES`**:
   * Delete all newly created files listed in `receipts.created_files`.
   * Restore all pre-existing modified files listed in `receipts.modified_files` from `.backup-<batch_id>/`.
   * Restore `wiki/Index.md` and `wiki/Log.md` from preimages if modified.
   * Isolate the failed batch in `.quarantine/<batch_id>/`.
   * Remove transaction directories, release lock, and exit with code 1.

---

## 7. Package Script & Interface Definitions

*(Target interfaces to be implemented in repository manifests).*

### 7.1 Producer Repository (`C:\dev\trm\package.json`)
* **Existing Base Script**:
  * `"triage:intake": "ts-node src/cli/index.ts triage-intake"`
* **Target Script Addition**:
  * `"triage:export:staging": "ts-node src/cli/index.ts triage-intake --export-staging=../kb-sync/_kb-sync-staging/trm"`

### 7.2 Consumer Repository (`C:\dev\kb-sync\package.json`)
* **Target Script Additions (Node/TypeScript Native)**:
  ```json
  {
    "scripts": {
      "wiki:validate-staging:trm": "node modules/wiki/validate-staging-docs.mjs _kb-sync-staging/trm",
      "wiki:ingest:trm:offline": "npx tsx modules/obsidian/synthesize-wiki.ts --source trm --provider offline-template",
      "wiki:ingest:trm:auto": "npx tsx modules/obsidian/synthesize-wiki.ts --source trm --provider anthropic",
      "kb:pipeline:trm": "npm run wiki:validate-staging:trm && npm run wiki:ingest:trm:offline && npm run wiki:validate-contract",
      "test:trm": "node --test --experimental-strip-types tests/trm-pipeline.test.ts"
    }
  }
  ```

---

## 8. Preserved Sandbox Test Specification (`tests/trm-pipeline.test.ts`)

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { validateTrmPayloadSemantics } from "../modules/wiki/validate-trm-semantics.mjs";

describe("TRM Pipeline Hardened Sandbox Verification Suite", () => {
  let sandboxRoot: string;

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trm-test-sandbox-"));
    fs.mkdirSync(path.join(sandboxRoot, "wiki/research"), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, "wiki/concepts"), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, "_kb-sync-staging/trm"), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, ".quarantine"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  test("TEST-01: Semantic stream validator rejects checksum mismatch, orphan files, and path traversal", async () => {
    const batchId = "20260814-220000-t01";
    const batchDir = path.join(sandboxRoot, "_kb-sync-staging/trm", batchId);
    fs.mkdirSync(path.join(batchDir, "sources"), { recursive: true });

    // 1. Create source file on disk with mismatched content and orphan file
    const diskContent = "Actual content on disk that differs from manifest hash";
    fs.writeFileSync(path.join(batchDir, "sources/src-01.md"), diskContent);
    fs.writeFileSync(path.join(batchDir, "sources/orphan.md"), "Unindexed orphan file");

    const expectedHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    const payload = {
      schema_version: "2.3.0",
      batch_id: batchId,
      topic_id: "trm:test-topic",
      title: "Test Topic",
      domain: "wiki",
      status: "beta",
      summary: "Test summary description.",
      sources: [
        {
          source_id: "src-01",
          title: "Test Source",
          origin_uri: "https://example.com/test",
          staged_filename: "src-01.md",
          content_sha256: expectedHash,
          byte_size: 20,
          retrieved_at: new Date().toISOString()
        },
        {
          source_id: "src-traversal",
          title: "Traversal Attempt",
          origin_uri: "https://example.com/bad",
          staged_filename: "../escaped.md",
          content_sha256: expectedHash,
          byte_size: 20,
          retrieved_at: new Date().toISOString()
        }
      ],
      extracted_concepts: [{
        concept_slug: "test-concept",
        concept_title: "Test Concept",
        description: "Test concept description text.",
        codebase_adjacency: []
      }]
    };

    const manifest = {
      "src-01.md": {
        content_sha256: expectedHash,
        byte_size: 20
      },
      "../escaped.md": {
        content_sha256: expectedHash,
        byte_size: 20
      }
    };

    const result = await validateTrmPayloadSemantics(batchDir, payload, manifest);
    assert.equal(result.valid, false, "Must fail validation due to multiple semantic violations");
    
    const ruleIds = result.errors.map((e) => e.rule_id);
    assert.ok(ruleIds.includes("RULE_SEMANTIC_CHECKSUM_MISMATCH"), "Must cite RULE_SEMANTIC_CHECKSUM_MISMATCH");
    assert.ok(ruleIds.includes("RULE_SEMANTIC_ORPHAN_FILE"), "Must cite RULE_SEMANTIC_ORPHAN_FILE");
    assert.ok(ruleIds.includes("RULE_SEMANTIC_TRAVERSAL_DETECTED"), "Must cite RULE_SEMANTIC_TRAVERSAL_DETECTED");
  });

  test("TEST-02: Contract validator verifies link target resolution, allowed categories, and citation rules", () => {
    const notePath = path.join(sandboxRoot, "wiki/research/test-note.md");
    fs.writeFileSync(notePath, `---
title: Test Note
category: wiki
status: beta
source_citations:
  - source_id: src-01
    content_sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    rel_path: _kb-sync-staging/trm/20260814-220000-t01/sources/src-01.md
---
Valid citation: [cite:src-01]
Unresolved citation: [cite:src-missing-02]
Invalid link to missing concept: [[kb-sync/wiki/concepts/non-existent-concept]]
Invalid link to unallowed directory: [[kb-sync/wiki/unallowed-dir/some-doc]]
`);

    const result = spawnSync("node", [
      path.resolve(process.cwd(), "modules/wiki/validate-contract.mjs"),
      path.join(sandboxRoot, "wiki"),
      "--json"
    ], { encoding: "utf8" });

    assert.equal(result.status, 1, "Contract validator must exit code 1 on contract error");
    const parsed = JSON.parse(result.stdout);
    const ruleIds = parsed.errors.map((e: any) => e.rule_id);
    assert.ok(ruleIds.includes("ABSOLUTE_LINK_INVALID") || ruleIds.includes("LINK_TARGET_NOT_FOUND"), "Must flag invalid link target");
    assert.ok(ruleIds.includes("RULE_CITATION_SOURCE_UNRESOLVED"), "Must flag undeclared citation tag");
  });
});
```

---

## 9. Baseline Health & Implementation Authorization

### 9.1 Pre-Existing Repository Health (Recorded Baseline Receipts)
* **`C:\dev\trm` Verification**:
  * `npm run typecheck` — **PASS**
  * Focused TRM test suites (`triageIntake`, `validator`, `intakeManifest`) — **3 suites, 47 tests PASSED**.
* **`C:\dev\kb-sync` Verification**:
  * `npm run test:contract-cleanup` — **PASS**
  * `npm run test:path` — **PASS**
  * `npm run test:worker` — **PASS (9 tests)**.

### 9.2 Implementation Phase Execution Order
1. **Module Construction**:
   * Create `modules/wiki/validate-trm-semantics.mjs` implementing the programmatic stream and semantic validation rules.
   * Extend `modules/obsidian/synthesize-wiki.ts` with the `SynthesisContext` provider interface and two-phase journaled crash recovery.
   * Wire `tests/trm-pipeline.test.ts` into `kb-sync`.
2. **Package Script Wiring**:
   * Add `triage:export:staging` to `trm/package.json`.
   * Add `wiki:validate-staging:trm`, `wiki:ingest:trm:*`, `kb:pipeline:trm`, and `test:trm` to `kb-sync/package.json`.
3. **Execution & Receipt Preservation**:
   * Execute `npm run test:trm` and capture execution receipts into `wiki/Log.md`.

### 9.3 Gate Review Statement

```gate-result
{
  "schema_version": "2.3",
  "gate": "swarm-review",
  "status": "CONDITIONAL",
  "project_type": "software-specification",
  "lenses": ["contract", "ownership", "security", "operability", "testability"],
  "affected_artifacts": [
    "C:\\dev\\trm\\src\\cli\\index.ts",
    "C:\\dev\\trm\\src\\cli\\commands\\triageIntake.ts",
    "C:\\dev\\kb-sync\\modules\\obsidian\\synthesize-wiki.ts",
    "C:\\dev\\kb-sync\\modules\\wiki\\validate-staging-docs.mjs",
    "C:\\dev\\kb-sync\\modules\\wiki\\validate-contract.mjs",
    "C:\\dev\\kb-sync\\package.json",
    "C:\\dev\\trm\\package.json",
    "C:\\dev\\kb-sync\\tests\\trm-pipeline.test.ts"
  ],
  "accounting": {
    "duration_ms": 0,
    "lenses_invoked": 5,
    "cost_usd": 0.0
  },
  "remediation": [
    "Set approval status to DRAFT — READY FOR TIER 1 REVIEW / APPROVED FOR IMPLEMENTATION PLANNING",
    "Constrained link categories strictly to wiki/(research|concepts)/",
    "Established unified authoritative source-record lookup chain across body, frontmatter, payload, manifest, and disk",
    "Specified SynthesisProposal output safety contract enforcing path containment and category restrictions",
    "Hardened trusted Graft binary discovery and caller file disk-existence checks",
    "Specified atomic lock acquisition with owner nonce, heartbeat, and promotion revalidation",
    "Specified two-phase journaled crash recovery with Index.md and Log.md preimages",
    "Defined comprehensive sandbox test suite exercising CHECKSUM_MISMATCH, TRAVERSAL_DETECTED, and RULE_CITATION_SOURCE_UNRESOLVED"
  ],
  "receipts_ref": null,
  "supersedes": "swarm-review-2026-08-15-trm-v2.2.0-final-r11",
  "gate_id": "swarm-review-2026-08-15-trm-v2.3.0-final",
  "emitted_at": "2026-08-15T00:52:00-04:00"
}
```
