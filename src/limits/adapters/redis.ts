import { ALLOW, GuardedStore, HitResult, StoreContext } from "./base";

/** The slice of an ioredis (>= 5) client the adapter uses; any client with these methods works. */
export interface RedisLikeClient {
	multi(): RedisLikeMulti;
	zadd(key: string, ...args: (string | number)[]): Promise<unknown>;
	zrem(key: string, member: string): Promise<unknown>;
	pexpire(key: string, ms: number): Promise<unknown>;
	ping?(): Promise<unknown>;
	connect?(): Promise<unknown>;
	on?(event: string, listener: (...args: unknown[]) => void): unknown;
	quit?(): Promise<unknown>;
	disconnect?(): unknown;
}
/** ioredis `exec()` resolves `[error, result][]` (one pair per command), or `null` when the transaction was discarded. */
export interface RedisLikeMulti {
	incr(key: string): RedisLikeMulti;
	pexpire(key: string, ms: number, mode?: "NX"): RedisLikeMulti;
	pttl(key: string): RedisLikeMulti;
	zremrangebyscore(key: string, min: number | string, max: number | string): RedisLikeMulti;
	zadd(key: string, score: number, member: string): RedisLikeMulti;
	zcard(key: string): RedisLikeMulti;
	exec(): Promise<[Error | null, unknown][] | null>;
}

export interface RedisAdapterOptions {
	url?: string;
	/** An existing client: used as is (the caller connects and closes it). Wins over `url`. */
	client?: RedisLikeClient;
	prefix?: string;
	/**
	 * `PING` interval of the adapter's own client, in ms (default env `LIMITS_STORE_PING_MS`, else 10000; 0 disables).
	 * Keeps the connection from going idle: a network hop (conntrack, Cilium, a load balancer) drops idle TCP
	 * connections, and the first command after that would pay a reconnect longer than the 100 ms command timeout.
	 * ioredis has no ping option: the adapter pings on a (unref'd) timer. Ignored for an injected `client`.
	 */
	pingIntervalMs?: number;
}

/** Optional peer dependency: required only when the adapter has to create its own client. */
function loadIoredis(): new (...args: any[]) => unknown {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const mod = require("ioredis");
		return mod.default ?? mod.Redis ?? mod;
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "MODULE_NOT_FOUND") {
			throw new Error("The limits Redis store needs the optional peer dependency \"ioredis\" (yarn add ioredis)");
		}
		throw err;
	}
}

const DEFAULT_PING_MS = 10_000;

function resolvePingMs(opt?: number): number {
	const raw = opt ?? (process.env.LIMITS_STORE_PING_MS !== undefined && process.env.LIMITS_STORE_PING_MS !== "" ? Number(process.env.LIMITS_STORE_PING_MS) : DEFAULT_PING_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 0;
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
 * adapter's own (ioredis, offline queue off, so a down Redis rejects at once instead of stalling the call).
 */
export class RedisAdapter extends GuardedStore {
	private client?: RedisLikeClient;
	private owned = false;
	private readonly url?: string;
	private readonly pingIntervalMs?: number;
	private pinger?: NodeJS.Timeout;

	constructor(opts: RedisAdapterOptions = {}, ctx: StoreContext = {}) {
		super({ ...ctx, prefix: opts.prefix ?? ctx.prefix });
		this.client = opts.client;
		this.url = opts.url;
		this.pingIntervalMs = opts.pingIntervalMs;
	}

	override start(): void {
		if (this.client) return;
		try {
			const Redis = loadIoredis();
			const pingInterval = resolvePingMs(this.pingIntervalMs);
			const options = {
				// Connected explicitly below, so a failure is handled and never an unhandled rejection.
				lazyConnect: true,
				// A down Redis rejects at once instead of queueing the command until it is back.
				enableOfflineQueue: false,
				connectTimeout: 1000,
				keepAlive: 5000,
				retryStrategy: (retries: number) => Math.min(retries * 100, 3000),
			};
			const client = (this.url ? new Redis(this.url, options) : new Redis(options)) as RedisLikeClient;
			this.client = client;
			this.owned = true;
			// An unhandled "error" event would crash the process; the guard reports failures per command.
			client.on?.("error", (err) => this.fail(err));
			// Never awaited: the service starts with Redis down, commands fail open until it is up.
			client.connect?.().catch((err) => this.fail(err));
			if (pingInterval > 0) {
				// A failing ping goes to the rate-limited warn, never thrown.
				this.pinger = setInterval(() => client.ping?.().catch((err) => this.fail(err)), pingInterval);
				this.pinger.unref();
			}
		} catch (err) {
			this.fail(err);
		}
	}

	override async stop(): Promise<void> {
		this.closed = true;
		if (this.pinger) clearInterval(this.pinger);
		this.pinger = undefined;
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
			client.disconnect?.();
		} catch {
			/* closed already */
		}
	}

	private get redis(): RedisLikeClient {
		if (!this.client) throw new Error("limits store has no Redis client");
		return this.client;
	}

	/** ioredis resolves a transaction as `[error, result][]`: a failed command throws here, so the store fails open. */
	private async exec(multi: RedisLikeMulti): Promise<unknown[]> {
		const replies = await multi.exec();
		if (!replies) throw new Error("limits store transaction discarded");
		return replies.map(([err, value]) => {
			if (err) throw err;
			return value;
		});
	}

	protected async doHit(key: string, perMinute: number, windowMs: number): Promise<HitResult> {
		const k = `${this.prefix}h:${key}`;
		const [count, , pttl] = await this.exec(this.redis.multi().incr(k).pexpire(k, windowMs, "NX").pttl(k));
		const n = Number(count);
		const left = Number(pttl);
		if (!(left > 0)) {
			// A counter without a TTL (written elsewhere) would block its key forever: re-arm it.
			await this.redis.pexpire(k, windowMs);
		}
		return { allowed: n <= perMinute, retryAfterMs: left > 0 ? left : windowMs, count: n };
	}

	protected async doAcquire(key: string, cap: number, leaseId: string, ttlMs: number): Promise<HitResult> {
		const k = `${this.prefix}c:${key}`;
		const now = Date.now();
		const replies = await this.exec(
			this.redis.multi().zremrangebyscore(k, "-inf", now).zadd(k, now + ttlMs, leaseId).zcard(k).pexpire(k, ttlMs),
		);
		const count = Number(replies[2]);
		if (count <= cap) return { ...ALLOW, count };
		await this.redis.zrem(k, leaseId);
		return { allowed: false, retryAfterMs: 0, count: count - 1 };
	}

	protected async doRenew(key: string, leaseId: string, ttlMs: number): Promise<boolean> {
		const k = `${this.prefix}c:${key}`;
		// XX: only a lease that is still held; CH: reply 1 when its score changed.
		const changed = await this.redis.zadd(k, "XX", "CH", Date.now() + ttlMs, leaseId);
		if (Number(changed) <= 0) return false;
		// The set's own TTL (set by acquire) must follow the renewed leases, or it would vanish under them.
		await this.redis.pexpire(k, ttlMs);
		return true;
	}

	protected async doRelease(key: string, leaseId: string): Promise<void> {
		await this.redis.zrem(`${this.prefix}c:${key}`, leaseId);
	}
}
