import { ALLOW, DEFAULT_WINDOW_MS, GuardedStore, HitResult } from "./base";

/** Per process: exact for one replica, each replica counts alone. Same semantics as the Redis adapter. */
export class MemoryAdapter extends GuardedStore {
	private windows = new Map<string, { count: number; resetAt: number }>();
	private leases = new Map<string, Map<string, number>>();
	private sweeper?: NodeJS.Timeout;

	override start(): void {
		if (this.sweeper) return;
		// Drops expired entries so idle keys do not pile up.
		this.sweeper = setInterval(() => this.sweep(), DEFAULT_WINDOW_MS);
		this.sweeper.unref();
	}

	override async stop(): Promise<void> {
		if (this.sweeper) clearInterval(this.sweeper);
		this.sweeper = undefined;
	}

	protected async doHit(key: string, perMinute: number, windowMs: number): Promise<HitResult> {
		const now = Date.now();
		let w = this.windows.get(key);
		if (!w || w.resetAt <= now) {
			w = { count: 0, resetAt: now + windowMs };
			this.windows.set(key, w);
		}
		w.count++;
		return { allowed: w.count <= perMinute, retryAfterMs: w.resetAt - now, count: w.count };
	}

	protected async doAcquire(key: string, cap: number, leaseId: string, ttlMs: number): Promise<HitResult> {
		const now = Date.now();
		const set = this.leases.get(key) ?? new Map<string, number>();
		this.leases.set(key, set);
		for (const [id, expiry] of set) if (expiry <= now) set.delete(id);
		if (set.size >= cap) return { allowed: false, retryAfterMs: 0, count: set.size };
		set.set(leaseId, now + ttlMs);
		return { ...ALLOW, count: set.size };
	}

	protected async doRenew(key: string, leaseId: string, ttlMs: number): Promise<boolean> {
		const set = this.leases.get(key);
		if (!set?.has(leaseId)) return false;
		set.set(leaseId, Date.now() + ttlMs);
		return true;
	}

	protected async doRelease(key: string, leaseId: string): Promise<void> {
		const set = this.leases.get(key);
		set?.delete(leaseId);
		if (set?.size === 0) this.leases.delete(key);
	}

	private sweep(): void {
		const now = Date.now();
		for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
		for (const [k, set] of this.leases) {
			for (const [id, expiry] of set) if (expiry <= now) set.delete(id);
			if (set.size === 0) this.leases.delete(k);
		}
	}
}
