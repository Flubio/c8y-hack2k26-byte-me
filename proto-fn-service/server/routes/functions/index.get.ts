import { defineHandler } from 'nitro/h3'
import { functionUrl } from '../../utils/functions.ts'
import { useStore } from '../../utils/store.ts'

export default defineHandler(() => useStore().list().map(f => ({ ...f, url: functionUrl(f.slug) })))
