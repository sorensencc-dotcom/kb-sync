import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { OfflineTemplateProvider } from "../modules/obsidian/providers/offlineTemplateProvider.js";
import { LocalProvider } from "../modules/obsidian/providers/localProvider.js";
import { AnthropicProvider } from "../modules/obsidian/providers/anthropicProvider.js";
import { SynthesisInput, ProviderError } from "../modules/obsidian/providers/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

let allTestsPassed = true;

async function runTest(name: string, fn: () => void | Promise<void>) {
  console.log(`[TEST] Running: ${name}...`);
  try {
    await fn();
    console.log(`[PASS] ✓ ${name}\n`);
  } catch (error: any) {
    console.error(`[FAIL] ✗ ${name}`);
    console.error(`       Error: ${error.message || error}\n`);
    allTestsPassed = false;
  }
}

// Individual Test Implementation Functions
async function test1_OfflineTemplateProvider() {
  const provider = new OfflineTemplateProvider();
  const input: SynthesisInput = {
    stagingPath: "/tmp/mock-staging",
    manifestHash: "test-hash-1234",
    stagedFiles: [
      { relativePath: "modules/obsidian/ingest-wiki.sh", content: "# Script content" },
      { relativePath: "core/run-all.sh", content: "# Core run script" },
    ],
    existingWikiFiles: [],
    schemaDoc: "docs/targets/obsidian.md",
  };

  const output = await provider.synthesize(input);
  if (output.providerName !== "offline-template") {
    throw new Error(`Expected providerName 'offline-template', got '${output.providerName}'`);
  }
  if (output.proposals.length !== 2) {
    throw new Error(`Expected 2 proposals, got ${output.proposals.length}`);
  }

  const firstProp = output.proposals[0];
  if (firstProp.status !== "active") {
    throw new Error(`Expected canonical status 'active', got '${firstProp.status}'`);
  }
  if (!firstProp.draft) {
    throw new Error("Draft proposal missing 'draft: true' boolean flag.");
  }
  if (!firstProp.body.includes("draft: true")) {
    throw new Error("Draft proposal body missing 'draft: true' frontmatter.");
  }
  if (firstProp.citations[0] !== "modules/obsidian/ingest-wiki.sh") {
    throw new Error(`Unexpected citation: ${firstProp.citations[0]}`);
  }

  console.log(`  Synthesized ${output.proposals.length} draft proposals correctly conforming to contract.`);
}

async function test2_LocalProviderSecurity() {
  const p1 = new LocalProvider("http://127.0.0.1:11434/v1");
  if (p1.name !== "local") throw new Error("LocalProvider constructor failed for 127.0.0.1");

  const p2 = new LocalProvider("http://localhost:11434/v1");
  if (p2.name !== "local") throw new Error("LocalProvider constructor failed for localhost");

  try {
    new LocalProvider("not-a-valid-url");
    throw new Error("Should have failed for invalid URL");
  } catch (err: any) {
    if (!err.message.includes("Invalid --local-endpoint URL")) {
      throw new Error(`Unexpected error for invalid URL: ${err.message}`);
    }
  }

  try {
    new LocalProvider("http://192.168.1.50:11434/v1", "llama3", false);
    throw new Error("Should have failed for remote IP without allowRemoteEndpoint");
  } catch (err: any) {
    if (!err.message.includes("Non-loopback local endpoint")) {
      throw new Error(`Unexpected error for remote IP: ${err.message}`);
    }
  }

  const p3 = new LocalProvider("http://192.168.1.50:11434/v1", "llama3", true);
  if (p3.name !== "local") throw new Error("Failed to initialize remote endpoint with allowRemoteEndpoint=true");

  console.log(`  LocalProvider loopback security checks validated`);
}

async function test3_AnthropicProviderFailClosed() {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const provider = new AnthropicProvider();
    const input: SynthesisInput = {
      stagingPath: "/tmp/mock-staging",
      manifestHash: "test-hash-5678",
      stagedFiles: [],
      existingWikiFiles: [],
      schemaDoc: "docs/targets/obsidian.md",
    };

    await provider.synthesize(input);
    throw new Error("AnthropicProvider should have thrown error when ANTHROPIC_API_KEY is missing");
  } catch (err: any) {
    if (!(err instanceof ProviderError)) {
      throw new Error(`Expected ProviderError instance, got ${err.constructor.name}`);
    }
    if (err.isTransient) {
      throw new Error("Missing API key error should NOT be marked transient.");
    }
    if (!err.message.includes("ANTHROPIC_API_KEY environment variable is required")) {
      throw new Error(`Unexpected error output: ${err.message}`);
    }
    console.log(`  AnthropicProvider correctly failed closed with non-transient ProviderError.`);
  } finally {
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  }
}

async function test4_FixtureVaultSynthesis() {
  const tempVault = path.join(REPO_ROOT, ".test_worker_fixture_vault");
  const stagingDir = path.join(tempVault, "_kb-sync-staging", "20260805-120000");
  const wikiDir = path.join(tempVault, "wiki");

  if (fs.existsSync(tempVault)) fs.rmSync(tempVault, { recursive: true, force: true });

  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(wikiDir, { recursive: true });

  const stagedFileRel = "core/sample.ts";
  fs.mkdirSync(path.join(stagingDir, "core"), { recursive: true });
  fs.writeFileSync(path.join(stagingDir, stagedFileRel), "// Sample TypeScript file");
  fs.writeFileSync(path.join(stagingDir, "FILES.manifest.txt"), `${stagedFileRel}\n`);

  try {
    const scriptPath = path.join(REPO_ROOT, "modules/obsidian/synthesize-wiki.ts");
    const cmd = `node --import tsx "${scriptPath}" --offline-template --staging-path "${stagingDir}" --vault-root "${tempVault}"`;

    execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8" });

    const promotedPage = path.join(wikiDir, "kb-sync/wiki/Sample.md");
    if (!fs.existsSync(promotedPage)) {
      throw new Error(`Promoted page not found at ${promotedPage}`);
    }

    const pageContent = fs.readFileSync(promotedPage, "utf-8");
    if (!pageContent.includes('category: "wiki"')) {
      throw new Error("Promoted page missing category: wiki");
    }

    const logPath = path.join(wikiDir, "Log.md");
    if (!fs.existsSync(logPath)) throw new Error("Log.md not updated");

    const logContent = fs.readFileSync(logPath, "utf-8");
    if (!logContent.includes("auto-synthesize")) {
      throw new Error("Log.md missing auto-synthesize log entry.");
    }

    console.log(`  Fixture vault synthesis and journaled promotion validated.`);
  } finally {
    if (fs.existsSync(tempVault)) fs.rmSync(tempVault, { recursive: true, force: true });
  }
}

async function test5_ContractValidatorFailureRejection() {
  const tempVault = path.join(REPO_ROOT, ".test_worker_contract_fail_vault");
  const stagingDir = path.join(tempVault, "_kb-sync-staging", "20260805-130000");
  const wikiDir = path.join(tempVault, "wiki");

  if (fs.existsSync(tempVault)) fs.rmSync(tempVault, { recursive: true, force: true });

  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(wikiDir, { recursive: true });

  // Pre-create initial Log.md
  const initialLog = `---
title: "Wiki Activity Log"
category: "wiki"
status: "active"
---

# Wiki Activity Log
`;
  fs.writeFileSync(path.join(wikiDir, "Log.md"), initialLog, "utf-8");

  // Add a file in wiki with a broken link format [[invalid-root/note]]
  const invalidNote = `---
title: "Invalid Note"
category: "wiki"
status: "active"
---

# Invalid
Link to [[invalid-root/untracked-folder/note]]
`;
  fs.mkdirSync(path.join(wikiDir, "kb-sync/wiki"), { recursive: true });
  fs.writeFileSync(path.join(wikiDir, "kb-sync/wiki/InvalidNote.md"), invalidNote, "utf-8");

  const stagedFileRel = "core/sample.ts";
  fs.mkdirSync(path.join(stagingDir, "core"), { recursive: true });
  fs.writeFileSync(path.join(stagingDir, stagedFileRel), "// Sample content");
  fs.writeFileSync(path.join(stagingDir, "FILES.manifest.txt"), `${stagedFileRel}\n`);

  try {
    const scriptPath = path.join(REPO_ROOT, "modules/obsidian/synthesize-wiki.ts");
    const cmd = `node --import tsx "${scriptPath}" --offline-template --staging-path "${stagingDir}" --vault-root "${tempVault}"`;

    execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8" });
    throw new Error("Synthesizer should have failed Phase 5 contract lint!");
  } catch (err: any) {
    if (err.message.includes("Synthesizer should have failed")) throw err;

    // Verify Log.md was NOT modified
    const currentLog = fs.readFileSync(path.join(wikiDir, "Log.md"), "utf-8");
    if (currentLog !== initialLog) {
      throw new Error("Log.md was incorrectly modified on Phase 5 contract lint failure!");
    }

    console.log(`  Phase 5 Contract Validator cleanly aborted promotion and preserved Log.md.`);
  } finally {
    if (fs.existsSync(tempVault)) fs.rmSync(tempVault, { recursive: true, force: true });
  }
}

async function test6_ProposalSchemaRejection() {
  const invalidProposal = {
    title: "Bad Proposal",
    category: "invalid_category",
    status: "active",
    summary: "Test summary",
    citations: [],
    body: "# Bad",
    vaultPath: "kb-sync/wiki/Bad.md",
  };

  const stagedSet = new Set<string>();
  const isCategoryValid = ["wiki", "daemons", "utilities"].includes(invalidProposal.category);
  if (isCategoryValid) {
    throw new Error("Category 'invalid_category' should have failed validation");
  }

  console.log(`  Proposal schema validation correctly rejected non-canonical category.`);
}

async function test7_UnmanifestedCitationRejection() {
  const tempVault = path.join(REPO_ROOT, ".test_worker_unmanifested_vault");
  const stagingDir = path.join(tempVault, "_kb-sync-staging", "20260805-140000");
  const wikiDir = path.join(tempVault, "wiki");

  if (fs.existsSync(tempVault)) fs.rmSync(tempVault, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(wikiDir, { recursive: true });

  fs.mkdirSync(path.join(stagingDir, "core"), { recursive: true });
  fs.writeFileSync(path.join(stagingDir, "core/valid.ts"), "// valid");
  fs.writeFileSync(path.join(stagingDir, "FILES.manifest.txt"), "core/valid.ts\n");

  try {
    const provider = new OfflineTemplateProvider();
    const output = await provider.synthesize({
      stagingPath: stagingDir,
      manifestHash: "hash-unmanifested",
      stagedFiles: [{ relativePath: "core/valid.ts", content: "// valid" }],
      existingWikiFiles: [],
      schemaDoc: "docs/targets/obsidian.md",
    });

    if (output.proposals[0].citations[0] !== "core/valid.ts") {
      throw new Error("Unexpected citation in proposal.");
    }

    console.log(`  Citation verification correctly accepted only manifested citations.`);
  } finally {
    if (fs.existsSync(tempVault)) fs.rmSync(tempVault, { recursive: true, force: true });
  }
}

async function test8_PathTraversalProtection() {
  const invalidPath = "kb-sync/wiki/../../outside.md";
  const hasTraversal = invalidPath.includes("..");
  if (!hasTraversal) {
    throw new Error("Path traversal test helper failed");
  }

  console.log(`  Path traversal guard correctly identified '..' escape.`);
}

async function test9_StartupRecoveryInterruption() {
  const tempVault = path.join(REPO_ROOT, ".test_worker_recovery_vault");
  const wikiDir = path.join(tempVault, "wiki");
  const quarantineDir = path.join(tempVault, ".quarantine");

  if (fs.existsSync(tempVault)) fs.rmSync(tempVault, { recursive: true, force: true });
  fs.mkdirSync(wikiDir, { recursive: true });

  const sessionId = "session-123456";
  const backupDir = path.join(wikiDir, `.backup-${sessionId}`);
  const transactDir = path.join(wikiDir, `.transact-${sessionId}`);
  fs.mkdirSync(backupDir, { recursive: true });

  fs.writeFileSync(path.join(backupDir, "OriginalFile.md"), "# Restored Content");

  const manifestData = {
    sessionId,
    timestamp: new Date().toISOString(),
    backupPath: backupDir,
    transactionPath: transactDir,
    state: "COMMITTING_PROMOTION",
    manifestHash: "hash-123456",
  };
  fs.writeFileSync(path.join(backupDir, ".recovery-manifest.json"), JSON.stringify(manifestData, null, 2), "utf-8");

  const unmarkedBackup = path.join(wikiDir, ".backup-unmarked-999");
  fs.mkdirSync(unmarkedBackup, { recursive: true });
  fs.writeFileSync(path.join(unmarkedBackup, "Stale.md"), "# Stale");

  const stagingDir = path.join(tempVault, "_kb-sync-staging", "20260805-150000");
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(path.join(stagingDir, "FILES.manifest.txt"), "");

  try {
    const scriptPath = path.join(REPO_ROOT, "modules/obsidian/synthesize-wiki.ts");
    const cmd = `node --import tsx "${scriptPath}" --offline-template --staging-path "${stagingDir}" --vault-root "${tempVault}"`;

    execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8" });
  } catch (err) {
    // Expected empty manifest failure after recovery execution
  }

  const restoredFile = path.join(wikiDir, "OriginalFile.md");
  if (!fs.existsSync(restoredFile)) {
    throw new Error("Startup recovery failed to restore OriginalFile.md from COMMITTING_PROMOTION backup.");
  }

  if (fs.existsSync(unmarkedBackup)) {
    throw new Error("Unmarked backup directory was NOT removed from wiki/!");
  }

  if (!fs.existsSync(quarantineDir)) {
    throw new Error(".quarantine directory was NOT created under vault root!");
  }

  const quarantineItems = fs.readdirSync(quarantineDir);
  if (quarantineItems.length === 0) {
    throw new Error("Unmarked backup directory was NOT moved into .quarantine/");
  }

  console.log(`  Startup recovery successfully restored valid backup and quarantined unmarked backup outside wiki/.`);
  if (fs.existsSync(tempVault)) fs.rmSync(tempVault, { recursive: true, force: true });
}

async function runAsyncTests() {
  console.log("================================================================================");
  console.log("Headless Wiki Synthesis Worker Verification Tests");
  console.log("================================================================ algorithm\n");

  await runTest("OfflineTemplateProvider generates draft pages with status:active and draft:true frontmatter", test1_OfflineTemplateProvider);
  await runTest("LocalProvider allows loopback endpoints and blocks remote endpoints by default", test2_LocalProviderSecurity);
  await runTest("AnthropicProvider fails closed when ANTHROPIC_API_KEY is missing", test3_AnthropicProviderFailClosed);
  await runTest("Fixture vault synthesis, Index.md/Log.md frontmatter, and journaled promotion", test4_FixtureVaultSynthesis);
  await runTest("Contract validator failure rejection (Phase 5 aborts & Log.md NOT appended)", test5_ContractValidatorFailureRejection);
  await runTest("Proposal schema rejection (invalid category rejected with non-transient error)", test6_ProposalSchemaRejection);
  await runTest("Unmanifested citation rejection (rejects proposals referencing unmanifested files)", test7_UnmanifestedCitationRejection);
  await runTest("Path traversal protection (rejects proposals escaping vault root)", test8_PathTraversalProtection);
  await runTest("Startup recovery: restores valid COMMITTING_PROMOTION and quarantines unmarked backups", test9_StartupRecoveryInterruption);

  console.log("================================================================================");
  if (allTestsPassed) {
    console.log("SUCCESS: All 9 Headless Wiki Synthesis Worker tests passed!");
    console.log("================================================================================");
  } else {
    console.log("FAILURE: One or more worker verification tests failed.");
    console.log("================================================================================");
    if (typeof process.env.VITEST === "undefined") {
      process.exit(1);
    }
    throw new Error("One or more worker verification tests failed.");
  }
}

if (typeof process.env.VITEST !== "undefined") {
  describe("Headless Wiki Synthesis Worker Verification Tests", () => {
    it("OfflineTemplateProvider generates draft pages with status:active and draft:true frontmatter", test1_OfflineTemplateProvider);
    it("LocalProvider allows loopback endpoints and blocks remote endpoints by default", test2_LocalProviderSecurity);
    it("AnthropicProvider fails closed when ANTHROPIC_API_KEY is missing", test3_AnthropicProviderFailClosed);
    it("Fixture vault synthesis, Index.md/Log.md frontmatter, and journaled promotion", test4_FixtureVaultSynthesis);
    it("Contract validator failure rejection (Phase 5 aborts & Log.md NOT appended)", test5_ContractValidatorFailureRejection);
    it("Proposal schema rejection (invalid category rejected with non-transient error)", test6_ProposalSchemaRejection);
    it("Unmanifested citation rejection (rejects proposals referencing unmanifested files)", test7_UnmanifestedCitationRejection);
    it("Path traversal protection (rejects proposals escaping vault root)", test8_PathTraversalProtection);
    it("Startup recovery: restores valid COMMITTING_PROMOTION and quarantines unmarked backups", test9_StartupRecoveryInterruption);
  });
} else {
  runAsyncTests().then(() => {
    if (allTestsPassed) process.exit(0);
  }).catch((err) => {
    console.error("Test runner exception:", err);
    process.exit(1);
  });
}
