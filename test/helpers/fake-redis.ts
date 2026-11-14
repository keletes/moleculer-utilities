import type { RedisLikeClient, RedisLikeMulti } from "../../src/limits/adapters";

type Entry = { kind: "str"; value: number; expireAt?: number } | { kind: "zset"; members: Map<string, number>; expireAt?: number };

/**
 * In-memory stand-in for the node-redis commands the Redis adapter uses (INCR, PEXPIRE [NX], PTTL, ZADD [XX CH],
 * ZREMRANGEBYSCORE, ZCARD, ZREM, MULTI/EXEC), with the real expiry semantics. `down` makes every command reject,
 * `latencyMs` delays every command: both simulate an unreachable or slow Redis.
 */
interface State {
	data: Map<string, Entry>;
	down: boolean;
	latencyMs: number;
	commands: number;
}
const states = new Map<number, State>();
let nextId = 0;

export class FakeRedis implements RedisLikeClient {
	// State lives outside the instance, behind an id: Moleculer deep-clones service settings, and a clone of this
	// object (as moleculer-web's route settings are) must still share the same "server".
	private readonly id = ++nextId;
	constructor() {
		states.set(this.id, { data: new Map(), down: false, latencyMs: 0, commands: 0 });
	}
	private get st(): State {
		return states.get(this.id)!;
	}
	get data() {
		return this.st.data;
	}
	get down() {
		return this.st.down;
	}
	set down(v: boolean) {
		this.st.down = v;
	}
	get latencyMs() {
		return this.st.latencyMs;
	}
	set latencyMs(v: number) {
		this.st.latencyMs = v;
	}
	get commands() {
		return this.st.commands;
	}

	private async gate() {
		this.st.commands++;
		if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
		if (this.down) throw new Error("The client is closed");
	}

	private live(key: string): Entry | undefined {
		const e = this.data.get(key);
		if (e?.expireAt !== undefined && e.expireAt <= Date.now()) {
			this.data.delete(key);
			return undefined;
		}
		return e;
	}

	private run(op: [string, ...any[]]): unknown {
		const [cmd, key, ...args] = op;
		switch (cmd) {
			case "incr": {
				const e = this.live(key);
				const entry = e && e.kind === "str" ? e : ({ kind: "str", value: 0 } as Entry & { kind: "str" });
				entry.value++;
				this.data.set(key, entry);
				return entry.value;
			}
			case "pExpire": {
				const e = this.live(key);
				if (!e) return 0;
				if (args[1] === "NX" && e.expireAt !== undefined) return 0;
				e.expireAt = Date.now() + args[0];
				return 1;
			}
			case "pTTL": {
				const e = this.live(key);
				if (!e) return -2;
				return e.expireAt === undefined ? -1 : e.expireAt - Date.now();
			}
			case "zRemRangeByScore": {
				const e = this.live(key);
				if (!e || e.kind !== "zset") return 0;
				const max = args[1] === "+inf" ? Infinity : Number(args[1]);
				const min = args[0] === "-inf" ? -Infinity : Number(args[0]);
				let n = 0;
				for (const [m, s] of e.members) if (s >= min && s <= max) (e.members.delete(m), n++);
				if (e.members.size === 0) this.data.delete(key);
				return n;
			}
			case "zAdd": {
				const [member, options] = args;
				let e = this.live(key);
				if (e && e.kind !== "zset") throw new Error("WRONGTYPE");
				if (options?.condition === "XX" && !e?.members.has(member.value)) return 0;
				if (!e) {
					e = { kind: "zset", members: new Map() };
					this.data.set(key, e);
				}
				const had = e.members.has(member.value);
				const changed = e.members.get(member.value) !== member.score;
				e.members.set(member.value, member.score);
				return options?.CH ? (changed ? 1 : 0) : had ? 0 : 1;
			}
			case "zCard": {
				const e = this.live(key);
				return e && e.kind === "zset" ? e.members.size : 0;
			}
			case "zRem": {
				const e = this.live(key);
				if (!e || e.kind !== "zset") return 0;
				const ok = e.members.delete(args[0]);
				if (e.members.size === 0) this.data.delete(key);
				return ok ? 1 : 0;
			}
			default:
				throw new Error(`unsupported ${cmd}`);
		}
	}

	multi(): RedisLikeMulti {
		const ops: [string, ...any[]][] = [];
		const chain: any = {
			incr: (k: string) => (ops.push(["incr", k]), chain),
			pExpire: (k: string, ms: number, mode?: string) => (ops.push(["pExpire", k, ms, mode]), chain),
			pTTL: (k: string) => (ops.push(["pTTL", k]), chain),
			zRemRangeByScore: (k: string, a: unknown, b: unknown) => (ops.push(["zRemRangeByScore", k, a, b]), chain),
			zAdd: (k: string, m: unknown) => (ops.push(["zAdd", k, m]), chain),
			zCard: (k: string) => (ops.push(["zCard", k]), chain),
			// MULTI/EXEC: every command runs together, nothing interleaves.
			exec: async () => {
				await this.gate();
				return ops.map((op) => this.run(op));
			},
		};
		return chain;
	}

	async zAdd(key: string, member: { score: number; value: string }, options?: Record<string, unknown>) {
		await this.gate();
		return this.run(["zAdd", key, member, options]);
	}
	async zRem(key: string, member: string) {
		await this.gate();
		return this.run(["zRem", key, member]);
	}
	async pExpire(key: string, ms: number) {
		await this.gate();
		return this.run(["pExpire", key, ms]);
	}
}
