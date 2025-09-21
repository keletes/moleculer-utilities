"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisStore = void 0;
const moleculer_web_1 = require("moleculer-web");
const moleculer_1 = require("moleculer");
const MoleculerError = moleculer_1.Errors.MoleculerError;
/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
class RedisStore extends moleculer_web_1.RateLimitStore {
    /**
     * @inheritdoc
     */
    constructor(clearPeriod, opts, broker) {
        super(clearPeriod, opts, broker);
        this.clearPeriod = clearPeriod;
        if (opts?.client) {
            this.client = opts?.client;
            this.prefix = opts?.prefix ?? '';
        }
        else {
            throw new MoleculerError('No Redis client defined in rate limiter options.');
        }
    }
    /**
     * Increment the counter by key
     * @param {String} key
     * @param {boolean} setExpire - Whether the key should automatically expire based on the set window
     * @returns {Number}
     * @memberof MemoryStore
     */
    async inc(key, setExpire) {
        if (this.prefix)
            key = `${this.prefix}${key}`;
        const counter = this.client.incr(key);
        if (setExpire)
            this.client.expire(key, this.clearPeriod);
        return counter;
    }
    /**
     * Decrement the counter by key
     *
     * @memberof MemoryStore
     */
    async dec(key) {
        if (this.prefix)
            key = `${this.prefix}${key}`;
        const counter = this.client.decr(key);
        return counter;
    }
}
exports.RedisStore = RedisStore;
module.exports = RedisStore;
