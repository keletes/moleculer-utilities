"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const middlewares_1 = __importDefault(require("./middlewares"));
const mixins_1 = __importDefault(require("./mixins"));
exports.default = { middlewares: middlewares_1.default, mixins: mixins_1.default };
