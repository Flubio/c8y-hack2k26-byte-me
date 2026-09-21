/** GET (query params) or POST (JSON body) -> `input` of the deployed function. */
import { defineHandler, getQuery, HTTPError } from 'nitro/h3'
import { useStore } from '../../utils/store.ts'
import { credsFrom } from '../../utils/creds.ts'
import { execute } from '../../utils/sandbox.ts'

export default defineHandler(async (event) => {
  const fn = useStore().get(event.context.params!.slug!)
  if (!fn) throw new HTTPError({ status: 404, message: 'unknown function' })
  const input = event.req.method === 'GET' ? getQuery(event) : await event.req.json().catch(() => ({}))
  const r = await execute(fn.code, input, { creds: credsFrom(event.req), allowWrite: fn.allowWrite })
  if (r.ok) return Response.json(r.value ?? null)
  return Response.json({ ...r.error, logs: r.logs, durationMs: r.durationMs }, { status: r.status })
})
