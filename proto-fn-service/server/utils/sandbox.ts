/**
 * Runs agent-written TS/JS in the `run` QuickJS sandbox (https://github.com/vercel-labs/run).
 * No Nitro imports on purpose: this file is unit-tested with plain `node --test`.
 */
import { getHostFunctionContext, run, RunConcurrencyError, RunError, RunTimeoutError, setMaxWorkers } from 'run'

setMaxWorkers(Number(process.env.FN_MAX_WORKERS ?? 8))

export interface Creds { baseUrl: string, headers: Record<string, string> }
export interface ExecOptions { creds: Creds, allowWrite?: boolean, dryRun?: boolean, timeoutMs?: number }
export type ExecResult =
  | { ok: true, value: unknown, logs: string[], durationMs: number }
  | { ok: false, status: number, error: { name: string, code?: string, message: string }, logs: string[], durationMs: number }

const ALLOWED_PREFIXES = ['/inventory', '/measurement', '/alarm', '/event', '/operation', '/identity', '/user/currentUser', '/tenant/currentTenant']
const BRIDGE_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 1024 * 1024

export function assertAllowedPath(p: unknown): asserts p is string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.includes('\\')) throw new Error(`invalid path: ${String(p)}`)
  let decoded: string
  try { decoded = decodeURIComponent(p) } catch { throw new Error('invalid path encoding') }
  if (decoded.includes('..') || decoded.includes('//')) throw new Error('path traversal not allowed')
  const path = p.split('?')[0]!
  if (!ALLOWED_PREFIXES.some(a => path === a || path.startsWith(`${a}/`))) throw new Error(`path not allowed: ${path}`)
}

async function bridge(creds: Creds, method: string, path: unknown, body: unknown, allowWrite: boolean, dryRun: boolean) {
  assertAllowedPath(path)
  if (method !== 'GET') {
    if (!allowWrite) throw new Error(`${method} requires allowWrite`)
    if (dryRun) return null // dry-run must never mutate the tenant
  }
  const headers: Record<string, string> = { ...creds.headers, accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(creds.baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any([getHostFunctionContext().abortSignal, AbortSignal.timeout(BRIDGE_TIMEOUT_MS)]),
  })
  // ponytail: buffers the whole body before the cap check, stream-and-abort if responses get huge
  const text = await res.text()
  if (text.length > MAX_RESPONSE_BYTES) throw new Error('response too large')
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

/**
 * One-line prelude + agent code + suffix. Nothing before the agent's code contains a
 * newline, so `RUN_USER_SOURCE_ERROR` line numbers match the agent's own code.
 * Logs are buffered guest-side (a host `log` call would be a detached bridge request).
 */
export function buildSource(code: string, input: unknown, allowWrite: boolean) {
  const inputLiteral = JSON.stringify(JSON.stringify(input ?? null))
  const call = (m: string, args: string) => `${m}:async(${args})=>__u(await sys.${m}(${args}))`
  const write = allowWrite ? `,${call('post', 'p,b')},${call('put', 'p,b')},${call('delete', 'p')}` : ''
  const fmt = 'a.map(x=>typeof x==="string"?x:JSON.stringify(x)).join(" ")'
  return `const input=JSON.parse(${inputLiteral});const __logs=[];const log=(...a)=>{__logs.push(${fmt})};`
    + `const __u=r=>{if(r.err)throw new Error(r.err);return r.v};const c8y={${call('get', 'p')}${write}};return (async()=>{${code}\n})()`
    + `.then(v=>({v,logs:__logs}),e=>({e:{name:e?.name,message:String(e?.message??e),stack:e?.stack},logs:__logs}));`
}

// The prelude has no newline, so the agent's line N is line N of the source. Compile errors
// report it as-is; run's function-body wrapper shifts guest runtime stacks down by 2 lines.
const withLine = (message: string, stack: string | undefined, offset: number) => {
  const line = Number(stack?.match(/run\.js:(\d+):/)?.[1]) - offset
  return line > 0 ? `${message} (line ${line})` : message
}

export async function execute(code: string, input: unknown, opts: ExecOptions): Promise<ExecResult> {
  const { creds, allowWrite = false, dryRun = false } = opts
  const t0 = Date.now()
  const timeoutMs = opts.timeoutMs ?? Number(process.env.FN_TIMEOUT_MS ?? 5000)
  // run masks host-function errors as "Host function failed."; pass them as data so the agent can self-repair
  const b = (m: string) => async (path: unknown, body?: unknown) => {
    try { return { v: await bridge(creds, m, path, body, allowWrite, dryRun) } } catch (e) { return { err: (e as Error).message } }
  }
  try {
    const result = await run<{ v?: unknown, e?: { name: string, message: string, stack?: string }, logs: string[] }>({
      source: buildSource(code, input, allowWrite),
      hostFunctions: { sys: { get: b('GET'), post: b('POST'), put: b('PUT'), delete: b('DELETE') } },
      limits: {
        timeoutMs,
        memoryLimitBytes: Number(process.env.FN_MEMORY_MB ?? 32) * 1024 * 1024,
        maxBridgeRequests: 50,
        maxSourceBytes: 200 * 1024,
      },
    })
    if (result.status !== 'completed') throw new Error('interrupted runs are not supported')
    const { v, e, logs } = result.value
    const durationMs = Date.now() - t0
    if (!e) return { ok: true, value: v, logs, durationMs }
    return { ok: false, status: 500, error: { name: e.name, message: withLine(e.message, e.stack, 2) }, logs, durationMs }
  } catch (err) {
    const status = err instanceof RunTimeoutError ? 504 : err instanceof RunConcurrencyError ? 429 : 500
    const error = RunError.isInstance(err)
      ? { name: err.name, code: err.code, message: withLine(err.message, err.stack, 0) }
      : { name: (err as Error).name, message: (err as Error).message }
    return { ok: false, status, error, logs: [], durationMs: Date.now() - t0 }
  }
}
