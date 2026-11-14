export type RenewResult = "ok" | "gone" | "error";

export interface HitResult {
	allowed: boolean;
	/** Time left in the key's window (hit) or 0 when unknown (acquire: the middleware applies its own hint). */
	retryAfterMs: number;
	/** Hits counted in the current window, 0 when the store failed open. */
	count: number;
}

/**
 * What a limits store offers. Keys are opaque strings chosen by the caller (the middleware never puts the raw access
 * key in one). Every method resolves and never rejects: a store error or timeout fails open (allowed, 0).
 */
export interface LimitsStore {
	/** Fixed window per key, starting at its first hit; refused hits count too. `windowMs` defaults to 60 s. */
	hit(key: string, perMinute: number, windowMs?: number): Promise<HitResult>;
	/** Optimistic lease: takes a slot of `cap` for `ttlMs`, or refuses. Never admits more than `cap`. */
	acquire(key: string, cap: number, leaseId: string, ttlMs: number): Promise<HitResult>;
	/** Extends a held lease: "ok", "gone" (released or expired: stop renewing) or "error" (store trouble: keep trying). */
	renew(key: string, leaseId: string, ttlMs: number): Promise<RenewResult>;
	release(key: string, leaseId: string): Promise<void>;
	/** Never blocks: connects in the background. */
	start(): void | Promise<void>;
	stop(): Promise<void>;
}

export interface StoreContext {
	logger?: { warn(...args: unknown[]): void };
	/** Called for every swallowed store error (the middleware counts `limits.store.errors`). */
	onError?: (err: unknown) => void;
	/** Prefix of every key the store writes (`limits:<namespace>:<service>:` by default). */
	prefix?: string;
	/** Per command timeout, 100 ms by default. */
	timeoutMs?: number;
}

const WARN_EVERY_MS = 10_000;
export const DEFAULT_WINDOW_MS = 60_000;
export const ALLOW: Readonly<HitResult> = Object.freeze({ allowed: true, retryAfterMs: 0, count: 0 });

/**
 * Shared fail-open plumbing: subclasses implement the `do*` methods and throw; the public methods turn any error or
 * timeout into "allow", warn at most every 10 s and report to `onError`.
 */
export abstract class GuardedStore implements LimitsStore {
	protected readonly timeoutMs: number;
	protected readonly prefix: string;
	private lastWarn = 0;
	/** After `stop()` every call is a silent no-op (a late release must not warn about a missing client). */
	protected closed = false;

	constructor(protected readonly ctx: StoreContext = {}) {
		this.timeoutMs = ctx.timeoutMs ?? 100;
		this.prefix = ctx.prefix ?? "";
	}

	protected abstract doHit(key: string, perMinute: number, windowMs: number): Promise<HitResult>;
	protected abstract doAcquire(key: string, cap: number, leaseId: string, ttlMs: number): Promise<HitResult>;
	protected abstract doRenew(key: string, leaseId: string, ttlMs: number): Promise<boolean>;
	protected abstract doRelease(key: string, leaseId: string): Promise<void>;

	hit(key: string, perMinute: number, windowMs = DEFAULT_WINDOW_MS): Promise<HitResult> {
		return this.guard(() => this.doHit(key, perMinute, windowMs), ALLOW);
	}
	acquire(key: string, cap: number, leaseId: string, ttlMs: number): Promise<HitResult> {
		return this.guard(() => this.doAcquire(key, cap, leaseId, ttlMs), ALLOW);
	}
	renew(key: string, leaseId: string, ttlMs: number): Promise<RenewResult> {
		return this.guard(async () => ((await this.doRenew(key, leaseId, ttlMs)) ? "ok" : "gone"), "error" as RenewResult);
	}
	async release(key: string, leaseId: string): Promise<void> {
		await this.guard(() => this.doRelease(key, leaseId), undefined);
	}
	start(): void | Promise<void> {
		/* nothing by default */
	}
	async stop(): Promise<void> {
		this.closed = true;
	}

	protected async guard<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
		if (this.closed) return fallback;
		let timer: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				fn(),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error("limits store timeout")), this.timeoutMs);
				}),
			]);
		} catch (err) {
			this.fail(err);
			return fallback;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	protected fail(err: unknown): void {
		try {
			this.ctx.onError?.(err);
		} catch {
			/* a metric must never break a request */
		}
		const now = Date.now();
		if (now - this.lastWarn >= WARN_EVERY_MS) {
			this.lastWarn = now;
			this.ctx.logger?.warn(`Limits store error, failing open: ${(err as Error)?.message ?? err}`);
		}
	}
}
