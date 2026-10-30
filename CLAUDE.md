# moleculer-utilities

Shared Moleculer pieces for the Keletes services, imported by subpath: `moleculer-utilities/mixins` (`Authorizer`, `Docs`, `KeyRateLimiter`), `/middlewares` (`InterNamespace`, `K8sHealthCheck`) and `/stores` (`MemoryStore`, `RedisStore`, for the rate limiter). Public repo: nothing specific to a service, no secret, no hostname.

## Commands

```
yarn verify    # typecheck + lint + test
yarn build     # tsc -> mixins/, middlewares/, stores/, utils/ at the package root
yarn test      # builds first, then jest (the layout spec imports the built folders)
```

## The `Docs` mixin

`Docs({ dir, version })` (`src/mixins/docs.ts`) serves a folder of markdown (front matter `title` + `summary`, topic id = path without `.md`) as the authoring documentation of a service: `docs.list` (`{version, topics:[{id,title,summary,hash}]}`) and `docs.get({topic})`, and the same index in `metadata.docs` (the texts never go into metadata: it travels in every node's info). A malformed file throws in `created()`, so a broken doc stops the service. Actions are `public` (reachable from other namespaces), never have a `rest` alias, and are not covered by `Authorizer` unless the service whitelists them.

## Shape of this repo

- Source is `src/<folder>/`. `yarn build` compiles it to the same folder names at the **package root**, which is what consumers import (`moleculer-utilities/mixins`). Do not move the output (no `dist/`): it would break every import.
- The built folders are git-ignored and committed **only by the release commit** (`.releaserc.json` force-adds them), so `master` between releases has no compiled output. Consumers pin a tag (`git+https://github.com/keletes/moleculer-utilities.git#vX.Y.Z`), never `#master`.
- Node 22 (`engines`); `moleculer` is a peer dependency.
- Tests are `test/*.spec.ts` (jest, ts-jest). `test/layout.spec.ts` guards the public surface of the built package.

## Releases: trunk-based, Conventional Commits

Same as the other repos: PR titles are Conventional Commits (`pr-title.yml`), `tag.yml` runs `semantic-release` on `master`, which commits `package.json` and the built folders as `chore(release)` and tags `vX.Y.Z`. `fix:` patch, `feat:` minor, `feat!:`/`BREAKING CHANGE:` major (a rename or removal of an export is breaking); `chore:`/`docs:`/`refactor:`/`test:`/`ci:`/`build:` release nothing. The tag workflow needs the org's `DEPLOY_APP_*` secrets and the app installed on this repo. Do not bump the version or push a `v*` tag by hand.

Default branch: `master`. Work on a branch, never on `master`.
