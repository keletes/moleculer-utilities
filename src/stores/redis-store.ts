import { ExtendedRateLimitStore } from './extended-rate-limit-store';
import { Errors } from 'moleculer';
import type { ServiceBroker } from 'moleculer';
import type { RateLimitSettings } from 'moleculer-web';
import type { RedisClientType } from 'redis';

const MoleculerError = Errors.MoleculerError;

export interface RedisRateLimitSettings extends RateLimitSettings {
	prefix?: string;
	client: RedisClientType;
}

/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
export class RedisStore extends ExtendedRateLimitStore {

	#client: RedisClientType;
	#clearPeriod: number;
	#prefix: string;

	/**
	 * @inheritdoc
	 */
	constructor(clearPeriod: number, opts?: RedisRateLimitSettings, broker?: ServiceBroker | undefined) {
		super(clearPeriod, opts, broker);
		this.#clearPeriod = clearPeriod;
		if (opts?.client) {
			this.#client = opts?.client;
			this.#prefix = opts?.prefix ?? '';
		} else {
			throw new MoleculerError('No Redis client defined in rate limiter options.');
		}
	}

	/**
	 * Increment the counter by key
	 * @param {String} key
	 * @param {boolean} setExpire - Whether the key should automatically expire based on the set window
	 * @returns {Number}
	 * @memberof MemoryStore
	 */
	async inc(key: string, setExpire = true): Promise<number> {
		key = this.#getFullKey(key);
		const counter = this.#client.incr(key);
		if (setExpire)
			this.#client.expire(
				key,
				this.#clearPeriod / 1000,
			);
		return counter;
	}

	/**
	 * Decrement the counter by key
	 *
	 * @memberof MemoryStore
	 */
	async dec(key: string): Promise<number> {
		key = this.#getFullKey(key);
		if (Number(await this.#client.get(key)) > 0)
			return this.#client.decr(key);
		return 0;
	}

	#getFullKey(key: string): string {
		if (this.#prefix) return `${this.#prefix}${key}`;
		return key;
	}
}
