#!/usr/bin/env node
import readline from 'node:readline';
import path from 'node:path';
import { getDatabase, DEFAULT_DB_PATH } from '../modules/cache/db-schema.mjs';

const DB_PATH = process.env.KB_CACHE_DB || DEFAULT_DB_PATH;

// Ensure database and schema exist
let db;
try {
  db = getDatabase(DB_PATH, { readonly: false });
} catch (err) {
  process.stderr.write(`[mcp-memory-server] Warning opening DB: ${err.message}\n`);
}

const SERVER_NAME = 'local-context-cache';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

const TOOL_DEFINITIONS = [
  {
    name: 'query_context_cache',
    description:
      'Searches the local SQLite topic research cache using full-text BM25 ranking. Returns matching topics, categories, file paths, highlighted context snippets, and rank scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms or keywords (supports SQLite FTS5 query syntax).'
        },
        category: {
          type: 'string',
          enum: ['all', 'research', 'gap', 'audit', 'source'],
          default: 'all',
          description: 'Filter results by document category.'
        },
        limit: {
          type: 'integer',
          default: 5,
          description: 'Maximum number of search results to return.'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'fetch_topic_note',
    description:
      'Retrieves the complete markdown content and metadata of a specific topic page from the local knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: "Kebab-case topic identifier (e.g. 'mobile-websocket-heartbeats')."
        }
      },
      required: ['topic']
    }
  }
];

export function handleQueryContextCache(dbInstance, { query, category = 'all', limit = 5 }) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'Error: A valid query string is required.' }]
    };
  }

  // Sanitize query for fts5 bare words or pass clean string
  let cleanQuery = query.trim();
  // If no boolean operators or quotes, wrap words with OR to allow BM25 ranking across matching tokens
  if (!/[*":]/.test(cleanQuery) && !/\b(AND|OR|NOT)\b/.test(cleanQuery)) {
    const tokens = cleanQuery.split(/\s+/).filter(Boolean);
    cleanQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' OR ');
  }

  let sql = `
    SELECT 
      d.id,
      d.topic,
      d.category,
      d.file_path,
      snippet(kb_fts, 2, '[MATCH]', '[/MATCH]', '...', 32) AS snippet,
      bm25(kb_fts) AS rank
    FROM kb_fts
    JOIN kb_documents d ON d.id = kb_fts.id
    WHERE kb_fts MATCH ?
  `;

  const params = [cleanQuery];

  if (category && category !== 'all') {
    sql += ' AND d.category = ?';
    params.push(category);
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(Number(limit) || 5);

  try {
    const stmt = dbInstance.prepare(sql);
    const results = stmt.all(...params);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  } catch (err) {
    // Fallback search with exact literal if syntax error in query
    try {
      const fallbackSql = `
        SELECT 
          d.id,
          d.topic,
          d.category,
          d.file_path,
          snippet(kb_fts, 2, '[MATCH]', '[/MATCH]', '...', 32) AS snippet,
          bm25(kb_fts) AS rank
        FROM kb_fts
        JOIN kb_documents d ON d.id = kb_fts.id
        WHERE kb_fts MATCH ?
        ${category && category !== 'all' ? 'AND d.category = ?' : ''}
        ORDER BY rank LIMIT ?
      `;
      const fallbackParams = [`"${query.replace(/"/g, '""')}"`];
      if (category && category !== 'all') fallbackParams.push(category);
      fallbackParams.push(Number(limit) || 5);

      const stmt = dbInstance.prepare(fallbackSql);
      const results = stmt.all(...fallbackParams);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2)
          }
        ]
      };
    } catch (fallbackErr) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Search failed: ${err.message}` }]
      };
    }
  }
}

export function handleFetchTopicNote(dbInstance, { topic }) {
  if (!topic || typeof topic !== 'string') {
    return {
      isError: true,
      content: [{ type: 'text', text: 'Error: A valid topic parameter is required.' }]
    };
  }

  const cleanTopic = topic.trim().toLowerCase();
  const stmt = dbInstance.prepare(`
    SELECT id, category, topic, file_path, content, sha256, last_updated 
    FROM kb_documents 
    WHERE LOWER(topic) = ? OR id = ? OR file_path LIKE ?
    LIMIT 1
  `);

  const result = stmt.get(cleanTopic, topic, `%${cleanTopic}%`);

  if (!result) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Topic "${topic}" not found in local cache.` }]
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: result.content
      }
    ]
  };
}

export function processRpcMessage(dbInstance, message) {
  if (!message || typeof message !== 'object') {
    return {
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request' },
      id: null
    };
  }

  const { id, method, params } = message;

  // Notifications (no id)
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') {
      return null;
    }
    return null;
  }

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION
          }
        }
      };

    case 'ping':
      return {
        jsonrpc: '2.0',
        id,
        result: {}
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOL_DEFINITIONS
        }
      };

    case 'tools/call': {
      const { name, arguments: args = {} } = params || {};
      if (name === 'query_context_cache') {
        const res = handleQueryContextCache(dbInstance, args);
        return {
          jsonrpc: '2.0',
          id,
          result: res
        };
      }
      if (name === 'fetch_topic_note') {
        const res = handleFetchTopicNote(dbInstance, args);
        return {
          jsonrpc: '2.0',
          id,
          result: res
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Unknown tool: ${name}`
        }
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      };
  }
}

// Start stdio interface if run directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'))) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const req = JSON.parse(trimmed);
      const res = processRpcMessage(db, req);
      if (res) {
        process.stdout.write(JSON.stringify(res) + '\n');
      }
    } catch (err) {
      const errRes = {
        jsonrpc: '2.0',
        error: { code: -32700, message: `Parse error: ${err.message}` },
        id: null
      };
      process.stdout.write(JSON.stringify(errRes) + '\n');
    }
  });

  process.stderr.write(`[mcp-memory-server] Started on stdio with DB: ${DB_PATH}\n`);
}
