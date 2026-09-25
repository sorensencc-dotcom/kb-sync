---
source: grok
skill: drive-it
topic: spec
title: "MCP stream transports: edge cases and breaking changes"
created: Fri Sep 25 2026 16:06:02 GMT-0400 (Eastern Daylight Time)
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
provenance_type: mobile_inbox_drop
content_sha256: 31d173ea231e35a31e016f1257cf9db83f7cd8ae6fbcfa40646a52f466f25b54
---

# MCP stream transports — edge cases and breaking changes

## Context

Live developer reports and first-party spec changelog for MCP remote transports: legacy HTTP+SSE (2024-11-05, Deprecated), Streamable HTTP (2025-03-26 / 2025-11-25), and the 2026-07-28 stateless revision.

## Payload

### Verdict

**SUPPORTED.** Two stacked breaking changes are real and first-party documented. Field failures cluster on idle SSE reads, HTTP/2 proxy flush, client hard timeouts, and dual-era handshake detection.

### Spec timeline (VERIFIED — modelcontextprotocol.io changelog 2026-07-28)

| Date | Event |
|---|---|
| 2024-11-05 | stdio + HTTP+SSE (GET stream + POST /messages?sessionId=) |
| 2025-03-26 | Streamable HTTP introduced; HTTP+SSE deprecated |
| 2025-04 | TS SDK v1.10.0 `StreamableHTTPServerTransport` |
| 2026-04-01 | Keboola drops SSE |
| 2026-06-30 | Atlassian Rovo SSE deadline |
| 2026-07-28 | Sessions, initialize handshake, GET stream, Last-Event-ID resumability removed |

Official 2026-07-28 removals: `Mcp-Session-Id`; `initialize` / `initialized`; standalone GET SSE; SSE event IDs / `Last-Event-ID` redelivery. Broken stream = lost in-flight request; client MUST retry with a new request id. HTTP+SSE reclassified Deprecated (SEP-2596). New headers: `Mcp-Method`, `Mcp-Name`. Subscriptions move to `subscriptions/listen`.

WorkOS (2026-09-16) and AWS/InfoQ (2026-09-25): protocol is stateless; application state is now the operator's problem; tool calls with side effects need idempotency because resume is gone.

### Field failure modes (developer reports)

1. **Idle SSE hang (TS SDK).** `_handleSseStream` `reader.read()` blocks forever on half-open TCP / proxy stall. Caller AbortSignal does not reach the loop. Issue #1883 + PR #1963 (`idleTimeoutMs`). Agents sit on "thinking" for 10+ minutes.
2. **Python SDK deadlock (stateless, 3+ SSE items).** Issue #1764: zero-buffer anyio memory streams. 1–2 items OK; 3+ hang. Race: MCP handler finishes before SSE writer iterates.
3. **HTTP/2 reverse-proxy TTFB hang (Go SDK #937).** Standalone GET SSE flushes headers with no DATA frame. Envoy/Caddy/httputil buffer HEADERS until DATA or timeout (~30s). Workaround: write SSE comment `: ok\n\n` after WriteHeader.
4. **Claude Code 5-minute hard cut.** Streamable HTTP tool calls ignored per-server timeout and died at ~5 min. Fixed in 2.1.274 (2026-09-17). Same release: legacy HTTP+SSE-only servers failed with 4xx. X: @ai_hack_dx, @Evro_AI, @ethereaglehq, @AICodingOpsJP.
5. **TS SDK #2739 (reproduced 1.29/1.30 by @NiaoXiao93261, 2026-09-01).** Request-scoped SSE dies in 3–4 ms while POST stays pending until timeout. JSON control path returns immediately.
6. **Proxy buffering / Origin 403.** Legacy two-endpoint SSE dies behind buffers. Streamable HTTP servers MUST validate Origin. Detection: POST initialize with `Accept: application/json, text/event-stream`. 405 → try GET SSE (legacy). Stateless 2026-07-28 servers have no initialize to succeed — try `tools/list` before declaring the URL dead (Merlonix).
7. **Load-balancer affinity.** Pre-2026-07-28 Streamable HTTP with sessions breaks if POST and GET land on different nodes. Post-2026-07-28 this is gone at protocol level; in-flight stream loss remains.

### Undocumented / easy to get wrong

- "SSE" in 2026 speech means two different things: deprecated HTTP+SSE transport vs optional SSE framing inside Streamable HTTP. Mixing the words in client config (`type: sse` vs `type: http`) is a common break.
- Official changelog is primary. Blog matrices that still list Streamable HTTP as "resumable" are stale after 2026-07-28.
- Tier-1 SDKs claim dual-era compat; custom clients that require `initialize` will fail against 2026-07-28 servers.
- No first-party guarantee that HTTP+SSE stays until mid-2027. Calmara: removable any release after Aug 2026 eligibility; unlikely before mid-2027; no universal client cutoff except named vendors.

## Next

If Rewrite Labs or CIC MCP servers still speak `/sse` + `?sessionId=`, migrate to one `/mcp` endpoint and treat 2026-07-28 as the target (no session header, idempotent tools). Catalog ingest: topic `spec`.
