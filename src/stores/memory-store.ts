import { RateLimitStore } from 'moleculer-web';
import type { ServiceBroker } from 'moleculer';
import type { RateLimitSettings } from 'moleculer-web';

/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
export class MemoryStore extends RateLimitStore {

	hits: Map<string, number> = new Map();
	timer: NodeJS.Timer;

	/**
	 * @inheritdoc
	 */
	constructor(clearPeriod: number, opts?: RateLimitSettings, broker?: ServiceBroker | undefined) {
		super(clearPeriod, opts, broker);
		this.resetTime = Date.now() + clearPeriod;

		this.timer = setInterval(() => {
			this.resetTime = Date.now() + clearPeriod;
			this.reset();
		}, clearPeriod);

		this.timer.unref();
	}

	/**
	 * @inheritdoc
	 */
	inc(key: string): number {
		let counter = this.hits.get(key) || 0;
		counter++;
		this.hits.set(key, counter);
		return counter;
	}

	/**
	 * Decrement the counter by key
	 *
	 * @memberof MemoryStore
	 */
	dec(key: string): number {
		let counter = this.hits.get(key) || 0;
		counter--;
		this.hits.set(key, counter);
		return counter;
	}

	/**
	 * @inheritdoc
	 */
	reset(): void {
		this.hits.clear();
	}
}

module.exports = MemoryStore;
