import type { Creds } from './sandbox.ts'

/** Forward the caller's platform credentials so a function can only do what the caller can. */
export function credsFrom(req: Request): Creds {
  const headers: Record<string, string> = {}
  const auth = req.headers.get('authorization')
  const cookie = req.headers.get('cookie')
  if (auth) headers.authorization = auth
  if (cookie) {
    headers.cookie = cookie
    const xsrf = /(?:^|;\s*)XSRF-TOKEN=([^;]+)/.exec(cookie)?.[1]
    if (xsrf) headers['x-xsrf-token'] = xsrf
  }
  return { baseUrl: (process.env.C8Y_BASEURL ?? '').replace(/\/$/, ''), headers }
}
