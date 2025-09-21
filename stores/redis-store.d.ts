import { ExtendedRateLimitStore } from './extended-rate-limit-store';
import type { ServiceBroker } from 'moleculer';
import type { RateLimitSettings } from 'moleculer-web';
import type { RedisClientType } from 'redis';
export interface RedisRateLimitSettings extends RateLimitSettings {
    prefix?: string;
    client: RedisClientType;
}
/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
export declare class RedisStore extends ExtendedRateLimitStore {
    #private;
    /**
     * @inheritdoc
     */
    constructor(clearPeriod: number, opts?: RedisRateLimitSettings, broker?: ServiceBroker | undefined);
    /**
     * Increment the counter by key
     * @param {String} key
     * @param {boolean} setExpire - Whether the key should automatically expire based on the set window
     * @returns {Number}
     * @memberof MemoryStore
     */
    inc(key: string, setExpire?: boolean): Promise<number>;
    /**
     * Decrement the counter by key
     *
     * @memberof MemoryStore
     */
    dec(key: string): Promise<number>;
}
