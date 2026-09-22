import { defineHandler, HTTPError } from 'nitro/h3'
import { functionUrl } from '../../utils/functions.ts'
import { useStore } from '../../utils/store.ts'

export default defineHandler((event) => {
  const fn = useStore().get(event.context.params!.slug!)
  if (!fn) throw new HTTPError({ status: 404, message: 'unknown function' })
  return { ...fn, url: functionUrl(fn.slug) }
})
