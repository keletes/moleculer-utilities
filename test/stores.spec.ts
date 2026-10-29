import { MemoryStore } from "../src/stores";

describe("MemoryStore", () => {
	let store: MemoryStore;
	beforeEach(() => {
		store = new MemoryStore(60_000);
	});

	it("counts per key", async () => {
		expect(await store.inc("a")).toBe(1);
		expect(await store.inc("a")).toBe(2);
		expect(await store.inc("b")).toBe(1);
		expect(store.dec("a")).toBe(1);
	});

	it("forgets everything on reset", async () => {
		await store.inc("a");
		store.reset();
		expect(await store.inc("a")).toBe(1);
	});
});
