import { resolveCitations } from "../modules/notebooklm/lib/grounding-citations.mjs";

console.log("[TEST] Running: grounding citation resolution...");

function expect(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const sources = [
  { id: "s1", title: "repo_knowledge_pack_part_aa.txt" },
  { id: "s2", title: "2026-08-24-sigil-federated-addressing.md" },
];

// Shape returned by `nlm query notebook --json`: number -> source ID.
expect(
  "id map resolves to titles, deduped",
  resolveCitations({ citations: { 1: "s1", 2: "s1", 3: "s2" } }, sources),
  [
    { source_id: "s1", source_name: "repo_knowledge_pack_part_aa.txt" },
    { source_id: "s2", source_name: "2026-08-24-sigil-federated-addressing.md" },
  ],
);

expect(
  "unknown source id keeps null name",
  resolveCitations({ citations: { 1: "gone" } }, sources),
  [{ source_id: "gone", source_name: null }],
);

expect("no citations", resolveCitations({ citations: {} }, sources), []);
expect("missing citations", resolveCitations({}, sources), []);

console.log("[PASS] ✓ Grounding citations resolve source IDs to titles");
