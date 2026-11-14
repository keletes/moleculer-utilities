import type { ServiceBroker } from "moleculer";
import { LimitExceededError } from "./errors";
import { LimitsStore, resolveStore, StoreConfig } from "./adapters";

export interface RateLimitStoreOptions {
	limit?: number;
	/** moleculer-web's own option; the window of the counter (default 60 s). */
	window?: number;
	/** Same shapes as the `Limits` middleware; defaults to `process.env.LIMITS_STORE`, then `"Memory"`. */
	limitsStore?: StoreConfig;
	/** Service name for the default key prefix `limits:<namespace>:<service>:` (default `api`). */
	service?: string;
	[key: string]: unknown;
}

/**
 * The limits adapters as a moleculer-web `rateLimit.StoreFactory` (constructor `(window, opts, broker)`, `inc(key)`),
 * so a gateway's per-IP layer is moleculer-web's built-in `rateLimit`, which runs before `authenticate`.
 *
 * moleculer-web awaits `inc` without a try/catch and treats a thrown error as the request's error, so `inc` throws
 * `LimitExceededError` itself, with `data.retryAfter` = the key's time left (moleculer-web's own data-less
 * `RateLimitExceeded` is never reached because `inc` throws first). Store failures are swallowed (`inc` returns 0:
 * fail open): only the limit error propagates.
 */
export class RateLimitStore {
	/** Read by moleculer-web for the `X-Rate-Limit-Reset` header only. */
	resetTime: number;
	private readonly store: LimitsStore;
	private readonly limit: number;
	private readonly window: number;

	constructor(window: number | undefined, opts?: RateLimitStoreOptions, broker?: ServiceBroker) {
		this.window = window ?? opts?.window ?? 60_000;
		this.limit = opts?.limit ?? 30;
		this.resetTime = Date.now() + this.window;
		this.store = resolveStore(opts?.limitsStore ?? (process.env.LIMITS_STORE as StoreConfig | undefined), {
			prefix: `limits:${broker?.namespace || ""}:${opts?.service ?? "api"}:`,
			logger: broker?.logger,
		});
		// Never blocks: Redis connects in the background.
		void this.store.start();
		// moleculer-web has no stop hook for a store.
		broker?.localBus?.once("$broker.stopped", () => void this.store.stop());
	}

	async inc(key: string): Promise<number> {
		const r = await this.store.hit(`ip:${key}`, this.limit, this.window);
		this.resetTime = Date.now() + r.retryAfterMs;
		if (!r.allowed) throw new LimitExceededError(Math.ceil(r.retryAfterMs / 1000));
		return r.count;
	}
}
