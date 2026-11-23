import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProposalSchema } from '../../../modules/obsidian/synthesize-wiki.js';
import { SynthesisProposal } from '../../../modules/obsidian/providers/index.js';

const stagedManifestSet = new Set(['docs/source.md', 'modules/obsidian/ingest-wiki.sh']);

const createBaseProposal = (): SynthesisProposal => ({
  title: 'Valid Proposal',
  category: 'wiki',
  status: 'active',
  summary: 'A valid proposal',
  citations: ['docs/source.md'],
  body: 'Some content',
  vaultPath: 'wiki/concepts/Test.md',
});

test('validateProposalSchema', async (t) => {

  await t.test('accepts a valid proposal', () => {
    const proposal = createBaseProposal();
    const errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.deepEqual(errors, []);
  });

  await t.test('rejects missing or empty title', () => {
    let proposal = createBaseProposal();
    proposal.title = '';
    let errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Missing mandatory proposal field 'title'/);

    proposal = createBaseProposal();
    (proposal as any).title = undefined;
    errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Missing mandatory proposal field 'title'/);
  });

  await t.test('rejects non-canonical category', () => {
    const proposal = createBaseProposal();
    proposal.category = 'unknown-category';
    const errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Non-canonical proposal category 'unknown-category'/);
  });

  await t.test('rejects non-canonical status', () => {
    const proposal = createBaseProposal();
    proposal.status = 'unknown-status';
    const errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Non-canonical proposal status 'unknown-status'/);
  });

  await t.test('rejects invalid vaultPath suffix', () => {
    const proposal = createBaseProposal();
    proposal.vaultPath = 'wiki/concepts/Test.txt';
    const errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Invalid vaultPath '.*'. Must end in \.md and have no '\.\.' path traversal/);
  });

  await t.test('rejects invalid vaultPath containing ..', () => {
    const proposal = createBaseProposal();
    proposal.vaultPath = 'wiki/concepts/../Test.md';
    const errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Invalid vaultPath '.*'. Must end in \.md and have no '\.\.' path traversal/);
  });

  await t.test('rejects invalid vaultPath boundary', () => {
    const proposal = createBaseProposal();
    proposal.vaultPath = 'unknown/boundary/Test.md';
    const errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Invalid vaultPath '.*'. Must start with a canonical vault directory boundary/);
  });

  await t.test('rejects Log.md; accepts Index.md root special', () => {
    const proposal1 = createBaseProposal();
    proposal1.vaultPath = 'Log.md';
    const logErrors = validateProposalSchema(proposal1, stagedManifestSet);
    assert.equal(logErrors.length, 1);
    assert.match(logErrors[0], /Log\.md is append-only/);

    const proposal2 = createBaseProposal();
    proposal2.vaultPath = 'Index.md';
    assert.deepEqual(validateProposalSchema(proposal2, stagedManifestSet), []);
  });

  await t.test('rejects citations that are not an array', () => {
    const proposal = createBaseProposal();
    (proposal as any).citations = 'docs/source.md';
    const errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Proposal 'citations' must be an array/);
  });

  await t.test('rejects unmanifested citations', () => {
    const proposal = createBaseProposal();
    proposal.citations = ['docs/unknown.md'];
    const errors = validateProposalSchema(proposal, stagedManifestSet);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Unmanifested citation 'docs\/unknown.md'/);
  });
});

test('synthesize-wiki preserves live Log.md append-only behavior', () => {
  const proposal = createBaseProposal();
  proposal.vaultPath = 'Log.md';
  const errors = validateProposalSchema(proposal, stagedManifestSet);
  assert.ok(errors.some((e) => e.includes('Log.md is append-only')));

  const lowerProposal = createBaseProposal();
  lowerProposal.vaultPath = 'log.md';
  const lowerErrors = validateProposalSchema(lowerProposal, stagedManifestSet);
  assert.ok(lowerErrors.some((e) => e.includes('Log.md is append-only')));

  const nestedProposal = createBaseProposal();
  nestedProposal.vaultPath = 'kb-sync/Log.md';
  const nestedErrors = validateProposalSchema(nestedProposal, stagedManifestSet);
  assert.ok(nestedErrors.some((e) => e.includes('Log.md is append-only')));
});
