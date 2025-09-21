import { ExtendedRateLimitStore } from './extended-rate-limit-store';
import type { ServiceBroker } from 'moleculer';
import type { RateLimitSettings } from 'moleculer-web';

/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
export class MemoryStore extends ExtendedRateLimitStore {

	#hits: Map<string, number> = new Map();
	#timer: NodeJS.Timer;

	/**
	 * @inheritdoc
	 */
	constructor(clearPeriod: number, opts?: RateLimitSettings, broker?: ServiceBroker | undefined) {
		super(clearPeriod, opts, broker);
		this.resetTime = Date.now() + clearPeriod;

		this.#timer = setInterval(() => {
			this.resetTime = Date.now() + clearPeriod;
			this.reset();
		}, clearPeriod);

		this.#timer.unref();
	}

	/**
	 * Increment the counter by key
	 * @param {String} key
	 * @param {boolean} setExpire - Whether the key should automatically expire based on the set window
	 * @returns {Number}
	 * @memberof MemoryStore
	 */
	async inc(key: string, setExpire?: true): Promise<number> {
		let counter = this.#hits.get(key) || 0;
		counter++;
		this.#hits.set(key, counter);
		return counter;
	}

	/**
	 * Decrement the counter by key
	 *
	 * @param {String} key
	 * @returns {Number}
	 * @memberof MemoryStore
	 */
	dec(key: string): number {
		let counter = this.#hits.get(key) || 0;
		counter--;
		this.#hits.set(key, counter);
		return counter;
	}

	/**
	 * @inheritdoc
	 */
	reset(): void {
		this.#hits.clear();
	}
}
