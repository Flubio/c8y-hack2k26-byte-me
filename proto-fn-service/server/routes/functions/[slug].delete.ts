import { defineHandler, HTTPError } from 'nitro/h3'
import { hasUserRequiredRole } from 'c8y-nitro/utils'
import { useStore } from '../../utils/store.ts'

export default defineHandler({
  middleware: [hasUserRequiredRole('ROLE_PROTO_FN_CREATE')],
  handler: (event) => {
    if (!useStore().remove(event.context.params!.slug!)) throw new HTTPError({ status: 404, message: 'unknown function' })
    return new Response(null, { status: 204 })
  },
})
