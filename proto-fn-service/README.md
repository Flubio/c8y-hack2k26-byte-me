# proto-fn-service

Cumulocity microservice (c8y-nitro) that stores agent-written TS/JS functions and runs them in a
[`run`](https://github.com/vercel-labs/run) QuickJS sandbox. Served at `/service/proto-fn/...`.

## API

| Route | Purpose |
|---|---|
| `POST /functions` | **Needs `ROLE_PROTO_FN_CREATE`.** Deploy `{slug, code, description?, inputSchema?, exampleInput?, allowWrite?}`. Validates, dry-runs with `exampleInput`, stores. 201 `{ok, url, version, exampleOutput, logs}` or 422 `{ok:false, phase, errors, logs}` |
| `GET /functions`, `GET /functions/:slug` | List, inspect (incl. `inputSchema`, `exampleInput`, `exampleOutput`) |
| `DELETE /functions/:slug` | **Needs `ROLE_PROTO_FN_CREATE`.** Remove |
| `GET` / `POST /run/:slug` | Run. GET: query params are `input`. POST: JSON body is `input`. 404 unknown, 429 too many runs, 500 script error, 504 timeout |

Running and listing need only a platform login. Assign `ROLE_PROTO_FN_CREATE` (defined in the manifest) to whoever may deploy; in `pnpm dev` that is the development user.

Callers must forward their `Authorization` header or cookie: the function's `c8y.get(path)` calls run as that user.

## Script contract

A function body (top-level `await` and `return`; no imports, `fetch` or Node APIs). Globals:

```ts
input            // GET query params or POST JSON body
c8y.get(path)    // /inventory /measurement /alarm /event /operation /identity /user/currentUser /tenant/currentTenant
c8y.post/put/delete(path, body?)   // only if deployed with allowWrite: true
log(...)         // returned with dry-run and error results
return { ... }   // any JSON-serializable value
```

Limits: 5 s, 32 MB, 1 MB result, 50 `c8y` calls, 8 concurrent runs (`FN_TIMEOUT_MS`, `FN_MEMORY_MB`, `FN_MAX_WORKERS`).
Functions are stored in SQLite (`FN_DB_PATH`, default `.data/functions.db`) for fast local reads, and mirrored into the calling tenant's own tenant options on every deploy/delete (each `PER_TENANT` instance uses `C8Y_TENANT`, never the owner tenant). The container filesystem is ephemeral on Cumulocity (a redeploy or reschedule wipes it), so on boot the service refills its SQLite store from tenant options — functions survive redeploys without needing to be re-uploaded. Requires `ROLE_OPTION_MANAGEMENT_ADMIN` on the microservice's own service user (granted via `requiredRoles` in the manifest).

## Develop

```sh
cp .env.example .env   # C8Y_BASEURL, C8Y_DEVELOPMENT_TENANT/USER/PASSWORD
pnpm dev               # first run creates + subscribes the microservice and writes bootstrap creds to .env
pnpm test              # sandbox tests (node --test)
```

## Deploy

```sh
pnpm build             # (or `pnpm release` to bump first) needs a running Docker daemon; writes proto-fn-service-<version>.zip (~230 MB)
```

Upload the zip in Administration > Ecosystem > Extensions > Add extension package, then subscribe the tenant.
Every upload needs a new version: `pnpm release` bumps the patch version and builds. Manifest: `PER_TENANT`, 1 replica, 1 CPU / 1 GiB,
context path `proto-fn` (set in `nitro.config.ts`; also used for the URLs returned to the agent).
