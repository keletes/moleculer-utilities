import { RateLimitStore } from 'moleculer-web';
import type { ServiceBroker } from 'moleculer';
import type { RateLimitSettings } from 'moleculer-web';
import type { RedisClientType } from 'redis';
interface RedisRateLimitSettings extends RateLimitSettings {
    prefix?: string;
    client: RedisClientType;
}
/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
export declare class RedisStore extends RateLimitStore {
    client: RedisClientType;
    clearPeriod: number;
    prefix: string;
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
    inc(key: string, setExpire?: true): Promise<number>;
    /**
     * Decrement the counter by key
     *
     * @memberof MemoryStore
     */
    dec(key: string): Promise<number>;
}
export {};
