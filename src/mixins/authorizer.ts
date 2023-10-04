import { Context, Errors, ServiceSchema } from 'moleculer';
const {MoleculerError} = Errors;

interface Options {
  whitelist?: string[]
}

type Schema = Omit<ServiceSchema<Settings>, 'name'>;

interface Meta {
  authorizer: {
    actions: Array<string>
  }
}

interface Settings {
  authorizer: {
    whitelist: [string]
  }
}

export default function Authorizer(opts?: Options): Schema {
  return {
    settings: {
      authorizer: opts
    },

    hooks: {
      before: {
        "*": async function (this: Schema, ctx: Context<null, Meta>) {
          const action = `${ctx.action?.service?.name}.${ctx.action?.rawName}`;
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
