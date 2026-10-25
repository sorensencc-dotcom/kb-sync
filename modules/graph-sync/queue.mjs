import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const GRAPH_FORMAT = 'kb-sync-graph/v1';

export class GraphSyncError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GraphSyncError';
    this.code = code;
    this.details = details;
  }
}

function assertString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GraphSyncError('MALFORMED_SNAPSHOT', `${name} must be a non-empty string`);
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function nodeKey(node) {
  return `${node.id}\u0000${node.kind}\u0000${node.path}`;
}

function edgeKey(edge) {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
}

function normalizeNode(node) {
  if (!node || typeof node !== 'object') throw new GraphSyncError('MALFORMED_SNAPSHOT', 'Node must be an object');
  for (const field of ['id', 'kind', 'path', 'hash']) assertString(node[field], `node.${field}`);
  return { id: node.id, kind: node.kind, path: node.path, hash: node.hash };
}

function normalizeEdge(edge) {
  if (!edge || typeof edge !== 'object') throw new GraphSyncError('MALFORMED_SNAPSHOT', 'Edge must be an object');
  for (const field of ['from', 'to', 'kind']) assertString(edge[field], `edge.${field}`);
  return { from: edge.from, to: edge.to, kind: edge.kind };
}

function snapshotPayload(snapshot) {
  return {
    format: GRAPH_FORMAT,
    sourceVersion: snapshot.sourceVersion,
    targetVersion: snapshot.targetVersion,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
  };
}

export function hashSnapshot(snapshot) {
  const payload = snapshotPayload(canonicalizeSnapshot(snapshot, { validateHash: false }));
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

export function canonicalizeSnapshot(input, { validateHash = true } = {}) {
  if (!input || typeof input !== 'object') throw new GraphSyncError('MALFORMED_SNAPSHOT', 'Snapshot must be an object');
  if (input.format !== GRAPH_FORMAT) {
    throw new GraphSyncError('MALFORMED_SNAPSHOT', `Snapshot format must be ${GRAPH_FORMAT}`);
  }
  assertString(input.sourceVersion, 'sourceVersion');
  assertString(input.targetVersion, 'targetVersion');
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw new GraphSyncError('MALFORMED_SNAPSHOT', 'Snapshot nodes and edges must be arrays');
  }

  const nodes = input.nodes.map(normalizeNode).sort((a, b) => nodeKey(a).localeCompare(nodeKey(b)));
  const edges = input.edges.map(normalizeEdge).sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  const nodeKeys = new Set();
  for (const node of nodes) {
    const key = nodeKey(node);
    if (nodeKeys.has(key)) throw new GraphSyncError('MALFORMED_SNAPSHOT', `Duplicate node identity ${key}`);
    nodeKeys.add(key);
  }
  const edgeKeys = new Set();
  for (const edge of edges) {
    const key = edgeKey(edge);
    if (edgeKeys.has(key)) throw new GraphSyncError('MALFORMED_SNAPSHOT', `Duplicate edge identity ${key}`);
    edgeKeys.add(key);
  }

  const payload = { ...snapshotPayload({ sourceVersion: input.sourceVersion, targetVersion: input.targetVersion, nodes, edges }) };
  const snapshotHash = createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
  if (validateHash && input.snapshotHash !== undefined && input.snapshotHash !== snapshotHash) {
    throw new GraphSyncError('MALFORMED_SNAPSHOT', 'snapshotHash does not match canonical snapshot');
  }
  return deepFreeze({ ...payload, snapshotHash });
}

export function createGraphSnapshot({ sourceVersion, targetVersion, nodes = [], edges = [] }) {
  return canonicalizeSnapshot({ format: GRAPH_FORMAT, sourceVersion, targetVersion, nodes, edges });
}

export function parseGraphSnapshot(value) {
  let input = value;
  if (typeof value === 'string') {
    try {
      input = JSON.parse(value);
    } catch (error) {
      throw new GraphSyncError('MALFORMED_SNAPSHOT', `Snapshot JSON is invalid: ${error.message}`);
    }
  }
  if (!input || typeof input.snapshotHash !== 'string') {
    throw new GraphSyncError('MALFORMED_SNAPSHOT', 'Snapshot must include snapshotHash');
  }
  return canonicalizeSnapshot(input);
}

function mapBy(items, keyFn) {
  return new Map(items.map((item) => [keyFn(item), item]));
}

function compareVersions(expected, observed, unknown) {
  if (expected.sourceVersion !== observed.sourceVersion || expected.targetVersion !== observed.targetVersion) {
    unknown.push({
      type: 'version-mismatch',
      expected: { sourceVersion: expected.sourceVersion, targetVersion: expected.targetVersion },
      observed: { sourceVersion: observed.sourceVersion, targetVersion: observed.targetVersion },
    });
  }
}

export function compareSnapshots(expectedInput, observedInput) {
  const result = { added: [], removed: [], changed: [], rewired: [], unknown: [], hasDrift: true };
  let expected;
  let observed;
  try {
    expected = canonicalizeSnapshot(expectedInput);
    observed = canonicalizeSnapshot(observedInput);
  } catch (error) {
    result.unknown.push({ type: 'malformed-snapshot', message: error.message, code: error.code ?? 'MALFORMED_SNAPSHOT' });
    return result;
  }

  compareVersions(expected, observed, result.unknown);
  const expectedNodes = mapBy(expected.nodes, nodeKey);
  const observedNodes = mapBy(observed.nodes, nodeKey);
  for (const [key, node] of observedNodes) if (!expectedNodes.has(key)) result.added.push({ node });
  for (const [key, node] of expectedNodes) if (!observedNodes.has(key)) result.removed.push({ node });
  for (const [key, node] of expectedNodes) {
    const other = observedNodes.get(key);
    if (other && other.hash !== node.hash) result.changed.push({ key, expected: node, observed: other });
  }

  const expectedEdges = mapBy(expected.edges, edgeKey);
  const observedEdges = mapBy(observed.edges, edgeKey);
  const expectedBySource = new Map();
  const observedBySource = new Map();
  for (const edge of expected.edges) {
    const key = `${edge.from}\u0000${edge.kind}`;
    expectedBySource.set(key, [...(expectedBySource.get(key) ?? []), edge]);
  }
  for (const edge of observed.edges) {
    const key = `${edge.from}\u0000${edge.kind}`;
    observedBySource.set(key, [...(observedBySource.get(key) ?? []), edge]);
  }
  const rewiredEdges = new Set();
  for (const key of new Set([...expectedBySource.keys(), ...observedBySource.keys()])) {
    const oldEdges = (expectedBySource.get(key) ?? []).sort((a, b) => a.to.localeCompare(b.to));
    const newEdges = (observedBySource.get(key) ?? []).sort((a, b) => a.to.localeCompare(b.to));
    if (oldEdges.length === 1 && newEdges.length === 1 && oldEdges[0].to !== newEdges[0].to) {
      result.rewired.push({ from: oldEdges[0].from, kind: oldEdges[0].kind, expectedTo: oldEdges[0].to, observedTo: newEdges[0].to });
      rewiredEdges.add(edgeKey(oldEdges[0]));
      rewiredEdges.add(edgeKey(newEdges[0]));
    }
  }
  for (const [key, edge] of observedEdges) if (!expectedEdges.has(key) && !rewiredEdges.has(key)) result.added.push({ edge });
  for (const [key, edge] of expectedEdges) if (!observedEdges.has(key) && !rewiredEdges.has(key)) result.removed.push({ edge });

  result.added.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  result.removed.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  result.changed.sort((a, b) => a.key.localeCompare(b.key));
  result.rewired.sort((a, b) => `${a.from}\u0000${a.kind}`.localeCompare(`${b.from}\u0000${b.kind}`));
  result.hasDrift = result.added.length > 0 || result.removed.length > 0 || result.changed.length > 0 || result.rewired.length > 0 || result.unknown.length > 0;
  return result;
}

export function createPreflightToken({ queueId, sourceVersion, targetVersion, snapshotHash }) {
  for (const [name, value] of Object.entries({ queueId, sourceVersion, targetVersion, snapshotHash })) assertString(value, name);
  const binding = { version: 1, queueId, sourceVersion, targetVersion, snapshotHash };
  const encoded = Buffer.from(stableStringify(binding), 'utf8').toString('base64url');
  const digest = createHash('sha256').update(encoded, 'utf8').digest('hex');
  return `gst1.${encoded}.${digest}`;
}

export function verifyPreflightToken(token, binding) {
  if (typeof token !== 'string' || !token.startsWith('gst1.')) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const expectedDigest = createHash('sha256').update(parts[1], 'utf8').digest('hex');
  if (parts[2] !== expectedDigest) return false;
  try {
    const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return decoded.version === 1 && Object.entries(binding).every(([key, value]) => decoded[key] === value);
  } catch {
    return false;
  }
}

export function createMemoryPersistence(initial = { version: 1, items: [] }) {
  let state = clone(initial);
  return {
    load() { return clone(state); },
    save(next) { state = clone(next); },
    snapshot() { return clone(state); },
  };
}

export function createJsonFilePersistence(filePath) {
  return {
    load() {
      if (!fs.existsSync(filePath)) return { version: 1, items: [] };
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        throw new GraphSyncError('MALFORMED_STATE', `Queue state is invalid: ${error.message}`);
      }
    },
    save(state) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fs.renameSync(tempPath, filePath);
    },
  };
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseRdfFiles(baseDir, files, sourceVersion, targetVersion) {
  const nodes = [];
  const edges = [];
  for (const file of files) {
    const content = readUtf8(file);
    for (const [index, rawLine] of content.split(/\r?\n/u).entries()) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const fields = line.split('\t');
      if (fields[0] === 'node' && fields.length === 5) {
        nodes.push({ id: fields[1], kind: fields[2], path: fields[3], hash: fields[4] });
      } else if (fields[0] === 'edge' && fields.length === 4) {
        edges.push({ from: fields[1], to: fields[2], kind: fields[3] });
      } else {
        throw new GraphSyncError('MALFORMED_BASE', `Malformed RDF snapshot line ${path.relative(baseDir, file)}:${index + 1}`);
      }
    }
  }
  if (nodes.length === 0 && edges.length === 0) throw new GraphSyncError('MALFORMED_BASE', 'Base directory contains no RDF snapshot records');
  return createGraphSnapshot({ sourceVersion, targetVersion, nodes, edges });
}

export function readBaseSnapshot(baseDir, { sourceVersion, targetVersion } = {}) {
  if (!baseDir || !fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
    throw new GraphSyncError('BASE_MISSING', `Base directory is missing: ${baseDir ?? '(none)'}`);
  }
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const snapshotFile = entries.find((entry) => entry.isFile() && entry.name === 'snapshot.json');
  if (snapshotFile) return parseGraphSnapshot(readUtf8(path.join(baseDir, snapshotFile.name)));
  const files = entries
    .filter((entry) => entry.isFile() && /\.(?:nt|nq|ttl|rdf|txt)$/iu.test(entry.name))
    .map((entry) => path.join(baseDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
  return parseRdfFiles(baseDir, files, sourceVersion, targetVersion);
}

export function createFilePreflightAdapter({ baseDir }) {
  return {
    inspect(item) {
      const observedSnapshot = readBaseSnapshot(baseDir, item);
      return { observedSnapshot, observedHash: observedSnapshot.snapshotHash };
    },
  };
}

export function createGitMergeAdapter({ cwd = process.cwd() } = {}) {
  return {
    async apply(item) {
      assertString(item.sourceVersion, 'sourceVersion');
      if (item.sourceVersion.startsWith('-') || /[\r\n]/u.test(item.sourceVersion)) {
        throw new GraphSyncError('UNSAFE_MERGE_REF', 'sourceVersion is not a safe git ref');
      }
      const result = await execFileAsync('git', ['merge', '--no-ff', '--no-edit', item.sourceVersion], { cwd, encoding: 'utf8', windowsHide: true });
      return { stdout: result.stdout, stderr: result.stderr };
    },
  };
}

function currentTime(clock) {
  const value = typeof clock === 'function' ? clock() : clock?.now?.();
  return new Date(value ?? Date.now()).toISOString();
}

function nextId(idGenerator) {
  const value = typeof idGenerator === 'function' ? idGenerator() : idGenerator?.next?.();
  assertString(value, 'generated queue id');
  return value;
}

function stateItems(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.items)) throw new GraphSyncError('MALFORMED_STATE', 'Queue state must contain version 1 and items');
  return state.items;
}

export class GraphSyncQueue {
  constructor({ persistence = createMemoryPersistence(), preflightAdapter, mergeAdapter, clock, idGenerator = () => cryptoRandomId() } = {}) {
    this.persistence = persistence;
    this.preflightAdapter = preflightAdapter;
    this.mergeAdapter = mergeAdapter;
    this.clock = clock;
    this.idGenerator = idGenerator;
    stateItems(this.persistence.load());
  }

  _state() { return this.persistence.load(); }

  _save(items) { this.persistence.save({ version: 1, items }); }

  get(id) {
    const item = stateItems(this._state()).find((candidate) => candidate.id === id);
    return item ? clone(item) : null;
  }

  list() { return clone(stateItems(this._state())); }

  enqueue({ sourceVersion, targetVersion, snapshot }) {
    const canonical = canonicalizeSnapshot(snapshot);
    if (canonical.sourceVersion !== sourceVersion || canonical.targetVersion !== targetVersion) {
      throw new GraphSyncError('VERSION_MISMATCH', 'Queue versions must match snapshot versions');
    }
    const items = stateItems(this._state());
    const existing = items.find((item) => item.sourceVersion === sourceVersion && item.targetVersion === targetVersion && item.snapshotHash === canonical.snapshotHash);
    if (existing) return clone(existing);
    const now = currentTime(this.clock);
    const item = {
      id: nextId(this.idGenerator),
      sourceVersion,
      targetVersion,
      snapshotHash: canonical.snapshotHash,
      snapshot: canonical,
      status: 'queued',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      preflightToken: null,
      quarantine: null,
      lastError: null,
      mergeResult: null,
    };
    this._save([...items, item]);
    return clone(item);
  }

  retry(id) {
    const items = stateItems(this._state());
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new GraphSyncError('NOT_FOUND', `Queue item not found: ${id}`);
    const item = items[index];
    if (item.status === 'queued' || item.status === 'preflighting') return clone(item);
    if (item.status === 'merged') return clone(item);
    const next = { ...item, status: 'queued', preflightToken: null, lastError: null, updatedAt: currentTime(this.clock) };
    items[index] = next;
    this._save(items);
    return clone(next);
  }

  async preflight(id) {
    const items = stateItems(this._state());
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new GraphSyncError('NOT_FOUND', `Queue item not found: ${id}`);
    const item = items[index];
    if (item.status === 'merged') return clone(item);
    if (item.status === 'ready' && item.preflightToken) return clone(item);
    if (!this.preflightAdapter?.inspect) throw new GraphSyncError('PREFLIGHT_ADAPTER_MISSING', 'Preflight adapter is required');
    const pending = { ...item, status: 'preflighting', attempts: item.attempts + 1, updatedAt: currentTime(this.clock) };
    items[index] = pending;
    this._save(items);
    try {
      const inspection = await this.preflightAdapter.inspect(clone(pending));
      const observedSnapshot = inspection?.observedSnapshot ?? inspection?.snapshot;
      const report = compareSnapshots(pending.snapshot, observedSnapshot);
      if (report.hasDrift) {
        const quarantined = {
          ...pending,
          status: 'quarantined',
          updatedAt: currentTime(this.clock),
          preflightToken: null,
          quarantine: {
            expectedHash: pending.snapshotHash,
            observedHash: inspection?.observedHash ?? observedSnapshot?.snapshotHash ?? null,
            retryable: true,
            reason: report.unknown.length ? 'unknown-drift' : 'graph-drift',
            report,
          },
        };
        items[index] = quarantined;
        this._save(items);
        return clone(quarantined);
      }
      const ready = {
        ...pending,
        status: 'ready',
        updatedAt: currentTime(this.clock),
        preflightToken: createPreflightToken({ queueId: pending.id, sourceVersion: pending.sourceVersion, targetVersion: pending.targetVersion, snapshotHash: pending.snapshotHash }),
        quarantine: null,
      };
      items[index] = ready;
      this._save(items);
      return clone(ready);
    } catch (error) {
      const quarantined = {
        ...pending,
        status: 'quarantined',
        updatedAt: currentTime(this.clock),
        preflightToken: null,
        quarantine: {
          expectedHash: pending.snapshotHash,
          observedHash: null,
          retryable: true,
          reason: error.code ?? 'preflight-error',
          report: [{ message: error.message }],
        },
      };
      items[index] = quarantined;
      this._save(items);
      return clone(quarantined);
    }
  }

  async merge(id, token) {
    const items = stateItems(this._state());
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new GraphSyncError('NOT_FOUND', `Queue item not found: ${id}`);
    const item = items[index];
    if (item.status === 'merged') return clone(item);
    if (item.status !== 'ready' || !verifyPreflightToken(token, { queueId: item.id, sourceVersion: item.sourceVersion, targetVersion: item.targetVersion, snapshotHash: item.snapshotHash }) || token !== item.preflightToken) {
      throw new GraphSyncError('TOKEN_MISMATCH', 'Preflight token does not bind to queue item');
    }
    if (!this.mergeAdapter?.apply) throw new GraphSyncError('MERGE_ADAPTER_MISSING', 'Merge adapter is required');
    const merging = { ...item, status: 'merging', updatedAt: currentTime(this.clock) };
    items[index] = merging;
    this._save(items);
    try {
      const mergeResult = await this.mergeAdapter.apply(clone(merging));
      const merged = { ...merging, status: 'merged', updatedAt: currentTime(this.clock), mergeResult: clone(mergeResult) };
      items[index] = merged;
      this._save(items);
      return clone(merged);
    } catch (error) {
      const failed = { ...merging, status: 'failed', updatedAt: currentTime(this.clock), lastError: { code: error.code ?? 'MERGE_FAILED', message: error.message } };
      items[index] = failed;
      this._save(items);
      throw error;
    }
  }
}

function cryptoRandomId() {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
