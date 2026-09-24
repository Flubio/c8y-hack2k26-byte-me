import { useDeployedTenantClient, useTenantOptions } from 'c8y-nitro/utils'
import { type FnDef, useStore } from './store.ts'

// Tenant options are the platform's own tenant-scoped KV store: they survive a
// microservice redeploy, unlike the container filesystem the SQLite store lives on.
const KEY_PREFIX = 'fn:'

async function ownOptions() {
  return useTenantOptions(await useDeployedTenantClient())
}

// ponytail: whole function as one tenant-option value, no size chunking — fine for
// hackathon-sized scripts; add chunking if a deployed function body gets huge.
export async function persistFn(fn: FnDef) {
  await (await ownOptions()).option(KEY_PREFIX + fn.slug).set(JSON.stringify(fn))
}

export async function deletePersistedFn(slug: string) {
  await (await ownOptions()).option(KEY_PREFIX + slug).delete()
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
