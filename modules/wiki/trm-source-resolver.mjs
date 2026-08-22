import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;

export class TRMSourceResolver {
  constructor(stagingRoot, { resolveSource } = {}) {
    this.stagingRoot = path.resolve(stagingRoot);
    this.resolveSource = resolveSource;
    if (typeof resolveSource !== 'function') throw new Error('source content resolver is required');
  }

  normalizeSourceId(rawId) {
    if (typeof rawId !== 'string') throw new Error('source id is required');
    const clean = rawId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const normalized = clean.startsWith('src-') ? clean : `src-${clean}`;
    if (!/^src-[a-z0-9-]+$/.test(normalized)) throw new Error(`source id cannot be normalized: ${rawId}`);
    return normalized;
  }

  async resolveAndMaterialize(result, batchId, { approved = false } = {}) {
    if (!approved) throw new Error('research result must be explicitly approved');
    if (!result || result.schema !== 'research.result.v1') throw new Error('research.result.v1 is required');
    if (result.status !== 'completed') throw new Error('only completed research results may be materialized');
    const findings = result.payload?.findings;
    if (!Array.isArray(findings)) throw new Error('research result findings are required');

    const batchDir = path.join(this.stagingRoot, 'trm', batchId);
    const sourcesDir = path.join(batchDir, 'sources');
    fs.mkdirSync(sourcesDir, { recursive: true });
    const mappings = [];
    const sources = [];
    const manifest = {};
    const seen = new Set();

    for (const finding of findings) {
      const incomingId = finding?.source_id;
      if (seen.has(incomingId)) continue;
      seen.add(incomingId);
      const source = await this.resolveSource(incomingId);
      if (!source || typeof source.text !== 'string') throw new Error(`source content is required: ${incomingId}`);
      if (finding.source_revision !== source.revision) throw new Error(`source revision mismatch: ${incomingId}`);
      const span = finding.source_span;
      if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end < span.start || span.end > source.text.length) throw new Error(`source span is invalid: ${incomingId}`);
      if (span.span_hash !== sha256(source.text.slice(span.start, span.end))) throw new Error(`source span hash mismatch: ${incomingId}`);

      const resolvedId = this.normalizeSourceId(incomingId);
      const stagedFilename = `${resolvedId}.md`;
      const markdown = `---\nsource_id: "${resolvedId}"\noriginal_id: "${incomingId}"\ntitle: "${String(source.title ?? incomingId).replaceAll('"', '\\"')}"\nurl: "${source.url}"\nretrieved_at: "${source.retrieved_at}"\n---\n\n${source.text}\n`;
      fs.writeFileSync(path.join(sourcesDir, stagedFilename), markdown, 'utf8');
      const digest = crypto.createHash('sha256').update(markdown, 'utf8').digest('hex');
      manifest[stagedFilename] = { content_sha256: digest, byte_size: Buffer.byteLength(markdown) };
      sources.push({ source_id: resolvedId, title: source.title ?? incomingId, origin_uri: source.url, staged_filename: stagedFilename, content_sha256: digest, byte_size: Buffer.byteLength(markdown), retrieved_at: source.retrieved_at });
      mappings.push({ incoming_id: incomingId, resolved_id: resolvedId, staged_path: `sources/${stagedFilename}` });
    }

    const payload = { schema_version: '2.3.0', batch_id: batchId, topic_id: `trm:${result.task_id}`, title: result.task_id, domain: 'research', status: 'stable', summary: `Approved research result ${result.task_id}`, sources, extracted_concepts: [] };
    fs.writeFileSync(path.join(batchDir, 'payload.json'), JSON.stringify(payload, null, 2));
    fs.writeFileSync(path.join(batchDir, 'sources.manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(batchDir, 'FILES.manifest.txt'), Object.entries(manifest).map(([file, info]) => `${info.content_sha256}  ${file}`).join('\n'));
    return { batch_id: batchId, mappings, payload, manifest };
  }
}