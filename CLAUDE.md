# @keletes/moleculer-utilities

Shared Moleculer pieces for the Keletes services, published to GitHub Packages as `@keletes/moleculer-utilities` and imported by subpath: `@keletes/moleculer-utilities/mixins` (`Authorizer`, `Docs`), `/middlewares` (`InterNamespace`, `K8sHealthCheck`) and `/limits` (`Limits`, `LimitExceededError`, `RateLimitStore`, `clientIp`, `PodCpuUsage`, `BusyGuard`, the store adapters). `stores` and `KeyRateLimiter` were removed (0.x minor, by decision). Public repo: nothing specific to a service, no secret, no hostname.

## Commands

```
yarn verify    # typecheck + lint + test
yarn build     # tsc -> mixins/, middlewares/, limits/, utils/ at the package root
yarn test      # builds first, then jest (the layout spec imports the built folders)
REDIS_URL=redis://localhost:6379/15 yarn verify:int   # the store contract against a real Redis >= 7 (throwaway DB)
```

## The `Docs` mixin

`Docs({ dir, version })` (`src/mixins/docs.ts`) serves a folder of markdown (front matter `title` + `summary`, topic id = path without `.md`) as the authoring documentation of a service: `docs.list` (`{version, topics:[{id,title,summary,hash}]}`) and `docs.get({topic})`, and the same index in `metadata.docs` (the texts never go into metadata: it travels in every node's info). A malformed file throws in `created()`, so a broken doc stops the service. Actions are `public` (reachable from other namespaces), never have a `rest` alias, and are not covered by `Authorizer` unless the service whitelists them.

## The `Authorizer` mixin

`Authorizer({ whitelist?, implies? })` (`src/mixins/authorizer.ts`, options type `AuthorizerOptions`) adds a `before "*"` hook: an action (`"<service>.<rawName>"`, unversioned) passes if it is in `whitelist`, then if `ctx.meta.authorizer.actions` lists it, then if that list holds a permission implied for it; otherwise 403 `E_NOT_AUTHORIZED`.

`implies` maps the action being called to the permission(s) that also allow it (string or array, any one suffices): `Authorizer({ implies: { "drawer.jobStatus": "drawer.draw", "drawer.jobResult": ["drawer.draw", "drawer.view"] } })`. One level only, no transitive chains: write each chain out. It is normalised once at mixin creation and read with own-property lookups, so `__proto__`/`toString` keys grant nothing.

## The `limits` subpath

Plan: `Servizi/docs/plans/request-control.md`. Source in `src/limits/`.

- **Stores** (`adapters/`): `resolveStore(config)` like Moleculer's `cacher` (`"Memory"`, `"redis://..."`, `{ type, options: { url | client, prefix } }`, `false`, a ready store). Interface `hit(key, perMinute, windowMs?)`, `acquire(key, cap, leaseId, ttlMs)`, `renew`, `release`, `start`, `stop`; all fail open (allow, warn at most every 10 s, `onError` for the `limits.store.errors` metric) and give up after 100 ms. Redis: client is **`ioredis`** (optional peer dependency `>=5`, the one Redis client of every Keletes service: Moleculer's Redis cacher only supports it; a missing package fails open with an error naming it). No Lua, plain commands in `MULTI` (ioredis `exec()` resolves `[error, result][]`: the adapter throws on a failed pair, so it fails open), needs **Redis >= 7** (`PEXPIRE ... NX`), own client with `lazyConnect` + the offline queue off, connected in the background (`start()` never blocks). The own client pings every 10 s (`pingIntervalMs`, env `LIMITS_REDIS_PING_MS`, 0 disables; ioredis has no ping option, so an unref'd timer calls `ping()`, cleared in `stop()`) and sets TCP keep-alive: a network hop (conntrack, Cilium, a load balancer) drops idle connections, and the first command after that paid a reconnect longer than the 100 ms timeout ("limits store timeout" every ~5 min on idle pods). A failing ping goes to the rate-limited warn. Injected clients are the caller's. `hit` is a fixed window per key (refused hits count); `acquire` is an optimistic lease on a sorted set (never over-admits, a race for the last slot may refuse both). The adapter's `acquire` returns `retryAfterMs: 0`: the `concurrent` hint is the middleware's (`concurrentRetryAfter`, 5 s).
- **`Limits({ store, service, defaults, mode })`** broker middleware (`localAction`): action schema `limits: { lease?: "call" | "stream" | "manual" }`. Reach the manual API as `this.broker.limits.check(ctx, "<service>.<action>", values)` and `.release(handles)` (the middleware sets `broker.limits` in `created`). A handle embeds the counter key and lease id, so any replica on the same store can release it. `service` names the default prefix `limits:<namespace>:<service>:` (pass it, or two services on one Redis share counters). Env: `LIMITS_STORE`, `LIMITS_MODE=enforce|shadow|off` (off: no store call, the store is not even started). Counters are `<access key id>:<action>:<hash of the rule>`; the raw key never enters a store key, an error or a log line. Rules: the key's `ctx.meta.authorizer.limits[action]` (any entry, even `[]`, replaces the defaults) else `defaults`; `params` is an AND subset match (`matchParams`), no operators.
- **`RateLimitStore`**: a moleculer-web `rateLimit.StoreFactory`; `inc` throws `LimitExceededError` with the time left, swallows store errors. Option `mode: "enforce" | "shadow" | "off"` (route `rateLimit` settings; default env `LIMITS_MODE`, else `enforce`), same meaning as the middleware's: `shadow` counts, returns `min(count, limit)` so moleculer-web (`remaining = limit - inc`, throws below 0) lets the request through, increments `limits.refused` `{ action: "ip", mode: "shadow" }` (registered unless the middleware already did: re-registering resets the counter) and warns at most every 10 s with the /24 or /48 prefix only; `off` makes no store call (store not started), `inc` returns 0. moleculer-web route settings are deep-cloned by Moleculer: give it a URL or `{ type: "Redis", options: { url } }` in `limitsStore`, never a live client object (it would be cloned, not shared).
- **`PodCpuUsage`** replaces `broker.getCpuUsage` (max of the `os.cpus()` sample, cgroup v2 PSI `cpu.pressure` `some avg10`, `cpu.stat` throttling when `cpu.max` is set); **`BusyGuard`** (`busyGuard: true` on an action) refuses with `QueueIsFullError` while `broker.registry.nodes.localNode.cpu` is over `BUSY_CPU_PRESSURE`; user middlewares sit inside the internal bulkhead, so it runs after the bulkhead's slot is taken. It rejects the promise instead of throwing: a synchronous throw would escape `broker.call`.
- Tests: `test/limits.spec.ts` runs one store contract (`test/helpers/store-suite.ts`) against Memory and Redis (`test/helpers/fake-redis.ts`, a `MULTI`-capable mock with ioredis' lowercase commands); `test/limits.redis.int.ts` runs the same contract on a real Redis.

## Shape of this repo

- Source is `src/<folder>/`. `yarn build` compiles it to the same folder names at the **package root**, which is what consumers import (`@keletes/moleculer-utilities/mixins`). Do not move the output (no `dist/`): it would break every import.
- The built folders are git-ignored and never committed: the release builds them and publishes them in the package (`files`). Consumers import `@keletes/moleculer-utilities/...` directly; they need an `.npmrc` with `@keletes:registry=https://npm.pkg.github.com` and a token with `read:packages`.
- Node 22 (`engines`); `moleculer` is a peer dependency.
- Tests are `test/*.spec.ts` (jest, ts-jest). `test/layout.spec.ts` guards the public surface of the built package.

## Releases: trunk-based, Conventional Commits

Same as the other repos: PR titles are Conventional Commits (`pr-title.yml`), `tag.yml` runs `semantic-release` on `master`, which tags `vX.Y.Z`, creates the GitHub release and publishes the package to GitHub Packages; no release commit goes back to `master`, and `package.json` keeps the placeholder version `0.0.0-development`. `fix:` patch, `feat:` minor, `feat!:`/`BREAKING CHANGE:` major (a rename or removal of an export is breaking); `chore:`/`docs:`/`refactor:`/`test:`/`ci:`/`build:` release nothing. The tag workflow needs the org's `DEPLOY_APP_*` secrets and the app installed on this repo. Do not bump the version or push a `v*` tag by hand.

Default branch: `master`. Work on a branch, never on `master`.

## Gotchas

- **Moleculer first:** for any structural, broker, transport or service-level change, prefer Moleculer's built-in features (bulkhead, `retryPolicy`, circuit breaker, timeouts, balancer strategies, caching, validators, middlewares, events, streams) over custom code; write custom code only when no built-in fits, and say why in a comment. Check `node_modules/moleculer/src` for the installed version's behaviour.
