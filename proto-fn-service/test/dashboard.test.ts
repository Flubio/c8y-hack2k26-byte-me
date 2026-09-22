import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addWidgetToDashboard } from '../server/utils/dashboard.ts'

const creds = { baseUrl: 'http://fake', headers: { authorization: 'Basic xyz' } }

test('read-modify-write: existing children and dashboard fields survive; only PUTs c8y_Dashboard', async (t) => {
  const existingDashboard = { name: 'My dashboard', icon: 'gauge', children: { 'old-widget': { id: 'old-widget', x: 1, y: 1 } } }
  const calls: { method: string, url: string, body?: unknown }[] = []

  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body as string) : undefined })
    if (!init || init.method === undefined) {
      return new Response(JSON.stringify({ id: 'dash-1', c8y_Dashboard: existingDashboard }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })

  const { widgetId } = await addWidgetToDashboard(creds, 'dash-1', { title: 'my-fn', code: 'export default class {}' })

  assert.equal(calls.length, 2)
  assert.equal(calls[0]!.method, 'GET')
  assert.equal(calls[1]!.method, 'PUT')

  const putBody = calls[1]!.body as { c8y_Dashboard: { name: string, icon: string, children: Record<string, unknown> } }
  // untouched top-level dashboard fields
  assert.equal(putBody.c8y_Dashboard.name, 'My dashboard')
  assert.equal(putBody.c8y_Dashboard.icon, 'gauge')
  // pre-existing widget survives the merge
  assert.deepEqual(putBody.c8y_Dashboard.children['old-widget'], { id: 'old-widget', x: 1, y: 1 })
  // new widget was added, keyed by the returned id
  const added = putBody.c8y_Dashboard.children[widgetId] as { id: string, config: { code: string } }
  assert.equal(added.id, widgetId)
  assert.equal(added.config.code, 'export default class {}')
})

test('throws a clear error when the target is not a dashboard', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 'not-a-dashboard' }), { status: 200 }))
  await assert.rejects(
    () => addWidgetToDashboard(creds, 'not-a-dashboard', { title: 't', code: 'c' }),
    /no c8y_Dashboard fragment/,
  )
})

test('surfaces a non-2xx GET as an error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }))
  await assert.rejects(() => addWidgetToDashboard(creds, 'missing', { title: 't', code: 'c' }), /HTTP 404/)
})
