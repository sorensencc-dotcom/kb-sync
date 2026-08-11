import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import jsYaml from "js-yaml";
import { validateLessonSchema } from "../wiki/validate-contract.mjs";
import { createProvider, SynthesisProvider, SynthesisInput, SynthesisProposal, ProviderError } from "./providers/index.js";

// --- LOG HELPERS ---
function logInfo(msg: string) {
  console.error(`\x1b[32m[WIKI-SYNTHESIZE] [INFO] ${msg}\x1b[0m`);
}

function logWarn(msg: string) {
  console.error(`\x1b[33m[WIKI-SYNTHESIZE] [WARN] ${msg}\x1b[0m`);
}

function logError(msg: string) {
  console.error(`\x1b[31m[WIKI-SYNTHESIZE] [ERROR] ${msg}\x1b[0m`);
}

// --- ALLOWED CONTRACT CONSTANTS ---
const ALLOWED_CATEGORIES = new Set([
  "daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki", "lessons"
]);
const ALLOWED_STATUSES = new Set(["active", "beta", "archived"]);

// --- CANONICAL PATH CONTAINMENT ---
function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const driveMatch = normalized.match(/^([A-Za-z]):/);
  if (driveMatch) {
    normalized = driveMatch[1].toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

function getCanonicalPath(targetPath: string): string {
  try {
    if (fs.existsSync(targetPath)) {
      return normalizePath(fs.realpathSync(targetPath));
    }
    const parent = path.dirname(targetPath);
    if (fs.existsSync(parent)) {
      const canonicalParent = fs.realpathSync(parent);
      return normalizePath(path.join(canonicalParent, path.basename(targetPath)));
    }
  } catch (err) {
    // Fall back to normalized path
  }
  return normalizePath(path.resolve(targetPath));
}

function assertPathContainment(canonicalWikiRoot: string, targetPath: string): void {
  const canonicalTarget = getCanonicalPath(targetPath);
  const rel = path.relative(canonicalWikiRoot, canonicalTarget);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`[SECURITY] Target path '${targetPath}' escapes wiki root '${canonicalWikiRoot}'. Relative path: '${rel}'`);
  }

  try {
    if (fs.existsSync(targetPath) && fs.lstatSync(targetPath).isSymbolicLink()) {
      const real = fs.realpathSync(targetPath);
      const realRel = path.relative(canonicalWikiRoot, normalizePath(real));
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        throw new Error(`[SECURITY] Symlink '${targetPath}' points outside wiki root: '${real}'`);
      }
    }
  } catch (err: any) {
    if (err.message.includes("[SECURITY]")) throw err;
  }

  if (canonicalTarget.includes("/_kb-sync-staging/") || canonicalTarget.includes("/.git/")) {
    throw new Error(`[SECURITY] Prohibited write target: '${targetPath}'`);
  }
}

// --- RECOVERY MANIFEST INTERFACE ---
export interface RecoveryManifest {
  sessionId: string;
  timestamp: string;
  backupPath: string;
  transactionPath: string;
  state: "STAGING" | "COMMITTING_PROMOTION" | "COMPLETED" | "RECOVERED";
  manifestHash: string;
}

// --- STARTUP CRASH RECOVERY & EXTERNAL QUARANTINE ---
function executeStartupRecovery(vaultRoot: string, wikiDir: string, canonicalWikiRoot: string): void {
  if (!fs.existsSync(wikiDir)) return;

  const entries = fs.readdirSync(wikiDir);
  const backupDirs = entries.filter((e) => e.startsWith(".backup-"));

  for (const backupDirName of backupDirs) {
    const backupPath = path.join(wikiDir, backupDirName);
    const manifestPath = path.join(backupPath, ".recovery-manifest.json");

    let recoveryManifest: RecoveryManifest | null = null;
    if (fs.existsSync(manifestPath)) {
      try {
        recoveryManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      } catch (err) {
        logWarn(`Could not parse recovery manifest in '${backupDirName}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (recoveryManifest && recoveryManifest.state === "RECOVERED") {
      logInfo(`Startup Recovery: Backup '${backupDirName}' already recovered. Purging...`);
      fs.rmSync(backupPath, { recursive: true, force: true });
      continue;
    }

    // Verify backup path containment
    let isValidBackup = false;
    if (recoveryManifest && recoveryManifest.state === "COMMITTING_PROMOTION") {
      try {
        assertPathContainment(canonicalWikiRoot, backupPath);

        // Validate transactionPath parent containment without calling realpath on missing file
        const tPath = recoveryManifest.transactionPath;
        const tParent = path.dirname(tPath);
        if (fs.existsSync(tParent)) {
          const canonicalTParent = normalizePath(fs.realpathSync(tParent));
          const relTParent = path.relative(canonicalWikiRoot, canonicalTParent);
          if (!relTParent.startsWith("..") && !path.isAbsolute(relTParent)) {
            isValidBackup = true;
          }
        }
      } catch (err) {
        logWarn(`Path containment validation failed for recovery candidate '${backupDirName}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (isValidBackup) {
      logWarn(`Startup Recovery: Found valid interrupted promotion backup '${backupDirName}'. Restoring vault state...`);
      try {
        const items = fs.readdirSync(backupPath);
        for (const item of items) {
          if (item === ".recovery-manifest.json") continue;
          const srcItem = path.join(backupPath, item);
          const destItem = path.join(wikiDir, item);
          if (fs.statSync(srcItem).isDirectory()) {
            fs.cpSync(srcItem, destItem, { recursive: true });
          } else {
            fs.copyFileSync(srcItem, destItem);
          }
        }
        recoveryManifest!.state = "RECOVERED";
        fs.writeFileSync(manifestPath, JSON.stringify(recoveryManifest, null, 2), "utf-8");
        fs.rmSync(backupPath, { recursive: true, force: true });
        logInfo(`✓ Crash recovery complete: Restored from '${backupDirName}'.`);
      } catch (err) {
        logError(`Failed during crash recovery of '${backupDirName}': ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // Quarantine unmarked or invalid backup outside wiki root: $OBSIDIAN_VAULT_ROOT/.quarantine/
      const quarantineRoot = path.join(vaultRoot, ".quarantine");
      if (!fs.existsSync(quarantineRoot)) {
        fs.mkdirSync(quarantineRoot, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const destQuarantine = path.join(quarantineRoot, `quarantine-${timestamp}-${backupDirName}`);
      logWarn(`Startup Recovery: Unmarked or invalid backup directory '${backupDirName}' detected.`);
      logWarn(`Moving candidate outside wiki tree to: '${destQuarantine}'`);

      try {
        fs.renameSync(backupPath, destQuarantine);
        logInfo(`✓ Quarantine complete for '${backupDirName}'.`);
      } catch (err) {
        logError(`Failed to quarantine '${backupDirName}': ${err instanceof Error ? err.message : String(err)}. Backup left untouched.`);
      }
    }
  }

  // Purge stale transaction workspaces
  const transactDirs = entries.filter((e) => e.startsWith(".transact-"));
  for (const tDir of transactDirs) {
    const tPath = path.join(wikiDir, tDir);
    logWarn(`Startup Recovery: Cleaning up leftover transaction workspace '${tDir}'...`);
    fs.rmSync(tPath, { recursive: true, force: true });
  }
}

// --- CONTENT-AWARE IDEMPOTENCY HASH ---
function computeManifestContentHash(stagingPath: string, manifestLines: string[]): string {
  const hasher = crypto.createHash("sha256");
  const sortedLines = [...manifestLines].sort();
  hasher.update(sortedLines.join("\n"));

  for (const relFile of sortedLines) {
    const filePath = path.join(stagingPath, relFile);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      hasher.update(`\nFILE:${relFile}\n`);
      hasher.update(fs.readFileSync(filePath));
    }
  }

  return hasher.digest("hex").slice(0, 16);
}

// --- PROPOSAL SCHEMA VALIDATION ---
function validateProposalSchema(proposal: SynthesisProposal, stagedManifestSet: Set<string>): string[] {
  const errors: string[] = [];

  if (!proposal.title || typeof proposal.title !== "string" || proposal.title.trim().length === 0) {
    errors.push("Missing mandatory proposal field 'title'");
  }

  if (!proposal.category || !ALLOWED_CATEGORIES.has(proposal.category.toLowerCase())) {
    errors.push(`Non-canonical proposal category '${proposal.category}'. Allowed: [${Array.from(ALLOWED_CATEGORIES).join(", ")}]`);
  }

  if (!proposal.status || !ALLOWED_STATUSES.has(proposal.status.toLowerCase())) {
    errors.push(`Non-canonical proposal status '${proposal.status}'. Allowed: [${Array.from(ALLOWED_STATUSES).join(", ")}]`);
  }

  if (!proposal.vaultPath || !proposal.vaultPath.endsWith(".md") || proposal.vaultPath.includes("..")) {
    errors.push(`Invalid vaultPath '${proposal.vaultPath}'. Must end in .md and have no '..' path traversal.`);
  }

  const ALLOWED_BOUNDARIES = ["kb-sync/", "entities/", "concepts/", "utilities/", "daemons/", "scripts/", "tests/", "lessons/", "kb-sync/lessons/"];
  const isRootSpecial = proposal.vaultPath === "Log.md" || proposal.vaultPath === "Index.md";
  const isValidBoundary = ALLOWED_BOUNDARIES.some((b) => proposal.vaultPath.startsWith(b)) || isRootSpecial;
  if (!isValidBoundary) {
    errors.push(`Invalid vaultPath '${proposal.vaultPath}'. Must start with a canonical vault directory boundary.`);
  }

  if (!Array.isArray(proposal.citations)) {
    errors.push("Proposal 'citations' must be an array of staged source relative paths.");
  } else {
    for (const citation of proposal.citations) {
      if (!stagedManifestSet.has(citation)) {
        errors.push(`Unmanifested citation '${citation}' declared in proposal '${proposal.title}'`);
      }
    }
  }

  return errors;
}

// --- CLI ARGUMENT PARSING ---
interface CLIConfig {
  providerName: string;
  stagingPath?: string;
  vaultRoot?: string;
  configPath?: string;
  dryRun: boolean;
  force: boolean;
  allowRemoteEndpoint: boolean;
  enrichLessons: boolean;
  localEndpoint?: string;
  model?: string;
}

function parseCLIArgs(): CLIConfig {
  const args = process.argv.slice(2);
  let providerName = "anthropic";
  let dryRun = false;
  let force = false;
  let allowRemoteEndpoint = false;
  let enrichLessons = false;
  let stagingPath: string | undefined;
  let vaultRoot: string | undefined;
  let configPath: string | undefined;
  let localEndpoint: string | undefined;
  let model: string | undefined;

  let hasAutoSynthesize = false;
  let hasOfflineTemplate = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--auto-synthesize" || arg === "auto-synthesize") {
      hasAutoSynthesize = true;
      providerName = "anthropic";
    } else if (arg === "--offline-template" || arg === "offline-template") {
      hasOfflineTemplate = true;
      providerName = "offline-template";
    } else if (arg === "--enrich-lessons" || arg === "enrich-lessons") {
      enrichLessons = true;
    } else if (arg === "--provider") {
      providerName = args[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--allow-remote-endpoint") {
      allowRemoteEndpoint = true;
    } else if (arg === "--local-endpoint") {
      localEndpoint = args[++i];
    } else if (arg === "--model") {
      model = args[++i];
    } else if (arg === "--staging-path") {
      stagingPath = args[++i];
    } else if (arg === "--vault-root") {
      vaultRoot = args[++i];
    } else if (arg === "--config") {
      configPath = args[++i];
    } else if (!arg.startsWith("-") && !stagingPath) {
      if (arg !== "validate" && arg !== "prompt") {
        stagingPath = arg;
      }
    }
  }

  if (hasAutoSynthesize && hasOfflineTemplate) {
    throw new Error("[ERROR] Mutually exclusive flags: cannot supply both --auto-synthesize and --offline-template.");
  }

  return {
    providerName,
    stagingPath,
    vaultRoot,
    configPath,
    dryRun,
    force,
    allowRemoteEndpoint,
    localEndpoint,
    model,
  };
}

// --- MAIN SYNTHESIS ENGINE ---
async function main() {
  logInfo("Starting Headless Wiki Synthesis Engine...");
  const cli = parseCLIArgs();

  // 1. Resolve Vault & Config
  const repoRoot = normalizePath(path.resolve(process.cwd()));
  const configFile = cli.configPath || path.join(repoRoot, "configs", "obsidian.yaml");

  let vaultRoot = cli.vaultRoot || process.env.OBSIDIAN_VAULT_ROOT;
  if (!vaultRoot && fs.existsSync(configFile)) {
    const match = fs.readFileSync(configFile, "utf-8").match(/^\s*vault_root\s*[:=]\s*(.+)$/m);
    if (match) vaultRoot = match[1].trim().replace(/["']/g, "");
  }

  if (!vaultRoot) {
    logError("OBSIDIAN_VAULT_ROOT not configured.");
    process.exit(1);
  }

  vaultRoot = normalizePath(path.resolve(vaultRoot));
  const wikiDir = path.join(vaultRoot, "wiki");
  const canonicalWikiRoot = getCanonicalPath(wikiDir);

  logInfo(`Resolved Vault Root: ${vaultRoot}`);
  logInfo(`Resolved Wiki Directory: ${wikiDir}`);

  // 2. Startup Crash Recovery
  executeStartupRecovery(vaultRoot, wikiDir, canonicalWikiRoot);

  // 3. Resolve Staging Path
  let stagingPath = cli.stagingPath;
  if (!stagingPath) {
    const defaultStagingBase = path.join(vaultRoot, "_kb-sync-staging");
    if (fs.existsSync(defaultStagingBase)) {
      const timestampDirs = fs
        .readdirSync(defaultStagingBase)
        .filter((d) => /^\d{8}-\d{6}$/.test(d))
        .sort()
        .reverse();
      if (timestampDirs.length > 0) {
        stagingPath = path.join(defaultStagingBase, timestampDirs[0]);
      }
    }
  }

  if (!stagingPath || !fs.existsSync(stagingPath)) {
    logError(`Staging path not found: '${stagingPath || "none"}'`);
    process.exit(1);
  }

  stagingPath = normalizePath(path.resolve(stagingPath));
  logInfo(`Staging Path: ${stagingPath}`);

  // 4. Validate Manifest
  const manifestFile = path.join(stagingPath, "FILES.manifest.txt");
  if (!fs.existsSync(manifestFile)) {
    logError(`FILES.manifest.txt not found in staging path: ${manifestFile}`);
    process.exit(1);
  }

  const manifestLines = fs
    .readFileSync(manifestFile, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  logInfo(`Manifest file validated: ${manifestLines.length} files listed.`);

  // 5. Idempotency Hash Check
  const manifestHash = computeManifestContentHash(stagingPath, manifestLines);
  logInfo(`Manifest Content Hash (SHA-256): ${manifestHash}`);

  const logFilePath = path.join(wikiDir, "Log.md");
  if (fs.existsSync(logFilePath)) {
    const logContent = fs.readFileSync(logFilePath, "utf-8");
    if (logContent.includes(`session ${manifestHash}`) && !cli.force) {
      logInfo(`✓ Idempotency Check: Manifest hash ${manifestHash} was already synthesized in Log.md.`);
      logInfo("Skipping repeat synthesis run. Pass --force to re-run.");
      process.exit(0);
    }
  }

  if (cli.force) {
    logWarn(`--force specified: Re-running synthesis for manifest hash ${manifestHash}.`);
  }

  // 6. Read Staged Files & Existing Wiki Pages
  const stagedFiles: Array<{ relativePath: string; content: string }> = [];
  for (const relFile of manifestLines) {
    const fullPath = path.join(stagingPath, relFile);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      stagedFiles.push({
        relativePath: relFile,
        content: fs.readFileSync(fullPath, "utf-8"),
      });
    }
  }

  const existingWikiFiles: Array<{ relativePath: string; content: string }> = [];
  if (fs.existsSync(wikiDir)) {
    const readWikiRecursive = (dir: string) => {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
          readWikiRecursive(full);
        } else if (entry.endsWith(".md")) {
          const rel = path.relative(wikiDir, full).replace(/\\/g, "/");
          existingWikiFiles.push({
            relativePath: rel,
            content: fs.readFileSync(full, "utf-8"),
          });
        }
      }
    };
    readWikiRecursive(wikiDir);
  }

  // 7. Instantiate Provider & Synthesize Proposals
  logInfo(`Initializing provider: '${cli.providerName}'...`);
  const provider: SynthesisProvider = await createProvider(cli.providerName, {
    model: cli.model,
    localEndpoint: cli.localEndpoint,
    allowRemoteEndpoint: cli.allowRemoteEndpoint,
  });

  const input: SynthesisInput = {
    stagingPath,
    manifestHash,
    stagedFiles,
    existingWikiFiles,
    schemaDoc: "docs/targets/obsidian.md",
    model: cli.model,
    localEndpoint: cli.localEndpoint,
    allowRemoteEndpoint: cli.allowRemoteEndpoint,
  };

  logInfo(`Invoking synthesis via provider '${provider.name}'...`);
  const providerOutput = await provider.synthesize(input);
  logInfo(`Received ${providerOutput.proposals.length} raw proposals from provider.`);

  // 8. Citation & Schema Validation
  const stagedManifestSet = new Set(manifestLines);
  const acceptedProposals: SynthesisProposal[] = [];
  const rejectedProposals: SynthesisProposal[] = [];

  for (const prop of providerOutput.proposals) {
    const schemaErrors = validateProposalSchema(prop, stagedManifestSet);
    if (schemaErrors.length > 0) {
      logWarn(`Proposal '${prop.title || "untitled"}' rejected due to schema errors: ${schemaErrors.join("; ")}`);
      rejectedProposals.push(prop);
    } else {
      acceptedProposals.push(prop);
    }
  }

  if (acceptedProposals.length === 0) {
    logError("Synthesis aborted: 100% of proposals failed schema/citation verification or provider returned 0 valid proposals.");
    process.exit(1);
  }

  logInfo(`Schema & Citation Verification: ${acceptedProposals.length} proposals accepted, ${rejectedProposals.length} proposals rejected.`);

  // 9. Transaction Workspace Setup
  const sessionId = `${Date.now()}-${manifestHash}`;
  const transactDir = path.join(wikiDir, `.transact-${sessionId}`);
  const transactWikiRoot = path.join(transactDir, "wiki");
  const backupDir = path.join(wikiDir, `.backup-${sessionId}`);

  assertPathContainment(canonicalWikiRoot, transactDir);

  if (fs.existsSync(transactDir)) {
    fs.rmSync(transactDir, { recursive: true, force: true });
  }

  fs.mkdirSync(transactWikiRoot, { recursive: true });

  // Copy existing wiki pages to transaction workspace
  if (fs.existsSync(wikiDir)) {
    const copyWikiToTransact = (src: string, dest: string) => {
      const items = fs.readdirSync(src);
      for (const item of items) {
        if (item.startsWith(".")) continue;
        const sPath = path.join(src, item);
        const dPath = path.join(dest, item);
        if (fs.statSync(sPath).isDirectory()) {
          fs.mkdirSync(dPath, { recursive: true });
          copyWikiToTransact(sPath, dPath);
        } else {
          fs.copyFileSync(sPath, dPath);
        }
      }
    };
    copyWikiToTransact(wikiDir, transactWikiRoot);
  }

  // 10. Write Accepted Proposals into Transaction Workspace
  const createdOrModifiedPaths: string[] = [];

  for (const prop of acceptedProposals) {
    const relTarget = prop.vaultPath;
    const targetFile = path.join(transactWikiRoot, relTarget);

    assertPathContainment(getCanonicalPath(transactWikiRoot), targetFile);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });

    let content = prop.body;
    if (!content.startsWith("---")) {
      const draftHeader = prop.draft ? `draft: true\n` : "";
      content = `---
title: "${prop.title}"
category: "${prop.category}"
status: "${prop.status}"
${draftHeader}citations: ${JSON.stringify(prop.citations)}
---

# ${prop.title}

## Summary
${prop.summary}

## Source Citations
${(prop.citations || []).map((c) => `- Staged: \`${c}\``).join("\n")}
`;
    }

    fs.writeFileSync(targetFile, content.trim() + "\n", "utf-8");
    createdOrModifiedPaths.push(relTarget);
  }

  // 10b. Process any unenriched lessons in the transaction workspace if --enrich-lessons flag is set
  if (cli.enrichLessons) {
    const enrichedLessons = await processUnenrichedLessons(transactWikiRoot, provider, lessonsDirName);
    if (enrichedLessons.length > 0) {
      logInfo(`Enriched ${enrichedLessons.length} lesson node(s) in transaction workspace.`);
      createdOrModifiedPaths.push(...enrichedLessons);
    }
  }

  // Deterministically generate Index.md and Log.md with contract frontmatter in Transaction Workspace
  const indexFilePath = path.join(transactWikiRoot, "Index.md");
  const indexContent = `---
title: "Wiki Index"
category: "wiki"
status: "active"
---

# Wiki Index

## Pages
${createdOrModifiedPaths.map((p) => {
  const cleanP = p.replace(/\.md$/, "");
  const targetLink = cleanP.startsWith("kb-sync/") ? cleanP : `kb-sync/${cleanP}`;
  return `- [[${targetLink}]]`;
}).join("\n") || "- None"}
`;

  fs.writeFileSync(indexFilePath, indexContent, "utf-8");
  const nestedIndexFilePath = path.join(transactWikiRoot, "kb-sync", "wiki", "Index.md");
  fs.mkdirSync(path.dirname(nestedIndexFilePath), { recursive: true });
  fs.writeFileSync(nestedIndexFilePath, indexContent, "utf-8");
  createdOrModifiedPaths.push("Index.md");

  const transactLogPath = path.join(transactWikiRoot, "Log.md");
  if (!fs.existsSync(transactLogPath)) {
    const initialLogHeader = `---
title: "Wiki Activity Log"
category: "wiki"
status: "active"
---

# Wiki Activity Log
`;
    fs.writeFileSync(transactLogPath, initialLogHeader, "utf-8");
  }

  // 11. Phase 5 Contract Validator Integration
  logInfo("Executing Phase 5 Contract Validator (validate-contract.mjs) on transaction workspace...");
  const validatorScript = path.join(repoRoot, "modules", "wiki", "validate-contract.mjs");

  const validatorResult = spawnSync("node", [validatorScript, transactWikiRoot], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

  if (validatorResult.status !== 0) {
    logError("Phase 5 Contract Validator Failed! Output:");
    if (validatorResult.stdout) console.log(validatorResult.stdout);
    if (validatorResult.stderr) console.error(validatorResult.stderr);
    logError("Transaction aborted. Target vault remains untouched and Log.md was NOT updated.");
    fs.rmSync(transactDir, { recursive: true, force: true });
    process.exit(1);
  }

  logInfo("✓ Phase 5 Contract Validator PASSED (100%).");

  // 12. Dry Run Mode Check
  if (cli.dryRun) {
    logInfo("========================================================================");
    logInfo("DRY-RUN COMPLETE: Planned Changes Validated (Vault Untouched)");
    logInfo("========================================================================");
    logInfo(`Provider: ${providerOutput.providerName} (${providerOutput.model})`);
    logInfo(`Manifest Hash: ${manifestHash}`);
    logInfo(`Files Validated: ${createdOrModifiedPaths.length}`);
    createdOrModifiedPaths.forEach((p) => logInfo(`  - [WOULD WRITE] wiki/${p}`));
    fs.rmSync(transactDir, { recursive: true, force: true });
    process.exit(0);
  }

  // 13. Journaled Recoverable Promotion
  logInfo("Initiating Journaled Recoverable Promotion...");

  // Snapshot Backup
  assertPathContainment(canonicalWikiRoot, backupDir);
  if (fs.existsSync(wikiDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    const items = fs.readdirSync(wikiDir);
    for (const item of items) {
      if (item.startsWith(".")) continue;
      const sPath = path.join(wikiDir, item);
      const dPath = path.join(backupDir, item);
      if (fs.statSync(sPath).isDirectory()) {
        fs.cpSync(sPath, dPath, { recursive: true });
      } else {
        fs.copyFileSync(sPath, dPath);
      }
    }
  }

  // Write explicit Recovery Manifest
  const recoveryManifest: RecoveryManifest = {
    sessionId,
    timestamp: new Date().toISOString(),
    backupPath: backupDir,
    transactionPath: transactDir,
    state: "COMMITTING_PROMOTION",
    manifestHash,
  };

  const backupManifestPath = path.join(backupDir, ".recovery-manifest.json");
  fs.writeFileSync(backupManifestPath, JSON.stringify(recoveryManifest, null, 2), "utf-8");

  try {
    // Copy synthesized files from transaction workspace to live wiki
    const copyTransactToWiki = (src: string, dest: string) => {
      const items = fs.readdirSync(src);
      for (const item of items) {
        const sPath = path.join(src, item);
        const dPath = path.join(dest, item);
        if (fs.statSync(sPath).isDirectory()) {
          fs.mkdirSync(dPath, { recursive: true });
          copyTransactToWiki(sPath, dPath);
        } else {
          fs.copyFileSync(sPath, dPath);
        }
      }
    };
    copyTransactToWiki(transactWikiRoot, wikiDir);

    // Append to Log.md
    const dateStr = new Date().toISOString().replace("T", " ").slice(0, 16);
    const forceFlag = cli.force ? " (forced re-run)" : "";
    const logEntry = `
## [${dateStr}] auto-synthesize${forceFlag}

- Provider: \`${providerOutput.providerName}\` (\`${providerOutput.model}\`)
- Session Hash: \`${manifestHash}\`
- Staging Path: \`${stagingPath}\`
- Proposals Accepted: ${acceptedProposals.length} (${rejectedProposals.length} rejected)
- Created/Updated Files:
${createdOrModifiedPaths.map((p) => `  - \`wiki/${p}\``).join("\n")}
`;

    fs.appendFileSync(logFilePath, logEntry, "utf-8");

    // Update manifest to COMPLETED and clean up
    recoveryManifest.state = "COMPLETED";
    fs.writeFileSync(backupManifestPath, JSON.stringify(recoveryManifest, null, 2), "utf-8");

    fs.rmSync(transactDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });

    logInfo("✓ Journaled Recoverable Promotion Complete.");
  } catch (err: any) {
    logError(`Promotion failed midway: ${err.message}. Initiating rollback from backup snapshot...`);
    if (fs.existsSync(backupDir)) {
      const items = fs.readdirSync(backupDir);
      for (const item of items) {
        if (item === ".recovery-manifest.json") continue;
        const sPath = path.join(backupDir, item);
        const dPath = path.join(wikiDir, item);
        if (fs.statSync(sPath).isDirectory()) {
          fs.cpSync(sPath, dPath, { recursive: true });
        } else {
          fs.copyFileSync(sPath, dPath);
        }
      }
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
    fs.rmSync(transactDir, { recursive: true, force: true });
    logError("Rollback complete. Target vault restored.");
    process.exit(1);
  }

  // 14. Deterministic PR Reviewer Report
  console.log("");
  console.log("========================================================================");
  console.log("PR REVIEWER SUMMARY REPORT (Autonomous Synthesis Complete)");
  console.log("========================================================================");
  console.log(`Execution Mode   : --provider ${providerOutput.providerName}`);
  console.log(`Model            : ${providerOutput.model}`);
  console.log(`Session Hash     : ${manifestHash}`);
  console.log(`Staging Path     : ${stagingPath}`);
  console.log(`Vault Root       : ${vaultRoot}`);
  console.log(`Proposals Passed : ${acceptedProposals.length}`);
  console.log(`Contract Lint    : PASSED (100%)`);
  console.log(`Log File Updated : wiki/Log.md`);
  console.log("------------------------------------------------------------------------");
  console.log("Files Synthesized:");
  createdOrModifiedPaths.forEach((p) => console.log(`  - wiki/${p}`));
  console.log("------------------------------------------------------------------------");
  console.log("PR Review Instructions:");
  console.log("  1. Run 'git status' to inspect modified wiki pages.");
  console.log("  2. Run 'git diff wiki/' to review synthesized changes.");
  console.log("  3. Approve and commit changes to open PR.");
  console.log("========================================================================");
  console.log("");

  process.exit(0);
}

// --- LESSON ENRICHMENT ENGINE ---
export interface LessonAnalysisPayload {
  rootCause: string;
  prevention: string;
}

export async function enrichLessonNode(
  content: string,
  analysis: LessonAnalysisPayload
): Promise<string> {
  // Fail-soft validation: missing or invalid payload returns original content
  if (
    !analysis ||
    typeof analysis.rootCause !== "string" ||
    typeof analysis.prevention !== "string"
  ) {
    return content;
  }

  const rootCause = analysis.rootCause.trim();
  const prevention = analysis.prevention.trim();

  if (!rootCause || !prevention) {
    return content;
  }

  // Payload length check: total payload or individual fields <= 10000 chars
  if (rootCause.length > 10000 || prevention.length > 10000 || (rootCause.length + prevention.length) > 10000) {
    return content;
  }

  // Case-insensitive heading regex matchers for Section 2 and Section 4
  const sec2Match = content.match(/#### 2\. Root Cause Analysis/i);
  const sec4Match = content.match(/#### 4\. Source Citations/i);

  if (!sec2Match || !sec4Match || sec2Match.index === undefined || sec4Match.index === undefined) {
    return content;
  }

  const index2 = sec2Match.index;
  const index4 = sec4Match.index;

  if (index2 >= index4) {
    return content;
  }

  // Section 1 slice: byte-for-byte from start up to Section 2 heading start, with "needs-enrichment" stripped from frontmatter
  let sec1Slice = content.slice(0, index2);

  // Strip "needs-enrichment" tag from tags in frontmatter
  // 1. Inline array: tags: [...]
  sec1Slice = sec1Slice.replace(/tags:\s*\[(.*?)\]/s, (match, p1) => {
    const tags = p1
      .split(",")
      .map((t: string) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    const filtered = tags.filter((t: string) => t !== "needs-enrichment");
    return `tags: [${filtered.map((t: string) => `"${t}"`).join(", ")}]`;
  });

  // 2. YAML list format: - needs-enrichment
  sec1Slice = sec1Slice.replace(/^\s*-\s*["']?needs-enrichment["']?\r?\n/gm, "");

  // Section 4 slice: byte-for-byte from Section 4 heading to end of content
  const sec4Slice = content.slice(index4);

  // Replacement Sections 2 & 3
  const sec2And3 = `#### 2. Root Cause Analysis\n${rootCause}\n\n#### 3. Resolution & Prevention\n${prevention}\n\n`;

  return sec1Slice + sec2And3 + sec4Slice;
}

export async function processUnenrichedLessons(
  wikiDir: string,
  provider: SynthesisProvider,
  lessonsDirName: string = "lessons"
): Promise<string[]> {
  const lessonsDir = path.join(wikiDir, lessonsDirName);
  if (!fs.existsSync(lessonsDir)) {
    return [];
  }

  const files = fs.readdirSync(lessonsDir).filter((f) => f.endsWith(".md"));
  const enrichedFiles: string[] = [];

  for (const file of files) {
    const filePath = path.join(lessonsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    // Strict frontmatter tag check
    let hasTag = false;
    try {
      const parts = content.split(/^---\r?\n/m);
      if (parts.length >= 3) {
        const fm = jsYaml.load(parts[1]) as any;
        if (fm && Array.isArray(fm.tags) && fm.tags.includes("needs-enrichment")) {
          hasTag = true;
        }
      }
    } catch {}

    if (hasTag) {
      let analysis: LessonAnalysisPayload | null = null;

      if (typeof (provider as any).enrichLesson === "function") {
        try {
          analysis = await (provider as any).enrichLesson(content, file);
        } catch (err) {
          logWarn(`Provider failed to enrich lesson '${file}': ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // FAIL-SOFT: If provider fails, returns null, or lacks required fields, DO NOT fabricate fallback text!
      if (!analysis || typeof analysis.rootCause !== "string" || typeof analysis.prevention !== "string" || !analysis.rootCause.trim() || !analysis.prevention.trim()) {
        logWarn(`Skipping enrichment for '${file}': provider '${provider.name}' returned invalid/null analysis payload. Retaining original file and 'needs-enrichment' tag.`);
        continue;
      }

      try {
        const updatedContent = await enrichLessonNode(content, analysis);
        const schemaErrors = validateLessonSchema(updatedContent, filePath);
        
        // Ensure schema passes, content actually changed, and tag was removed
        if (schemaErrors.length === 0 && updatedContent !== content && !updatedContent.includes("needs-enrichment")) {
          fs.writeFileSync(filePath, updatedContent, "utf-8");
          enrichedFiles.push(path.join(lessonsDirName, file).replace(/\\/g, "/"));
        } else if (schemaErrors.length > 0) {
          logWarn(`Enriched content for '${file}' failed schema validation: ${schemaErrors.join("; ")}. Preserving original file.`);
        }
      } catch (err) {
        logWarn(`Failed to apply enrichment to '${file}': ${err instanceof Error ? err.message : String(err)}. Preserving original file.`);
      }
    }
  }

  return enrichedFiles;
}

const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("synthesize-wiki.ts") ||
  process.argv[1].endsWith("synthesize-wiki.js")
);

if (isMainModule) {
  main().catch((err) => {
    logError(`Unhandled exception in synthesis worker: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    process.exit(1);
  });
}

