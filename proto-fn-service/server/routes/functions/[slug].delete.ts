import { defineHandler, HTTPError } from 'nitro/h3'
import { hasUserRequiredRole } from 'c8y-nitro/utils'
import { syncPersistedFn } from '../../utils/persistence.ts'
import { useStore } from '../../utils/store.ts'

export default defineHandler({
  middleware: [hasUserRequiredRole('ROLE_PROTO_FN_CREATE')],
  handler: async (event) => {
    const slug = event.context.params!.slug!
    const store = useStore()
    const fn = store.get(slug)
    if (!fn || !store.remove(slug)) throw new HTTPError({ status: 404, message: 'unknown function' })
    try {
      await syncPersistedFn(slug)
    } catch (err) {
      // The tenant option would bring it back on the next boot - undo the local removal so
      // state stays consistent and the caller can simply retry the DELETE. restore() won't
      // clobber a newer version deployed in the meantime.
      store.restore(fn)
      console.warn(`[proto-fn] could not delete '${slug}' from tenant options:`, err instanceof Error ? err.message : err)
      throw new HTTPError({ status: 503, message: 'could not remove the function from tenant options; nothing was deleted, retry' })
    }
    return new Response(null, { status: 204 })
  },
})
