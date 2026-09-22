# Byte Me — Cumulocity Function Prototype Editor

> Turn a plain-language dashboard request into a sandboxed Cumulocity data function and a live Cockpit widget.

Byte Me is a hackathon prototype for Cumulocity IoT. It combines an AI-enabled Cockpit widget with a Cumulocity microservice so users can describe the data they need, have an agent create a small function, and visualize the result on the current dashboard.

## How it works

1. Add the **Prototype Editor** widget to a Cockpit dashboard.
2. Ask for a data view in natural language—for example, “show the latest temperature for each device”.
3. The `c8y-fn-author` agent creates and validates a function through the function service.
4. The service runs the function in an isolated QuickJS sandbox using the current user's Cumulocity credentials.
5. For visual requests, the agent generates a Cockpit HTML widget and adds it to the active dashboard when its ID is available.

## Components

| Directory | Purpose |
| --- | --- |
| `proto-fn-service/` | Cumulocity Nitro microservice that validates, stores, and runs agent-authored JavaScript/TypeScript function bodies in a QuickJS sandbox. It also exposes MCP tools for deployment and widget generation. |
| `proto-fn-service-frontend/` | Angular/Cumulocity Web SDK plugin providing the **Prototype Editor** Cockpit widget and chat experience. |
| `c8y-system/` | System prompt for the `c8y-fn-author` agent. |

## Safety model

Function code is deliberately constrained:

- It can use only `input`, `log(...)`, and `c8y.get(...)` by default.
- Cumulocity paths are allow-listed for inventory, measurements, alarms, events, operations, identities, and current user/tenant information.
- Writes through `c8y.post`, `c8y.put`, and `c8y.delete` require the function to be deployed with `allowWrite: true`.
- Imports, Node.js APIs, and `fetch` are unavailable.
- The sandbox has runtime, memory, result-size, API-call, and concurrency limits.
- The caller's Cumulocity authorization is forwarded to Cumulocity requests, so functions act with the caller's permissions.

Deploying or deleting functions requires the Cumulocity role `ROLE_PROTO_FN_CREATE`. Running and listing functions require a normal platform login.

## Prerequisites

- Node.js and pnpm
- A Cumulocity IoT tenant and credentials
- Docker, to build the deployable microservice ZIP
- A configured `c8y-fn-author` agent that can reach the function service MCP endpoint

## Local development

Install dependencies in each independently deployable component:

```sh
cd proto-fn-service
pnpm install
cp .env.example .env
```

Set the values in `proto-fn-service/.env`:

```dotenv
C8Y_DEVELOPMENT_TENANT=<your-tenant-id>
C8Y_DEVELOPMENT_USER=<your-username>
C8Y_DEVELOPMENT_PASSWORD=<your-password>
C8Y_BASEURL=<your-base-url>
```

Start the function service. On its first run, Cumulocity Nitro creates and subscribes the development microservice and stores bootstrap credentials in `.env`.

```sh
pnpm dev
```

In a second terminal, start the Cockpit plugin development server:

```sh
cd proto-fn-service-frontend
pnpm install
pnpm start
```

The frontend's default `start` script targets `https://text-to-edge.eu-latest.cumulocity.com/`. Change that script or pass the appropriate Cumulocity target for another tenant.

## Function service API

The service is hosted below `/service/proto-fn` in Cumulocity.

| Endpoint | Description |
| --- | --- |
| `POST /functions` | Validate, dry-run, and deploy a function. |
| `GET /functions` | List deployed functions. |
| `GET /functions/:slug` | Inspect one function. |
| `DELETE /functions/:slug` | Remove a function. |
| `GET` / `POST /run/:slug` | Run a function with query-string or JSON input. |
| `POST /mcp` | MCP endpoint exposing deployment and widget tools to the agent. |

A deployed function body supports top-level `await` and `return`; it is not a complete module or wrapped function.

## Test and build

Run the service tests and type check:

```sh
cd proto-fn-service
pnpm test
pnpm typecheck
```

Build a deployable microservice package:

```sh
cd proto-fn-service
pnpm build
```

This produces `proto-fn-service-<version>.zip`. Upload it in **Administration → Ecosystem → Extensions → Add extension package**, then subscribe the tenant. Each upload needs a new version; use `pnpm release` to bump the patch version and build.

Build and deploy the Cockpit plugin:

```sh
cd proto-fn-service-frontend
pnpm build
pnpm deploy
```

## Persistence note

Functions are stored in SQLite at `FN_DB_PATH` (default: `.data/functions.db`). The Cumulocity container filesystem is ephemeral: data survives a process restart but not a redeploy or reschedule. Redeploy demonstration functions after publishing a new service version.

## Inspiration and acknowledgements

Built for the Cumulocity AIoT Hackathon. This project is built on [Cumulocity IoT](https://www.cumulocity.com/), the Cumulocity Web SDK, [c8y-nitro](https://github.com/Cumulocity-IoT/c8y-nitro), and the [`run`](https://github.com/vercel-labs/run) QuickJS sandbox.

## License

No repository-level license has been declared yet.