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
var _RedisStore_instances, _RedisStore_client, _RedisStore_clearPeriod, _RedisStore_prefix, _RedisStore_broker, _RedisStore_getFullKey;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisStore = void 0;
const extended_rate_limit_store_1 = require("./extended-rate-limit-store");
const moleculer_1 = require("moleculer");
const MoleculerError = moleculer_1.Errors.MoleculerError;
/**
 * Improved memory store for Rate limiter
 *
 * @class MemoryStore
 */
class RedisStore extends extended_rate_limit_store_1.ExtendedRateLimitStore {
    /**
     * @inheritdoc
     */
    constructor(clearPeriod, opts, broker) {
        super(clearPeriod, opts, broker);
        _RedisStore_instances.add(this);
        _RedisStore_client.set(this, void 0);
        _RedisStore_clearPeriod.set(this, void 0);
        _RedisStore_prefix.set(this, void 0);
        _RedisStore_broker.set(this, void 0);
        __classPrivateFieldSet(this, _RedisStore_clearPeriod, clearPeriod, "f");
        __classPrivateFieldSet(this, _RedisStore_broker, broker, "f");
        if (opts?.client) {
            __classPrivateFieldSet(this, _RedisStore_client, opts?.client, "f");
            __classPrivateFieldSet(this, _RedisStore_prefix, opts?.prefix ?? '', "f");
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
    async inc(key, setExpire = true) {
        key = __classPrivateFieldGet(this, _RedisStore_instances, "m", _RedisStore_getFullKey).call(this, key);
        const counter = __classPrivateFieldGet(this, _RedisStore_client, "f").incr(key);
        if (setExpire)
            __classPrivateFieldGet(this, _RedisStore_client, "f").expire(key, __classPrivateFieldGet(this, _RedisStore_clearPeriod, "f") / 1000);
        return counter;
    }
    /**
     * Decrement the counter by key
     *
     * @memberof MemoryStore
     */
    async dec(key) {
        key = __classPrivateFieldGet(this, _RedisStore_instances, "m", _RedisStore_getFullKey).call(this, key);
        if (Number(await __classPrivateFieldGet(this, _RedisStore_client, "f").get(key)) > 0)
            return __classPrivateFieldGet(this, _RedisStore_client, "f").decr(key);
        return 0;
    }
}
exports.RedisStore = RedisStore;
_RedisStore_client = new WeakMap(), _RedisStore_clearPeriod = new WeakMap(), _RedisStore_prefix = new WeakMap(), _RedisStore_broker = new WeakMap(), _RedisStore_instances = new WeakSet(), _RedisStore_getFullKey = function _RedisStore_getFullKey(key) {
    if (__classPrivateFieldGet(this, _RedisStore_prefix, "f"))
        return `${__classPrivateFieldGet(this, _RedisStore_prefix, "f")}${key}`;
    return key;
};
