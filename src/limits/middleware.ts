import { createHash, randomUUID } from "crypto";
import type { Context, Middleware, ServiceBroker } from "moleculer";
import { LimitExceededError } from "./errors";
import { matchParams, stableStringify } from "./match";
import { LimitsStore, resolveStore, StoreConfig } from "./adapters";

export interface LimitRule {
	/** Max calls/jobs running at once, per key. */
	concurrent?: number;
	/** Max starts per window (a minute), per key. */
	perMinute?: number;
	/** AND subset match against `ctx.params` (or the values of a manual check). */
	params?: Record<string, unknown>;
}
/** Per action (`"<service>.<action>"`, unversioned): the rules a key carries. */
export type AccessKeyLimits = Record<string, LimitRule[]>;

export type LimitsMode = "enforce" | "shadow" | "off";

export interface LimitsOptions {
	/** Same shapes as Moleculer's `cacher`; defaults to `process.env.LIMITS_STORE`, then `"Memory"`. */
	store?: StoreConfig;
	/** Service name, part of the default key prefix `limits:<namespace>:<service>:`. */
	service?: string;
	/** Rules of keys that carry none for an action, by action name. */
	defaults?: AccessKeyLimits;
	/** Defaults to `process.env.LIMITS_MODE`, then `"enforce"`. */
	mode?: LimitsMode;
	/** `Retry-After` hint of a refused `concurrent` rule, seconds (default 5). */
	concurrentRetryAfter?: number;
	/** Lease time to live (default 60 s) and renewal period (default 20 s). */
	leaseTtlMs?: number;
	renewEveryMs?: number;
	/** A lease older than this is released and no longer renewed (a stream nobody consumes never closes). Default 30 min, `LIMITS_MAX_LEASE_MS`. */
	maxLeaseMs?: number;
}

/** What `broker.limits` offers a service that checks by hand (`lease: "manual"`). */
export interface LimitsApi {
	/**
	 * Applies the rules of the caller's key for `action` that match `values`. Throws `LimitExceededError`, or returns
	 * the lease handles to give back with `release`. Returns `[]` for calls without an access key (internal calls),
	 * when no rule matches, or when the mode is `off`.
	 */
	check(ctx: Context<unknown, any>, action: string, values?: Record<string, unknown>): Promise<string[]>;
	/** Gives the leases back. Safe from any replica (a handle holds everything needed) and idempotent. */
	release(leaseIds: string | string[] | undefined | null): Promise<void>;
}

declare module "moleculer" {
	interface ServiceBroker {
		/** Set by the `Limits` middleware. */
		limits?: LimitsApi;
	}
}

const WARN_EVERY_MS = 10_000;
const SEP = "|";

function ruleHash(rule: LimitRule): string {
	return createHash("sha256").update(stableStringify(rule)).digest("hex").slice(0, 16);
}

function ownRules(map: unknown, action: string): LimitRule[] | undefined {
	if (!map || typeof map !== "object" || !Object.prototype.hasOwnProperty.call(map, action)) return undefined;
	const rules = (map as Record<string, unknown>)[action];
	return Array.isArray(rules) ? (rules as LimitRule[]) : undefined;
}

/**
 * Per-access-key limits, enforced inside the service that serves the action.
 *
 * Custom code instead of a built-in: Moleculer's bulkhead, throttle and circuit breaker are per action per node and
 * know no caller, so a limit that belongs to an access key (and travels with it) has no built-in. It is a
 * `localAction` hook like the bulkhead; the store follows the adapter pattern of `cacher`.
 *
 * An action opts in with `limits: { lease?: "call" | "stream" | "manual" }` (default `call`):
 * - `call`: leases are taken before the handler and released when it settles;
 * - `stream`: released when the returned stream closes (end, error or abort);
 * - `manual`: the middleware does nothing; the handler calls `this.broker.limits.check(ctx, action, values)` once it
 *   knows the work is real and `this.broker.limits.release(handles)` when it ends.
 *
 * Only calls with `ctx.meta.authorizer.accessKey` are limited. Rules come from `ctx.meta.authorizer.limits[action]`
 * (any entry, even empty, replaces the defaults) else from `defaults`; every rule whose `params` match applies, each
 * with its own counter named `<access key id>:<action>:<hash of the rule>` (never the product, never the raw key).
 * Leases live 60 s and are renewed every 20 s while held, so a crashed pod frees its slots.
 */
export function Limits(opts: LimitsOptions = {}): Middleware {
	const mode = (opts.mode ?? (process.env.LIMITS_MODE as LimitsMode | undefined) ?? "enforce") as LimitsMode;
	if (!["enforce", "shadow", "off"].includes(mode)) throw new Error(`Invalid LIMITS_MODE: ${mode}`);
	const defaults = opts.defaults ?? {};
	const concurrentRetryAfter = opts.concurrentRetryAfter ?? 5;
	const leaseTtlMs = opts.leaseTtlMs ?? 60_000;
	const renewEveryMs = opts.renewEveryMs ?? 20_000;
	const maxLeaseMs = opts.maxLeaseMs ?? (Number(process.env.LIMITS_MAX_LEASE_MS) || 30 * 60_000);

	let broker!: ServiceBroker;
	let store!: LimitsStore;
	let lastShadowWarn = 0;
	// Handles held by this pod, renewed until released (or until the store says the lease is gone).
	const held = new Map<string, number>(); // handle -> time it was taken
	let renewTimer: NodeJS.Timeout | undefined;

	const parse = (handle: string): [string, string] | null => {
		const i = handle.lastIndexOf(SEP);
		return i > 0 ? [handle.slice(0, i), handle.slice(i + 1)] : null;
	};

	function count(name: string, labels: Record<string, string>) {
		try {
			broker.metrics?.increment(name, labels);
		} catch {
			/* metrics are best effort */
		}
	}

	async function release(leaseIds: string | string[] | undefined | null): Promise<void> {
		const list = Array.isArray(leaseIds) ? leaseIds : leaseIds ? [leaseIds] : [];
		await Promise.all(
			list.map(async (handle) => {
				held.delete(handle);
				const parts = parse(handle);
				if (parts) await store.release(parts[0], parts[1]);
			}),
		);
		if (held.size === 0 && renewTimer) {
			clearInterval(renewTimer);
			renewTimer = undefined;
		}
	}

	function track(handle: string) {
		held.set(handle, Date.now());
		if (renewTimer) return;
		renewTimer = setInterval(() => {
			const now = Date.now();
			for (const [h, since] of [...held]) {
				if (now - since > maxLeaseMs) {
					// Nobody released it in time (an unconsumed stream, a lost manual handle): free the slot.
					void release([h]);
					continue;
				}
				const parts = parse(h);
				if (!parts) continue;
				store
					.renew(parts[0], parts[1], leaseTtlMs)
					// Only "gone" (released elsewhere, expired) stops the renewal; a store error keeps trying.
					.then((r) => r !== "gone" || held.delete(h))
					.catch(() => undefined);
			}
		}, renewEveryMs);
		renewTimer.unref();
	}

	function refused(action: string, ctx: Context<unknown, any>, retryAfterSeconds: number): LimitExceededError | null {
		count("limits.refused", { action, mode });
		if (mode === "shadow") {
			const now = Date.now();
			if (now - lastShadowWarn >= WARN_EVERY_MS) {
				lastShadowWarn = now;
				// The key prefix identifies the key; the raw key is never in the context.
				broker.logger.warn(
					`Limit would refuse '${action}' (shadow), key prefix '${ctx.meta?.authorizer?.accessKey?.prefix ?? "?"}'`,
				);
			}
			return null;
		}
		return new LimitExceededError(retryAfterSeconds);
	}

	async function check(ctx: Context<unknown, any>, action: string, values?: Record<string, unknown>): Promise<string[]> {
		if (mode === "off") return [];
		const authorizer = ctx.meta?.authorizer;
		const keyId = authorizer?.accessKey?.id;
		if (!authorizer?.accessKey || keyId == null) return [];

		const rules = ownRules(authorizer.limits, action) ?? ownRules(defaults, action) ?? [];
		const facts = values ?? (ctx.params as Record<string, unknown>);
		const handles: string[] = [];
		const giveBack = () => release(handles.splice(0));

		// `params: null` counts as absent.
		const matching = rules.filter((rule) => rule && (rule.params == null || matchParams(rule.params, facts)));
		const counterOf = (rule: LimitRule) => `${keyId}:${action}:${ruleHash(rule)}`;

		// Concurrency first, minute budget second: a call refused for concurrency never consumes a minute slot, and
		// one refused by the minute budget gives its fresh leases back.
		for (const rule of matching) {
			if (rule.concurrent == null) continue;
			const counter = counterOf(rule);
			const id = randomUUID();
			const r = await store.acquire(counter, rule.concurrent, id, leaseTtlMs);
			if (r.allowed) {
				const handle = `${counter}${SEP}${id}`;
				handles.push(handle);
				track(handle);
			} else {
				const err = refused(action, ctx, concurrentRetryAfter);
				if (err) {
					await giveBack();
					throw err;
				}
			}
		}
		for (const rule of matching) {
			if (rule.perMinute == null) continue;
			const r = await store.hit(counterOf(rule), rule.perMinute);
			if (!r.allowed) {
				const err = refused(action, ctx, Math.ceil(r.retryAfterMs / 1000));
				if (err) {
					await giveBack();
					throw err;
				}
			}
		}
		return handles;
	}

	function localAction(handler: (ctx: Context<any, any>) => unknown, action: any) {
		const cfg = action.limits;
		if (!cfg || mode === "off") return handler;
		const lease: "call" | "stream" | "manual" = cfg.lease ?? "call";
		if (lease === "manual") return handler;
		// Unversioned "<service>.<action>", the same name `Authorizer` and the key's `limits` use.
		const name = `${action.service?.name}.${action.rawName}`;

		return async function limitsMiddleware(this: unknown, ctx: Context<any, any>) {
			const handles = await check(ctx, name);
			if (handles.length === 0) return handler.call(this, ctx);
			let result: unknown;
			try {
				result = await handler.call(this, ctx);
			} catch (err) {
				await release(handles);
				throw err;
			}
			if (lease === "stream" && result && typeof (result as any).once === "function") {
				const stream = result as NodeJS.ReadableStream & { destroyed?: boolean; readableEnded?: boolean };
				// Already over: no event will ever come.
				if (stream.destroyed || stream.readableEnded) {
					await release(handles);
					return result;
				}
				let done = false;
				const end = () => {
					if (done) return;
					done = true;
					void release(handles);
				};
				stream.once("close", end);
				stream.once("end", end);
				stream.once("error", end);
				return result;
			}
			await release(handles);
			return result;
		};
	}

	return {
		name: "Limits",
		created(b: ServiceBroker) {
			broker = b;
			const prefix = `limits:${b.namespace || ""}:${opts.service ?? "default"}:`;
			store = resolveStore(opts.store ?? (process.env.LIMITS_STORE as StoreConfig | undefined), {
				prefix,
				logger: b.logger,
				onError: () => count("limits.store.errors", {}),
			});
			for (const metric of [
				{ name: "limits.refused", labelNames: ["action", "mode"], description: "Calls refused (or that shadow mode would refuse) by a key limit" },
				{ name: "limits.store.errors", labelNames: [], description: "Limits store errors and timeouts (failed open)" },
			]) {
				b.metrics?.register({ type: "counter", ...metric });
			}
			b.limits = { check, release };
		},
		started() {
			// Never blocks: Redis connects in the background and fails open until it is up.
			if (mode !== "off") void store.start();
		},
		async stopped() {
			// Give the held leases back (bounded: each store call gives up after 100 ms, fail open), then close.
			await release([...held.keys()]);
			if (renewTimer) clearInterval(renewTimer);
			renewTimer = undefined;
			await store.stop();
		},
		localAction,
	} as unknown as Middleware;
}
