import { Context, Errors, ActionSchema, ServiceSchema } from 'moleculer';
import { ExtendedRateLimitStore } from '../stores/extended-rate-limit-store';
import type ApiGatewayService from 'moleculer-web';
import type { Alias, RateLimitSettings, Route } from 'moleculer-web';
const { MoleculerClientError, MoleculerError } = Errors;
import type { Service, ServiceHooksBefore } from 'moleculer';
import objectHash from 'object-hash';
import forIn from 'lodash.forin';
import isArray from 'lodash.isarray';
import isEqual from 'lodash.isequal';
import isObject from 'lodash.isobject';
import isString from 'lodash.isstring';

// @ts-ignore
import { removeTrailingSlashes, addSlashes, normalizePath } from '../utils.js';

const { ServiceNotFoundError } = Errors;


// XOR Type from https://medium.com/@aeron169/building-a-xor-type-in-typescript-5f4f7e709a9d
type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
type XOR<T, Tcopy> = T extends object ? Without<Exclude<Tcopy, T>, T> & T : T;

export type LimiterPath = XOR<{timed: number, params?: Record<string, any>}, {concurrent: number, params?: Record<string, any>}>;

export interface Options {
  paths: Record<string, Array<LimiterPath> | undefined>;
}

interface Meta {
  apiKey: string;
  authorizer: {
    rateLimits?: Options["paths"];
  }
}

export interface ExtendedRateLimiterSettings extends RateLimitSettings {
  StoreFactory?: new (...args: ConstructorParameters<typeof ExtendedRateLimitStore>) => ExtendedRateLimitStore;
  store?: ExtendedRateLimitStore;
  apiService: string;
  [key: string]: any;
}

interface Settings {
  rateLimit: ExtendedRateLimiterSettings;
}

type Mixin = Partial<ServiceSchema<Settings>>;

function getServiceFullname(svc: Service) {
  if (svc.version != null && svc.settings.$noVersionPrefix !== true)
    return (typeof (svc.version) == "number" ? "v" + svc.version : svc.version) + "." + svc.name;

  return svc.name;
}

const SLASH_REGEX = new RegExp(/\./g);

export function KeyRateLimiter(opts?: Options): Mixin {
  /*const rules: Options["paths"] = {'*': undefined};
  for (const path in opts?.paths) {
    if (!rules[path]) rules[path] = [];
    if (opts?.paths[path])
      for (const opt of opts?.paths[path] as Array<LimiterPath>) {
        rules[path]!.push(opt);
      }
  }

  const hookConstructor = (path: string) => {
    return async function(this: Mixin, ctx: Context<null, Meta>): Promise<void> {
      // If it’s not from the API, allow it.
      const store = this.rateLimitStore;
      if (!store) throw new MoleculerError('No store defined for the rate limiter mixin.');

      let limiters = rules[path]!;
      if (ctx.meta.authorizer.rateLimits?.[path])
        for (const limiter of ctx.meta.authorizer.rateLimits[path]!) {
          // Filtering out limiters with the same params
          limiters = limiters.filter((el) => !isEqual(el.params, limiter.params));
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
        const counter = await store.inc(key, setExpire);
        if (counter >= limit) {
          // If reached limit, we decrease it in case it’s concurrent, to allow
          // a correct count (we always increase at first)
          if (!setExpire) store.dec(key);
          throw new MoleculerClientError("Rate limit exceeded", 429);
        }
      }

      return;

    }
  };

  const before: ServiceHooksBefore = {};

  for (const rule in rules) {
    before[rule] = hookConstructor(rule);
  }*/

  // Mixin to join with service definition.
  return {

    /**
     * Regenerate aliases automatically if service registry has been changed.
     *
     * @param {Route} route
     */
    regenerateAutoAliases(this: typeof ApiGatewayService, route: Route) {
      this.logRouteRegistration(`♻ Generate aliases for '${route.path}' route...`);

      // Clean previous aliases for this route
      this.aliases = this.aliases.filter((alias: Alias) => alias.route != route || !alias._generated);

      const processedServices = new Set();

      const services = this.broker.registry.getServiceList({ withActions: true, grouping: true });
      services.forEach((service: Service) => {
        if(!service.settings) return;
        const serviceName = service.fullName || getServiceFullname(service);

        let basePaths = [];
        if (isString(service.settings.rest)) {
          basePaths = [service.settings.rest];
        } else if (isArray(service.settings.rest)) {
          basePaths = service.settings.rest;
        } else {
          basePaths = [serviceName.replace(SLASH_REGEX, "/")];
        }

        // Skip multiple instances of services
        if (processedServices.has(serviceName)) return;

        for (let basePath of basePaths) {
          basePath = addSlashes(isString(basePath) ? basePath : serviceName.replace(SLASH_REGEX, "/"));

          forIn(service.actions, (action: ActionSchema) => {
            if (action.rest) {
              // Check visibility
              if (action.visibility != null && action.visibility != "published") return;

              // Check whitelist
              if (route.hasWhitelist && !this.checkWhitelist(route, action.name)) return;

              // Blacklist check
              if (route.hasBlacklist) {
                if (this.checkBlacklist(route, action.name)) {
                  this.logger.debug(
                    `  The '${action.name}' action is in the blacklist!`
                  );
                  throw new ServiceNotFoundError({
                    action: action.name,
                  });
                }
              }

              let restRoutes = [];
              if (!isArray(action.rest)) {
                restRoutes = [action.rest];
              } else {
                restRoutes = action.rest;
              }

              for (let restRoute of restRoutes) {
                let alias = null;

                if (isString(restRoute)) {
                  alias = this.parseActionRestString(restRoute, basePath);
                } else if (isObject(restRoute)) {
                  alias = this.parseActionRestObject(restRoute, action.rawName, basePath);
                }

                if (alias) {
                  alias.path = removeTrailingSlashes(normalizePath(alias.path));
                  alias._generated = true;
                  this.aliases.push(this.createAlias(route, alias, action.name));
                }
              }
            }

            processedServices.add(serviceName);
          });
        }
      });

      if (this.settings?.optimizeOrder) {
        this.optimizeAliasesOrder();
      }
    },

  }
};
