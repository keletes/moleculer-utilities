import { ServiceSchema } from 'moleculer';
import { ExtendedRateLimitStore } from '../stores/extended-rate-limit-store';
import type { RateLimitSettings } from 'moleculer-web';
type Without<T, U> = {
    [P in Exclude<keyof T, keyof U>]?: never;
};
type XOR<T, Tcopy> = T extends object ? Without<Exclude<Tcopy, T>, T> & T : T;
export type LimiterPath = XOR<{
    timed: number;
    params?: Record<string, any>;
}, {
    concurrent: number;
    params?: Record<string, any>;
}>;
export interface Options {
    paths: Record<string, Array<LimiterPath> | undefined>;
}
export interface ExtendedRateLimiterSettings extends RateLimitSettings {
    StoreFactory?: new (...args: ConstructorParameters<typeof ExtendedRateLimitStore>) => ExtendedRateLimitStore;
    store?: ExtendedRateLimitStore;
    apiService: string;
    [key: string]: any;
}
interface Settings {
    rateLimit: ExtendedRateLimiterSettings;
}
type Mixin = Partial<ServiceSchema<Settings>>;
export declare function KeyRateLimiter(opts?: Options): Mixin;
export {};
