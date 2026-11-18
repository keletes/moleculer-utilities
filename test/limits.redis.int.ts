import Redis from "ioredis";
import { RedisAdapter } from "../src/limits";
import { storeSuite } from "./helpers/store-suite";

// `yarn verify:int`: the store contract against a real Redis >= 7 (REDIS_URL, e.g. redis://localhost:6379/15).
// Keys are unique per run and expire by themselves; use a throwaway database.
const url = process.env.REDIS_URL;
if (!url) throw new Error("Set REDIS_URL to run the real-Redis suite (verify:int)");

storeSuite("Redis (real)", async () => {
	const client = new Redis(url);
	const prefix = `limits:test:${Date.now()}:`;
	return {
		store: new RedisAdapter({ client: client, prefix }),
		cleanup: async () => {
			const keys = await client.keys(`${prefix}*`);
			if (keys.length) await client.del(...keys);
			await client.quit();
		},
	};
});
