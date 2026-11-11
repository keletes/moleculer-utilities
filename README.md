# @keletes/moleculer-utilities

Shared Moleculer mixins, middlewares and rate-limit stores of the Keletes services.

```json
"@keletes/moleculer-utilities": "^X.Y.Z"
```

```ts
import { Authorizer, Docs, KeyRateLimiter } from "@keletes/moleculer-utilities/mixins";
import { InterNamespace, K8sHealthCheck } from "@keletes/moleculer-utilities/middlewares";
import { MemoryStore, RedisStore } from "@keletes/moleculer-utilities/stores";
```

Install a release tag, not a branch: the compiled files are only in the release commits. See `CLAUDE.md` for development.
