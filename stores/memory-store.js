"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStore = void 0;
const moleculer_web_1 = require("moleculer-web");
/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
class MemoryStore extends moleculer_web_1.RateLimitStore {
    /**
     * @inheritdoc
     */
    constructor(clearPeriod, opts, broker) {
        super(clearPeriod, opts, broker);
        this.hits = new Map();
        this.resetTime = Date.now() + clearPeriod;
        this.timer = setInterval(() => {
            this.resetTime = Date.now() + clearPeriod;
            this.reset();
        }, clearPeriod);
        this.timer.unref();
    }
    /**
     * @inheritdoc
     */
    inc(key) {
        let counter = this.hits.get(key) || 0;
        counter++;
        this.hits.set(key, counter);
        return counter;
    }
    /**
     * Decrement the counter by key
     *
     * @memberof MemoryStore
     */
    dec(key) {
        let counter = this.hits.get(key) || 0;
        counter--;
        this.hits.set(key, counter);
        return counter;
    }
    /**
     * @inheritdoc
     */
    reset() {
        this.hits.clear();
    }
}
exports.MemoryStore = MemoryStore;
module.exports = MemoryStore;
