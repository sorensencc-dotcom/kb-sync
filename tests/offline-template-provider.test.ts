import { describe, it } from "node:test";
import assert from "node:assert";
import { OfflineTemplateProvider } from "../modules/obsidian/providers/offlineTemplateProvider.ts";

describe("OfflineTemplateProvider", () => {
    it("should successfully synthesize a valid .md file", async () => {
        const provider = new OfflineTemplateProvider();
        const input = {
            stagingPath: "test-pack",
            manifestHash: "hash",
            schemaDoc: "",
            existingWikiFiles: [],
            stagedFiles: [{ relativePath: "test-doc.md", content: "" }]
        };

        const output = await provider.synthesize(input);

        assert.equal(output.providerName, "offline-template");
        assert.equal(output.model, "offline-scaffold-v1");
        assert.equal(output.proposals.length, 1);

        const proposal = output.proposals[0];
        assert.equal(proposal.title, "TestDoc");
        assert.equal(proposal.category, "wiki");
        assert.equal(proposal.status, "active");
        assert.equal(proposal.draft, true);
        assert.equal(proposal.vaultPath, "kb-sync/wiki/TestDoc.md");
        assert.deepEqual(proposal.citations, ["test-doc.md"]);
        assert.ok(proposal.body.includes("# TestDoc"));
    });

    it("should assign utilities category to .sh files", async () => {
        const provider = new OfflineTemplateProvider();
        const input = {
            stagingPath: "test-pack",
            manifestHash: "hash",
            schemaDoc: "",
            existingWikiFiles: [],
            stagedFiles: [{ relativePath: "script.sh", content: "" }]
        };

        const output = await provider.synthesize(input);
        assert.equal(output.proposals.length, 1);
        assert.equal(output.proposals[0].category, "utilities");
        assert.equal(output.proposals[0].vaultPath, "kb-sync/utilities/Script.md");
    });

    it("should skip invalid file extensions", async () => {
        const provider = new OfflineTemplateProvider();
        const input = {
            stagingPath: "test-pack",
            manifestHash: "hash",
            schemaDoc: "",
            existingWikiFiles: [],
            stagedFiles: [{ relativePath: "app.exe", content: "" }]
        };

        const output = await provider.synthesize(input);
        assert.equal(output.proposals.length, 0);
    });

    it("should normalize title case properly", async () => {
        const provider = new OfflineTemplateProvider();
        const input = {
            stagingPath: "test-pack",
            manifestHash: "hash",
            schemaDoc: "",
            existingWikiFiles: [],
            stagedFiles: [{ relativePath: "some_snake_case-file.md", content: "" }]
        };

        const output = await provider.synthesize(input);
        assert.equal(output.proposals.length, 1);
        assert.equal(output.proposals[0].title, "SomeSnakeCaseFile");
    });

    it("should skip files with titles less than 2 characters after normalization", async () => {
        const provider = new OfflineTemplateProvider();
        const input = {
            stagingPath: "test-pack",
            manifestHash: "hash",
            schemaDoc: "",
            existingWikiFiles: [],
            stagedFiles: [{ relativePath: "a.md", content: "" }, { relativePath: "-.md", content: "" }]
        };

        const output = await provider.synthesize(input);
        assert.equal(output.proposals.length, 0);
    });

    it("should skip files that already exist in existingWikiFiles", async () => {
        const provider = new OfflineTemplateProvider();
        const input = {
            stagingPath: "test-pack",
            manifestHash: "hash",
            schemaDoc: "",
            existingWikiFiles: [{ relativePath: "existing-doc.md", content: "" }],
            stagedFiles: [{ relativePath: "existing-doc.md", content: "" }]
        };

        const output = await provider.synthesize(input);
        assert.equal(output.proposals.length, 0);
    });

    it("should skip duplicate staged files with the same lowercased title", async () => {
        const provider = new OfflineTemplateProvider();
        const input = {
            stagingPath: "test-pack",
            manifestHash: "hash",
            schemaDoc: "",
            existingWikiFiles: [],
            stagedFiles: [
                { relativePath: "test-doc.md", content: "" },
                { relativePath: "test_doc.ts", content: "" },
                { relativePath: "TestDoc.json", content: "" }
            ]
        };

        const output = await provider.synthesize(input);
        assert.equal(output.proposals.length, 1);
        assert.equal(output.proposals[0].title, "TestDoc");
        assert.equal(output.proposals[0].citations[0], "test-doc.md");
    });
});
