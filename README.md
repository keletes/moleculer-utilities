# @keletes/moleculer-utilities

Shared Moleculer mixins, middlewares and request limits of the Keletes services.

```json
"@keletes/moleculer-utilities": "^X.Y.Z"
```

```ts
import { Authorizer, Docs, ValidateEntity } from "@keletes/moleculer-utilities/mixins";
import { InterNamespace, K8sHealthCheck } from "@keletes/moleculer-utilities/middlewares";
import { Limits, LimitExceededError, RateLimitStore, clientIp, PodCpuUsage, BusyGuard } from "@keletes/moleculer-utilities/limits";
```

`Authorizer({ whitelist, implies })`: `implies` maps an action to the permission(s) that also allow it, e.g. `{ "drawer.jobStatus": "drawer.draw", "drawer.jobResult": ["drawer.draw", "drawer.view"] }` (any one suffices). One level only: no transitive chains.

## `InterNamespace`

`InterNamespace(["other"])` starts one broker per listed namespace; `call("action@other")` goes through it. The middleware also sets `broker.interNamespace(namespace)` (typed through a `ServiceBroker` augmentation; throws `Unknown namespace` for a namespace not listed), which reads the live registry of that namespace:

- `services(name?, { withActions }?)`: available services (an empty or missing `name` means every service; `withActions: true` adds each service's `actions`, keyed by action name) with their `settings` (and `name`, `version`, `fullName`, `nodeID`, and the service's `metadata`, e.g. the `Docs` mixin's index in `metadata.docs`), from the local registry, no network call.
- `watch(name, handler)`: `handler(settingsList)` with the settings of every available instance of `name` (possibly empty; an empty `name` means every service of the namespace), once the namespace broker has started and again whenever that result changes. Returns the unsubscribe function.
- `on(event, handler, { group }?)`: subscribes to an event of that namespace (wildcards such as `orders.*` work); `handler(payload, nodeID, eventName)`. Returns an async unsubscribe. A new subscription becomes known to the other namespace's registry shortly after (discovery).

Types `InterNamespaceApi`, `InterNamespaceService` and `InterNamespaceEventOptions` are exported from `@keletes/moleculer-utilities/middlewares`; importing that module is enough for `broker.interNamespace` to type-check.

## `ValidateEntity`

With `ValidateEntity()` the entity is validated on every write: `moleculer-db` runs `settings.entityValidator` on `create` and `insert`, and the mixin adds `update`: the stored entity with the changes applied (respecting `settings.useDotNotation`) goes through `this.validateEntity` before the write, and a failure throws the validator's own error with nothing written. It adds no settings: it reuses `entityValidator` (a function, or a schema compiled by `broker.validator`), does nothing without one, and leaves an unknown id to moleculer-db's 404. The service's own `beforeEntityUpdate` still runs first. The id fields (`_id`, `settings.idField`) are not part of the validated entity. `moleculer-db` is an optional peer dependency (needed only by services using this mixin).

```ts
import DbService from "moleculer-db";
import { ValidateEntity } from "@keletes/moleculer-utilities/mixins";

broker.createService({
	name: "people",
	mixins: [DbService, ValidateEntity()],
	settings: { entityValidator: { name: { type: "string", min: 2 }, age: { type: "number" }, $$strict: true } },
});
```

## `limits`

- `Limits({ store, service, defaults, mode })` broker middleware: per-access-key limits (`concurrent`, `perMinute`, `params`) carried in `ctx.meta.authorizer.limits`, falling back to `defaults`. Opt in per action with `limits: { lease: "call" | "stream" | "manual" }`; a `manual` action calls `this.broker.limits.check(ctx, action, values)` and `this.broker.limits.release(handles)`. Store from `LIMITS_STORE` (`Memory`, `redis://host:6379/2`, `false`; Redis >= 7, optional peer dependency `ioredis` >= 5); `LIMITS_MODE=enforce|shadow|off`. The adapter's own ioredis client pings every 10 s (`pingIntervalMs` option or `LIMITS_STORE_PING_MS`, 0 disables) and enables TCP keep-alive, because idle connections get dropped by the network (conntrack, load balancers) and the first command afterwards would time out. Over a limit: `LimitExceededError` (429 `LIMIT_EXCEEDED`, `data: { retryAfter }`). A store outage never refuses a call. Each store command gives up after 100 ms by default (fail open); set `store: { type: "Redis", options: { url }, timeoutMs: 250 }` or env `LIMITS_STORE_TIMEOUT_MS` (positive integer; the config wins; invalid values fall back to 100 with one warning). A service that blocks the event loop for longer than the timeout (heavy CPU work) can still see timeouts, since the reply is only read after the block; the check yields once to the I/O phase before giving up, but such a service should raise the timeout.
- `RateLimitStore` + `clientIp`: the same stores as moleculer-web's `rateLimit` `StoreFactory` (per-IP flood protection before `authenticate`). Route `rateLimit` option `mode: "enforce" | "shadow" | "off"` (default env `LIMITS_MODE`, else `enforce`): `shadow` never refuses, counts `limits.refused{action="ip",mode="shadow"}` and warns (masked IP) at most every 10 s; `off` makes no store call.
- `PodCpuUsage` (heartbeat `node.cpu` = max of node CPU, pod CPU pressure, pod throttling) and `BusyGuard` (`busyGuard: true`: refuse new work with `QUEUE_FULL` while the pod is over `BUSY_CPU_PRESSURE`).

Install a release tag, not a branch: the compiled files are only in the release commits. See `CLAUDE.md` for development.
