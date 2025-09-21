/// <reference types="node" />
import { RateLimitStore } from 'moleculer-web';
import type { ServiceBroker } from 'moleculer';
import type { RateLimitSettings } from 'moleculer-web';
/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
export declare class MemoryStore extends RateLimitStore {
    hits: Map<string, number>;
    timer: NodeJS.Timer;
    /**
     * @inheritdoc
     */
    constructor(clearPeriod: number, opts?: RateLimitSettings, broker?: ServiceBroker | undefined);
    /**
     * @inheritdoc
     */
    inc(key: string): number;
    /**
     * Decrement the counter by key
     *
     * @memberof MemoryStore
     */
    dec(key: string): number;
    /**
     * @inheritdoc
     */
    reset(): void;
}
