---
name: verify-wiki-log
description: >
  Use when changing validateProposalSchema, copyTransactToWiki, synthesize-wiki
  promotion, wiki Log.md, Index.md root special, append-only log, or a proposal
  vaultPath of Log.md.
---

# Verify Log.md append-only

Live `wiki/Log.md` is an append-only audit trail. Entries stay. A synthesis run may append a session stanza. It must not replace the file with a model proposal.

## Does this change touch it?

Yes if the diff includes `modules/obsidian/synthesize-wiki.ts` (`validateProposalSchema`, journaled promotion) or `modules/wiki/schema.md` Log.md rules.

## Run

From `C:\dev\kb-sync`:

```powershell
node specs/wiki-log/run-tlc.mjs
node --test tests/modules/obsidian/synthesize-wiki.test.ts tests/validate-proposal-schema.test.ts
```

TLC uses `C:\Users\soren\.tla\jdk\bin\java.exe` and `C:\Users\soren\.tla\tla2tools.jar` (tlaplus v1.7.4). Override with `JAVA` and `TLA2TOOLS`.

A pass is: `run-tlc.mjs` exit 0 **and** those tests green. The runner already expects one TLC failure:

| Check | Meaning in the code |
|---|---|
| PASS current guards | `Log.md` is rejected as a proposal; existing live `Log.md` is not copied over; `appendFileSync` adds the stanza. First-run with no live log may seed a header. |
| BUG-VARIANT old allowlist + overwrite | `AllowLogProposal` and `PromoteExistingLog` both true: model proposes `Log.md`, transact write replaces the copied log, promote copies that onto live. History gone. |

A fail of `LogHistoryKept` on `WikiLog.cfg` (current knobs false) is a real bug or a stale model. Replay: `YouRunSynthesize` = provider vaultPath, `CopyAndWrite` = copy live wiki + `writeFileSync` accepted + seed-if-missing, `Promote` = `copyTransactToWiki` + `appendFileSync`. Product code only if the user asks.

## Bounds

One proposal per run (`page` / `log` / `index`). Live log starts empty or with history. No concurrent synthesizers, no rollback path.

## Coverage (sync `5b950e0f`)

| Code | Model |
|---|---|
| `validateProposalSchema` rejects `vaultPath === "Log.md"` | `AllowLogProposal = FALSE` |
| `isRootSpecial` is `Index.md` only | `chose = "index"` does not wipe the log |
| `copyTransactToWiki` skips existing live `Log.md` | `PromoteExistingLog = FALSE` |
| seed transact `Log.md` only if missing; then `appendFileSync` | `CopyAndWrite` seed / `Promote` keeps history |

Move this sync commit forward only after TLC still describes those steps at the new HEAD. `/maintain-formal-verification-skill` if HEAD moved without a recheck.
