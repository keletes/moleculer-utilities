import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ServiceBroker } from "moleculer";
import { Docs, DocsIndex, DocsPage } from "../src/mixins";
import { loadDocs } from "../src/mixins/docs";

// What the node announces about its services: what other nodes (and the registry) get to see.
interface Announced {
	name: string;
	metadata: { docs: DocsIndex };
	actions: Record<string, { rest?: unknown }>;
}
const announced = (broker: ServiceBroker): Announced =>
	(broker.registry as unknown as { getLocalNodeInfo(): { services: Announced[] } })
		.getLocalNodeInfo()
		.services.find(s => s.name === "thing") as Announced;

const page = (title: string, summary: string, body: string) => `---\ntitle: ${title}\nsummary: ${summary}\n---\n${body}`;

describe("Docs", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "docs-"));
		mkdirSync(join(dir, "ember"));
		writeFileSync(join(dir, "functions.md"), page("Functions", "How a function is written.", "# Functions\nreturn 1;\n"));
		writeFileSync(join(dir, "ember", "helpers.md"), page("Helpers", "The template helpers.", "# Helpers\n"));
		writeFileSync(join(dir, "notes.txt"), "not a topic");
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	describe("served by a service", () => {
		let broker: ServiceBroker;
		beforeEach(async () => {
			broker = new ServiceBroker({ logger: false });
			broker.createService({ name: "thing", mixins: [Docs({ dir, version: "1.2.3" })] });
			await broker.start();
		});
		afterEach(() => broker.stop());

		it("lists the topics with their summaries and a hash", async () => {
			const index: DocsIndex = await broker.call("thing.docs.list");
			expect(index.version).toBe("1.2.3");
			expect(index.topics.map(t => [t.id, t.title, t.summary])).toEqual([
				["ember/helpers", "Helpers", "The template helpers."],
				["functions", "Functions", "How a function is written."],
			]);
			expect(index.topics[0].hash).toMatch(/^[0-9a-f]{64}$/);
		});

		it("answers a topic with its markdown, without the front matter", async () => {
			const result: DocsPage = await broker.call("thing.docs.get", { topic: "functions" });
			expect(result).toMatchObject({ id: "functions", version: "1.2.3", markdown: "# Functions\nreturn 1;\n" });
		});

		it("refuses an unknown topic, and one that is not a topic name", async () => {
			await expect(broker.call("thing.docs.get", { topic: "nope" })).rejects.toMatchObject({ code: 404 });
			await expect(broker.call("thing.docs.get", { topic: "../package" })).rejects.toMatchObject({ code: 404 });
		});

		it("publishes the index in the service metadata, not the texts", () => {
			const { metadata } = announced(broker);
			expect(metadata.docs.topics).toHaveLength(2);
			expect(JSON.stringify(metadata)).not.toContain("return 1;");
		});

		it("adds no REST alias", () => {
			expect(Object.values(announced(broker).actions).filter(a => a.rest)).toEqual([]);
		});
	});

	describe("hash", () => {
		it("changes with the text and not with the title", () => {
			const before = loadDocs(dir).find(t => t.id === "functions")?.hash;
			writeFileSync(join(dir, "functions.md"), page("Other title", "How a function is written.", "# Functions\nreturn 1;\n"));
			expect(loadDocs(dir).find(t => t.id === "functions")?.hash).toBe(before);
			writeFileSync(join(dir, "functions.md"), page("Functions", "How a function is written.", "# Functions\nreturn 2;\n"));
			expect(loadDocs(dir).find(t => t.id === "functions")?.hash).not.toBe(before);
		});
	});

	describe("a broken folder stops the service from starting", () => {
		const start = () => {
			const broker = new ServiceBroker({ logger: false });
			broker.createService({ name: "thing", mixins: [Docs({ dir, version: "1" })] });
		};

		it("without front matter", () => {
			writeFileSync(join(dir, "bare.md"), "# no front matter");
			expect(start).toThrow(/front matter/);
		});

		it("without a summary", () => {
			writeFileSync(join(dir, "bare.md"), "---\ntitle: T\n---\nbody");
			expect(start).toThrow(/title and a summary/);
		});

		it("with a name that is not a topic id", () => {
			writeFileSync(join(dir, "Bad Name.md"), page("T", "S", "body"));
			expect(start).toThrow(/lowercase/);
		});

		it("with no markdown at all", () => {
			rmSync(join(dir, "functions.md"));
			rmSync(join(dir, "ember"), { recursive: true });
			expect(start).toThrow(/no markdown/);
		});
	});
});
