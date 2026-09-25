---
source: grok
skill: drive-it
topic: rewrite
title: "CJS to ESM migration pitfalls in large Node monorepos"
created: Fri Sep 25 2026 16:06:02 GMT-0400 (Eastern Daylight Time)
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
provenance_type: mobile_inbox_drop
content_sha256: d4e30167d350a5d2a567164599af0eeb2026fba6d0ab60d0ceb12d9d6a34fc1b
---

# CJS → ESM in large Node monorepos — live pitfalls

## Context

Rewrite Labs and kb-sync are Node/TS workspaces. This drop lists migration failure modes that still show up in 2025–2026 field reports, not the textbook syntax diff.

## Payload

### Verdict

**SUPPORTED.** The breakage is concentrated in interop seams, not `import` vs `require` spelling. Monorepos multiply every seam by package count.

### Pitfalls that actually ship-break

1. **ERR_REQUIRE_ESM from a dependency flip.** A CJS workspace `require()`s a package that went ESM-only. Sentry (updated 2026-09-21) still lists this as the default Next/tooling trap. Fix is `import()` or flip the importer to ESM — not "add type module to one package and hope."
2. **`"type": "module"` at the wrong boundary.** One root or one package flipped; siblings stay CJS. `.js` meaning flips per nearest package.json. File-by-file migration without directory boundaries produces mixed graphs. Joyee Cheung (Node, Nordic.js 2025 / talks 2025): transpiled-as-CJS source that *looks* like ESM then `require()`s a real ESM dep → confusing ERR_REQUIRE_ESM in code that has no `require` in source.
3. **Dual-package hazard.** Shipping both CJS and ESM copies of the same package can instantiate it twice when an ESM consumer pulls one copy via CJS dep path and another via ESM path. Shared singletons, plugin registries, and React-like contexts split. Cheung: "not every package is set up to expect two versions of itself."
4. **Default-export interop.** `module.exports = fn` vs `export default`. Named import of a CJS default can be `undefined` in production only (Nexumo 2026-02: taxlib `computeTax` undefined in one region after a "green" deploy). Prefer named exports only during migration.
5. **Mandatory extensions.** ESM requires explicit `.js` (or `.mjs`) in relative specifiers. TS-in-TS often omits them; production Node does not. Prisma 7 default ESM + Turborepo: @aman100xdev (2026-01-25) had to set `"type": "module"` on all 5 package.json files and add `.js` extensions in `.ts` imports.
6. **Circular imports.** CJS is lenient (partial exports). ESM can yield `undefined` bindings. Surfaces only after the first files flip.
7. **Tooling still assuming CJS.** Jest/ts-jest, older Mocha, some Webpack configs, `tsconfig.module: CommonJS` silently rewriting `import` → `require`. Then runtime hits real ESM deps.
8. **`__dirname` / `__filename` / `require.resolve` / `require.cache`.** Gone. Need `import.meta.url` + `fileURLToPath`. Dynamic optional deps that used `require` in try/catch need `import()`.
9. **Top-level await.** Fine in ESM apps; cannot be `require()`d. Breaks test runners and CJS entrypoints that load the package.
10. **Package manager defaults moved.** pnpm 11 (Apr 2026, @pnpmjs): pure ESM, Node 22+, `pnpm init` defaults to `"type": "module"`. Rspack 2.0: pure ESM. Node 24.15: `require(esm)` stable — reduces but does not delete dual-package and exports-map bugs.
11. **exports map conditions.** `"import"` vs `"require"` vs `"default"` pointing at different files. Monorepo workspace protocol (`workspace:*`) plus mismatched conditions = different resolution in app vs test vs tsup.
12. **Hono + pnpm monorepo.** @levan (2025-10): could not run Hono without `"type": "module"`; stayed on Cloudflare rather than migrate one service.

### Monorepo-specific protocol

- Pick one strategy and freeze it: **app-only ESM** (apps `"type": "module"`, libs stay CJS until touched) or **full-repo ESM** (one cutover). Do not freestyle per package (Nexumo).
- Flip by package, not by file. Every package.json is a format boundary.
- Ban default exports on workspace packages until the graph is one format.
- Run the same resolver in test and prod (Node, not a bundler-only path) before calling the migration done.
- Node 22+ `require(esm)` is an offramp for leftover CJS scripts, not a reason to keep publishing dual packages.

### What this is not

Not a claim that CJS is dead. Cheung's 2025 survey: most high-impact npm packages still ship CJS or dual, not "real ESM." Rewrite Labs scanners that assume every modern site's toolchain is ESM-only will misclassify.

## Next

If kb-sync / trm-ingest scripts are still CJS entrypoints calling ESM packs, document the entry format in `docs/specs/` and do not flip root `"type"` without a package-by-package list. Catalog ingest: topic `rewrite`.
