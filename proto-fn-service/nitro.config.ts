import { defineNitroConfig } from 'nitro/config'
import c8y from 'c8y-nitro'

// URL prefix on the platform: /service/<contextPath>/... (single source for the manifest and the URLs handed to the agent)
const contextPath = 'proto-fn'

export default defineNitroConfig({
  preset: 'node_server',
  // Server code (routes/, plugins/, tasks/) lives under ./server — the Nitro default.
  serverDir: './server',

  builder: 'rolldown',

  experimental: {
    // Enables async_hooks-based context propagation so helpers like useLogger()
    // can reach the current request from deeply nested call stacks.
    asyncContext: true,
    // Note: c8y-nitro's task registry (c8yTasks) does its own runtime cron
    // scheduling and does NOT need `tasks: true`. Only enable Nitro's native
    // task system if you also use build-time `scheduledTasks`.
  },

  runtimeConfig: { serviceContext: contextPath },

  c8y: {
    manifest: {
      contextPath,
      // Required to deploy or delete functions. Running and listing only need a platform login.
      roles: ['ROLE_PROTO_FN_CREATE'],
      // Own service user: needed to mirror deployed functions into tenant options,
      // which survive a redeploy (the container filesystem/SQLite store does not).
      requiredRoles: ['ROLE_OPTION_MANAGEMENT_ADMIN'],
      // Sandboxed functions run with the caller's credentials, not the service user's.
      // one replica: the in-memory function store must not be split across instances
      isolation: 'PER_TENANT',
      replicas: 1,
      resources: { cpu: '1', memory: '1Gi' },
    },
  },

  modules: [
    c8y(),
  ],
})
