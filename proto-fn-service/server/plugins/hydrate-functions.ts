import { definePlugin } from 'nitro'
import { hydrateStore } from '../utils/persistence.ts'

// Runs once at boot: a redeploy wipes the container filesystem (and the SQLite
// store with it), so refill it from tenant options before the service takes traffic.
export default definePlugin(async () => {
  try {
    await hydrateStore()
  } catch (err) {
    console.warn('[proto-fn] could not hydrate functions from tenant options:', err instanceof Error ? err.message : err)
  }
})
