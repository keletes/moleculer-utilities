"use strict";
const { MoleculerError } = require("moleculer").Errors;

module.exports = function Authorizer(opts) {
  return {
    settings: {
      authorizer: {
        //whitelist: []
      },
    },

    hooks: {
      before: {
        "*": async function (ctx) {
          const action = `${ctx.action.service.name}.${ctx.action.rawName}`;
          if (
            this.settings?.authorizer?.whitelist?.indexOf?.(action) >
            -1
          )
            return;

          const authorizer = ctx.meta.authorizer;

          if (authorizer.actions?.indexOf?.(action) < 0)
            throw new MoleculerError(
              "Action not authorized.",
              403,
              "E_NOT_AUTHORIZED"
            );
        },
      },
    },
  };
};
