"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _MemoryStore_hits, _MemoryStore_timer;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStore = void 0;
const extended_rate_limit_store_1 = require("./extended-rate-limit-store");
/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
class MemoryStore extends extended_rate_limit_store_1.ExtendedRateLimitStore {
    /**
     * @inheritdoc
     */
    constructor(clearPeriod, opts, broker) {
        super(clearPeriod, opts, broker);
        _MemoryStore_hits.set(this, new Map());
        _MemoryStore_timer.set(this, void 0);
        this.resetTime = Date.now() + clearPeriod;
        __classPrivateFieldSet(this, _MemoryStore_timer, setInterval(() => {
            this.resetTime = Date.now() + clearPeriod;
            this.reset();
        }, clearPeriod), "f");
        __classPrivateFieldGet(this, _MemoryStore_timer, "f").unref();
    }
    /**
     * Increment the counter by key
     * @param {String} key
     * @param {boolean} setExpire - Whether the key should automatically expire based on the set window
     * @returns {Number}
     * @memberof MemoryStore
     */
    async inc(key, setExpire) {
        let counter = __classPrivateFieldGet(this, _MemoryStore_hits, "f").get(key) || 0;
        counter++;
        __classPrivateFieldGet(this, _MemoryStore_hits, "f").set(key, counter);
        return counter;
    }
    /**
     * Decrement the counter by key
     *
     * @param {String} key
     * @returns {Number}
     * @memberof MemoryStore
     */
    dec(key) {
        let counter = __classPrivateFieldGet(this, _MemoryStore_hits, "f").get(key) || 0;
        counter--;
        __classPrivateFieldGet(this, _MemoryStore_hits, "f").set(key, counter);
        return counter;
    }
    /**
     * @inheritdoc
     */
    reset() {
        __classPrivateFieldGet(this, _MemoryStore_hits, "f").clear();
    }
}
exports.MemoryStore = MemoryStore;
_MemoryStore_hits = new WeakMap(), _MemoryStore_timer = new WeakMap();
