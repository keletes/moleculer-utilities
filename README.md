# @keletes/moleculer-utilities

Shared Moleculer mixins, middlewares and request limits of the Keletes services.

```json
"@keletes/moleculer-utilities": "^X.Y.Z"
```

```ts
import { Authorizer, Docs } from "@keletes/moleculer-utilities/mixins";
import { InterNamespace, K8sHealthCheck } from "@keletes/moleculer-utilities/middlewares";
import { Limits, LimitExceededError, RateLimitStore, clientIp, PodCpuUsage, BusyGuard } from "@keletes/moleculer-utilities/limits";
```

`Authorizer({ whitelist, implies })`: `implies` maps an action to the permission(s) that also allow it, e.g. `{ "drawer.jobStatus": "drawer.draw", "drawer.jobResult": ["drawer.draw", "drawer.view"] }` (any one suffices). One level only: no transitive chains.

## `limits`

- `Limits({ store, service, defaults, mode })` broker middleware: per-access-key limits (`concurrent`, `perMinute`, `params`) carried in `ctx.meta.authorizer.limits`, falling back to `defaults`. Opt in per action with `limits: { lease: "call" | "stream" | "manual" }`; a `manual` action calls `this.broker.limits.check(ctx, action, values)` and `this.broker.limits.release(handles)`. Store from `LIMITS_STORE` (`Memory`, `redis://host:6379/2`, `false`; Redis >= 7, optional peer dependency `redis`); `LIMITS_MODE=enforce|shadow|off`. Over a limit: `LimitExceededError` (429 `LIMIT_EXCEEDED`, `data: { retryAfter }`). A store outage never refuses a call.
- `RateLimitStore` + `clientIp`: the same stores as moleculer-web's `rateLimit` `StoreFactory` (per-IP flood protection before `authenticate`). Route `rateLimit` option `mode: "enforce" | "shadow" | "off"` (default env `LIMITS_MODE`, else `enforce`): `shadow` never refuses, counts `limits.refused{action="ip",mode="shadow"}` and warns (masked IP) at most every 10 s; `off` makes no store call.
- `PodCpuUsage` (heartbeat `node.cpu` = max of node CPU, pod CPU pressure, pod throttling) and `BusyGuard` (`busyGuard: true`: refuse new work with `QUEUE_FULL` while the pod is over `BUSY_CPU_PRESSURE`).

Install a release tag, not a branch: the compiled files are only in the release commits. See `CLAUDE.md` for development.
