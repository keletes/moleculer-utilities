import { RateLimitStore } from 'moleculer-web';
import { Errors } from 'moleculer';
import type { ServiceBroker } from 'moleculer';
import type { RateLimitSettings } from 'moleculer-web';
import type { RedisClientType } from 'redis';

const MoleculerError = Errors.MoleculerError;

interface RedisRateLimitSettings extends RateLimitSettings {
	prefix?: string,
	client: RedisClientType
}

/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
export class RedisStore extends RateLimitStore {

	client: RedisClientType;
	clearPeriod: number;
	prefix: string;

	/**
	 * @inheritdoc
	 */
	constructor(clearPeriod: number, opts?: RedisRateLimitSettings, broker?: ServiceBroker | undefined) {
		super(clearPeriod, opts, broker);
		this.clearPeriod = clearPeriod;
		if (opts?.client) {
			this.client = opts?.client;
			this.prefix = opts?.prefix ?? '';
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
	async inc(key: string, setExpire?: true): Promise<number> {
		if (this.prefix) key = `${this.prefix}${key}`;
		const counter = this.client.incr(key);
		if (setExpire)
			this.client.expire(
				key,
				this.clearPeriod,
			);
		return counter;
	}

	/**
	 * Decrement the counter by key
	 *
	 * @memberof MemoryStore
	 */
	async dec(key: string): Promise<number> {
		if (this.prefix) key = `${this.prefix}${key}`;
		const counter = this.client.decr(key);
		return counter;
	}
}

module.exports = RedisStore;
