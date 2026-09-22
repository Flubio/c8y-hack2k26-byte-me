import { defineHandler } from 'nitro/h3'
import { hasUserRequiredRole } from 'c8y-nitro/utils'
import { deployFunction, type DeployInput } from '../../utils/functions.ts'
import { credsFrom } from '../../utils/creds.ts'

export default defineHandler({
  middleware: [hasUserRequiredRole('ROLE_PROTO_FN_CREATE')],
  handler: async (event) => {
    const result = await deployFunction(await event.req.json() as DeployInput, credsFrom(event.req))
    return Response.json(result, { status: result.ok ? 201 : 422 })
  },
})
