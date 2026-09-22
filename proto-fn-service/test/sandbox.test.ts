import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertAllowedPath, execute } from '../server/utils/sandbox.ts'

const creds = { baseUrl: 'http://127.0.0.1:1', headers: {} }
const go = (code: string, input?: unknown, o: object = {}) => execute(code, input, { creds, timeoutMs: 1500, ...o })

test('returns value, strips TS, captures logs', async () => {
  const r = await go('const { n } = input as { n: number }; log("hi", { n }); return n * 2', { n: 21 })
  assert.deepEqual(r.ok && [r.value, r.logs], [42, ['hi {"n":21}']])
})

test('syntax error reports the agent line number', async () => {
  const r = await go('const a = 1;\nconst b = ;\nreturn a')
  assert.ok(!r.ok && r.error.code === 'RUN_USER_SOURCE_ERROR')
  assert.match(r.error.message, /\(line 2\)/)
})

test('thrown error keeps logs', async () => {
  const r = await go('log("before"); throw new Error("boom")')
  assert.ok(!r.ok && r.status === 500 && r.error.message === 'boom (line 1)' && r.logs[0] === 'before')
})

test('runtime error line number matches the agent code', async () => {
  const r = await go('const a = 1;\n\nnull.x')
  assert.ok(!r.ok && /\(line 3\)/.test(r.error.message))
})

test('infinite loop -> 504', async () => {
  const r = await go('while (true) {}', undefined, { timeoutMs: 300 })
  assert.ok(!r.ok && r.status === 504)
})

test('memory bomb is contained', async () => {
  const r = await go('const a = []; while (true) a.push(new Array(1e5).fill(1))', undefined, { timeoutMs: 3000 })
  assert.ok(!r.ok)
})

test('no node / network globals', async () => {
  const r = await go('return [typeof process, typeof require, typeof fetch]')
  assert.deepEqual(r.ok && r.value, ['undefined', 'undefined', 'undefined'])
})

test('path allowlist', () => {
  for (const ok of ['/inventory/managedObjects/1?x=1', '/user/currentUser', '/alarm/alarms']) assertAllowedPath(ok)
  for (const bad of ['/user/users', '/inventory/../user/users', '/inventory/%2e%2e/x', '//evil.com', 'http://evil.com', '/application/applications'])
    assert.throws(() => assertAllowedPath(bad), bad)
})

test('async host round trip, writes need allowWrite', async () => {
  const r = await go('try { await c8y.get("/user/users") } catch (e) { return e.message }')
  assert.ok(r.ok && /path not allowed/.test(String(r.value)))
  assert.ok(!(await go('return await c8y.get("/inventory/managedObjects")')).ok) // unreachable host -> real error, not a hang
  const w = await go('return typeof c8y.post')
  assert.deepEqual(w.ok && w.value, 'undefined')
})
