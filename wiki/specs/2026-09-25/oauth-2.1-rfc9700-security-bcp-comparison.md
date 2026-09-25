---
source: copilot
skill: drive-it
topic: spec
title: "OAuth 2.1 vs RFC 9700 Security Best Current Practice Comparison"
created: 2026-09-25T20:06:48Z
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
---

## Findings Summary

RFC 9700 and OAuth 2.1 are related but distinct artifacts. RFC 9700 ("Best Current Practice for OAuth 2.0
Security," published January 2025, BCP 240) is a security advisory document layered on top of the existing
OAuth 2.0 core spec (RFC 6749/6750) — it recommends against insecure patterns without removing them from the
underlying spec text. OAuth 2.1 (`draft-ietf-oauth-v2-1`, currently revision -16 as of September 2026) is a
full consolidation/replacement spec that folds RFC 9700's recommendations directly into normative requirements
and deletes the deprecated flows from the spec text entirely rather than just discouraging them. OAuth 2.1 is
still an Internet-Draft, not yet an RFC.

Key behavioral differences RFC 9700 recommends vs. OAuth 2.1 mandates as core requirements: PKCE is required
for every authorization-code-grant client (not just public clients); redirect URIs must use exact string
matching (no partial/pattern matching); the Implicit grant and Resource Owner Password Credentials grant are
removed from the specification (OAuth 2.1 doesn't merely deprecate them, it omits them); refresh tokens issued
to public clients must be sender-constrained or rotated on use.

## Primary Citations & Specifications

- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html) — IETF BCP 240, published January 2025; updates RFC 6749, 6750, 6819; deprecates Implicit grant and Resource Owner Password Credentials grant, recommends PKCE and exact redirect URI matching.
- [draft-ietf-oauth-v2-1-16 — The OAuth 2.1 Authorization Framework](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) — Active Internet-Draft, last updated 2026-09-02; replaces/obsoletes RFC 6749 and RFC 6750's bearer token usage; WG milestone targets IESG submission December 2026.
- [OAuth 2.1 — oauth.net summary](https://oauth.net/2.1/) — lists the concrete deltas from OAuth 2.0: PKCE required for all clients, exact-match redirect URIs, Implicit and Password grants omitted, sender-constrained or rotated refresh tokens for public clients.
- [OAuth 2.0 Security Best Current Practice — oauth.net summary of RFC 9700](https://oauth.net/2/oauth-best-practice/) — confirms "the recommendations in this document are incorporated into OAuth 2.1."

## Contradictions or Open Gaps

- OAuth 2.1 is not finalized — it remains an Internet-Draft (expires March 2027), so citing it as a settled
  spec would overstate its status; RFC 9700 is the only one of the two that is a published, numbered RFC.
- A successor BCP is already in progress — [`draft-ietf-oauth-security-topics-update`](https://www.ietf.org/archive/id/draft-wuertele-oauth-security-topics-update-00.html) explicitly extends RFC 9700 to
  cover newly discovered threats (e.g., audience injection attacks against signature-based client
  authentication) not yet addressed in RFC 9700 itself — treat RFC 9700 as necessary but not sufficient for
  current-state security guidance.
