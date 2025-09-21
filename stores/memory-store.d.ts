import { ExtendedRateLimitStore } from './extended-rate-limit-store';
import type { ServiceBroker } from 'moleculer';
import type { RateLimitSettings } from 'moleculer-web';
/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
export declare class MemoryStore extends ExtendedRateLimitStore {
    #private;
    /**
     * @inheritdoc
     */
    constructor(clearPeriod: number, opts?: RateLimitSettings, broker?: ServiceBroker | undefined);
    /**
     * Increment the counter by key
     * @param {String} key
     * @param {boolean} setExpire - Whether the key should automatically expire based on the set window
     * @returns {Number}
     * @memberof MemoryStore
     */
    inc(key: string, setExpire?: true): Promise<number>;
    /**
     * Decrement the counter by key
     *
     * @param {String} key
     * @returns {Number}
     * @memberof MemoryStore
     */
    dec(key: string): number;
    /**
     * @inheritdoc
     */
    reset(): void;
}
