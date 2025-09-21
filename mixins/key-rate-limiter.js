"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyRateLimiter = void 0;
const moleculer_1 = require("moleculer");
const memory_store_1 = require("../stores/memory-store");
const { MoleculerClientError, MoleculerError } = moleculer_1.Errors;
const object_hash_1 = __importDefault(require("object-hash"));
const lodash_isequal_1 = __importDefault(require("lodash.isequal"));
function KeyRateLimiter(opts) {
    const rules = { '*': undefined };
    for (const path in opts?.paths) {
        if (!rules[path])
            rules[path] = [];
        if (opts?.paths[path])
            for (const opt of opts?.paths[path]) {
                rules[path].push(opt);
            }
    }
    const hookConstructor = (path) => {
        return async function (ctx) {
            // If it’s not from the API, allow it.
            if (ctx.caller != this.settings?.rateLimit?.apiService)
                return;
            const store = this.rateLimitStore;
            if (!store)
                throw new MoleculerError('No store defined for the rate limiter mixin.');
            let limiters = rules[path];
            if (ctx.meta.authorizer.rateLimits?.[path])
                for (const limiter of ctx.meta.authorizer.rateLimits[path]) {
                    // Filtering out limiters with the same params
                    limiters = limiters.filter((el) => !(0, lodash_isequal_1.default)(el.params, limiter.params));
                    limiters.push(limiter);
                }
            // If no rate limit is set for this path, allow.
            if (!limiters)
                return;
            for (const limiter of limiters) {
                // setting key object to then compute the unique key based on it.
                const keyObject = {
                    apiKey: ctx.meta.apiKey,
                    path
                };
                // If types are set in the limiter and are matched in the request, increase counter.
                if (limiter.params) {
                    let match = 0;
                    for (let param in limiter.params) {
                        if (limiter.params[param] == ctx.params?.[param]) {
                            keyObject[param] = String(limiter.params[param]);
                            match++;
                        }
                    }
                    if (match < Object.keys(limiter.params).length)
                        continue;
                }
                const key = (0, object_hash_1.default)(keyObject);
                const limit = limiter.timed ?? limiter.concurrent;
                const setExpire = limiter.timed ? true : false;
                const counter = await store.inc(key, setExpire);
                if (counter >= limit) {
                    // If reached limit, we decrease it in case it’s concurrent, to allow
                    // a correct count (we always increase at first)
                    if (!setExpire)
                        store.dec(key);
                    throw new MoleculerClientError("Rate limit exceeded", 429);
                }
            }
            return;
        };
    };
    const before = {};
    for (const rule in rules) {
        before[rule] = hookConstructor(rule);
    }
    // Mixin to join with service definition.
    return {
        settings: {
            rateLimit: {
                apiService: 'api',
            }
        },
        hooks: {
            before
        },
        started() {
            const opts = this.settings?.rateLimit;
            const Factory = opts.StoreFactory ?? memory_store_1.MemoryStore;
            this.rateLimitStore = new Factory(opts.window ?? 0, opts, this.broker);
        }
    };
}
exports.KeyRateLimiter = KeyRateLimiter;
;
