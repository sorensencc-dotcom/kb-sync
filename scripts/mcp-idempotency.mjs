/**
 * Process-local idempotency ledger for the kb-sync loopback daemon.
 *
 * The key is idempotency:v1:{owner}:{client_request_id}. On this socket
 * the owner is the fixed principal. Tasks and the in-progress TTL are
 * not in this module.
 */

import { createHash } from "node:crypto";

export const CLIENT_REQUEST_ID = "dev.toolforge/clientRequestId";
export const RETRY_AFTER_SECONDS = 5;
export const FAILED_RETRY_CAP = 3;
const INVALID_PARAMS = -32602;

export function createLedger() {
  return { rows: new Map(), chain: Promise.resolve() };
}

function withLock(ledger, fn) {
  const run = ledger.chain.then(fn, fn);
  ledger.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function canonicalString(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalString).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalString(value[key])}`).join(",")}}`;
}

export function canonicalFingerprint(method, name, args) {
  const encoded = canonicalString({ arguments: args ?? null, method, name });
  return createHash("sha256").update(encoded).digest("hex");
}

function reject(id, reason, message, extra) {
  return jsonError(id, INVALID_PARAMS, message, { reason, ...(extra ?? {}) });
}

function jsonResult(id, result) {
  return Response.json({ jsonrpc: "2.0", id, result }, { status: 200 });
}

function jsonError(id, code, message, data) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message, data } }, { status: 400 });
}

function stampOwner(result, owner) {
  const structured = result?.structuredContent;
  const next =
    structured && typeof structured === "object" && !Array.isArray(structured)
      ? { ...structured }
      : structured == null
        ? {}
        : { value: structured };
  next.owner = owner;
  return { ...result, structuredContent: next };
}

async function readRpc(response) {
  const type = response.headers.get("content-type") || "";
  const text = await response.text();
  if (type.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload && payload !== "[DONE]") return JSON.parse(payload);
    }
    throw new Error("sse response had no data");
  }
  return JSON.parse(text);
}

function readOrInsert(ledger, key, fingerprint, owner) {
  const row = ledger.rows.get(key);
  if (!row) {
    ledger.rows.set(key, {
      status: "IN_PROGRESS",
      fingerprint,
      owner,
      body: null,
      error: null,
      retries: 0,
      retryable: false,
    });
    return { run: true };
  }
  if (row.fingerprint !== fingerprint) {
    return { error: ["idempotency_fingerprint_mismatch", "client request id was reused with a different call"] };
  }
  if (row.status === "COMPLETED") {
    return row.error ? { storedError: row.error } : { stored: structuredCopy(row.body) };
  }
  if (row.status === "IN_PROGRESS") {
    return {
      error: ["idempotency_in_progress", "this client request id is still running", { retryAfterSeconds: RETRY_AFTER_SECONDS }],
    };
  }
  if (row.status === "FAILED" && row.retryable && row.retries < FAILED_RETRY_CAP) {
    row.status = "IN_PROGRESS";
    row.body = null;
    row.retries += 1;
    return { run: true };
  }
  const exhausted = { code: INVALID_PARAMS, message: "retry cap exhausted", data: { reason: "idempotency_retry_exhausted" } };
  row.status = "COMPLETED";
  row.retryable = false;
  row.error = exhausted;
  row.body = null;
  return { storedError: exhausted };
}

function structuredCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(ledger, key, error) {
  const row = ledger.rows.get(key);
  if (!row || row.status !== "IN_PROGRESS") return;
  if (error) {
    row.status = "COMPLETED";
    row.retryable = false;
    row.body = null;
    row.error = error;
    return;
  }
  row.status = "FAILED";
  row.retryable = true;
  row.body = null;
  row.error = null;
}

function commit(ledger, key, result) {
  const row = ledger.rows.get(key);
  const body = stampOwner(structuredCopy(result), row.owner);
  row.status = "COMPLETED";
  row.retryable = false;
  row.body = body;
  row.error = null;
  return body;
}

export async function applyIdempotency(request, { mutations, ledger, fixedPrincipal, fetchHandler }) {
  if (request.method !== "POST") return fetchHandler(request);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return fetchHandler(request);
  let message;
  try {
    message = JSON.parse(await request.clone().text());
  } catch {
    return fetchHandler(request);
  }
  const params = message?.params ?? {};
  const name = params.name;
  if (message?.method !== "tools/call" || !mutations.has(name)) return fetchHandler(request);

  const meta = params._meta && typeof params._meta === "object" ? params._meta : {};
  const clientRequestId = meta[CLIENT_REQUEST_ID];
  if (typeof clientRequestId !== "string" || clientRequestId.length === 0) {
    return reject(message.id, "missing_client_request_id", "mutation requires dev.toolforge/clientRequestId");
  }
  const fingerprint = canonicalFingerprint(message.method, name, params.arguments ?? null);
  const key = `idempotency:v1:${fixedPrincipal}:${clientRequestId}`;
  const decision = await withLock(ledger, async () => readOrInsert(ledger, key, fingerprint, fixedPrincipal));
  if (decision.error) {
    const [reason, text, extra] = decision.error;
    return reject(message.id, reason, text, extra);
  }
  if (decision.storedError) {
    return jsonError(message.id, decision.storedError.code, decision.storedError.message, decision.storedError.data);
  }
  if (decision.stored) return jsonResult(message.id, decision.stored);

  let response;
  try {
    response = await fetchHandler(request);
  } catch {
    await withLock(ledger, async () => fail(ledger, key, null));
    throw new Error("mutation handler failed");
  }
  let rpc;
  try {
    rpc = await readRpc(response);
  } catch {
    await withLock(ledger, async () => fail(ledger, key, null));
    throw new Error("mutation handler returned no JSON-RPC body");
  }
  if (rpc.error) {
    await withLock(ledger, async () => fail(ledger, key, rpc.error));
    return jsonError(message.id, rpc.error.code, rpc.error.message, rpc.error.data);
  }
  const stored = await withLock(ledger, async () => commit(ledger, key, rpc.result));
  return jsonResult(message.id, stored);
}
