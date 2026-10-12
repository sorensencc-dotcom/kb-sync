import assert from "node:assert/strict";
import test from "node:test";

import {
  FAILED_RETRY_CAP,
  applyIdempotency,
  canonicalFingerprint,
  createLedger,
} from "../scripts/mcp-idempotency.mjs";

const PRINCIPAL = "local:kb-sync";
const REQUEST_ID = "6f1e2c0a-7b34-4d5e-9a10-2c8b7d6e5f42";

function callRequest(name, args, requestId) {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "probe", version: "0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  if (requestId != null) meta["dev.toolforge/clientRequestId"] = requestId;
  return new Request("http://127.0.0.1:8765/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args, _meta: meta },
    }),
  });
}

function handler(seen, impl) {
  return async () => {
    seen.calls += 1;
    return impl(seen.calls);
  };
}

async function rpc(response) {
  return response.json();
}

test("missing client request id inserts nothing", async () => {
  const ledger = createLedger();
  const seen = { calls: 0 };
  const response = await applyIdempotency(callRequest("mark_request", { label: "alpha" }, null), {
    mutations: new Set(["mark_request"]),
    ledger,
    fixedPrincipal: PRINCIPAL,
    fetchHandler: handler(seen, () => Response.json({})),
  });
  const body = await rpc(response);
  assert.equal(response.status, 400);
  assert.equal(body.error.data.reason, "missing_client_request_id");
  assert.equal(ledger.rows.size, 0);
  assert.equal(seen.calls, 0);
});

test("completed row owner is the fixed principal", async () => {
  const ledger = createLedger();
  const seen = { calls: 0 };
  const response = await applyIdempotency(callRequest("mark_request", { label: "alpha" }, REQUEST_ID), {
    mutations: new Set(["mark_request"]),
    ledger,
    fixedPrincipal: PRINCIPAL,
    fetchHandler: handler(seen, (calls) =>
      Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: { structuredContent: { label: "alpha", executions: calls }, isError: false },
      }),
    ),
  });
  const body = await rpc(response);
  const key = `idempotency:v1:${PRINCIPAL}:${REQUEST_ID}`;
  const row = ledger.rows.get(key);
  assert.equal(row.owner, PRINCIPAL);
  assert.equal(row.status, "COMPLETED");
  assert.equal(body.result.structuredContent.owner, PRINCIPAL);
  assert.equal(body.result.structuredContent.executions, 1);
  assert.equal(seen.calls, 1);
});

test("same id returns the stored body", async () => {
  const ledger = createLedger();
  const seen = { calls: 0 };
  const options = {
    mutations: new Set(["mark_request"]),
    ledger,
    fixedPrincipal: PRINCIPAL,
    fetchHandler: handler(seen, (calls) =>
      Response.json({
        jsonrpc: "2.0",
        id: 9,
        result: { structuredContent: { label: "alpha", executions: calls } },
      }),
    ),
  };
  const first = await rpc(await applyIdempotency(callRequest("mark_request", { label: "alpha" }, REQUEST_ID), options));
  const second = await rpc(await applyIdempotency(callRequest("mark_request", { label: "alpha" }, REQUEST_ID), options));
  assert.deepEqual(second.result, first.result);
  assert.equal(seen.calls, 1);
  assert.equal(second.result.structuredContent.executions, 1);
});

test("same id different label does not run", async () => {
  const ledger = createLedger();
  const seen = { calls: 0 };
  const options = {
    mutations: new Set(["mark_request"]),
    ledger,
    fixedPrincipal: PRINCIPAL,
    fetchHandler: handler(seen, () => Response.json({ jsonrpc: "2.0", id: 2, result: { structuredContent: {} } })),
  };
  await applyIdempotency(callRequest("mark_request", { label: "alpha" }, REQUEST_ID), options);
  const response = await applyIdempotency(callRequest("mark_request", { label: "beta" }, REQUEST_ID), options);
  const body = await rpc(response);
  assert.equal(body.error.data.reason, "idempotency_fingerprint_mismatch");
  assert.equal(seen.calls, 1);
});

test("read without client request id runs", async () => {
  const ledger = createLedger();
  const seen = { calls: 0 };
  const response = await applyIdempotency(callRequest("query_context_cache", { query: "x" }, null), {
    mutations: new Set(["mark_request"]),
    ledger,
    fixedPrincipal: PRINCIPAL,
    fetchHandler: handler(seen, () => Response.json({ jsonrpc: "2.0", id: 2, result: { ok: true } })),
  });
  const body = await rpc(response);
  assert.equal(body.result.ok, true);
  assert.equal(seen.calls, 1);
  assert.equal(ledger.rows.size, 0);
});

test("in progress row does not run", async () => {
  const ledger = createLedger();
  const fingerprint = canonicalFingerprint("tools/call", "mark_request", { label: "alpha" });
  const key = `idempotency:v1:${PRINCIPAL}:${REQUEST_ID}`;
  ledger.rows.set(key, { status: "IN_PROGRESS", fingerprint, owner: PRINCIPAL, retries: 0, retryable: false });
  const seen = { calls: 0 };
  const response = await applyIdempotency(callRequest("mark_request", { label: "alpha" }, REQUEST_ID), {
    mutations: new Set(["mark_request"]),
    ledger,
    fixedPrincipal: PRINCIPAL,
    fetchHandler: handler(seen, () => Response.json({})),
  });
  const body = await rpc(response);
  assert.equal(body.error.data.reason, "idempotency_in_progress");
  assert.equal(body.error.data.retryAfterSeconds, 5);
  assert.equal(seen.calls, 0);
  assert.equal(ledger.rows.get(key).status, "IN_PROGRESS");
});

test("handler throw is retryable once", async () => {
  const ledger = createLedger();
  const seen = { calls: 0 };
  const options = {
    mutations: new Set(["mark_request"]),
    ledger,
    fixedPrincipal: PRINCIPAL,
    fetchHandler: handler(seen, (calls) => {
      if (calls === 1) throw new Error("boom");
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: { structuredContent: { label: "alpha", executions: calls } },
      });
    }),
  };
  const request = () => callRequest("mark_request", { label: "alpha" }, REQUEST_ID);
  await assert.rejects(() => applyIdempotency(request(), options));
  const key = `idempotency:v1:${PRINCIPAL}:${REQUEST_ID}`;
  assert.equal(ledger.rows.get(key).status, "FAILED");
  const body = await rpc(await applyIdempotency(request(), options));
  assert.equal(seen.calls, 2);
  assert.equal(ledger.rows.get(key).status, "COMPLETED");
  assert.equal(body.result.structuredContent.executions, 2);
  assert.equal(ledger.rows.get(key).retries, 1);
  assert.equal(FAILED_RETRY_CAP, 3);
});
