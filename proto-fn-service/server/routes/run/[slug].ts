/**
 * GET (query params) or POST (JSON body) -> `input` of the deployed function.
 *
 * ?debug=1 switches the success response from the bare return value to
 * {value, logs, durationMs, source} - `source` is the exact code that ran
 * (prelude + the agent's code), which is what the error line numbers refer to.
 * Failure responses already include logs/durationMs regardless of this flag,
 * since deploy_function's self-repair loop depends on that.
 */
import { defineHandler, getQuery, HTTPError } from 'nitro/h3'
import { useStore } from '../../utils/store.ts'
import { credsFrom } from '../../utils/creds.ts'
import { buildSource, execute } from '../../utils/sandbox.ts'

export default defineHandler(async (event) => {
  const fn = useStore().get(event.context.params!.slug!)
  if (!fn) throw new HTTPError({ status: 404, message: 'unknown function' })

  const query = getQuery(event)
  const debug = query.debug !== undefined && query.debug !== '0' && query.debug !== 'false'
  const input = event.req.method === 'GET' ? query : await event.req.json().catch(() => ({}))
  if (debug && event.req.method === 'GET') delete (input as Record<string, unknown>).debug

  const r = await execute(fn.code, input, { creds: credsFrom(event.req), allowWrite: fn.allowWrite })
  if (!r.ok) return Response.json({ ...r.error, logs: r.logs, durationMs: r.durationMs }, { status: r.status })
  if (!debug) return Response.json(r.value ?? null)
  return Response.json({ value: r.value ?? null, logs: r.logs, durationMs: r.durationMs, source: buildSource(fn.code, input, fn.allowWrite) })
})
