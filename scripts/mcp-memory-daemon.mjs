import { createMcpHandler, localhostAllowedOrigins, McpServer, originValidationResponse } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { DEFAULT_DB_PATH, walCheckpoint } from "../modules/cache/db-schema.mjs";
import { applyIdempotency, createLedger } from "./mcp-idempotency.mjs";

const require = createRequire(import.meta.url);
const zodEntry = require.resolve("zod", {
  paths: [path.dirname(require.resolve("@modelcontextprotocol/server"))],
});
const { z } = await import(pathToFileURL(zodEntry).href);

export const CALLER_SUBJECT = "local:kb-sync";

/**
 * Require Authorization: Bearer <KB_CACHE_DAEMON_TOKEN> for HTTP daemon access.
 * When the env token is unset/empty, reject with 401 (HTTP mode must be configured).
 * Uses timing-safe compare when lengths match.
 *
 * @param {Request} request
 * @returns {Response|null} 401 Response when unauthorized, else null
 */
export function assertDaemonAuth(request) {
  const expected = process.env.KB_CACHE_DAEMON_TOKEN;
  if (expected == null || String(expected).length === 0) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        message: "KB_CACHE_DAEMON_TOKEN must be set for HTTP daemon access",
      }),
      {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
      },
    );
  }

  const header = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return new Response(
      JSON.stringify({ error: "unauthorized", message: "Missing or invalid Authorization Bearer token" }),
      {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
      },
    );
  }

  const provided = match[1];
  const expectedBuf = Buffer.from(String(expected), "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return new Response(
      JSON.stringify({ error: "unauthorized", message: "Invalid daemon token" }),
      {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
      },
    );
  }

  return null;
}


function sqlString(filePath) {
  return path.resolve(filePath).replaceAll("'", "''");
}

export function copyCacheDatabase(source, dest) {
  const resolvedSource = path.resolve(source);
  const resolvedDest = path.resolve(dest);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`kb-sync cache source is missing: ${resolvedSource}`);
  }
  fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const stale = resolvedDest + suffix;
    if (fs.existsSync(stale)) fs.rmSync(stale);
  }
  const sourceDb = new DatabaseSync(resolvedSource, { readOnly: true });
  try {
    sourceDb.exec(`VACUUM INTO '${sqlString(resolvedDest)}'`);
  } finally {
    sourceDb.close();
  }
  return { source: resolvedSource, dest: resolvedDest };
}

function prepareDatabaseEnv() {
  if (process.env.KB_CACHE_DB) {
    return {
      source: process.env.KB_CACHE_DB_SOURCE || null,
      dest: path.resolve(process.env.KB_CACHE_DB),
      copied: false,
    };
  }
  const source = process.env.KB_CACHE_DB_SOURCE || DEFAULT_DB_PATH;
  const dest = path.join(path.dirname(path.resolve(source)), "knowledge.daemon-copy.db");
  const copied = copyCacheDatabase(source, dest);
  process.env.KB_CACHE_DB = copied.dest;
  return { source: copied.source, dest: copied.dest, copied: true };
}

let loading;

export function loadDaemon() {
  if (!loading) loading = loadDaemonOnce();
  return loading;
}

async function loadDaemonOnce() {
  const paths = prepareDatabaseEnv();
  // mcp-memory-server.mjs reads KB_CACHE_DB and opens the file at import.
  const memory = await import("./mcp-memory-server.mjs");
  const opened = memory.daemonDatabasePath();
  if (path.resolve(opened) !== path.resolve(paths.dest)) {
    throw new Error(`daemon opened ${opened}, expected ${paths.dest}`);
  }

  const ledger = createLedger();
  const mutations = new Set(["mark_request"]);
  const executions = { mark_request: 0 };
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "local-context-cache", version: "1.0.0" });
    const database = memory.daemonDatabase();
    server.registerTool(
      "mark_request",
      {
        description: "Record one loopback marker. A retry returns the stored row.",
        inputSchema: z.object({ label: z.string() }),
      },
      async ({ label }) => {
        executions.mark_request += 1;
        return {
          content: [{ type: "text", text: label }],
          structuredContent: { label, executions: executions.mark_request },
        };
      },
    );
    server.registerTool(
      "query_context_cache",
      {
        description: "Search the local SQLite topic research cache.",
        inputSchema: z.object({
          query: z.string(),
          category: z.enum(["all", "research", "gap", "audit", "source"]).optional(),
          limit: z.number().int().optional(),
        }),
      },
      async (args) => memory.handleQueryContextCache(database, args),
    );
    server.registerTool(
      "fetch_topic_note",
      {
        description: "Read one topic note from the local knowledge cache.",
        inputSchema: z.object({ topic: z.string() }),
      },
      async (args) => memory.handleFetchTopicNote(database, args),
    );
    server.registerTool(
      "vfs_upsert_document",
      {
        description: "Write a note to the workspace and the local knowledge cache.",
        inputSchema: z.object({
          topic: z.string(),
          category: z.string(),
          content: z.string(),
          file_path: z.string().optional(),
        }),
      },
      async (args) => memory.handleVfsUpsertDocument(database, args),
    );
    return server;
  });

  return { memory, paths, handler, ledger, mutations };
}

export async function mountedFetch(request) {
  const started = await loadDaemon();
  const rejected = originValidationResponse(request, localhostAllowedOrigins());
  if (rejected) return rejected;
  const unauthorized = assertDaemonAuth(request);
  if (unauthorized) return unauthorized;
  return applyIdempotency(request, {
    mutations: started.mutations,
    ledger: started.ledger,
    fixedPrincipal: CALLER_SUBJECT,
    fetchHandler: (next) => started.handler.fetch(next),
  });
}

export function createHttpServer() {
  const nodeHandler = toNodeHandler({ fetch: mountedFetch });
  return http.createServer((req, res) => {
    nodeHandler(req, res);
  });
}

export async function closeDaemonDatabase() {
  const { memory } = await loadDaemon();
  const database = memory.daemonDatabase();
  if (!database) return;
  walCheckpoint(database, "TRUNCATE");
  database.close();
}

const entryUrl = pathToFileURL(path.resolve(process.argv[1] || "")).href;
if (entryUrl === import.meta.url) {
  const started = await loadDaemon();
  const port = Number(process.env.KB_CACHE_DAEMON_PORT || 8765);
  const server = createHttpServer();
  let closing = false;

  function shutdown() {
    if (closing) return;
    closing = true;
    fs.rmSync(`${started.paths.dest}.ready`, { force: true });
    server.close(() => {
      closeDaemonDatabase()
        .then(() => process.exit(0))
        .catch((error) => {
          process.stderr.write(`[mcp-memory-daemon] shutdown failed: ${error.message}\n`);
          process.exit(1);
        });
    });
    server.closeAllConnections?.();
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (process.env.KB_CACHE_DAEMON_STOP_ON_STDIN === "1") {
    process.stdin.on("end", shutdown);
    process.stdin.resume();
  }

  if (!process.env.KB_CACHE_DAEMON_TOKEN) {
    process.stderr.write(
      "[mcp-memory-daemon] WARNING: KB_CACHE_DAEMON_TOKEN is unset; all HTTP requests will return 401 Unauthorized.\n",
    );
  }

  server.listen(port, "127.0.0.1", () => {
    const { source, dest } = started.paths;
    const banner = `kb-sync daemon http://127.0.0.1:${port}/mcp subject ${CALLER_SUBJECT} source ${source} opened ${dest}\n`;
    fs.writeFileSync(`${dest}.ready`, `${source}\n${dest}\n`);
    process.stdout.write(banner);
  });
}
