import type { LimitsStore, StoreContext } from "./base";
import { MemoryAdapter } from "./memory";
import { NoneAdapter } from "./none";
import { RedisAdapter, RedisAdapterOptions } from "./redis";

export type StoreConfig =
	| false
	| string
	| LimitsStore
	| { type: "Memory" | "Redis" | "None"; options?: RedisAdapterOptions };

/**
 * Resolves the store like Moleculer resolves `cacher`: `"Memory"`, `"redis://host:6379/2"`, `{ type: "Redis",
 * options: { url | client, prefix } }`, `false` (no limits), or a ready store object. A string `"false"` and a JSON
 * string are accepted too, because the usual source is an environment variable (`LIMITS_STORE`).
 */
export function resolveStore(config: StoreConfig | undefined, ctx: StoreContext = {}): LimitsStore {
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
