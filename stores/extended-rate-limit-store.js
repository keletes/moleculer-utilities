"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtendedRateLimitStore = void 0;
class ExtendedRateLimitStore {
    constructor(clearPeriod, opts, broker) { this.resetTime = 0; }
    inc(key, setExpire) {
        return 0;
    }
}
exports.ExtendedRateLimitStore = ExtendedRateLimitStore;
