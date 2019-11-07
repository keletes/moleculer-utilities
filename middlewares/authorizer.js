"use strict";
const { MoleculerError } = require("moleculer").Errors;

module.exports = function Authorizer(opts) {
  return {
    hooks: {
      before: {
        '*': 'authorize'
      }
    },

    methods: {
      async authorize(ctx) {
        if (ctx.meta.role.actions.indexOf(ctx.action.name) < 0)
          throw new MoleculerError('Action not authorized.', 403, 'E_NOT_AUTHORIZED');
      }
    }
  }
};