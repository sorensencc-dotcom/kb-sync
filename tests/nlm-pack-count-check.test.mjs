import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runCheck,
  classifyNotebook,
  loadNotebooks,
  normalizePackFamilyKey,
  main,
} from '../scripts/nlm-pack-count-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const FIXED_NOW = () => new Date('2026-10-17T12:00:00.000Z');

const INLINE_MANIFEST = {
  clusters: {
    cluster_a: {
      notebooks: [
        {
          key: 'willow-run',
          uuid: '6fd7c40b-df90-444b-9c7a-a64682925856',
          has_pack: true,
          pack_family: 'pack_willow_run',
        },
        {
          key: 'master-kb',
          uuid: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
          has_pack: true,
          pack_family: 'pack_master_kb',
          multipart: true,
        },
        {
          key: 'photo-archive',
          uuid: 'fd0e0e4e-6890-4fb9-89bf-b9e568295e7a',
          has_pack: false,
        },
        {
          key: 'post-war',
          uuid: '9c469910-a900-43a4-877c-a43c9f545b5f',
          has_pack: true,
          pack_family: 'pack_post_war',
        },
      ],
    },
    excluded_not_swept: [
      {
        key: 'toolforge-ecosystem',
        uuid: '39a71593-eb5b-4605-a4a4-f212ae010da2',
        sweep_status: 'EXCLUDED_RETIRED',
      },
    ],
  },
};

test('real repo manifest loads 30 active swept notebooks and skips EXCLUDED_RETIRED', () => {
  const manifestPath = path.join(REPO_ROOT, 'state', 'knowledge-plane-notebooks.json');
  const notebooks = loadNotebooks(manifestPath);
  assert.equal(notebooks.length, 30);
  assert.equal(notebooks.some((n) => n.alias === 'toolforge-ecosystem'), false);
  assert.equal(notebooks.some((n) => n.id === '39a71593-eb5b-4605-a4a4-f212ae010da2'), false);
});

test('GREEN case: single family, contiguous multipart aa..ac, has_pack:false without packs, and NO_PACK info stays GREEN', async () => {
  const calledIds = [];
  const fakeRunner = async (nbId) => {
    calledIds.push(nbId);
    if (nbId === '6fd7c40b-df90-444b-9c7a-a64682925856') {
      return {
        ok: true,
        sources: [
          { id: 's1', title: 'pack_willow_run.txt', status: 2 },
          { id: 's2', title: 'B-24 Production Notes.pdf', status: 2 },
        ],
      };
    }
    if (nbId === '679b8bab-2d87-42cb-a726-6dc54c83acc2') {
      return {
        ok: true,
        sources: [
          { id: 'm1', title: 'pack_master_kb_part_aa.txt', status: 2 },
          { id: 'm2', title: 'pack_master_kb_part_ab.txt', status: 2 },
          { id: 'm3', title: 'pack_master_kb_part_ac.txt', status: 2 },
        ],
      };
    }
    if (nbId === 'fd0e0e4e-6890-4fb9-89bf-b9e568295e7a') {
      return {
        ok: true,
        sources: [{ id: 'p1', title: 'Archive Photo Index.md', status: 2 }],
      };
    }
    if (nbId === '9c469910-a900-43a4-877c-a43c9f545b5f') {
      // has_pack: true, zero pack sources -> NO_PACK (info)
      return {
        ok: true,
        sources: [{ id: 'doc1', title: 'General Notes.txt', status: 2 }],
      };
    }
    return { ok: true, sources: [] };
  };

  const res = await runCheck({
    manifest: INLINE_MANIFEST,
    runner: fakeRunner,
    now: FIXED_NOW,
  });

  assert.equal(res.overall, 'GREEN');
  assert.equal(res.notebooks_checked, 4);
  assert.equal(res.notebooks_unknown, 0);
  assert.equal(calledIds.includes('39a71593-eb5b-4605-a4a4-f212ae010da2'), false);
  assert.deepEqual(res.counts['willow-run'], {
    notebook_id: '6fd7c40b-df90-444b-9c7a-a64682925856',
    families: 1,
    sources: 2,
    pack_sources: 1,
    parts: 0,
  });
  assert.deepEqual(res.counts['master-kb'], {
    notebook_id: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
    families: 1,
    sources: 3,
    pack_sources: 3,
    parts: 3,
  });
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].code, 'NO_PACK');
  assert.equal(res.findings[0].severity, 'info');
  assert.equal(res.findings[0].alias, 'post-war');
});

test('MULTI_FAMILY: detects two distinct pack families and duplicate part titles', () => {
  const nb = {
    id: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
    alias: 'agent-harness',
    has_pack: true,
    pack_family: 'pack_agent_harness',
    multipart: true,
  };

  // Case 1: two distinct families
  const twoFam = classifyNotebook(nb, [
    { id: '1', title: 'pack_agent_harness.txt', status: 2 },
    { id: '2', title: 'pack_sigil.txt', status: 2 },
  ]);
  assert.equal(twoFam.counts.families, 2);
  assert.equal(twoFam.findings.some((f) => f.code === 'MULTI_FAMILY' && f.severity === 'red'), true);

  // Case 2: same exact part title present twice
  const dupPart = classifyNotebook(nb, [
    { id: '1', title: 'repo_knowledge_pack_part_aa.txt', status: 2 },
    { id: '2', title: 'repo_knowledge_pack_part_aa.txt', status: 2 },
    { id: '3', title: 'repo_knowledge_pack_part_ab.txt', status: 2 },
  ]);
  assert.equal(dupPart.counts.families, 1);
  assert.equal(dupPart.findings.some((f) => f.code === 'MULTI_FAMILY' && f.severity === 'red'), true);
});

test('BAK_UPLOADED: detects any source ending in .bak.txt', () => {
  const nb = {
    id: '6fd7c40b-df90-444b-9c7a-a64682925856',
    alias: 'willow-run',
    has_pack: true,
    pack_family: 'pack_willow_run',
  };

  const res = classifyNotebook(nb, [
    { id: '1', title: 'pack_willow_run.txt', status: 2 },
    { id: '2', title: 'pack_x.bak.txt', status: 2 },
  ]);
  assert.equal(res.findings.some((f) => f.code === 'BAK_UPLOADED' && f.severity === 'red'), true);
});

test('PACK_ERROR_STATUS: detects status 3 and missing status on pack sources', () => {
  const nb = {
    id: '6fd7c40b-df90-444b-9c7a-a64682925856',
    alias: 'willow-run',
    has_pack: true,
    pack_family: 'pack_willow_run',
  };

  const resStatus3 = classifyNotebook(nb, [
    { id: '1', title: 'pack_willow_run.txt', status: 3 },
  ]);
  assert.equal(resStatus3.findings.some((f) => f.code === 'PACK_ERROR_STATUS' && f.severity === 'red'), true);

  const resMissing = classifyNotebook(nb, [
    { id: '1', title: 'pack_willow_run.txt' },
  ]);
  assert.equal(resMissing.findings.some((f) => f.code === 'PACK_ERROR_STATUS' && f.severity === 'red'), true);
});

test('MULTIPART_GAP: detects non-contiguous multipart labels (aa, ac -> missing ab)', () => {
  const nb = {
    id: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
    alias: 'master-kb',
    has_pack: true,
    pack_family: 'pack_master_kb',
    multipart: true,
  };

  const res = classifyNotebook(nb, [
    { id: '1', title: 'pack_master_kb_part_aa.txt', status: 2 },
    { id: '2', title: 'pack_master_kb_part_ac.txt', status: 2 },
  ]);
  const gapFinding = res.findings.find((f) => f.code === 'MULTIPART_GAP');
  assert.ok(gapFinding, 'must report MULTIPART_GAP');
  assert.equal(gapFinding.severity, 'red');
  assert.match(gapFinding.detail, /\bab\b/);
});

test('POLLUTION: detects pack in has_pack:false notebook and software pack in historical notebook', () => {
  // 1. Pack in has_pack: false notebook
  const noPackNb = {
    id: 'fd0e0e4e-6890-4fb9-89bf-b9e568295e7a',
    alias: 'photo-archive',
    has_pack: false,
  };
  const resNoPack = classifyNotebook(noPackNb, [
    { id: '1', title: 'pack_photo_archive.txt', status: 2 },
  ]);
  assert.equal(resNoPack.findings.some((f) => f.code === 'POLLUTION' && f.severity === 'red'), true);

  // 2. pack_ironledger in historical master-kb notebook
  const masterKb = {
    id: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
    alias: 'master-kb',
    has_pack: true,
    pack_family: 'pack_master_kb',
  };
  const resHist = classifyNotebook(masterKb, [
    { id: '1', title: 'pack_ironledger.txt', status: 2 },
  ]);
  assert.equal(resHist.findings.some((f) => f.code === 'POLLUTION' && f.severity === 'red'), true);
});

test('POLLUTION false-positive fix: master-kb historical notebook with ordinary Sigil research sources and 3-part pack is GREEN with no POLLUTION', async () => {
  const masterKbManifest = {
    clusters: {
      cluster_b_historical_archival_media: {
        notebooks: [
          {
            key: 'master-kb',
            uuid: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
            has_pack: true,
            pack_family: 'pack_master_kb',
            multipart: true,
          },
        ],
      },
    },
  };

  const sources = [
    {
      id: 'r1',
      title: 'GitHub - sorensencc-dotcom/sigil: Governed cryptographic task relay and host connector for Claude, Codex, Grok, Antigravity, and local LLMs. · GitHub',
      status: 2,
    },
    {
      id: 'r2',
      title: 'Sigil Rooms vs. Switch Architecture',
      status: 2,
    },
    { id: 'm1', title: 'pack_master_kb_part_aa.txt', status: 2 },
    { id: 'm2', title: 'pack_master_kb_part_ab.txt', status: 2 },
    { id: 'm3', title: 'pack_master_kb_part_ac.txt', status: 2 },
  ];

  const [masterKbNb] = loadNotebooks(masterKbManifest);
  const classified = classifyNotebook(masterKbNb, sources);
  assert.equal(classified.findings.some((f) => f.code === 'POLLUTION'), false);
  assert.equal(classified.findings.length, 0);
  assert.deepEqual(classified.counts, {
    notebook_id: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
    families: 1,
    sources: 5,
    pack_sources: 3,
    parts: 3,
  });

  const report = await runCheck({
    manifest: masterKbManifest,
    runner: async () => ({ ok: true, sources }),
    now: FIXED_NOW,
  });
  assert.equal(report.overall, 'GREEN');
  assert.equal(report.findings.some((f) => f.code === 'POLLUTION'), false);
  assert.equal(report.findings.length, 0);
});

test('POLLUTION: software pack file titles in a historical notebook each produce a red POLLUTION finding', () => {
  const masterKb = {
    id: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
    alias: 'master-kb',
    has_pack: true,
    pack_family: 'pack_master_kb',
    multipart: true,
  };

  const pollutingPackTitles = [
    'pack_sigil.txt',
    'pack_ironledger_part_aa.txt',
    'repo_knowledge_pack_part_ab.txt',
    'pack_agent_harness.txt',
    'pack_agent_harness_part_ap.txt',
  ];

  for (const badTitle of pollutingPackTitles) {
    const res = classifyNotebook(masterKb, [
      { id: 'm1', title: 'pack_master_kb_part_aa.txt', status: 2 },
      { id: 'bad', title: badTitle, status: 2 },
    ]);
    const pollutionFinding = res.findings.find(
      (f) => f.code === 'POLLUTION' && f.severity === 'red'
    );
    assert.ok(pollutionFinding, `expected red POLLUTION finding for "${badTitle}"`);
    assert.match(pollutionFinding.detail, new RegExp(badTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('AUTH runner failure stops checking remaining notebooks and marks overall UNKNOWN (never RED)', async () => {
  let calls = 0;
  const authRunner = async (nbId) => {
    calls++;
    return {
      ok: false,
      sources: [],
      error: 'Authentication expired: please run nlm login',
      kind: 'AUTH',
    };
  };

  const res = await runCheck({
    manifest: INLINE_MANIFEST,
    runner: authRunner,
    now: FIXED_NOW,
  });

  assert.equal(calls, 1, 'must stop after first AUTH failure without retrying');
  assert.equal(res.overall, 'UNKNOWN');
  assert.equal(res.notebooks_checked, 0);
  assert.equal(res.notebooks_unknown, 1);
  assert.equal(res.unknown[0].kind, 'AUTH');
});

test('CLI_MISSING runner failure stops immediately and marks overall UNKNOWN', async () => {
  let calls = 0;
  const cliMissingRunner = async () => {
    calls++;
    return {
      ok: false,
      sources: [],
      error: 'spawn nlm ENOENT',
      kind: 'CLI_MISSING',
    };
  };

  const res = await runCheck({
    manifest: INLINE_MANIFEST,
    runner: cliMissingRunner,
    now: FIXED_NOW,
  });

  assert.equal(calls, 1);
  assert.equal(res.overall, 'UNKNOWN');
  assert.equal(res.unknown[0].kind, 'CLI_MISSING');
});

test('generic ERROR is retried once then recorded in unknown, and EXCLUDED_RETIRED is skipped', async () => {
  const attemptsByNb = new Map();
  const errorRunner = async (nbId) => {
    attemptsByNb.set(nbId, (attemptsByNb.get(nbId) || 0) + 1);
    if (nbId === '6fd7c40b-df90-444b-9c7a-a64682925856') {
      return {
        ok: false,
        sources: [],
        error: 'Command timed out',
        kind: 'ERROR',
      };
    }
    return {
      ok: true,
      sources: [{ id: '1', title: 'pack_master_kb_part_aa.txt', status: 2 }],
    };
  };

  const res = await runCheck({
    manifest: INLINE_MANIFEST,
    runner: errorRunner,
    now: FIXED_NOW,
  });

  assert.equal(attemptsByNb.get('6fd7c40b-df90-444b-9c7a-a64682925856'), 2, 'generic ERROR must be retried once');
  assert.equal(attemptsByNb.has('39a71593-eb5b-4605-a4a4-f212ae010da2'), false, 'EXCLUDED_RETIRED must be skipped');
  assert.equal(res.notebooks_unknown, 1);
  assert.equal(res.unknown[0].alias, 'willow-run');
  assert.equal(res.unknown[0].kind, 'ERROR');
});

test('atomic write and exit codes 0 (GREEN), 2 (RED), 3 (UNKNOWN) via main()', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nlm-pack-count-test-'));
  const manifestFile = path.join(tmpDir, 'manifest.json');
  const outFile = path.join(tmpDir, 'out', 'nlm_pack_counts.json');

  const miniManifest = {
    clusters: {
      c1: {
        notebooks: [
          {
            key: 'willow-run',
            uuid: '6fd7c40b-df90-444b-9c7a-a64682925856',
            has_pack: true,
            pack_family: 'pack_willow_run',
          },
        ],
      },
    },
  };
  fs.writeFileSync(manifestFile, JSON.stringify(miniManifest), 'utf8');

  // 1. Exit code 0 (GREEN)
  const codeGreen = await main(
    ['--manifest', manifestFile, '--out', outFile],
    {},
    {
      now: FIXED_NOW,
      runner: async () => ({
        ok: true,
        sources: [{ id: '1', title: 'pack_willow_run.txt', status: 2 }],
      }),
    }
  );
  assert.equal(codeGreen, 0);
  const writtenGreen = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(writtenGreen.overall, 'GREEN');
  assert.equal(writtenGreen.generated_at, '2026-10-17T12:00:00.000Z');

  // 2. Exit code 2 (RED)
  const codeRed = await main(
    ['--manifest', manifestFile, '--out', outFile],
    {},
    {
      now: FIXED_NOW,
      runner: async () => ({
        ok: true,
        sources: [
          { id: '1', title: 'pack_willow_run.txt', status: 2 },
          { id: '2', title: 'pack_other.bak.txt', status: 2 },
        ],
      }),
    }
  );
  assert.equal(codeRed, 2);
  const writtenRed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(writtenRed.overall, 'RED');

  // 3. Exit code 3 (UNKNOWN on auth expired)
  const codeUnknown = await main(
    ['--manifest', manifestFile, '--out', outFile],
    {},
    {
      now: FIXED_NOW,
      runner: async () => ({
        ok: false,
        sources: [],
        error: 'Authentication expired',
        kind: 'AUTH',
      }),
    }
  );
  assert.equal(codeUnknown, 3);
  const writtenUnknown = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(writtenUnknown.overall, 'UNKNOWN');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('modules and personal-os live H1 pack titles classify correctly as pack sources without NO_PACK findings', () => {
  const modulesNb = {
    id: '096b5b92-55d0-44b2-b074-3b3fef0a0d12',
    alias: 'modules',
    has_pack: true,
    pack_family: 'pack_modules',
    legacy_title_alias: 'KB - Modules Pack',
  };
  const modulesSources = [
    { id: 'm1', title: 'Canonical Domain Purpose — KB - Modules', status: 2 },
    { id: 'm2', title: 'Ecosystem Architecture Guide (Current)', status: 2 },
    { id: 'm3', title: 'KB - Modules Pack', status: 2 },
  ];
  const modRes = classifyNotebook(modulesNb, modulesSources);
  assert.equal(modRes.counts.pack_sources, 1);
  assert.equal(modRes.counts.families, 1);
  assert.equal(modRes.findings.length, 0);

  const personalOsNb = {
    id: '9724e682-c5ea-4693-8e21-caf8de68611e',
    alias: 'personal-os',
    has_pack: true,
    pack_family: 'pack_personal_os',
    legacy_title_alias: 'Personal OS (Household, Utilities, Florida Logistics) Pack',
  };
  const personalOsSources = [
    { id: 'p1', title: 'Personal OS Spec', status: 2 },
    { id: 'p2', title: 'Personal OS (Household, Utilities, Florida Logistics) Pack', status: 2 },
  ];
  const posRes = classifyNotebook(personalOsNb, personalOsSources);
  assert.equal(posRes.counts.pack_sources, 1);
  assert.equal(posRes.counts.families, 1);
  assert.equal(posRes.findings.length, 0);
});

test('pack_daily_part1..pack_daily_part21 for pack_daily notebook: one family, status GREEN, no MULTI_FAMILY', async () => {
  const dailyManifest = {
    clusters: {
      cluster_b_historical_archival_media: {
        notebooks: [
          {
            key: 'daily',
            uuid: '1b4861a3-931f-4632-8fc1-343a8dd37df8',
            has_pack: true,
            pack_family: 'pack_daily',
          },
        ],
      },
    },
  };

  const sources = Array.from({ length: 21 }, (_, i) => ({
    id: `d${i + 1}`,
    title: `pack_daily_part${i + 1}`,
    status: 2,
  }));

  const [dailyNb] = loadNotebooks(dailyManifest);
  const classified = classifyNotebook(dailyNb, sources);
  assert.equal(classified.counts.families, 1);
  assert.equal(classified.counts.pack_sources, 21);
  assert.equal(classified.counts.parts, 21);
  assert.equal(classified.findings.some((f) => f.code === 'MULTI_FAMILY'), false);
  assert.equal(classified.findings.length, 0);

  const report = await runCheck({
    manifest: dailyManifest,
    runner: async () => ({ ok: true, sources }),
    now: FIXED_NOW,
  });
  assert.equal(report.overall, 'GREEN');
  assert.equal(report.findings.some((f) => f.code === 'MULTI_FAMILY'), false);
  assert.equal(report.findings.length, 0);
});

test('repo_knowledge_pack_part_aa..aq and master-kb part1..23 still normalize to one family each', () => {
  const agentHarnessNb = {
    id: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
    alias: 'agent-harness',
    has_pack: true,
    pack_family: 'pack_agent_harness',
    multipart: true,
  };
  const alphaLabels = Array.from({ length: 17 }, (_, i) =>
    `a${String.fromCharCode(97 + i)}`
  ); // aa..aq
  const agentSources = alphaLabels.map((lbl, i) => ({
    id: `ah${i + 1}`,
    title: `repo_knowledge_pack_part_${lbl}.txt`,
    status: 2,
  }));
  const agentRes = classifyNotebook(agentHarnessNb, agentSources);
  assert.equal(agentRes.counts.families, 1);
  assert.equal(agentRes.counts.pack_sources, 17);
  assert.equal(agentRes.counts.parts, 17);
  assert.equal(agentRes.findings.length, 0);

  const masterKbNb = {
    id: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
    alias: 'master-kb',
    has_pack: true,
    pack_family: 'pack_master_kb',
    multipart: true,
  };
  const masterSources = Array.from({ length: 23 }, (_, i) => ({
    id: `mk${i + 1}`,
    title: `pack_master_kb_part${i + 1}.txt`,
    status: 2,
  }));
  const masterRes = classifyNotebook(masterKbNb, masterSources);
  assert.equal(masterRes.counts.families, 1);
  assert.equal(masterRes.counts.pack_sources, 23);
  assert.equal(masterRes.counts.parts, 23);
  assert.equal(masterRes.findings.length, 0);
});

test('two genuinely different families (pack_daily_part1 + pack_miami_estate) still produce MULTI_FAMILY', () => {
  const dailyNb = {
    id: '1b4861a3-931f-4632-8fc1-343a8dd37df8',
    alias: 'daily',
    has_pack: true,
    pack_family: 'pack_daily',
  };

  const res = classifyNotebook(dailyNb, [
    { id: '1', title: 'pack_daily_part1', status: 2 },
    { id: '2', title: 'pack_miami_estate', status: 2 },
  ]);
  assert.equal(res.counts.families, 2);
  assert.equal(res.findings.some((f) => f.code === 'MULTI_FAMILY' && f.severity === 'red'), true);
});

test('titles containing "partner" are not normalized as a part or merged with another family', () => {
  const xPartner = normalizePackFamilyKey('x_partner');
  assert.equal(xPartner.isPart, false);
  assert.equal(xPartner.partLabel, null);
  assert.equal(xPartner.familyKey, 'x_partner');

  const partnerBrief = normalizePackFamilyKey('pack_partner_brief');
  assert.equal(partnerBrief.isPart, false);
  assert.equal(partnerBrief.partLabel, null);
  assert.equal(partnerBrief.familyKey, 'pack_partner_brief');

  const nb = {
    id: '1b4861a3-931f-4632-8fc1-343a8dd37df8',
    alias: 'daily',
    has_pack: true,
    pack_family: 'pack_daily',
  };
  const classified = classifyNotebook(nb, [
    { id: '1', title: 'pack_partner_brief', status: 2 },
    { id: '2', title: 'pack_daily_part1', status: 2 },
  ]);
  assert.equal(classified.counts.families, 2);
  assert.equal(classified.counts.parts, 1);
  assert.equal(classified.findings.some((f) => f.code === 'MULTI_FAMILY' && f.severity === 'red'), true);
});


