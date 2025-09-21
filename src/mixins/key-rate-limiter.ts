import { Context, Errors, ServiceSchema } from 'moleculer';
import type { RateLimitStore } from 'moleculer-web';
const { MoleculerClientError, MoleculerError } = Errors;
import type { ServiceHooksBefore } from 'moleculer';
import objectHash from 'object-hash';

// XOR Type from https://medium.com/@aeron169/building-a-xor-type-in-typescript-5f4f7e709a9d
type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
type XOR<T, Tcopy> = T extends object ? Without<Exclude<Tcopy, T>, T> & T : T;

export type LimiterPath = XOR<{timed: number, params?: Record<string, any>}, {concurrent: number, params?: Record<string, any>}>;

export interface Options {
  paths: Record<string, Array<LimiterPath> | undefined>;
  store: RateLimitStore
}


interface Meta {
  apiKey: string;
  authorizer: {
    rateLimiter?: Options["paths"]
  }
}

interface Settings {
  rateLimiter: {
    rules: Options["paths"],
    store: RateLimitStore
  }
}

type Mixin = Partial<ServiceSchema<Settings>>;

export function KeyRateLimiter(opts?: Options): Mixin {
  const rules: Options["paths"] = {'*': undefined};
  for (const path in opts?.paths) {
    if (!rules[path]) rules[path] = [];
    if (opts?.paths[path])
      for (const opt of opts?.paths[path] as Array<LimiterPath>) {
        rules[path]!.push(opt);
      }
  }

  if (!opts?.store) throw new MoleculerError('No store defined for the rate limiter mixin.');

  const hookConstructor = (path: string) => {
    return async function(this: Mixin, ctx: Context<null, Meta>): Promise<void> {
      const store = this.settings!.rateLimiter.store;

      const limiters = this.settings!.rateLimiter.rules[path]!;
      if (ctx.meta.authorizer.rateLimiter?.[path])
        for (const limiter of ctx.meta.authorizer.rateLimiter[path]!) {
          limiters.push(limiter);
        }


      // If no rate limit is set for this path, allow.
      if (!limiters) return;

      for (const limiter of limiters) {
        // setting key object to then compute the unique key based on it.
        const keyObject: Record<string, string> = {
          apiKey: ctx.meta.apiKey,
          path
        };

        // If types are set in the limiter and are matched in the request, increase counter.
        if (limiter.params) {
          let match = 0;
          for (let param in limiter.params) {
            if (limiter.params[param] == ctx.params?.[param]) {
              keyObject[param] = String(limiter.params[param]);
              match++;
            }
          }
          if (match < Object.keys(limiter.params).length) continue;
        }
        const key = objectHash(keyObject);
        const limit = limiter.timed ?? limiter.concurrent;
        const setExpire = limiter.timed ? true : false;
        const counter = await this.store.inc(key, setExpire);
        if (counter >= limit) throw new MoleculerClientError("Rate limit exceeded", 429);
      }

      return;

    }
  };

  const before: ServiceHooksBefore = {};

  for (const rule in rules) {
    before[rule] = hookConstructor(rule);
  }

  return {
    settings: {
      rateLimiter: {
        rules: rules,
        store: opts.store
      }
    },

    hooks: {
      before
    },
  };
};
