import { useSubscribedTenantClients, useTenantOptions } from 'c8y-nitro/utils'
import { serializePerKey } from './serializePerKey.ts'
import { type FnDef, useStore } from './store.ts'

// Tenant options are the platform's own tenant-scoped KV store: they survive a
// microservice redeploy, unlike the container filesystem the SQLite store lives on.
const KEY_PREFIX = 'fn:'
const PERSIST_ATTEMPTS = 3

/**
 * Tenant options of the tenant this instance serves - NOT the microservice owner.
 * With PER_TENANT isolation the platform runs one instance (and so one SQLite store) per
 * subscribed tenant and passes that tenant as C8Y_TENANT; useDeployedTenantClient() would
 * always target C8Y_BOOTSTRAP_TENANT (the owner) and mix every tenant's functions there.
 * Local dev has no C8Y_TENANT, but there the bootstrap tenant is the only tenant anyway.
 */
async function ownOptions() {
  const tenant = process.env.C8Y_TENANT ?? process.env.C8Y_BOOTSTRAP_TENANT
  const client = tenant ? (await useSubscribedTenantClients())[tenant] : undefined
  if (!client) throw new Error(`no service-user credentials for tenant '${tenant}' - is it subscribed to this microservice?`)
  return useTenantOptions(client)
}

/**
 * Makes the tenant option for `slug` match the local store *at write time*: set if the
 * function exists, delete if it doesn't. Serialized per slug and never working from a
 * snapshot, so racing deploys can't persist a stale version and a deploy racing a DELETE
 * can't resurrect the function on the next boot - the last write always reflects the
 * latest local state. Retries transient failures; throws if the option still can't be
 * written, so callers can refuse to report a deploy/delete that won't survive a redeploy.
 * ponytail: in-process queue - correct only with one replica (isolation PER_TENANT);
 * needs a version compare-and-set on the option if the service ever scales out.
 */
export function syncPersistedFn(slug: string): Promise<void> {
  return serializePerKey(slug, async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const option = (await ownOptions()).option(KEY_PREFIX + slug)
        const fn = useStore().get(slug) // re-read per attempt: never retry a stale snapshot
        // ponytail: whole function as one tenant-option value, no size chunking — fine for
        // hackathon-sized scripts; add chunking if a deployed function body gets huge.
        if (fn) await option.set(JSON.stringify(fn))
        else await option.delete()
        return
      } catch (err) {
        if (attempt >= PERSIST_ATTEMPTS) throw err
        await new Promise(resolve => setTimeout(resolve, 250 * attempt))
      }
    }
  })
}

/** Refills the local store from tenant options; only fills slugs missing locally (fresh container after redeploy). */
export async function hydrateStore() {
  const all = await (await ownOptions()).list()
  const store = useStore()
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue
    store.restore(JSON.parse(value) as FnDef)
  }
}
