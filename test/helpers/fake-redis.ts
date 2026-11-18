import type { RedisLikeClient, RedisLikeMulti } from "../../src/limits/adapters";

type Entry = { kind: "str"; value: number; expireAt?: number } | { kind: "zset"; members: Map<string, number>; expireAt?: number };

/**
 * In-memory stand-in for the ioredis commands the Redis adapter uses (INCR, PEXPIRE [NX], PTTL, ZADD [XX CH],
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
			case "pexpire": {
				const e = this.live(key);
				if (!e) return 0;
				if (args[1] === "NX" && e.expireAt !== undefined) return 0;
				e.expireAt = Date.now() + args[0];
				return 1;
			}
			case "pttl": {
				const e = this.live(key);
				if (!e) return -2;
				return e.expireAt === undefined ? -1 : e.expireAt - Date.now();
			}
			case "zremrangebyscore": {
				const e = this.live(key);
				if (!e || e.kind !== "zset") return 0;
				const max = args[1] === "+inf" ? Infinity : Number(args[1]);
				const min = args[0] === "-inf" ? -Infinity : Number(args[0]);
				let n = 0;
				for (const [m, s] of e.members) if (s >= min && s <= max) (e.members.delete(m), n++);
				if (e.members.size === 0) this.data.delete(key);
				return n;
			}
			case "zadd": {
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
			case "zcard": {
				const e = this.live(key);
				return e && e.kind === "zset" ? e.members.size : 0;
			}
			case "zrem": {
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
			pexpire: (k: string, ms: number, mode?: string) => (ops.push(["pexpire", k, ms, mode]), chain),
			pttl: (k: string) => (ops.push(["pttl", k]), chain),
			zremrangebyscore: (k: string, a: unknown, b: unknown) => (ops.push(["zremrangebyscore", k, a, b]), chain),
			zadd: (k: string, score: number, value: string) => (ops.push(["zadd", k, { score, value }]), chain),
			zcard: (k: string) => (ops.push(["zcard", k]), chain),
			// MULTI/EXEC: every command runs together, nothing interleaves. Replies are ioredis' [error, result] pairs.
			exec: async () => {
				await this.gate();
				return ops.map((op) => {
					try {
						return [null, this.run(op)] as [null, unknown];
					} catch (err) {
						return [err as Error, undefined] as [Error, unknown];
					}
				});
			},
		};
		return chain;
	}

	// ioredis variadic form: zadd(key, "XX", "CH", score, member) / zadd(key, score, member).
	async zadd(key: string, ...args: (string | number)[]) {
		await this.gate();
		const flags: string[] = [];
		while (typeof args[0] === "string" && /^(XX|NX|CH)$/.test(args[0])) flags.push(args.shift() as string);
		const rest = args;
		const [score, value] = rest as [number, string];
		return this.run(["zadd", key, { score, value }, { condition: flags.includes("XX") ? "XX" : undefined, CH: flags.includes("CH") }]);
	}
	async zrem(key: string, member: string) {
		await this.gate();
		return this.run(["zrem", key, member]);
	}
	async pexpire(key: string, ms: number) {
		await this.gate();
		return this.run(["pexpire", key, ms]);
	}
}
