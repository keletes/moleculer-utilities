import type { LimitsStore } from "../../src/limits";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The store contract, run unchanged against every adapter (Memory, Redis on a mock, Redis for real). Real timers and
 * short windows, so it works on a live Redis too. `uniq()` gives keys no other run has used.
 */
export function storeSuite(name: string, make: () => Promise<{ store: LimitsStore; cleanup?: () => Promise<void> }>) {
	describe(`store contract: ${name}`, () => {
		let store: LimitsStore;
		let cleanup: (() => Promise<void>) | undefined;
		let n = 0;
		const uniq = () => `k${Date.now()}-${n++}-${Math.random().toString(36).slice(2)}`;

		beforeEach(async () => {
			({ store, cleanup } = await make());
			await store.start();
		});
		afterEach(async () => {
			await store.stop();
			await cleanup?.();
		});

		it("hit: the N+1th hit of a window is refused with the time left, then a new window starts", async () => {
			const key = uniq();
			for (let i = 0; i < 3; i++) expect((await store.hit(key, 3, 400)).allowed).toBe(true);
			const refused = await store.hit(key, 3, 400);
			expect(refused.allowed).toBe(false);
			expect(refused.retryAfterMs).toBeGreaterThan(0);
			expect(refused.retryAfterMs).toBeLessThanOrEqual(400);
			await sleep(450);
			expect((await store.hit(key, 3, 400)).allowed).toBe(true);
		});

		it("hit: refused hits count, and keys are independent", async () => {
			const a = uniq();
			const b = uniq();
			await store.hit(a, 1, 5000);
			await store.hit(a, 1, 5000);
			expect((await store.hit(a, 1, 5000)).count).toBe(3);
			expect((await store.hit(b, 1, 5000)).allowed).toBe(true);
		});

		it("acquire: N+1 parallel acquisitions on a cap of N never admit more than N", async () => {
			const key = uniq();
			const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.acquire(key, 3, `l${i}`, 5000)));
			const admitted = results.filter((r) => r.allowed).length;
			expect(admitted).toBeGreaterThan(0);
			expect(admitted).toBeLessThanOrEqual(3);
		});

		it("acquire: sequential acquisitions fill the cap exactly, release frees a slot", async () => {
			const key = uniq();
			expect((await store.acquire(key, 2, "a", 5000)).allowed).toBe(true);
			expect((await store.acquire(key, 2, "b", 5000)).allowed).toBe(true);
			expect((await store.acquire(key, 2, "c", 5000)).allowed).toBe(false);
			await store.release(key, "a");
			expect((await store.acquire(key, 2, "c", 5000)).allowed).toBe(true);
			await store.release(key, "a"); // idempotent
		});

		it("a lease nobody renews or releases frees itself after its TTL (crashed holder)", async () => {
			const key = uniq();
			expect((await store.acquire(key, 1, "a", 150)).allowed).toBe(true);
			expect((await store.acquire(key, 1, "b", 150)).allowed).toBe(false);
			await sleep(220);
			expect((await store.acquire(key, 1, "b", 150)).allowed).toBe(true);
		});

		it("renew keeps a lease alive, and reports false once it is gone", async () => {
			const key = uniq();
			await store.acquire(key, 1, "a", 200);
			for (let i = 0; i < 4; i++) {
				await sleep(80);
				expect(await store.renew(key, "a", 200)).toBe("ok");
			}
			expect((await store.acquire(key, 1, "b", 200)).allowed).toBe(false);
			await store.release(key, "a");
			expect(await store.renew(key, "a", 200)).toBe("gone");
		});
	});
}
