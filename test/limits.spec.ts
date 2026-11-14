import { PassThrough } from "stream";
import { Errors, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import {
	BusyGuard,
	clientIp,
	LimitExceededError,
	Limits,
	matchParams,
	MemoryAdapter,
	PodCpuUsage,
	RateLimitStore,
	RedisAdapter,
	resolveStore,
} from "../src/limits";
import type { AccessKeyLimits, StoreConfig } from "../src/limits";
import { FakeRedis } from "./helpers/fake-redis";
import { storeSuite } from "./helpers/store-suite";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RAW_KEY = "RAW-SECRET-KEY-VALUE";

storeSuite("Memory", async () => ({ store: new MemoryAdapter() }));
storeSuite("Redis (mock with MULTI)", async () => ({ store: new RedisAdapter({ client: new FakeRedis() }) }));

describe("store resolution", () => {
	it("resolves like Moleculer's cacher option", async () => {
		expect(resolveStore(undefined)).toBeInstanceOf(MemoryAdapter);
		expect(resolveStore("Memory")).toBeInstanceOf(MemoryAdapter);
		expect(resolveStore("redis://localhost:6379/2")).toBeInstanceOf(RedisAdapter);
		expect(resolveStore({ type: "Redis", options: { client: new FakeRedis() } })).toBeInstanceOf(RedisAdapter);
		expect(resolveStore("{\"type\":\"Memory\"}")).toBeInstanceOf(MemoryAdapter);
		const none = resolveStore(false);
		expect((await none.hit("k", 1)).allowed).toBe(true);
		expect((await none.acquire("k", 0, "l", 1000)).allowed).toBe(true);
		expect((await resolveStore("false").acquire("k", 0, "l", 1000)).allowed).toBe(true);
		expect(() => resolveStore("memcached://x")).toThrow();
	});
});

describe("Redis adapter", () => {
	it("hit sets the window TTL in the same transaction (no counter without TTL)", async () => {
		const fake = new FakeRedis();
		const store = new RedisAdapter({ client: fake, prefix: "p:" });
		await store.hit("k", 5, 60_000);
		await store.hit("k", 5, 60_000);
		const entry = fake.data.get("p:h:k");
		expect(entry?.expireAt).toBeDefined();
		expect(entry!.expireAt! - Date.now()).toBeLessThanOrEqual(60_000);
	});

	it("an abandoned lease set expires by itself", async () => {
		const fake = new FakeRedis();
		const store = new RedisAdapter({ client: fake, prefix: "p:" });
		await store.acquire("k", 1, "a", 100);
		expect(fake.data.get("p:c:k")?.expireAt).toBeDefined();
	});

	it("fails open on a store error, counts it and warns at most every 10 s", async () => {
		const fake = new FakeRedis();
		fake.down = true;
		const onError = jest.fn();
		const warn = jest.fn();
		const store = new RedisAdapter({ client: fake }, { onError, logger: { warn } });
		expect((await store.hit("k", 1)).allowed).toBe(true);
		expect((await store.acquire("k", 0, "l", 1000)).allowed).toBe(true);
		expect(await store.renew("k", "l", 1000)).toBe("error");
		await store.release("k", "l");
		expect(onError).toHaveBeenCalledTimes(4);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("gives up on a slow store within its timeout and allows", async () => {
		const fake = new FakeRedis();
		fake.latencyMs = 1000;
		const store = new RedisAdapter({ client: fake });
		const t = Date.now();
		expect((await store.hit("k", 1)).allowed).toBe(true);
		expect(Date.now() - t).toBeLessThan(400);
	});

	it("start() does not block on an unreachable Redis (own client) and calls fail open", async () => {
		require("redis"); // module load time is not the adapter's
		const store = new RedisAdapter({ url: "redis://127.0.0.1:1" });
		const t = Date.now();
		await store.start();
		expect(Date.now() - t).toBeLessThan(100);
		expect((await store.hit("k", 1)).allowed).toBe(true);
		await store.stop();
	});

	it("re-arms a counter that has no TTL", async () => {
		const fake = new FakeRedis();
		fake.data.set("p:h:k", { kind: "str", value: 5 });
		const store = new RedisAdapter({ client: fake, prefix: "p:" });
		const r = await store.hit("k", 3, 5000);
		expect(r.allowed).toBe(false);
		expect(fake.data.get("p:h:k")?.expireAt).toBeDefined();
	});

	it("after stop() every call is a silent no-op", async () => {
		const warn = jest.fn();
		const store = new RedisAdapter({ client: new FakeRedis() }, { logger: { warn } });
		await store.stop();
		await store.release("k", "l");
		expect((await store.hit("k", 1)).allowed).toBe(true);
		expect(warn).not.toHaveBeenCalled();
	});

	it("two services on one Redis never share counters (prefix)", async () => {
		const fake = new FakeRedis();
		const a = new RedisAdapter({ client: fake, prefix: "limits:ns:a:" });
		const b = new RedisAdapter({ client: fake, prefix: "limits:ns:b:" });
		await a.hit("k", 1);
		expect((await a.hit("k", 1)).allowed).toBe(false);
		expect((await b.hit("k", 1)).allowed).toBe(true);
		expect([...fake.data.keys()].sort()).toEqual(["limits:ns:a:h:k", "limits:ns:b:h:k"]);
	});
});

describe("matchParams", () => {
	it("matches subsets, nested objects, scalars and arrays by equality; unknown fields never match", () => {
		const params = { type: "pdf", codeParts: { series: "ABC", size: 3, extra: { deep: true } }, list: [1, 2] };
		expect(matchParams(undefined, params)).toBe(true);
		expect(matchParams({}, params)).toBe(true);
		expect(matchParams({ type: "pdf" }, params)).toBe(true);
		expect(matchParams({ type: "pdf", codeParts: { series: "ABC" } }, params)).toBe(true);
		expect(matchParams({ codeParts: { extra: { deep: true } } }, params)).toBe(true);
		expect(matchParams({ list: [1, 2] }, params)).toBe(true);
		expect(matchParams({ type: "dxf" }, params)).toBe(false);
		expect(matchParams({ codeParts: { series: "XYZ" } }, params)).toBe(false);
		expect(matchParams({ list: [1] }, params)).toBe(false);
		expect(matchParams({ missing: undefined }, params)).toBe(false);
		expect(matchParams({ unknown: 1 }, params)).toBe(false);
		expect(matchParams({ codeParts: { unknown: 1 } }, params)).toBe(false);
		expect(matchParams({ type: "pdf" }, undefined)).toBe(false);
		expect(matchParams({ $gt: 1 }, { $gt: 1 })).toBe(true); // no operators: just a field name
	});
});

describe("LimitExceededError", () => {
	it("is a 429 client error, never retryable, with only an integer retryAfter >= 1 in data", () => {
		const e = new LimitExceededError(0.2);
		expect(e).toBeInstanceOf(Errors.MoleculerClientError);
		expect(e.code).toBe(429);
		expect(e.code).toBeLessThan(500);
		expect(e.type).toBe("LIMIT_EXCEEDED");
		expect(e.retryable).toBe(false);
		expect(e.data).toEqual({ retryAfter: 1 });
		expect(new LimitExceededError(7.3).data).toEqual({ retryAfter: 8 });
	});
});

type Gate = { resolve: () => void; promise: Promise<void> };
const gate = (): Gate => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { resolve, promise };
};

const meta = (id: string, limits?: AccessKeyLimits) => ({
	meta: { authorizer: { accessKey: { id, prefix: "kl_pre", name: "n", key: RAW_KEY }, ...(limits ? { limits } : {}) } },
});

function makeService(broker: ServiceBroker, name: string, gates: Gate[], streams: PassThrough[] = []) {
	return broker.createService({
		name,
		actions: {
			work: {
				limits: { lease: "call" },
				async handler(): Promise<string> {
					const g = gate();
					gates.push(g);
					await g.promise;
					return "ok";
				},
			},
			jobs: {
				limits: { lease: "stream" },
				handler() {
					const s = new PassThrough();
					streams.push(s);
					return s;
				},
			},
			manual: {
				limits: { lease: "manual" },
				async handler(this: any, ctx: any) {
					return this.broker.limits.check(ctx, `${name}.manual`, ctx.params);
				},
			},
			boom: {
				limits: { lease: "call" },
				async handler(): Promise<void> {
					throw new Error("boom");
				},
			},
			free: { handler: () => "free" },
		},
	});
}

const flush = () => sleep(20);

describe.each<[string, () => { store: StoreConfig; fake?: FakeRedis }]>([
	["Memory", () => ({ store: "Memory" })],
	[
		"Redis (mock)",
		() => {
			const fake = new FakeRedis();
			return { store: { type: "Redis", options: { client: fake } }, fake };
		},
	],
])("Limits middleware on %s", (_name, config) => {
	let broker: ServiceBroker;
	let gates: Gate[];
	let streams: PassThrough[];
	let fake: FakeRedis | undefined;

	async function start(opts: Parameters<typeof Limits>[0] = {}, mwStore?: StoreConfig) {
		const c = config();
		fake = c.fake;
		broker = new ServiceBroker({
			logger: false,
			metrics: { enabled: true },
			middlewares: [Limits({ store: mwStore ?? c.store, service: "svc", ...opts })],
		});
		gates = [];
		streams = [];
		makeService(broker, "svc", gates, streams);
		await broker.start();
		return broker;
	}
	const finish = () => gates.splice(0).forEach((g) => g.resolve());
	afterEach(async () => {
		finish();
		await broker?.stop();
	});

	it("refuses the second concurrent call of a key with 429, leaves other keys alone, frees on settle", async () => {
		await start();
		const limits = { "svc.work": [{ concurrent: 1 }] };
		const first = broker.call("svc.work", {}, meta("k1", limits));
		await flush();
		const err: any = await broker.call("svc.work", {}, meta("k1", limits)).catch((e: any) => e);
		expect(err).toBeInstanceOf(LimitExceededError);
		expect(err.code).toBe(429);
		expect(err.type).toBe("LIMIT_EXCEEDED");
		expect(err.retryable).toBe(false);
		expect(err.data).toEqual({ retryAfter: 5 });
		const other = broker.call("svc.work", {}, meta("k2", limits));
		await flush();
		finish();
		await Promise.all([first, other]);
		const again = broker.call("svc.work", {}, meta("k1", limits)); // the slot is free again
		await flush();
		finish();
		await expect(again).resolves.toBe("ok");
	});

	it("releases the lease when the handler throws or the call ends", async () => {
		await start();
		const limits = { "svc.boom": [{ concurrent: 1 }], "svc.work": [{ concurrent: 1 }] };
		for (let i = 0; i < 3; i++) await expect(broker.call("svc.boom", {}, meta("k1", limits))).rejects.toThrow("boom");
		const p = broker.call("svc.work", {}, meta("k1", limits));
		await flush();
		finish();
		await p;
		const q = broker.call("svc.work", {}, meta("k1", limits));
		await flush();
		finish();
		await expect(q).resolves.toBe("ok");
	});

	it("applies only the rules whose params match, each with its own counter", async () => {
		await start();
		const limits = { "svc.work": [{ concurrent: 1, params: { type: "pdf" } }, { concurrent: 2, params: { type: "dxf" } }] };
		const pdf = broker.call("svc.work", { type: "pdf" }, meta("k1", limits));
		await flush();
		await expect(broker.call("svc.work", { type: "pdf" }, meta("k1", limits))).rejects.toBeInstanceOf(LimitExceededError);
		const glb = broker.call("svc.work", { type: "glb" }, meta("k1", limits)); // no matching rule
		const dxf1 = broker.call("svc.work", { type: "dxf" }, meta("k1", limits));
		const dxf2 = broker.call("svc.work", { type: "dxf" }, meta("k1", limits));
		await flush();
		await expect(broker.call("svc.work", { type: "dxf" }, meta("k1", limits))).rejects.toBeInstanceOf(LimitExceededError);
		finish();
		await Promise.all([pdf, glb, dxf1, dxf2]);
	});

	it("a key without an entry gets the defaults; a key with any entry gets only its own rules", async () => {
		await start({ defaults: { "svc.work": [{ concurrent: 1 }] } });
		const a = broker.call("svc.work", {}, meta("k1"));
		await flush();
		await expect(broker.call("svc.work", {}, meta("k1"))).rejects.toBeInstanceOf(LimitExceededError);
		// own entry replaces the defaults: two at once are fine
		const own = { "svc.work": [{ concurrent: 3 }] };
		const b = broker.call("svc.work", {}, meta("k2", own));
		const c = broker.call("svc.work", {}, meta("k2", own));
		await flush();
		// an empty entry means "no limits for this action"
		const d = broker.call("svc.work", {}, meta("k3", { "svc.work": [] }));
		const e = broker.call("svc.work", {}, meta("k3", { "svc.work": [] }));
		await flush();
		finish();
		await Promise.all([a, b, c, d, e]);
	});

	it("perMinute: the N+1th start is refused with retryAfter = window time left (>= 1 s)", async () => {
		await start();
		const limits = { "svc.work": [{ perMinute: 2 }] };
		for (let i = 0; i < 2; i++) {
			const p = broker.call("svc.work", {}, meta("k1", limits));
			await flush();
			finish();
			await p;
		}
		const err: any = await broker.call("svc.work", {}, meta("k1", limits)).catch((e: any) => e);
		expect(err).toBeInstanceOf(LimitExceededError);
		expect(Number.isInteger(err.data.retryAfter)).toBe(true);
		expect(err.data.retryAfter).toBeGreaterThanOrEqual(1);
		expect(err.data.retryAfter).toBeLessThanOrEqual(60);
		expect(Object.keys(err.data)).toEqual(["retryAfter"]);
	});

	it("N+1 simultaneous calls on a cap of N never run more than N", async () => {
		await start();
		const limits = { "svc.work": [{ concurrent: 3 }] };
		const calls = Array.from({ length: 8 }, () => broker.call("svc.work", {}, meta("k1", limits)).catch((e: any) => e));
		await sleep(60);
		expect(gates.length).toBeLessThanOrEqual(3);
		expect(gates.length).toBeGreaterThan(0);
		finish();
		await Promise.all(calls);
	});

	it("stream lease: the 3rd open stream is refused; closing one lets the next open", async () => {
		await start();
		const limits = { "svc.jobs": [{ concurrent: 2 }] };
		await broker.call("svc.jobs", {}, meta("k1", limits));
		await broker.call("svc.jobs", {}, meta("k1", limits));
		await expect(broker.call("svc.jobs", {}, meta("k1", limits))).rejects.toBeInstanceOf(LimitExceededError);
		streams[0].end();
		streams[0].resume();
		await flush();
		await broker.call("svc.jobs", {}, meta("k1", limits));
		streams[1].destroy(); // abort
		await flush();
		await broker.call("svc.jobs", {}, meta("k1", limits));
		for (const s of streams) s.destroy();
	});

	it("manual lease: nothing happens until the handler checks; handles are released from another broker", async () => {
		await start();
		const limits = { "svc.manual": [{ concurrent: 1 }] };
		const handles: string[] = await broker.call("svc.manual", {}, meta("k1", limits));
		expect(handles).toHaveLength(1);
		await expect(broker.call("svc.manual", {}, meta("k1", limits))).rejects.toBeInstanceOf(LimitExceededError);
		// the handle names the lease, so any replica sharing the store can release it
		await broker.limits!.release(handles);
		await broker.limits!.release(handles);
		await expect(broker.call("svc.manual", {}, meta("k1", limits))).resolves.toHaveLength(1);
	});

	it("manual check matches the values the handler passes, not ctx.params", async () => {
		await start();
		const limits = { "svc.manual": [{ concurrent: 1, params: { type: "pdf" } }] };
		const ctx: any = { meta: meta("k1", limits).meta, params: {} };
		expect(await broker.limits!.check(ctx, "svc.manual", { type: "glb" })).toEqual([]);
		expect(await broker.limits!.check(ctx, "svc.manual", { type: "pdf" })).toHaveLength(1);
		await expect(broker.limits!.check(ctx, "svc.manual", { type: "pdf" })).rejects.toBeInstanceOf(LimitExceededError);
	});

	it("never limits internal calls (no access key) nor actions without a limits declaration", async () => {
		await start({ defaults: { "svc.work": [{ concurrent: 1 }] } });
		const a = broker.call("svc.work", {});
		const b = broker.call("svc.work", {});
		await flush();
		expect(gates).toHaveLength(2);
		for (let i = 0; i < 5; i++) expect(await broker.call("svc.free", {}, meta("k1", { "svc.free": [{ concurrent: 0 }] }))).toBe("free");
		finish();
		await Promise.all([a, b]);
	});

	it("shadow serves would-be refusals and counts limits.refused{mode=shadow}; off makes no store call", async () => {
		await start({ mode: "shadow" });
		const spy = jest.spyOn(broker.metrics, "increment");
		const limits = { "svc.work": [{ concurrent: 1 }] };
		const a = broker.call("svc.work", {}, meta("k1", limits));
		await flush();
		const b = broker.call("svc.work", {}, meta("k1", limits));
		await flush();
		expect(gates).toHaveLength(2);
		expect(spy).toHaveBeenCalledWith("limits.refused", { action: "svc.work", mode: "shadow" });
		finish();
		await Promise.all([a, b]);
		await broker.stop();

		await start({ mode: "off" });
		const before = fake?.commands ?? 0;
		const c = broker.call("svc.work", {}, meta("k1", limits));
		const d = broker.call("svc.work", {}, meta("k1", limits));
		await flush();
		expect(gates).toHaveLength(2);
		expect(fake?.commands ?? 0).toBe(before);
		finish();
		await Promise.all([c, d]);
	});

	it("enforce counts limits.refused{mode=enforce}", async () => {
		await start();
		const spy = jest.spyOn(broker.metrics, "increment");
		const limits = { "svc.work": [{ concurrent: 1 }] };
		const a = broker.call("svc.work", {}, meta("k1", limits));
		await flush();
		await broker.call("svc.work", {}, meta("k1", limits)).catch(() => undefined);
		expect(spy).toHaveBeenCalledWith("limits.refused", { action: "svc.work", mode: "enforce" });
		finish();
		await a;
	});

	it("never exposes the raw key: not in the error, nor in any store key", async () => {
		await start();
		const limits = { "svc.work": [{ concurrent: 1, perMinute: 1 }] };
		const a = broker.call("svc.work", {}, meta("keyid-1", limits));
		await flush();
		const err: any = await broker.call("svc.work", {}, meta("keyid-1", limits)).catch((e: any) => e);
		expect(JSON.stringify(err.toJSON?.() ?? err)).not.toContain(RAW_KEY);
		expect(JSON.stringify({ message: err.message, data: err.data, type: err.type })).not.toContain("keyid-1");
		if (fake) {
			const keys = [...fake.data.keys()];
			expect(keys.length).toBeGreaterThan(0);
			for (const k of keys) {
				expect(k).not.toContain(RAW_KEY);
				expect(k).toContain("keyid-1");
			}
		}
		finish();
		await a;
	});
});

describe("Limits middleware: store trouble, prefix, lease TTL (Redis mock)", () => {
	let broker: ServiceBroker | undefined;
	afterEach(async () => {
		await broker?.stop();
		broker = undefined;
	});
	const limits = { "svc.work": [{ concurrent: 1 }] };

	function build(fake: FakeRedis, opts: Parameters<typeof Limits>[0] = {}, service = "svc") {
		const b = new ServiceBroker({
			logger: false,
			metrics: { enabled: true },
			middlewares: [Limits({ store: { type: "Redis", options: { client: fake } }, service, ...opts })],
		});
		const gates: Gate[] = [];
		makeService(b, service, gates);
		return { b, gates };
	}

	it("serves unlimited when the store is down or slow, counts limits.store.errors, and starts with the store down", async () => {
		const fake = new FakeRedis();
		fake.down = true;
		const { b, gates } = build(fake);
		broker = b;
		const t = Date.now();
		await b.start();
		expect(Date.now() - t).toBeLessThan(500);
		const spy = jest.spyOn(b.metrics, "increment");
		const calls = [b.call("svc.work", {}, meta("k1", limits)), b.call("svc.work", {}, meta("k1", limits))];
		await flush();
		expect(gates).toHaveLength(2);
		expect(spy).toHaveBeenCalledWith("limits.store.errors", {});
		gates.forEach((g) => g.resolve());
		await Promise.all(calls);

		fake.down = false;
		fake.latencyMs = 1000;
		const t2 = Date.now();
		const slow = b.call("svc.work", {}, meta("k1", limits));
		await sleep(250);
		expect(gates).toHaveLength(3); // served after the 100 ms timeout
		expect(Date.now() - t2).toBeLessThan(600);
		gates[2].resolve();
		await slow;
	});

	it("two services on one Redis never share counters", async () => {
		const fake = new FakeRedis();
		const a = build(fake, {}, "svc");
		const bb = build(fake, {}, "other");
		await Promise.all([a.b.start(), bb.b.start()]);
		const first = a.b.call("svc.work", {}, meta("k1", limits));
		const second = bb.b.call("other.work", {}, meta("k1", { "other.work": [{ concurrent: 1 }] }));
		await flush();
		expect(a.gates).toHaveLength(1);
		expect(bb.gates).toHaveLength(1);
		expect(fake.data.size).toBeGreaterThan(0);
		expect([...fake.data.keys()].every((k) => k.startsWith("limits::svc:") || k.startsWith("limits::other:"))).toBe(true);
		a.gates[0].resolve();
		bb.gates[0].resolve();
		await Promise.all([first, second]);
		await Promise.all([a.b.stop(), bb.b.stop()]);
	});

	it("renews held leases, and a crashed holder frees them within the TTL", async () => {
		const fake = new FakeRedis();
		const { b, gates } = build(fake, { leaseTtlMs: 200, renewEveryMs: 50 });
		broker = b;
		await b.start();
		const held = b.call("svc.work", {}, meta("k1", limits));
		await sleep(500); // longer than the TTL: only renewal keeps it
		await expect(b.call("svc.work", {}, meta("k1", limits))).rejects.toBeInstanceOf(LimitExceededError);
		gates[0].resolve();
		await held;

		// a holder that dies without releasing: its lease is in the store and nobody renews it
		const crashed = new RedisAdapter({ client: fake });
		await crashed.acquire("k2:svc.work:abc", 1, "dead", 150);
		expect((await crashed.acquire("k2:svc.work:abc", 1, "next", 150)).allowed).toBe(false);
		await sleep(220);
		expect((await crashed.acquire("k2:svc.work:abc", 1, "next", 150)).allowed).toBe(true);
	});

	it("a store error during renewal keeps the lease; only a vanished lease stops being renewed", async () => {
		const fake = new FakeRedis();
		const { b, gates } = build(fake, { leaseTtlMs: 400, renewEveryMs: 40 });
		broker = b;
		await b.start();
		const held = b.call("svc.work", {}, meta("k1", limits));
		await flush();
		fake.down = true; // a blip: renewals fail open as "error"
		await sleep(150);
		fake.down = false;
		await sleep(100);
		await expect(b.call("svc.work", {}, meta("k1", limits))).rejects.toBeInstanceOf(LimitExceededError);
		gates[0].resolve();
		await held;
	});

	it("a lease older than maxLeaseMs is released by the middleware (unconsumed stream)", async () => {
		const fake = new FakeRedis();
		const b = new ServiceBroker({
			logger: false,
			middlewares: [Limits({ store: { type: "Redis", options: { client: fake } }, service: "svc", renewEveryMs: 30, maxLeaseMs: 120 })],
		});
		const streams: PassThrough[] = [];
		makeService(b, "svc", [], streams);
		broker = b;
		await b.start();
		const rules = { "svc.jobs": [{ concurrent: 1 }] };
		await b.call("svc.jobs", {}, meta("k1", rules));
		await expect(b.call("svc.jobs", {}, meta("k1", rules))).rejects.toBeInstanceOf(LimitExceededError);
		await sleep(250);
		await expect(b.call("svc.jobs", {}, meta("k1", rules))).resolves.toBeDefined();
		streams.forEach((s) => s.destroy());
	});

	it("a stream that is already destroyed releases at once; stopping releases held leases", async () => {
		const fake = new FakeRedis();
		const b = new ServiceBroker({ logger: false, middlewares: [Limits({ store: { type: "Redis", options: { client: fake } }, service: "svc" })] });
		b.createService({
			name: "svc",
			actions: {
				dead: { limits: { lease: "stream" }, handler: () => { const s = new PassThrough(); s.destroy(); return s; } },
				open: { limits: { lease: "stream" }, handler: () => new PassThrough() },
			},
		});
		await b.start();
		const rules = { "svc.dead": [{ concurrent: 1 }], "svc.open": [{ concurrent: 1 }] };
		for (let i = 0; i < 3; i++) await b.call("svc.dead", {}, meta("k1", rules));
		await b.call("svc.open", {}, meta("k1", rules));
		expect([...fake.data.keys()].some((k) => k.includes("svc.open"))).toBe(true);
		await b.stop();
		expect([...fake.data.keys()].some((k) => k.includes("svc.open"))).toBe(false);
	});

	it("a concurrency refusal does not consume a minute slot; a minute refusal gives its leases back", async () => {
		const fake = new FakeRedis();
		const { b, gates } = build(fake);
		broker = b;
		await b.start();
		const rules = { "svc.work": [{ concurrent: 1, perMinute: 2 }] };
		const first = b.call("svc.work", {}, meta("k1", rules));
		await flush();
		for (let i = 0; i < 4; i++) await expect(b.call("svc.work", {}, meta("k1", rules))).rejects.toBeInstanceOf(LimitExceededError);
		gates[0].resolve();
		await first;
		// only one minute slot was used so far
		const second = b.call("svc.work", {}, meta("k1", rules));
		await flush();
		gates[1].resolve();
		await second;
		// the minute budget (2) is now spent: refused, and the lease taken first is not left behind
		await expect(b.call("svc.work", {}, meta("k1", rules))).rejects.toBeInstanceOf(LimitExceededError);
		const zsets = [...fake.data.values()].filter((e) => e.kind === "zset");
		expect(zsets.every((z) => (z as any).members.size === 0)).toBe(true);
	});

	it("treats params: null as absent", async () => {
		const fake = new FakeRedis();
		const { b } = build(fake);
		broker = b;
		await b.start();
		const rules = { "svc.work": [{ concurrent: 1, params: null as any }] };
		const first = b.call("svc.work", { a: 1 }, meta("k1", rules));
		await flush();
		await expect(b.call("svc.work", { a: 2 }, meta("k1", rules))).rejects.toBeInstanceOf(LimitExceededError);
		await b.stop(); // releases; the pending handler is abandoned
		void first.catch(() => undefined);
	});

	it("a lease released on another replica is dropped from the holder's renewals", async () => {
		const fake = new FakeRedis();
		const mk = () => {
			const x = new ServiceBroker({
				logger: false,
				middlewares: [Limits({ store: { type: "Redis", options: { client: fake } }, service: "svc", renewEveryMs: 30 })],
			});
			x.createService({
				name: "svc",
				actions: { manual: { limits: { lease: "manual" }, handler(this: any, ctx: any) { return this.broker.limits.check(ctx, "svc.manual"); } } },
			});
			return x;
		};
		const holder = mk();
		const other = mk();
		await Promise.all([holder.start(), other.start()]);
		const rules = { "svc.manual": [{ concurrent: 1 }] };
		const handles: string[] = await holder.call("svc.manual", {}, meta("k1", rules));
		await other.limits!.release(handles);
		await sleep(100); // holder's renew finds the lease gone and forgets it, it must not resurrect it
		await expect(other.call("svc.manual", {}, meta("k1", rules))).resolves.toHaveLength(1);
		await Promise.all([holder.stop(), other.stop()]);
	});
});

describe("RateLimitStore with moleculer-web's built-in rateLimit", () => {
	const fake = new FakeRedis();
	let broker: ServiceBroker;
	let port: number;
	const authenticate = jest.fn();

	beforeAll(async () => {
		broker = new ServiceBroker({ logger: false });
		broker.createService({ name: "ping", actions: { hello: () => "pong" } });
		const gw = broker.createService({
			name: "api",
			mixins: [ApiGateway],
			settings: {
				port: 0,
				routes: [
					{
						path: "/",
						authentication: true,
						rateLimit: {
							limit: 2,
							window: 60_000,
							headers: true,
							key: clientIp,
							StoreFactory: RateLimitStore,
							limitsStore: { type: "Redis", options: { client: fake } },
						},
						aliases: { "GET /ping": "ping.hello" },
					},
				],
			},
			methods: {
				authenticate(...args: unknown[]) {
					authenticate(...args);
					return { id: "x" };
				},
			},
		});
		await broker.start();
		port = (gw as any).server.address().port;
	});
	afterAll(() => broker.stop());

	const get = async (ip: string) => {
		const res = await fetch(`http://127.0.0.1:${port}/ping`, { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
		return { status: res.status, body: (await res.json().catch(() => null)) as any };
	};

	it("answers 429 LIMIT_EXCEEDED with the key's time left before authenticate runs, per client IP", async () => {
		expect((await get("1.1.1.1")).status).toBe(200);
		expect((await get("1.1.1.1")).status).toBe(200);
		const calls = authenticate.mock.calls.length;
		const refused = await get("1.1.1.1");
		expect(refused.status).toBe(429);
		expect(refused.body.type).toBe("LIMIT_EXCEEDED");
		expect(refused.body.data.retryAfter).toBeGreaterThanOrEqual(1);
		expect(refused.body.data.retryAfter).toBeLessThanOrEqual(60);
		expect(Object.keys(refused.body.data)).toEqual(["retryAfter"]);
		expect(authenticate.mock.calls.length).toBe(calls);
		expect((await get("2.2.2.2")).status).toBe(200);
		expect(fake.data.size).toBeGreaterThan(0);
		expect([...fake.data.keys()].every((k) => k.startsWith("limits::api:h:ip:"))).toBe(true);
	});

	it("fails open when the store is down", async () => {
		fake.down = true;
		for (let i = 0; i < 5; i++) { const r = await get("3.3.3.3"); expect(JSON.stringify(r)).toContain("200"); }
		fake.down = false;
	});

	it("clientIp takes the first X-Forwarded-For element, else the socket address", () => {
		expect(clientIp({ headers: { "x-forwarded-for": "9.9.9.9, 1.1.1.1" }, socket: { remoteAddress: "5.5.5.5" } } as any)).toBe("9.9.9.9");
		expect(clientIp({ headers: { "x-forwarded-for": ["8.8.8.8"] }, socket: {} } as any)).toBe("8.8.8.8");
		expect(clientIp({ headers: {}, socket: { remoteAddress: "5.5.5.5" } } as any)).toBe("5.5.5.5");
		expect(clientIp({ headers: {}, socket: {} } as any)).toBe("unknown");
		const ip = (xff: string | undefined, remote?: string) =>
			clientIp({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote } } as any);
		expect(ip(" 1.2.3.4:5678 , 9.9.9.9")).toBe("1.2.3.4");
		expect(ip("[::1]:443")).toBe("::1");
		expect(ip("::FFFF:1.2.3.4")).toBe("1.2.3.4");
		expect(ip("2001:DB8::1")).toBe("2001:db8::1");
		expect(ip("not-an-ip", "::ffff:5.5.5.5")).toBe("5.5.5.5");
		expect(ip("junk", "also junk")).toBe("unknown");
		expect(ip("junk-a")).toBe(ip("junk-b"));
	});
});

describe("PodCpuUsage", () => {
	const files = (map: Record<string, string>) => ({
		readFile: async (p: string) => {
			const name = p.split("/").pop()!;
			if (name in map) return map[name];
			throw new Error("ENOENT");
		},
	});
	const psi = (avg10: number) => `some avg10=${avg10.toFixed(2)} avg60=1.00 avg300=1.00 total=123\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`;

	async function brokerWith(mw: ReturnType<typeof PodCpuUsage>, nodeCpu?: number) {
		const b = new ServiceBroker({ logger: false, middlewares: [mw] });
		if (nodeCpu !== undefined) {
			// The original measure, as Moleculer would sample it (the host).
			(b as any).getCpuUsage = async () => ({ avg: nodeCpu, usages: [nodeCpu] });
			// created() ran in the constructor, before the stub: re-run the hook on the stubbed broker
			(mw as any).created(b);
		}
		return b;
	}

	it("an idle pod on a busy node reports the node's value; a pressured pod reports its pressure", async () => {
		let b = await brokerWith(PodCpuUsage({ readers: files({ "cpu.pressure": psi(2), "cpu.max": "max 100000" }) }), 70);
		expect((await b.getCpuUsage()).avg).toBe(70);
		b = await brokerWith(PodCpuUsage({ readers: files({ "cpu.pressure": psi(85) }) }), 10);
		expect((await b.getCpuUsage()).avg).toBe(85);
	});

	it("reports the throttled share of the interval when cpu.max sets a limit, none when it does not", async () => {
		let now = 1_000_000;
		let throttledUsec = 0;
		const readers = {
			now: () => now,
			readFile: async (p: string) => {
				const name = p.split("/").pop();
				if (name === "cpu.max") return "50000 100000";
				if (name === "cpu.stat") return `usage_usec 1\nthrottled_usec ${throttledUsec}\n`;
				throw new Error("ENOENT");
			},
		};
		const b = await brokerWith(PodCpuUsage({ readers }), 5);
		expect((await b.getCpuUsage()).avg).toBe(5); // first sample: baseline only
		now += 10_000;
		throttledUsec += 6_000_000; // 6 s throttled over 10 s
		expect((await b.getCpuUsage()).avg).toBe(60);
		now += 10_000;
		expect((await b.getCpuUsage()).avg).toBe(5);

		const noLimit = await brokerWith(PodCpuUsage({ readers: files({ "cpu.max": "max 100000", "cpu.stat": "throttled_usec 999999999\n" }) }), 5);
		expect((await noLimit.getCpuUsage()).avg).toBe(5);
	});

	it("without cgroup files it equals the original measure and warns once per file", async () => {
		const b = new ServiceBroker({ logger: false, middlewares: [PodCpuUsage({ readers: files({}) })] });
		const warn = jest.spyOn(b.logger, "warn");
		const r1 = await b.getCpuUsage();
		await b.getCpuUsage();
		expect(typeof r1.avg).toBe("number");
		expect(warn).toHaveBeenCalledTimes(2); // cpu.pressure and cpu.max, once each
	});

	it("POD_CPU_MEASURE: node ignores the cgroup, pod ignores the node", async () => {
		const readers = files({ "cpu.pressure": psi(30) });
		expect((await (await brokerWith(PodCpuUsage({ measure: "node", readers }), 70)).getCpuUsage()).avg).toBe(70);
		expect((await (await brokerWith(PodCpuUsage({ measure: "pod", readers }), 70)).getCpuUsage()).avg).toBe(30);
		expect(() => PodCpuUsage({ measure: "bogus" as any })).toThrow();
	});

	it("never reports NaN: non-finite terms are ignored", async () => {
		const b = await brokerWith(PodCpuUsage({ readers: files({ "cpu.pressure": "some avg10=nan" }) }), 20);
		expect((await b.getCpuUsage()).avg).toBe(20);
		const c = await brokerWith(PodCpuUsage({ readers: files({ "cpu.pressure": psi(30) }) }), NaN);
		expect((await c.getCpuUsage()).avg).toBe(30);
	});

	it("works unbound, as Moleculer's heartbeat calls it", async () => {
		const b = await brokerWith(PodCpuUsage({ readers: files({ "cpu.pressure": psi(40) }) }), 10);
		const fn = b.getCpuUsage;
		expect((await fn()).avg).toBe(40);
	});

	it("the heartbeat carries it as node.cpu and a caller's CpuUsage strategy picks the least pressured node", async () => {
		const mk = (id: string, pressure?: number) =>
			new ServiceBroker({
				nodeID: id,
				logger: false,
				transporter: "Fake",
				heartbeatInterval: 1,
				registry: { strategy: "CpuUsage", strategyOptions: { sampleCount: 5, lowCpuUsage: 5 } },
				middlewares: pressure === undefined ? [] : [PodCpuUsage({ readers: files({ "cpu.pressure": psi(pressure) }) })],
			});
		const make = (b: ServiceBroker) =>
			b.createService({ name: "heavy", actions: { run: () => b.nodeID } });
		const busy = mk("busy", 90);
		const calm = mk("calm", 40);
		const caller = mk("caller");
		make(busy);
		make(calm);
		await Promise.all([busy.start(), calm.start(), caller.start()]);
		try {
			const seen = async (id: string, min: number) => {
				for (let i = 0; i < 80; i++) {
					if ((caller.registry.nodes.get(id)?.cpu ?? 0) >= min) return true;
					await sleep(100);
				}
				return false;
			};
			expect(await seen("busy", 90)).toBe(true);
			expect(await seen("calm", 40)).toBe(true);
			const picked = new Set<string>();
			for (let i = 0; i < 6; i++) picked.add(await caller.call("heavy.run"));
			expect([...picked]).toEqual(["calm"]);
		} finally {
			await Promise.all([busy.stop(), calm.stop(), caller.stop()]);
		}
	}, 20_000);
});

describe("BusyGuard", () => {
	let broker: ServiceBroker;
	afterEach(() => broker?.stop());

	function build(opts: Parameters<typeof BusyGuard>[0], extra: Record<string, unknown> = {}, schema: Record<string, unknown> = {}) {
		const handler = jest.fn(async () => "done");
		broker = new ServiceBroker({ logger: false, metrics: { enabled: true }, middlewares: [BusyGuard(opts)], ...extra });
		broker.createService({ name: "freecad", actions: { generate: { busyGuard: true, handler, ...schema }, other: { handler } } });
		return handler;
	}
	const setCpu = (v: number) => ((broker.registry.nodes as any).localNode.cpu = v);

	it("refuses with a retryable QUEUE_FULL before the handler when the pressure is over the threshold", async () => {
		const handler = build({ threshold: 60 });
		await broker.start();
		setCpu(95);
		const err: any = await broker.call("freecad.generate").catch((e: any) => e);
		expect(err).toBeInstanceOf(Errors.QueueIsFullError);
		expect(err.type).toBe("QUEUE_FULL");
		expect(err.retryable).toBe(true);
		expect(handler).not.toHaveBeenCalled();
		await broker.call("freecad.other"); // not opted in
		setCpu(30);
		expect(await broker.call("freecad.generate")).toBe("done");
	});

	it("shadow serves and counts limits.busy{mode=shadow}; off does nothing", async () => {
		const handler = build({ threshold: 60, mode: "shadow" });
		await broker.start();
		const spy = jest.spyOn(broker.metrics, "increment");
		setCpu(95);
		expect(await broker.call("freecad.generate")).toBe("done");
		expect(handler).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith("limits.busy", { action: "freecad.generate", mode: "shadow" });
		await broker.stop();

		const off = build({ threshold: 60, mode: "off" });
		await broker.start();
		setCpu(95);
		expect(await broker.call("freecad.generate")).toBe("done");
		expect(off).toHaveBeenCalledTimes(1);
	});

	it("sits inside the bulkhead: a queued call is checked when it reaches the front", async () => {
		const g = gate();
		let first = true;
		const handler = jest.fn(async () => {
			if (first) {
				first = false;
				await g.promise;
			}
			return "done";
		});
		broker = new ServiceBroker({ logger: false, middlewares: [BusyGuard({ threshold: 60 })] });
		broker.createService({
			name: "freecad",
			actions: { generate: { busyGuard: true, bulkhead: { enabled: true, concurrency: 1, maxQueueSize: 1 }, handler } },
		});
		await broker.start();
		setCpu(10);
		const running = broker.call("freecad.generate");
		await flush();
		const queued = broker.call("freecad.generate").catch((e: any) => e);
		await flush();
		setCpu(95); // the pod got busy while the call waited
		g.resolve();
		await running;
		expect(await queued).toBeInstanceOf(Errors.QueueIsFullError);
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
