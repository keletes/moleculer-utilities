"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyRateLimiter = void 0;
const moleculer_1 = require("moleculer");
const { MoleculerClientError, MoleculerError } = moleculer_1.Errors;
const object_hash_1 = __importDefault(require("object-hash"));
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
    if (!opts?.store)
        throw new MoleculerError('No store defined for the rate limiter mixin.');
    const hookConstructor = (path) => {
        return async function (ctx) {
            const store = this.settings.rateLimiter.store;
            const limiters = this.settings.rateLimiter.rules[path];
            if (ctx.meta.authorizer.rateLimiter?.[path])
                for (const limiter of ctx.meta.authorizer.rateLimiter[path]) {
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
                const counter = await this.store.inc(key, setExpire);
                if (counter >= limit)
                    throw new MoleculerClientError("Rate limit exceeded", 429);
            }
            return;
        };
    };
    const before = {};
    for (const rule in rules) {
        before[rule] = hookConstructor(rule);
    }
    return {
        settings: {
            rateLimiter: {
                rules: rules,
                store: opts.store
            }
        },
        hooks: {
            before
        },
    };
}
exports.KeyRateLimiter = KeyRateLimiter;
;
