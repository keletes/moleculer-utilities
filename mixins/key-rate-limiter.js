"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyRateLimiter = KeyRateLimiter;
const moleculer_1 = require("moleculer");
const { MoleculerClientError, MoleculerError } = moleculer_1.Errors;
const lodash_forin_1 = __importDefault(require("lodash.forin"));
const lodash_isarray_1 = __importDefault(require("lodash.isarray"));
const lodash_isobject_1 = __importDefault(require("lodash.isobject"));
const lodash_isstring_1 = __importDefault(require("lodash.isstring"));
const path_1 = require("../utils/path");
const { ServiceNotFoundError } = moleculer_1.Errors;
function getServiceFullname(svc) {
    if (svc.version != null && svc.settings.$noVersionPrefix !== true)
        return (typeof (svc.version) == "number" ? "v" + svc.version : svc.version) + "." + svc.name;
    return svc.name;
}
const SLASH_REGEX = new RegExp(/\./g);
function KeyRateLimiter(opts) {
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
        regenerateAutoAliases(route) {
            this.logRouteRegistration(`♻ Generate aliases for '${route.path}' route...`);
            // Clean previous aliases for this route
            this.aliases = this.aliases.filter((alias) => alias.route != route || !alias._generated);
            const processedServices = new Set();
            const services = this.broker.registry.getServiceList({ withActions: true, grouping: true });
            services.forEach((service) => {
                if (!service.settings)
                    return;
                const serviceName = service.fullName || getServiceFullname(service);
                let basePaths = [];
                if ((0, lodash_isstring_1.default)(service.settings.rest)) {
                    basePaths = [service.settings.rest];
                }
                else if ((0, lodash_isarray_1.default)(service.settings.rest)) {
                    basePaths = service.settings.rest;
                }
                else {
                    basePaths = [serviceName.replace(SLASH_REGEX, "/")];
                }
                // Skip multiple instances of services
                if (processedServices.has(serviceName))
                    return;
                for (let basePath of basePaths) {
                    basePath = (0, path_1.addSlashes)((0, lodash_isstring_1.default)(basePath) ? basePath : serviceName.replace(SLASH_REGEX, "/"));
                    (0, lodash_forin_1.default)(service.actions, (action) => {
                        if (action.rest) {
                            // Check visibility
                            if (action.visibility != null && action.visibility != "published")
                                return;
                            // Check whitelist
                            if (route.hasWhitelist && !this.checkWhitelist(route, action.name))
                                return;
                            // Blacklist check
                            if (route.hasBlacklist) {
                                if (this.checkBlacklist(route, action.name)) {
                                    this.logger.debug(`  The '${action.name}' action is in the blacklist!`);
                                    throw new ServiceNotFoundError({
                                        action: action.name,
                                    });
                                }
                            }
                            let restRoutes = [];
                            if (!(0, lodash_isarray_1.default)(action.rest)) {
                                restRoutes = [action.rest];
                            }
                            else {
                                restRoutes = action.rest;
                            }
                            for (const restRoute of restRoutes) {
                                let alias = null;
                                if ((0, lodash_isstring_1.default)(restRoute)) {
                                    alias = this.parseActionRestString(restRoute, basePath);
                                }
                                else if ((0, lodash_isobject_1.default)(restRoute)) {
                                    alias = this.parseActionRestObject(restRoute, action.rawName, basePath);
                                }
                                if (alias) {
                                    alias.path = (0, path_1.removeTrailingSlashes)((0, path_1.normalizePath)(alias.path));
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
    };
}
