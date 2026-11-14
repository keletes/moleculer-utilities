import { Context, Errors, ServiceSchema } from "moleculer";
const {MoleculerError} = Errors;

export interface AuthorizerOptions {
  /** Actions (`"<service>.<rawName>"`) callable without authorization. */
  whitelist?: string[]
  /**
   * Key: the action being called. Value: permission(s) that ALSO allow it
   * (any one suffices). One level only: an implied permission does not imply others.
   */
  implies?: Record<string, string | string[]>
}

type Schema = Omit<ServiceSchema<Settings>, "name">;

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

export default function Authorizer(opts?: AuthorizerOptions): Schema {
	// Normalised once: own properties only, so "__proto__"/"toString" never match.
	const implied = new Map<string, string[]>();
	if (opts?.implies && typeof opts.implies === "object") {
		for (const key of Object.keys(opts.implies)) {
			const value = opts.implies[key];
			const list = (Array.isArray(value) ? value : [value]).filter((p) => typeof p === "string");
			if (list.length) implied.set(key, list);
		}
	}

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

					// If unauthenticated or unauthorized, return 403
					if (authorizer?.actions?.indexOf?.(action) >= 0)
						return;
					const alternatives = implied.get(action);
					if (alternatives?.some((p) => authorizer?.actions?.indexOf?.(p) >= 0))
						return;
					throw new MoleculerError(
						"Action not authorized.",
						403,
						"E_NOT_AUTHORIZED"
					);
				},
			},
		},
	};
}
