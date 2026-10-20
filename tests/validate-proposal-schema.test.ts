import { describe, it } from "node:test";
import assert from "node:assert";
import { validateProposalSchema } from "../modules/obsidian/synthesize-wiki.ts";

describe("validateProposalSchema", () => {
    it("should validate a completely valid proposal", () => {
        const proposal = {
            title: "Test Title",
            category: "wiki",
            status: "active",
            vaultPath: "kb-sync/test.md",
            citations: ["source.ts"],
            summary: "summary",
            body: "body"
        };
        const errors = validateProposalSchema(proposal as any, new Set(["source.ts"]));
        assert.deepEqual(errors, []);
    });

    it("should return error for missing title", () => {
        const errors = validateProposalSchema({ category: "wiki", status: "active", vaultPath: "kb-sync/test.md", citations: [] } as any, new Set());
        assert.ok(errors.some(e => e.includes("Missing mandatory proposal field 'title'")));
    });

    it("should return error for empty title", () => {
        const errors = validateProposalSchema({ title: "  ", category: "wiki", status: "active", vaultPath: "kb-sync/test.md", citations: [] } as any, new Set());
        assert.ok(errors.some(e => e.includes("Missing mandatory proposal field 'title'")));
    });

    it("should return error for invalid category", () => {
        const errors = validateProposalSchema({ title: "Test", category: "invalid", status: "active", vaultPath: "kb-sync/test.md", citations: [] } as any, new Set());
        assert.ok(errors.some(e => e.includes("Non-canonical proposal category 'invalid'")));
    });

    it("should return error for invalid status", () => {
        const errors = validateProposalSchema({ title: "Test", category: "wiki", status: "invalid", vaultPath: "kb-sync/test.md", citations: [] } as any, new Set());
        assert.ok(errors.some(e => e.includes("Non-canonical proposal status 'invalid'")));
    });

    it("should return error for missing vaultPath", () => {
        const errors = validateProposalSchema({ title: "Test", category: "wiki", status: "active", citations: [] } as any, new Set());
        assert.ok(errors.some(e => e.includes("Invalid vaultPath 'undefined'")));
    });

    it("should return error for invalid vaultPath extension", () => {
        const errors = validateProposalSchema({ title: "Test", category: "wiki", status: "active", vaultPath: "kb-sync/test.txt", citations: [] } as any, new Set());
        assert.ok(errors.some(e => e.includes("Must end in .md")));
    });

    it("should return error for vaultPath with path traversal", () => {
        const errors = validateProposalSchema({ title: "Test", category: "wiki", status: "active", vaultPath: "kb-sync/../test.md", citations: [] } as any, new Set());
        assert.ok(errors.some(e => e.includes("have no '..' path traversal")));
    });

    it("should return error for invalid vaultPath boundary", () => {
        const errors = validateProposalSchema({ title: "Test", category: "wiki", status: "active", vaultPath: "invalid/test.md", citations: [] } as any, new Set());
        assert.ok(errors.some(e => e.includes("Must start with a canonical vault directory boundary")));
    });

    it("should accept valid special vaultPath Log.md", () => {
        const errors = validateProposalSchema({ title: "Log", category: "wiki", status: "active", vaultPath: "Log.md", citations: [] } as any, new Set());
        assert.deepEqual(errors, []);
    });

    it("should accept valid special vaultPath Index.md", () => {
        const errors = validateProposalSchema({ title: "Index", category: "wiki", status: "active", vaultPath: "Index.md", citations: [] } as any, new Set());
        assert.deepEqual(errors, []);
    });

    it("should return error if citations is not an array", () => {
        const errors = validateProposalSchema({ title: "Test", category: "wiki", status: "active", vaultPath: "kb-sync/test.md" } as any, new Set());
        assert.ok(errors.some(e => e.includes("must be an array of staged source relative paths")));
    });

    it("should return error for unmanifested citations", () => {
        const errors = validateProposalSchema({ title: "Test", category: "wiki", status: "active", vaultPath: "kb-sync/test.md", citations: ["invalid.ts"] } as any, new Set(["valid.ts"]));
        assert.ok(errors.some(e => e.includes("Unmanifested citation 'invalid.ts'")));
    });
});
