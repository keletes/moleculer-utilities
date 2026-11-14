import type { ServiceBroker } from "moleculer";
import { isIP } from "net";
import { LimitExceededError } from "./errors";
import type { LimitsMode } from "./middleware";
import { LimitsStore, resolveStore, StoreConfig } from "./adapters";

export interface RateLimitStoreOptions {
	limit?: number;
	/** moleculer-web's own option; the window of the counter (default 60 s). */
	window?: number;
	/** Same shapes as the `Limits` middleware; defaults to `process.env.LIMITS_STORE`, then `"Memory"`. */
	limitsStore?: StoreConfig;
	/** Service name for the default key prefix `limits:<namespace>:<service>:` (default `api`). */
	service?: string;
	/** `enforce` (default), `shadow` (count, never refuse, metric + warn) or `off` (no store call); defaults to `process.env.LIMITS_MODE`. */
	mode?: LimitsMode;
	[key: string]: unknown;
}

const WARN_EVERY_MS = 10_000;

/** The /24 (IPv4) or /48 (IPv6) prefix of an address, for logs; anything else is not echoed. */
export function maskIp(ip: string): string {
	const v = isIP(ip);
	if (v === 4) return `${ip.split(".").slice(0, 3).join(".")}.0/24`;
	if (v === 6) {
		const [head, tail = ""] = ip.split("::");
		const h = head ? head.split(":") : [];
		const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - (tail ? tail.split(":").length : 0))).fill("0"), ...(tail ? tail.split(":") : [])] : h;
		return `${groups.slice(0, 3).join(":")}::/48`;
	}
	return "?";
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
	private readonly mode: LimitsMode;
	private readonly broker?: ServiceBroker;
	private lastWarn = 0;

	constructor(window: number | undefined, opts?: RateLimitStoreOptions, broker?: ServiceBroker) {
		this.window = window ?? opts?.window ?? 60_000;
		this.limit = opts?.limit ?? 30;
		this.resetTime = Date.now() + this.window;
		this.broker = broker;
		this.mode = (opts?.mode ?? (process.env.LIMITS_MODE as LimitsMode | undefined) ?? "enforce") as LimitsMode;
		if (!["enforce", "shadow", "off"].includes(this.mode)) throw new Error(`Invalid LIMITS_MODE: ${this.mode}`);
		// The Limits middleware registers the same metric: do not reset its counter.
		if (broker?.metrics && !broker.metrics.hasMetric?.("limits.refused")) {
			try {
				broker.metrics.register({
					type: "counter",
					name: "limits.refused",
					labelNames: ["action", "mode"],
					description: "Calls refused (or that shadow mode would refuse) by a key limit",
				});
			} catch {
				/* metrics are best effort */
			}
		}
		this.store = resolveStore(opts?.limitsStore ?? (process.env.LIMITS_STORE as StoreConfig | undefined), {
			prefix: `limits:${broker?.namespace || ""}:${opts?.service ?? "api"}:`,
			logger: broker?.logger,
		});
		// Never blocks: Redis connects in the background.
		if (this.mode !== "off") void this.store.start();
		// moleculer-web has no stop hook for a store.
		broker?.localBus?.once("$broker.stopped", () => void this.store.stop());
	}

	async inc(key: string): Promise<number> {
		if (this.mode === "off") return 0;
		const r = await this.store.hit(`ip:${key}`, this.limit, this.window);
		this.resetTime = Date.now() + r.retryAfterMs;
		if (!r.allowed && this.mode === "shadow") {
			try {
				this.broker?.metrics?.increment("limits.refused", { action: "ip", mode: "shadow" });
			} catch {
				/* metrics are best effort */
			}
			const now = Date.now();
			if (now - this.lastWarn >= WARN_EVERY_MS) {
				this.lastWarn = now;
				this.broker?.logger?.warn(`Rate limit would refuse client ${maskIp(key)} (shadow)`);
			}
			// moleculer-web throws when `limit - inc() < 0`: report the limit itself, so the request passes.
			return Math.min(r.count, this.limit);
		}
		if (!r.allowed) throw new LimitExceededError(Math.ceil(r.retryAfterMs / 1000));
		return r.count;
	}
}
