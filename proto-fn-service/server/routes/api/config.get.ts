/**
 * GET /api/config
 *
 * Returns the non-secret runtime config the bundled index.html needs to link
 * back into the Cumulocity platform (application tiles, microservice dashboard).
 *
 * C8Y_BASEURL comes from .env during `pnpm dev` and is injected by the platform
 * when the microservice runs on a tenant.
 */
import { defineEventHandler } from 'nitro/h3'

export default defineEventHandler(() => {
  const baseUrl = process.env.C8Y_BASEURL ?? ''

  return {
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
  }
})
