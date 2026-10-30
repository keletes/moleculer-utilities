"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyRateLimiter = exports.Docs = exports.Authorizer = void 0;
const authorizer_1 = __importDefault(require("./authorizer"));
Object.defineProperty(exports, "Authorizer", { enumerable: true, get: function () { return authorizer_1.default; } });
const docs_1 = require("./docs");
Object.defineProperty(exports, "Docs", { enumerable: true, get: function () { return docs_1.Docs; } });
const key_rate_limiter_1 = require("./key-rate-limiter");
Object.defineProperty(exports, "KeyRateLimiter", { enumerable: true, get: function () { return key_rate_limiter_1.KeyRateLimiter; } });
