import { ALLOW, GuardedStore, HitResult, StoreContext } from "./base";

/** The slice of a node-redis (>= 4) client the adapter uses; any client with these methods works. */
export interface RedisLikeClient {
	multi(): RedisLikeMulti;
	zAdd(key: string, member: { score: number; value: string }, options?: Record<string, unknown>): Promise<unknown>;
	zRem(key: string, member: string): Promise<unknown>;
	pExpire(key: string, ms: number): Promise<unknown>;
	connect?(): Promise<unknown>;
	on?(event: string, listener: (...args: unknown[]) => void): unknown;
	quit?(): Promise<unknown>;
	destroy?(): unknown;
}
export interface RedisLikeMulti {
	incr(key: string): RedisLikeMulti;
	pExpire(key: string, ms: number, mode?: "NX"): RedisLikeMulti;
	pTTL(key: string): RedisLikeMulti;
	zRemRangeByScore(key: string, min: number | string, max: number | string): RedisLikeMulti;
	zAdd(key: string, member: { score: number; value: string }): RedisLikeMulti;
	zCard(key: string): RedisLikeMulti;
	exec(): Promise<unknown[]>;
}

export interface RedisAdapterOptions {
	url?: string;
	/** An existing client: used as is (the caller connects and closes it). Wins over `url`. */
	client?: RedisLikeClient;
	prefix?: string;
}

/**
 * Redis store, plain commands in `MULTI` (no Lua, so any Redis mock can test it). Needs Redis >= 7: `PEXPIRE ... NX`.
 *
 * - `hit`: `INCR` + `PEXPIRE key window NX` + `PTTL` in one `MULTI`: a fixed window per key that starts at the first
 *   hit; the `NX` in the same transaction means a counter never exists without a TTL. A burst of up to twice the
 *   limit across a window boundary is accepted; refused hits count, so a key that keeps hammering stays limited.
 * - `acquire`: optimistic lease on a sorted set scored by expiry: one `MULTI` of `ZREMRANGEBYSCORE` (expired) +
 *   `ZADD` (mine) + `ZCARD` (+ `PEXPIRE` so an abandoned set cleans itself up); over the cap, `ZREM` mine and refuse.
 *   Never over-admits; two requests racing for the last slot may both be refused and retry after the hint.
 *   Scores are the pod's clock (`Date.now()`): pods are expected to be within a second or two of each other.
 *
 * Custom code instead of a built-in: Moleculer has no per-caller limit and no distributed counter; the client is the
 * adapter's own (offline queue off, so a down Redis rejects at once instead of stalling the call).
 */
export class RedisAdapter extends GuardedStore {
	private client?: RedisLikeClient;
	private owned = false;
	private readonly url?: string;

	constructor(opts: RedisAdapterOptions = {}, ctx: StoreContext = {}) {
		super({ ...ctx, prefix: opts.prefix ?? ctx.prefix });
		this.client = opts.client;
		this.url = opts.url;
	}

	override start(): void {
		if (this.client) return;
		try {
			// Optional peer dependency: required only when the adapter has to create its own client.
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { createClient } = require("redis");
			this.client = createClient({
				url: this.url,
				disableOfflineQueue: true,
				socket: { connectTimeout: 1000, reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000) },
			}) as RedisLikeClient;
			this.owned = true;
			// An unhandled "error" event would crash the process; the guard reports failures per command.
			this.client.on?.("error", (err) => this.fail(err));
			// Never awaited: the service starts with Redis down, commands fail open until it is up.
			this.client.connect?.().catch((err) => this.fail(err));
		} catch (err) {
			this.fail(err);
		}
	}

	override async stop(): Promise<void> {
		this.closed = true;
		if (!this.owned || !this.client) return;
		const client = this.client;
		this.client = undefined;
		// A graceful QUIT can wait forever on a client that is still reconnecting: bounded, then torn down.
		let timer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				client.quit?.(),
				new Promise((resolve) => (timer = setTimeout(resolve, 200))),
			]);
		} catch {
			/* closed already */
		} finally {
			if (timer) clearTimeout(timer);
		}
		try {
			client.destroy?.();
		} catch {
			/* closed already */
		}
	}

	private get redis(): RedisLikeClient {
		if (!this.client) throw new Error("limits store has no Redis client");
		return this.client;
	}

	protected async doHit(key: string, perMinute: number, windowMs: number): Promise<HitResult> {
		const k = `${this.prefix}h:${key}`;
		const [count, , pttl] = await this.redis.multi().incr(k).pExpire(k, windowMs, "NX").pTTL(k).exec();
		const n = Number(count);
		const left = Number(pttl);
		if (!(left > 0)) {
			// A counter without a TTL (written elsewhere) would block its key forever: re-arm it.
			await this.redis.pExpire(k, windowMs);
		}
		return { allowed: n <= perMinute, retryAfterMs: left > 0 ? left : windowMs, count: n };
	}

	protected async doAcquire(key: string, cap: number, leaseId: string, ttlMs: number): Promise<HitResult> {
		const k = `${this.prefix}c:${key}`;
		const now = Date.now();
		const replies = await this.redis
			.multi()
			.zRemRangeByScore(k, "-inf", now)
			.zAdd(k, { score: now + ttlMs, value: leaseId })
			.zCard(k)
			.pExpire(k, ttlMs)
			.exec();
		const count = Number(replies[2]);
		if (count <= cap) return { ...ALLOW, count };
		await this.redis.zRem(k, leaseId);
		return { allowed: false, retryAfterMs: 0, count: count - 1 };
	}

	protected async doRenew(key: string, leaseId: string, ttlMs: number): Promise<boolean> {
		const k = `${this.prefix}c:${key}`;
		// XX: only a lease that is still held; CH: reply 1 when its score changed.
		const changed = await this.redis.zAdd(k, { score: Date.now() + ttlMs, value: leaseId }, { condition: "XX", CH: true });
		if (Number(changed) <= 0) return false;
		// The set's own TTL (set by acquire) must follow the renewed leases, or it would vanish under them.
		await this.redis.pExpire(k, ttlMs);
		return true;
	}

	protected async doRelease(key: string, leaseId: string): Promise<void> {
		await this.redis.zRem(`${this.prefix}c:${key}`, leaseId);
	}
}
