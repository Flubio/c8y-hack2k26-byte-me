/** GET /functions/:slug/widget -> ready-to-paste Cockpit HTML-widget (Advanced mode) source. */
import { defineHandler, HTTPError } from 'nitro/h3'
import { functionUrl } from '../../../utils/functions.ts'
import { useStore } from '../../../utils/store.ts'
import { buildLitWidget } from '../../../utils/widget.ts'

export default defineHandler((event) => {
  const fn = useStore().get(event.context.params!.slug!)
  if (!fn) throw new HTTPError({ status: 404, message: 'unknown function' })
  const code = buildLitWidget({ ...fn, url: functionUrl(fn.slug) })
  return new Response(code, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
})
