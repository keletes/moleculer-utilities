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
        '*': async function(ctx) {
          if (this.settings.authorizer &&
              this.settings.authorizer.whitelist &&
              this.settings.authorizer.whitelist.indexOf &&
              this.settings.authorizer.whitelist.indexOf(ctx.action.name) > -1
          )
            return;
          if (!ctx.meta.authorizedActions || !ctx.meta.role.authorizedActions.indexOf || ctx.meta.role.authorizedActions.indexOf(ctx.action.name) < 0)
            throw new MoleculerError('Action not authorized.', 403, 'E_NOT_AUTHORIZED');
        }
      }
    }
  }
};