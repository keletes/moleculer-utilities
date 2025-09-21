import type { RateLimitSettings } from 'moleculer-web';
import type { ServiceBroker } from 'moleculer';
export declare abstract class ExtendedRateLimitStore {
    resetTime: number;
    constructor(clearPeriod: number, opts?: RateLimitSettings, broker?: ServiceBroker);
    inc(key: string, setExpire?: boolean): number | Promise<number>;
}
