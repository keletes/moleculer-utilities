# moleculer-utilities

Shared Moleculer mixins, middlewares and rate-limit stores of the Keletes services.

```json
"moleculer-utilities": "git+https://github.com/keletes/moleculer-utilities.git#vX.Y.Z"
```

```ts
import { Authorizer, KeyRateLimiter } from "moleculer-utilities/mixins";
import { InterNamespace, K8sHealthCheck } from "moleculer-utilities/middlewares";
import { MemoryStore, RedisStore } from "moleculer-utilities/stores";
```

Install a release tag, not a branch: the compiled files are only in the release commits. See `CLAUDE.md` for development.
