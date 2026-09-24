import { defineHandler, HTTPError } from 'nitro/h3'
import { hasUserRequiredRole } from 'c8y-nitro/utils'
import { deletePersistedFn } from '../../utils/persistence.ts'
import { useStore } from '../../utils/store.ts'

export default defineHandler({
  middleware: [hasUserRequiredRole('ROLE_PROTO_FN_CREATE')],
  handler: async (event) => {
    const slug = event.context.params!.slug!
    if (!useStore().remove(slug)) throw new HTTPError({ status: 404, message: 'unknown function' })
    try {
      await deletePersistedFn(slug)
    } catch (err) {
      console.warn(`[proto-fn] could not delete '${slug}' from tenant options:`, err instanceof Error ? err.message : err)
    }
    return new Response(null, { status: 204 })
  },
})
