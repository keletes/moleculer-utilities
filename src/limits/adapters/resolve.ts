import { DEFAULT_TIMEOUT_MS, LimitsStore, StoreContext } from "./base";
import { MemoryAdapter } from "./memory";
import { NoneAdapter } from "./none";
import { RedisAdapter, RedisAdapterOptions } from "./redis";

export interface StoreObjectConfig {
	type: "Memory" | "Redis" | "None";
	options?: RedisAdapterOptions;
	/** Per command timeout in ms (positive integer, default env `LIMITS_STORE_TIMEOUT_MS`, else 100). */
	timeoutMs?: number;
}

export type StoreConfig = false | string | LimitsStore | StoreObjectConfig;

let warnedEnvTimeout = false;

function validTimeout(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** `LIMITS_STORE_TIMEOUT_MS`: a positive integer, else the default (warns once). */
function envTimeout(logger?: StoreContext["logger"]): number {
	const raw = process.env.LIMITS_STORE_TIMEOUT_MS?.trim();
	if (!raw) return DEFAULT_TIMEOUT_MS;
	const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
	if (validTimeout(n)) return n;
	if (!warnedEnvTimeout) {
		warnedEnvTimeout = true;
		logger?.warn(`Invalid LIMITS_STORE_TIMEOUT_MS, using ${DEFAULT_TIMEOUT_MS} ms`);
	}
	return DEFAULT_TIMEOUT_MS;
}

/**
 * Resolves the store like Moleculer resolves `cacher`: `"Memory"`, `"redis://host:6379/2"`, `{ type: "Redis",
 * options: { url | client, prefix } }`, `false` (no limits), or a ready store object. A string `"false"` and a JSON
 * string are accepted too, because the usual source is an environment variable (`LIMITS_STORE`). The per command timeout comes
 * from `{ timeoutMs }` of the object form, else `ctx.timeoutMs`, else env `LIMITS_STORE_TIMEOUT_MS`, else 100 ms.
 */
export function resolveStore(config: StoreConfig | undefined, baseCtx: StoreContext = {}): LimitsStore {
	const fromConfig = (config as { timeoutMs?: unknown } | undefined)?.timeoutMs;
	if (fromConfig !== undefined && !validTimeout(fromConfig)) throw new Error("Limits store timeoutMs must be a positive integer");
	const ctx: StoreContext = { ...baseCtx, timeoutMs: (fromConfig as number | undefined) ?? baseCtx.timeoutMs ?? envTimeout(baseCtx.logger) };
	let cfg: StoreConfig | undefined = config;
	if (typeof cfg === "string") {
		const s = cfg.trim();
		if (s === "false") cfg = false;
		else if (s.startsWith("{")) cfg = JSON.parse(s) as StoreConfig;
		else cfg = s;
	}
	if (cfg === undefined || cfg === "" || cfg === "Memory") return new MemoryAdapter(ctx);
	if (cfg === false) return new NoneAdapter(ctx);
	if (typeof cfg === "string") {
		if (/^rediss?:\/\//i.test(cfg)) return new RedisAdapter({ url: cfg }, ctx);
		throw new Error(`Unknown limits store: ${cfg.split("://")[0]}`);
	}
	if (typeof (cfg as LimitsStore).hit === "function") return cfg as LimitsStore;
	const { type, options } = cfg as { type: string; options?: RedisAdapterOptions };
	switch (type) {
		case "Memory":
			return new MemoryAdapter(ctx);
		case "None":
			return new NoneAdapter(ctx);
		case "Redis":
			return new RedisAdapter(options, ctx);
		default:
			throw new Error(`Unknown limits store type: ${type}`);
	}
}
