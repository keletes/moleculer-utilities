"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const moleculer_1 = require("moleculer");
const { MoleculerError } = moleculer_1.Errors;
function Authorizer(opts) {
    return {
        settings: {
            authorizer: opts
        },
        hooks: {
            before: {
                "*": async function (ctx) {
                    const action = `${ctx.action?.service?.name}.${ctx.action?.rawName}`;
                    if (this.settings?.authorizer?.whitelist?.indexOf?.(action) >
                        -1)
                        return;
                    const authorizer = ctx.meta.authorizer;
                    // If unauthenticated or unauthorized, return 403
                    if (authorizer?.actions?.indexOf?.(action) >= 0)
                        return;
                    throw new MoleculerError("Action not authorized.", 403, "E_NOT_AUTHORIZED");
                },
            },
        },
    };
}
exports.default = Authorizer;
;
