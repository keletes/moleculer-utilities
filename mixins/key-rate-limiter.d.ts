import { ServiceSchema } from 'moleculer';
import type { RateLimitStore } from 'moleculer-web';
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
    store: RateLimitStore;
}
interface Settings {
    rateLimiter: {
        rules: Options["paths"];
        store: RateLimitStore;
    };
}
type Mixin = Partial<ServiceSchema<Settings>>;
export declare function KeyRateLimiter(opts?: Options): Mixin;
export {};
