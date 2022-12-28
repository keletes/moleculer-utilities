"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const moleculer_1 = require("moleculer");
const { MoleculerError } = moleculer_1.Errors;
function Authorizer(opts) {
    return {
        settings: {
            authorizer: {
            //whitelist: []
            },
        },
        hooks: {
            before: {
                "*": function (ctx) {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return __awaiter(this, void 0, void 0, function* () {
                        const action = `${(_b = (_a = ctx.action) === null || _a === void 0 ? void 0 : _a.service) === null || _b === void 0 ? void 0 : _b.name}.${(_c = ctx.action) === null || _c === void 0 ? void 0 : _c.rawName}`;
                        if (((_g = (_f = (_e = (_d = this.settings) === null || _d === void 0 ? void 0 : _d.authorizer) === null || _e === void 0 ? void 0 : _e.whitelist) === null || _f === void 0 ? void 0 : _f.indexOf) === null || _g === void 0 ? void 0 : _g.call(_f, action)) >
                            -1)
                            return;
                        const authorizer = ctx.meta.authorizer;
                        if (((_j = (_h = authorizer.actions) === null || _h === void 0 ? void 0 : _h.indexOf) === null || _j === void 0 ? void 0 : _j.call(_h, action)) < 0)
                            throw new MoleculerError("Action not authorized.", 403, "E_NOT_AUTHORIZED");
                    });
                },
            },
        },
    };
}
exports.default = Authorizer;
;
