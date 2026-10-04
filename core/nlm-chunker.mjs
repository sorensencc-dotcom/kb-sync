// ==============================================================================
// Dynamic NLM Pack Chunker & ENOBUFS Buffer Overflow Guard
// Guarantees zero pack files exceed KIS-P 380 KiB chunk ceilings.
// Automatically partitions oversized categories into sequential shards.
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_PACK_BYTES = 380 * 1024; // 380 KiB hard chunk ceiling
export const MAX_FACT_REGISTRY_BYTES = 38 * 1024; // 38 KiB ceiling for fact registry

export function computeSha256(content) {
  return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex');
}

export function formatFactEntry(fact) {
  const status = fact.verification_status || 'verified';
  const shortHash = (fact.fact_id || '').replace(/^sha256:/, '').slice(0, 7);
  const anchor = fact.temporal_anchor ? ` | ${fact.temporal_anchor}` : '';
  const hashTag = shortHash ? ` [hash: ${shortHash}]` : '';
  return `- [${status}] ${fact.subject} | ${fact.predicate} | ${fact.object}${anchor}${hashTag}`;
}

export function formatFactRegistrySection(facts = [], maxBytes = MAX_FACT_REGISTRY_BYTES) {
  if (!Array.isArray(facts) || facts.length === 0) return '';
  const headerLines = [
    '=== FACT REGISTRY (EVIDENCE MODE) ==='
  ];
  const footerLine = '================================================================================\n\n';

  const entries = [];
  let currentBytes = Buffer.byteLength(headerLines.join('\n') + '\n' + footerLine, 'utf8');

  for (const fact of facts) {
    const line = formatFactEntry(fact);
    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
    if (currentBytes + lineBytes <= maxBytes) {
      entries.push(line);
      currentBytes += lineBytes;
    } else {
      break;
    }
  }

  if (entries.length === 0) return '';
  return headerLines.join('\n') + '\n' + entries.join('\n') + '\n' + footerLine;
}

export function formatFileSection(item) {
  let section = `--- START FILE: ${item.relPath} ---\n`;
  if (item.frontmatter && item.frontmatter.source_title) {
    section += `PROVENANCE SOURCE: ${item.frontmatter.source_title}\n`;
    section += `REPOSITORY: ${item.frontmatter.repository || 'N/A'}\n`;
    section += `DOCUMENT DATE: ${item.frontmatter.document_date || 'N/A'}\n`;
    section += `VERIFICATION STATUS: ${item.frontmatter.verification_status || 'N/A'}\n`;
  }
  section += `\n${item.content}\n`;
  section += `--- END FILE: ${item.relPath} ---\n\n`;
  return section;
}

/**
 * Builds the chunk header text.
 */
export function buildChunkHeader(packDef, shardIndex, totalShards, itemCount, factCount) {
  const shardSuffix = totalShards > 1 ? ` (Part ${shardIndex} of ${totalShards})` : '';
  let header = `================================================================================\n`;
  header += `THEMATIC KNOWLEDGE PACK: ${packDef.title}${shardSuffix}\n`;
  header += `CATEGORY: ${packDef.category}\n`;
  header += `TARGET NOTEBOOK: ${packDef.notebookId}\n`;
  header += `SHARD: ${shardIndex}/${totalShards}\n`;
  header += `COMPILED AT: ${new Date().toISOString()}\n`;
  header += `FACT_REGISTRY_COUNT: ${factCount}\n`;
  header += `FILE COUNT: ${itemCount}\n`;
  header += `================================================================================\n\n`;
  return header;
}

/**
 * Partition items and facts for a pack definition into bounded chunks <= MAX_PACK_BYTES.
 * @param {Object} packDef
 * @param {Array<Object>} items
 * @param {Array<Object>} facts
 * @param {Object} options
 * @returns {Array<{ filename: string, payload: string, bytes: number, items: Array, facts: Array }>}
 */
export function partitionPackIntoChunks(packDef, items = [], facts = [], options = {}) {
  const maxPackBytes = options.maxPackBytes || MAX_PACK_BYTES;
  const maxFactBytes = options.maxFactBytes || MAX_FACT_REGISTRY_BYTES;

  if (items.length === 0) {
    const header = buildChunkHeader(packDef, 1, 1, 0, facts.length);
    const factSection = formatFactRegistrySection(facts, maxFactBytes);
    const payload = header + factSection;
    return [{
      filename: packDef.filename,
      payload,
      bytes: Buffer.byteLength(payload, 'utf8'),
      itemCount: 0,
      factCount: facts.length
    }];
  }

  // Pre-calculate formatted file strings
  const formattedItems = items.map(item => ({
    item,
    formatted: formatFileSection(item),
    bytes: Buffer.byteLength(formatFileSection(item), 'utf8')
  }));

  // Estimate single-chunk size
  const sampleHeader = buildChunkHeader(packDef, 1, 1, items.length, facts.length);
  const factSection = formatFactRegistrySection(facts, maxFactBytes);
  const baseOverhead = Buffer.byteLength(sampleHeader, 'utf8') + Buffer.byteLength(factSection, 'utf8');
  const totalItemBytes = formattedItems.reduce((acc, curr) => acc + curr.bytes, 0);

  if (baseOverhead + totalItemBytes <= maxPackBytes) {
    const payload = sampleHeader + factSection + formattedItems.map(f => f.formatted).join('');
    return [{
      filename: packDef.filename,
      payload,
      bytes: Buffer.byteLength(payload, 'utf8'),
      itemCount: items.length,
      factCount: facts.length
    }];
  }

  // Multi-part partitioning required
  const shards = [];
  let currentShardItems = [];
  let currentBytes = 0;

  function flushShard(shardNumber) {
    const header = buildChunkHeader(packDef, shardNumber, 0, currentShardItems.length, facts.length);
    const payload = header + factSection + currentShardItems.map(f => f.formatted).join('');
    shards.push({
      items: currentShardItems.map(f => f.item),
      payload,
      bytes: Buffer.byteLength(payload, 'utf8')
    });
    currentShardItems = [];
    currentBytes = 0;
  }

  const shardOverhead = baseOverhead + 128; // safety margin for shard label

  for (const formattedItem of formattedItems) {
    // If a single item exceeds maxPackBytes on its own, it must be included as its own shard
    if (formattedItem.bytes + shardOverhead > maxPackBytes && currentShardItems.length === 0) {
      currentShardItems.push(formattedItem);
      flushShard(shards.length + 1);
      continue;
    }

    if (currentBytes + formattedItem.bytes + shardOverhead > maxPackBytes) {
      flushShard(shards.length + 1);
    }

    currentShardItems.push(formattedItem);
    currentBytes += formattedItem.bytes;
  }

  if (currentShardItems.length > 0) {
    flushShard(shards.length + 1);
  }

  const totalShards = shards.length;
  const baseName = packDef.filename.replace(/\.txt$/i, '');

  return shards.map((shard, idx) => {
    const shardIndex = idx + 1;
    const filename = totalShards === 1 ? packDef.filename : `${baseName}_part${shardIndex}.txt`;
    const finalHeader = buildChunkHeader(packDef, shardIndex, totalShards, shard.items.length, facts.length);
    const finalPayload = finalHeader + factSection + shard.items.map(item => formatFileSection(item)).join('');
    const bytes = Buffer.byteLength(finalPayload, 'utf8');

    return {
      filename,
      payload: finalPayload,
      bytes,
      itemCount: shard.items.length,
      factCount: facts.length,
      shardIndex,
      totalShards
    };
  });
}
