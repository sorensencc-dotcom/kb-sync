#!/usr/bin/env node
/**
 * scripts/notebooklm/chat-injection-runner.mjs
 *
 * Dedicated Chat Injection & Staleness Audit Daemon for NotebookLM Cluster.
 *
 * Enforces:
 * 1. Canonical 21-notebook cluster registry parity + 3 operational buffers (from configs/notebooklm.yaml).
 * 2. Automated Google Drive folder provisioning (G:\My Drive\notebooklm\<slug>\).
 * 3. Dynamic, domain-specific, entity-anchored question synthesis (prohibits generic 4-question loops).
 * 4. Constrained query execution for source-heavy notebooks (>50 sources, e.g. Ford Executive Dynamics) via --source-ids.
 * 5. Minimum 3.5s execution pacing per turn to prevent status 3 / 429 rate limits.
 * 6. Deterministic fail-closed audit telemetry flagging any notebook with >24h latency.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(REPO_ROOT, 'configs', 'notebooklm.yaml');
const DRIVE_ROOT = fs.existsSync('G:\\My Drive\\notebooklm')
  ? 'G:\\My Drive\\notebooklm'
  : (fs.existsSync(path.join(process.env.USERPROFILE || '', 'Google Drive', 'My Drive', 'notebooklm'))
      ? path.join(process.env.USERPROFILE || '', 'Google Drive', 'My Drive', 'notebooklm')
      : null);
const LOCAL_CONVERSATIONS_ROOT = path.join(REPO_ROOT, 'wiki', 'conversations');
const OBSIDIAN_CONVERSATIONS_ROOT = path.join(REPO_ROOT, 'obsidian', 'vault', 'wiki', 'conversations');
const STATUS_FEED_DIR = path.join(REPO_ROOT, '_status-feed');
const AUDIT_REPORT_PATH = path.join(STATUS_FEED_DIR, 'chat_injection_audit.json');

const BANNED_BOILERPLATE_PATTERNS = [
  /what open questions or unresolved contradictions exist across these sources/i,
  /what claims are asserted but single-sourced or under-corroborated/i,
  /what adjacent topics do these sources point to that aren't covered yet/i,
  /what follow-up research would most strengthen current findings/i,
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// 1. Load Registry from configs/notebooklm.yaml
// -----------------------------------------------------------------------------
export function loadClusterRegistry(configPath = CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Cluster configuration file not found at: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const doc = yaml.load(raw);
  if (!doc || !doc.notebook_registry) {
    throw new Error(`Invalid notebooklm.yaml: notebook_registry section is missing.`);
  }

  const notebooks = [];
  const sections = ['historical', 'software_dev', 'personal_os', 'operational_buffers'];

  for (const sec of sections) {
    const list = doc.notebook_registry[sec] || [];
    for (const item of list) {
      notebooks.push({
        ...item,
        section: sec,
        isCanonical: sec !== 'operational_buffers',
      });
    }
  }

  return notebooks;
}

// -----------------------------------------------------------------------------
// 2. Drive & Local Directory Provisioning
// -----------------------------------------------------------------------------
export function ensureSyncDirectories(slug, dateStr) {
  const driveDir = DRIVE_ROOT ? path.join(DRIVE_ROOT, slug) : null;
  if (driveDir && !fs.existsSync(driveDir)) {
    fs.mkdirSync(driveDir, { recursive: true });
    console.log(`[PROVISION] Created Google Drive sync directory: ${driveDir}`);
  }

  const localDateDir = path.join(LOCAL_CONVERSATIONS_ROOT, dateStr);
  if (!fs.existsSync(localDateDir)) {
    fs.mkdirSync(localDateDir, { recursive: true });
  }

  const obsidianDateDir = path.join(OBSIDIAN_CONVERSATIONS_ROOT, dateStr);
  if (!fs.existsSync(obsidianDateDir)) {
    fs.mkdirSync(obsidianDateDir, { recursive: true });
  }

  return { localDir: localDateDir, obsidianDir: obsidianDateDir, driveDir, dirs: [driveDir, localDateDir, obsidianDateDir].filter(Boolean) };
}

// -----------------------------------------------------------------------------
// 3. Dynamic Question Generator (Entity-Anchored, Zero Boilerplate)
// -----------------------------------------------------------------------------
export function getRecentGitCommits(maxCount = 5) {
  try {
    const res = spawnSync('git', ['log', `-n`, String(maxCount), '--oneline'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (res.status === 0 && res.stdout) {
      return res.stdout.trim().split('\n').filter(Boolean);
    }
  } catch {}
  return [];
}

export function synthesizeDynamicQuestions(notebook, options = {}) {
  const questions = [];
  const title = (notebook.title || '').toLowerCase();
  const slug = (notebook.slug || '').toLowerCase();

  // Historical Domain Questions
  if (notebook.section === 'historical' || title.includes('cic')) {
    if (slug.includes('ford-politics') || title.includes('executive') || title.includes('politics')) {
      questions.push({
        id: 'gap-25-capizzi-severance',
        text: 'Did Charles Sorensen\'s formal termination agreement in March 1944 carry Henry Ford\'s personal signature or power of attorney execution, and did corporate counsel I.A. Capizzi draft an explicit non-compete waiver enabling his Willys-Overland transition?',
      });
      questions.push({
        id: 'bennett-service-c199',
        text: 'How did Harry Bennett\'s Service Department (Case C-199) and corporate governance under Henry Ford conflict with Charles Sorensen\'s operational management and factory authority at the Rouge?',
      });
      questions.push({
        id: 'dodge-v-ford-1919-precedent',
        text: 'How did the legal precedent of Dodge v. Ford Motor Co. (1919) shape capital reinvestment, executive compensation disputes, and minority shareholder relations during Sorensen\'s tenure?',
      });
      questions.push({
        id: 'flanders-1906-production-rule',
        text: 'Detail Walter Flanders\' 1906 production methods and organizational rules versus Charles Sorensen\'s manufacturing authority at the Piquette and Highland Park plants.',
      });
    } else if (slug.includes('willow-run') || title.includes('willow run') || title.includes('aviation')) {
      questions.push({
        id: 'gap-27-an426-rivets',
        text: 'Did early B-24 flush-rivet shear and dimple cracking originate from improper A17ST alloy temper in Rouge-modified cold-heading machines or excessive bucking pressure on assembly fixtures?',
      });
      questions.push({
        id: 'gap-28-thermal-expansion',
        text: 'Did ambient temperature differentials between unheated San Diego outdoor assembly yards and insulated Michigan plant bays cause the 0.045-inch center-wing mating mismatch, and when did Wright Field mandate 68°F reference check gauges?',
      });
      questions.push({
        id: 'davis-wing-blueprints',
        text: 'Examine the engineering blueprints and lofting specifications for the Davis high-lift wing on the B-24 Liberator and describe how Ford tooling engineers translated them for mass production stamping.',
      });
    } else if (slug.includes('cuba') || title.includes('cuban') || title.includes('seizures')) {
      questions.push({
        id: 'gap-03a-havana-litho',
        text: 'What was the certified valuation benchmark established for Compañía Litográfica de la Habana under Cuban Law 890 (FCSC Claim CU-3440), and who held claimant status?',
      });
      questions.push({
        id: 'gap-03b-agrarian-reform',
        text: 'Under what legal or tax mechanism were Sorensen\'s physical citrus groves and cattle acreage in Matanzas and Pinar del Río accounted for following the May 1959 First Agrarian Reform Law?',
      });
      questions.push({
        id: 'gap-29-central-west-trust',
        text: 'What archival evidence exists regarding Central West Company as a nominee or voting trust tied to the pre-1933 Detroit Trust Company network holding shares for industrial syndicates?',
      });
    } else if (slug.includes('willys') || title.includes('willys-overland')) {
      questions.push({
        id: 'gap-26-canaday-restructuring',
        text: 'What specific board actions stripped Charles Sorensen of executive power in early 1946 (Canaday vs. Sorensen), reclassifying him from President to Vice Chairman regarding Brooks Stevens 6-70 sedan capital expenditures?',
      });
      questions.push({
        id: 'civilian-jeep-cpa-allocation',
        text: 'How did Willys-Overland allocate wartime surplus tooling and civilian Jeep CJ-2A manufacturing overhead during the 1945–1946 reconversion?',
      });
    } else if (slug.includes('assembly') || title.includes('assembly line') || title.includes('rouge')) {
      questions.push({
        id: 'piquette-to-highland-park-flow',
        text: 'Compare Walter Flanders\' 1906 machine layout at Piquette Avenue with the 1913 moving assembly line innovations introduced by Sorensen, Martin, and Klann at Highland Park.',
      });
      questions.push({
        id: 'rouge-vertical-integration',
        text: 'Detail the metallurgical and logistical integration between the Rouge blast furnaces, foundry, and final chassis assembly line.',
      });
    } else {
      questions.push({
        id: 'historical-entity-sourcing',
        text: `Analyze primary archival sources in this notebook regarding Charles E. Sorensen's verified documentary trail, contrasting memoir claims with contemporary business ledgers.`,
      });
      questions.push({
        id: 'timeline-verification-events',
        text: `What specific verified dates, patent filings, or board minutes substantiate the key milestones recorded in this collection?`,
      });
    }
  }

  // Core Software & Dev Domain Questions
  else if (notebook.section === 'software_dev') {
    const commits = getRecentGitCommits(3);
    const commitContext = commits.length > 0 ? ` Recent commit context: ${commits.join('; ')}.` : '';

    if (slug.includes('governance')) {
      questions.push({
        id: 'gov-authority-contract',
        text: `Verify the 3-tier authority model (Tier 1 Decision, Tier 2 Execution, Tier 3 Automation) and state the mandatory human approval guardrails.${commitContext}`,
      });
      questions.push({
        id: 'gov-roadmap-placement-rules',
        text: 'What are the forbidden file paths for ROADMAP.md files and how does the local pre-commit hook enforce roadmap location compliance?',
      });
    } else if (slug.includes('modules')) {
      questions.push({
        id: 'modules-crate-boundaries',
        text: `Examine the dependency structure between modules and libraries in this codebase. What interfaces prevent tight coupling between ingest and storage?${commitContext}`,
      });
      questions.push({
        id: 'modules-public-api-surface',
        text: 'What shared utilities and public symbols are exposed across module package boundaries?',
      });
    } else if (slug.includes('skills')) {
      questions.push({
        id: 'skills-manifest-compliance',
        text: 'What criteria must a toolforge skill fulfill in manifest.json and SKILL.md to achieve full operational compliance?',
      });
      questions.push({
        id: 'skills-router-and-dispatch',
        text: 'How does the skill routing table resolve user prompts to specialized tools and subagents?',
      });
    } else if (slug.includes('operations')) {
      questions.push({
        id: 'ops-process-janitor-preflight',
        text: 'How does the process-janitor preflight ensure clean daemon execution and prevent abandoned Node/Python processes on Windows?',
      });
      questions.push({
        id: 'ops-daemon-health-telemetry',
        text: 'How are background daemon heartbeat, memory ceilings, and log file rotation audited across IronBot tasks?',
      });
    } else if (slug.includes('meta')) {
      questions.push({
        id: 'meta-taxonomy-drift',
        text: 'How are knowledge base entities and documentation drift tracked and remediated across the wiki target roots?',
      });
      questions.push({
        id: 'meta-schema-and-indexing',
        text: 'What frontmatter schemas, link graphs, and index tables structure the persistent system memory?',
      });
    } else if (slug.includes('targets')) {
      questions.push({
        id: 'targets-milestone-gates',
        text: 'What are the active phase gates, deliverables, and acceptance criteria for current roadmap targets?',
      });
      questions.push({
        id: 'targets-roadmap-conformance',
        text: 'How are sprint goals and roadmap checkpoints verified against project governance contracts?',
      });
    } else if (slug.includes('superpowers')) {
      questions.push({
        id: 'superpowers-subagent-dispatch',
        text: 'What are the operational guidelines for subagent dispatch, cavecrew delegation, and token-compressed communication?',
      });
      questions.push({
        id: 'superpowers-skill-orchestration',
        text: 'How do high-leverage workflows orchestrate parallel worktrees and automated review cycles?',
      });
    } else if (slug.includes('ironledger')) {
      questions.push({
        id: 'ironledger-double-entry-invariants',
        text: 'How does IronLedger enforce double-entry mathematical balance invariants and KMS envelope encryption on audit transactions?',
      });
      questions.push({
        id: 'ironledger-tax-lot-and-hud-rendering',
        text: 'How does IronLedger manage tax lot consistency, HUD rendering, and bank CSV ingest mapping across transaction ledgers?',
      });
    } else if (slug.includes('sigil')) {
      questions.push({
        id: 'sigil-fix-wal-persistence',
        text: 'Explain the FIX session protocol state transitions, WAL persistence mechanism, and room federation in Sigil.',
      });
      questions.push({
        id: 'sigil-key-lifecycle-and-reconciliation',
        text: 'How are Ed25519 identity key rotation, heartbeat intervals, and message reconciliation handled in the Sigil client daemon?',
      });
    } else if (slug.includes('agent-harness')) {
      questions.push({
        id: 'agent-harness-graft-sam-mesh',
        text: 'How does the Graft context graph map repo hubs, and how does the SAM mesh coordinate multi-agent terminal workers?',
      });
      questions.push({
        id: 'agent-harness-terminal-multiplexing',
        text: 'Detail Herdr terminal multiplexing, supervisor worker loops, and subagent process lifecycle controls.',
      });
    } else if (slug.includes('rewrite-labs')) {
      questions.push({
        id: 'rewrite-labs-ssg-redesign',
        text: 'How does Rewrite Labs automate static site generation, asset compilation, and MCP tooling for redesign workflows?',
      });
      questions.push({
        id: 'rewrite-labs-ast-compaction',
        text: 'What AST transformation pipelines and layout engines power Rewrite Labs multi-tenant SSG output?',
      });
    } else if (slug.includes('dev-triage') || slug.includes('open-dev-issues')) {
      questions.push({
        id: 'ci-cd-defect-triage',
        text: `Review the top active defects and CI test telemetry. What root causes are currently tracked in the open issues buffer?${commitContext}`,
      });
      questions.push({
        id: 'ci-cd-triage-remediation-pipeline',
        text: 'What automated repair scripts and health check gates validate triage queue recovery before landing?',
      });
    } else {
      questions.push({
        id: 'software-architecture-verification',
        text: `What architectural patterns and invariants govern this subsystem?${commitContext}`,
      });
      questions.push({
        id: 'software-testing-and-contracts',
        text: `What verification tests and contracts validate this subsystem?${commitContext}`,
      });
    }
  }

  // Personal OS Domain Questions
  else if (notebook.section === 'personal_os') {
    questions.push({
      id: 'personal-os-utilities-continuity',
      text: 'What recurring utility accounts, household maintenance schedules, and logistics items are tracked in this workspace?',
    });
    questions.push({
      id: 'personal-os-inventory-sync',
      text: 'What pending operational tasks require action or reconciliation this week?',
    });
  }

  // Operational Buffers
  else {
    questions.push({
      id: 'buffer-telemetry-status',
      text: `What new events, incoming signals, or telemetry cards have arrived in the ${notebook.title} buffer?`,
    });
    questions.push({
      id: 'buffer-action-item-resolution',
      text: `What open action items or dispatch receipts from the ${notebook.title} queue require processing?`,
    });
  }

  // Final assert: reject any question matching banned boilerplate
  for (const q of questions) {
    for (const pattern of BANNED_BOILERPLATE_PATTERNS) {
      if (pattern.test(q.text)) {
        throw new Error(`CRITICAL: Generated question matched banned boilerplate pattern: "${q.text}"`);
      }
    }
  }

  return questions;
}

// -----------------------------------------------------------------------------
// 4. Source Inspection for Large Notebooks (>50 sources)
// -----------------------------------------------------------------------------
export function getNotebookSources(notebookUuid) {
  try {
    const res = spawnSync('nlm', ['source', 'list', notebookUuid, '--json'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    if (res.status === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout);
      return Array.isArray(parsed) ? parsed : (parsed.sources || []);
    }
  } catch {}
  return [];
}

// -----------------------------------------------------------------------------
// 5. Query NotebookLM Turn Execution
// -----------------------------------------------------------------------------
export function executeNlmQuery(notebookUuid, questionText, options = {}) {
  const args = ['query', 'notebook', notebookUuid, questionText, '--json'];

  if (options.sourceIds && options.sourceIds.length > 0) {
    args.push('--source-ids', options.sourceIds.join(','));
  }

  const timeoutSec = options.timeoutSeconds || (options.sourceIds ? 180 : 120);
  args.push('--timeout', String(timeoutSec));

  const result = spawnSync('nlm', args, {
    encoding: 'utf8',
    timeout: (timeoutSec + 30) * 1000,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  if (result.status !== 0) {
    let errMessage = `nlm exited with status ${result.status}`;
    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed && parsed.error) errMessage = String(parsed.error);
    } catch {
      if (result.stderr && result.stderr.trim()) errMessage = result.stderr.trim();
      else if (result.stdout && result.stdout.trim()) errMessage = result.stdout.trim();
    }
    return { ok: false, error: errMessage };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return { ok: true, data: parsed.answer || parsed };
  } catch (err) {
    return { ok: false, error: `nlm produced non-JSON output: ${err.message}` };
  }
}

// -----------------------------------------------------------------------------
// 6. Format Cathryn Lavery Synthesis Log
// -----------------------------------------------------------------------------
export function formatSynthesisLog(notebook, turns, dateStr) {
  const lines = [
    `# Daily Synthesis Log: ${notebook.title} — ${dateStr}`,
    '',
    '| Metadata | Value |',
    '|---|---|',
    `| **Notebook** | ${notebook.title} (\`${notebook.uuid}\`) |`,
    `| **Slug** | \`${notebook.slug}\` |`,
    `| **Domain Section** | \`${notebook.section}\` |`,
    `| **Date** | ${dateStr} |`,
    `| **Turn Count** | ${turns.length} |`,
    `| **Status** | SYNTHESIZED |`,
    '',
    '## Executive summary',
    `Executed automated chat injection battery for ${notebook.title} on ${dateStr}. Injected ${turns.length} domain-specific inquiries grounded in active registry requirements and primary entity targets.`,
    '',
    '## Grounded inquiries and model responses',
    '',
  ];

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    lines.push(`### Turn ${i + 1}: ${t.questionId}`);
    lines.push(`**Question:** ${t.question}`);
    lines.push('');
    lines.push(`**Response excerpt:**`);
    lines.push(t.answer ? t.answer.trim() : '*(No response received)*');
    lines.push('');
  }

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// 7. Latency & Staleness Audit
// -----------------------------------------------------------------------------
export function auditClusterLatency(registry) {
  const auditResults = [];
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (const nb of registry) {
    let lastLogTime = null;
    let lastLogPath = null;

    // Check Drive mirror directory
    if (DRIVE_ROOT) {
      const driveDir = path.join(DRIVE_ROOT, nb.slug);
      if (fs.existsSync(driveDir)) {
        try {
          const files = fs.readdirSync(driveDir).filter((f) => f.endsWith('.md'));
          for (const file of files) {
            const stat = fs.statSync(path.join(driveDir, file));
            if (!lastLogTime || stat.mtimeMs > lastLogTime) {
              lastLogTime = stat.mtimeMs;
              lastLogPath = path.join(driveDir, file);
            }
          }
        } catch {}
      }
    }

    // Check local conversations directories (both wiki/conversations and obsidian/vault/wiki/conversations)
    const conversationRoots = [LOCAL_CONVERSATIONS_ROOT, OBSIDIAN_CONVERSATIONS_ROOT];
    const slugTitle = (nb.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const candidateNames = new Set([
      `${nb.slug}.md`,
      `cic-${nb.slug}.md`,
      `${slugTitle}.md`,
      `${slugTitle.replace(/^cic-/, '')}.md`,
    ]);

    for (const root of conversationRoots) {
      if (fs.existsSync(root)) {
        try {
          const dateDirs = fs.readdirSync(root);
          for (const d of dateDirs) {
            const dirPath = path.join(root, d);
            try {
              const dirFiles = fs.readdirSync(dirPath);
              const slugParts = nb.slug.split('-').filter(p => p.length > 2);
              for (const f of dirFiles) {
                if (!f.endsWith('.md')) continue;
                const fLower = f.toLowerCase();
                const matchesCandidate = candidateNames.has(f) || candidateNames.has(fLower);
                const matchesSlug = fLower.includes(nb.slug);
                const matchesParts = slugParts.length > 0 && slugParts.every(part => fLower.includes(part));
                if (matchesCandidate || matchesSlug || matchesParts) {
                  const stat = fs.statSync(path.join(dirPath, f));
                  if (!lastLogTime || stat.mtimeMs > lastLogTime) {
                    lastLogTime = stat.mtimeMs;
                    lastLogPath = path.join(dirPath, f);
                  }
                }
              }
            } catch {}
          }
        } catch {}
      }
    }

    const latencyHours = lastLogTime ? ((now - lastLogTime) / (1000 * 60 * 60)).toFixed(1) : 'INF';
    const isStale = !lastLogTime || (now - lastLogTime) > ONE_DAY_MS;

    auditResults.push({
      slug: nb.slug,
      uuid: nb.uuid,
      title: nb.title,
      section: nb.section,
      isCanonical: nb.isCanonical,
      lastLogTime: lastLogTime ? new Date(lastLogTime).toISOString() : null,
      lastLogPath,
      latencyHours,
      status: isStale ? 'STALE' : 'FRESH',
    });
  }

  return auditResults;
}

// -----------------------------------------------------------------------------
// 8. Main Execution Runner
// -----------------------------------------------------------------------------
export async function runChatInjection(options = {}) {
  const dateStr = options.date || new Date().toISOString().slice(0, 10);
  const registry = loadClusterRegistry();
  console.log(`[CLUSTER-PARITY] Loaded ${registry.length} notebooks from configs/notebooklm.yaml.`);

  // Filter target notebooks
  let targets = registry;
  if (options.targetSlugOrUuid) {
    const needle = options.targetSlugOrUuid.toLowerCase();
    targets = registry.filter(
      (n) => n.slug.toLowerCase() === needle || n.uuid.toLowerCase() === needle || n.title.toLowerCase().includes(needle)
    );
    if (targets.length === 0) {
      throw new Error(`Target "${options.targetSlugOrUuid}" not found in cluster registry.`);
    }
  }

  // Pre-audit latency
  const preAudit = auditClusterLatency(registry);
  const staleCanonical = preAudit.filter((a) => a.isCanonical && a.status === 'STALE');
  console.log(`[AUDIT-PREFLIGHT] Canonical notebooks: ${preAudit.filter((a) => a.isCanonical).length} | Fresh: ${preAudit.filter((a) => a.isCanonical && a.status === 'FRESH').length} | Stale (>24h): ${staleCanonical.length}`);

  if (options.auditOnly) {
    if (!fs.existsSync(STATUS_FEED_DIR)) fs.mkdirSync(STATUS_FEED_DIR, { recursive: true });
    fs.writeFileSync(AUDIT_REPORT_PATH, JSON.stringify({ auditedAt: new Date().toISOString(), preAudit }, null, 2), 'utf8');
    console.log(`[AUDIT-REPORT] Written telemetry to ${AUDIT_REPORT_PATH}`);
    return { audit: preAudit };
  }

  const runResults = [];

  for (const notebook of targets) {
    console.log(`\n================================================================================`);
    console.log(`[INJECT-RUN] Notebook: ${notebook.title} (${notebook.slug}) [${notebook.uuid}]`);
    console.log(`================================================================================`);

    // Ensure sync directories exist (Google Drive + Local)
    const syncDirs = ensureSyncDirectories(notebook.slug, dateStr);

    // Synthesize questions
    const questions = synthesizeDynamicQuestions(notebook);
    console.log(`[PROMPT-GEN] Generated ${questions.length} entity-anchored questions (0 boilerplate).`);

    // Inspect sources for large notebooks
    let sourceFilter = null;
    let sourceCount = 0;
    try {
      const sources = getNotebookSources(notebook.uuid);
      sourceCount = sources.length;
      if (sourceCount > 50 || notebook.large_source_threshold) {
        console.log(`[LARGE-NOTEBOOK-GUARD] Notebook has ${sourceCount} sources (>50). Constraining query to top 20 sources.`);
        sourceFilter = sources.slice(0, 20).map((s) => s.id);
      }
    } catch {}

    const turns = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      console.log(`\n[TURN ${i + 1}/${questions.length}] Querying ID: ${q.id}`);
      console.log(`  Question: "${q.text.slice(0, 100)}..."`);

      if (options.dryRun) {
        turns.push({
          questionId: q.id,
          question: q.text,
          answer: `[DRY-RUN SIMULATED ANSWER for ${q.id}]`,
        });
      } else {
        const queryRes = executeNlmQuery(notebook.uuid, q.text, {
          sourceIds: sourceFilter,
          timeoutSeconds: sourceFilter ? 180 : 120,
        });

        if (queryRes.ok) {
          console.log(`  -> Response received (${typeof queryRes.data === 'string' ? queryRes.data.length : 'JSON'} bytes)`);
          turns.push({
            questionId: q.id,
            question: q.text,
            answer: typeof queryRes.data === 'string' ? queryRes.data : JSON.stringify(queryRes.data, null, 2),
          });
        } else {
          console.warn(`  -> Query failed: ${queryRes.error}`);
        }

        // Enforce 3.5s distributed execution pacing
        if (i < questions.length - 1) {
          console.log(`  [PACING] Sleeping 3.5s to respect NotebookLM rate limits...`);
          await sleep(3500);
        }
      }
    }

    // Mirror Daily Synthesis Log
    if (turns.length > 0) {
      const logContent = formatSynthesisLog(notebook, turns, dateStr);
      const logFileName = `Daily Synthesis Log - ${dateStr}.md`;

      // 1. Google Drive mirror
      if (DRIVE_ROOT) {
        const driveLogPath = path.join(DRIVE_ROOT, notebook.slug, logFileName);
        try {
          fs.writeFileSync(driveLogPath, logContent, 'utf8');
          console.log(`[DRIVE-MIRROR] Synced Daily Synthesis Log -> ${driveLogPath}`);
        } catch (err) {
          console.error(`[DRIVE-MIRROR-ERR] Failed writing to Drive: ${err.message}`);
        }
      }

      // 2. Local conversations mirror (wiki and obsidian)
      const localLogPath = path.join(LOCAL_CONVERSATIONS_ROOT, dateStr, `${notebook.slug}.md`);
      const obsidianLogPath = path.join(OBSIDIAN_CONVERSATIONS_ROOT, dateStr, `${notebook.slug}.md`);
      try {
        fs.writeFileSync(localLogPath, logContent, 'utf8');
        console.log(`[LOCAL-MIRROR] Synced local conversation -> ${localLogPath}`);
      } catch (err) {
        console.error(`[LOCAL-MIRROR-ERR] Failed writing to local wiki: ${err.message}`);
      }
      try {
        fs.writeFileSync(obsidianLogPath, logContent, 'utf8');
        console.log(`[OBSIDIAN-MIRROR] Synced obsidian conversation -> ${obsidianLogPath}`);
      } catch (err) {
        console.error(`[OBSIDIAN-MIRROR-ERR] Failed writing to obsidian vault: ${err.message}`);
      }

      runResults.push({
        notebook: notebook.slug,
        uuid: notebook.uuid,
        turns: turns.length,
        status: 'SUCCESS',
      });
    } else {
      console.warn(`[INJECT-WARN] 0 turns completed for ${notebook.title}.`);
      runResults.push({
        notebook: notebook.slug,
        uuid: notebook.uuid,
        turns: 0,
        status: 'FAILED',
      });
    }

    // Brief cooldown between notebooks
    await sleep(2000);
  }

  // Post-audit latency
  const postAudit = auditClusterLatency(registry);
  if (!fs.existsSync(STATUS_FEED_DIR)) fs.mkdirSync(STATUS_FEED_DIR, { recursive: true });
  fs.writeFileSync(AUDIT_REPORT_PATH, JSON.stringify({ auditedAt: new Date().toISOString(), postAudit, runResults }, null, 2), 'utf8');

  console.log(`\n================================================================================`);
  console.log(`[RUN-COMPLETE] Processed ${runResults.length} notebook(s). Audit report: ${AUDIT_REPORT_PATH}`);
  console.log(`================================================================================`);

  return { runResults, postAudit };
}

// -----------------------------------------------------------------------------
// CLI Invocation
// -----------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    auditOnly: args.includes('--audit-only') || args.includes('--audit'),
    targetSlugOrUuid: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--notebook' && args[i + 1]) {
      options.targetSlugOrUuid = args[i + 1];
      i++;
    }
  }

  runChatInjection(options)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[FATAL] ${err.message}`);
      process.exit(1);
    });
}
