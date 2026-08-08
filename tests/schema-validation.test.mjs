import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('schemas exist and are valid JSON', () => {
  const dagSchema = JSON.parse(fs.readFileSync('kb-sync/schemas/dag.schema.v2.json', 'utf8'));
  const adjSchema = JSON.parse(fs.readFileSync('kb-sync/schemas/adjacency.schema.v2.json', 'utf8'));
  assert.equal(dagSchema.version, '2.0.0');
  assert.equal(adjSchema.version, '2.0.0');
});
