"use strict";
const { MoleculerError } = require("moleculer").Errors;

module.exports = function Authorizer(opts) {
  return {
    settings: {
      authorizer: {
        //whitelist: []
      }
    },

    hooks: {
      before: {
        if (whitelist && whitelist.indexOf && whitelist.indexOf(ctx.action.name) > -1)
          return;
        '*': async function(ctx) {
          if (!ctx.meta.role || !ctx.meta.role.actions || !ctx.meta.role.actions.indexOf || ctx.meta.role.actions.indexOf(ctx.action.name) < 0)
            throw new MoleculerError('Action not authorized.', 403, 'E_NOT_AUTHORIZED');
        }
      }
    }
  }
};