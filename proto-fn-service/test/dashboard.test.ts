import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addWidgetToDashboard } from '../server/utils/dashboard.ts'

const creds = { baseUrl: 'http://fake', headers: { authorization: 'Basic xyz' } }
const validWidgetCode = "import { LitElement } from 'lit'; export default class MyWidget extends LitElement {}"

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

  const { widgetId } = await addWidgetToDashboard(creds, 'dash-1', { title: 'my-fn', code: validWidgetCode })

  assert.equal(calls.length, 2)
  assert.equal(calls[0]!.method, 'GET')
  assert.equal(calls[1]!.method, 'PUT')

  const putBody = calls[1]!.body as { c8y_Dashboard: { name: string, icon: string, children: Record<string, unknown> } }
  // untouched top-level dashboard fields
  assert.equal(putBody.c8y_Dashboard.name, 'My dashboard')
  assert.equal(putBody.c8y_Dashboard.icon, 'gauge')
  // pre-existing widget survives the merge
  assert.deepEqual(putBody.c8y_Dashboard.children['old-widget'], { id: 'old-widget', x: 1, y: 1 })
  // new widget matches @c8y/ngx-components' real Widget/HtmlWidgetConfig/HtmlWidget shape
  const added = putBody.c8y_Dashboard.children[widgetId] as {
    id: string
    componentId: string
    title: string
    _x: number
    _y: number
    _width: number
    _height: number
    config: { config: { code: string, css: string, legacy: boolean, devMode: boolean, options: { advancedSecurity: boolean } } }
  }
  assert.equal(added.id, widgetId)
  assert.equal(added.componentId, 'Html widget') // defaultWidgetIds.HTML
  assert.equal(added.title, 'my-fn')
  assert.deepEqual([added._x, added._y, added._width, added._height], [0, 0, 4, 4])
  assert.equal(added.config.config.code, validWidgetCode)
  assert.equal(added.config.config.legacy, false)
  assert.equal(added.config.config.devMode, true)
  assert.equal(added.config.config.options.advancedSecurity, true)
})

test('rejects custom-element registrations that fail when Cockpit reloads a widget module', async () => {
  await assert.rejects(
    () => addWidgetToDashboard(creds, 'dash-1', {
      title: 'invalid-widget',
      code: "customElements.define('device-telemetry-widget', class extends HTMLElement {})",
    }),
    /must not call customElements\.define/,
  )
})

test('rejects manual shadow-root attachment in LitElement widgets', async () => {
  await assert.rejects(
    () => addWidgetToDashboard(creds, 'dash-1', {
      title: 'invalid-widget',
      code: "import { LitElement } from 'lit'; export default class MyWidget extends LitElement { render() { this.attachShadow({ mode: 'open' }); } }",
    }),
    /must not call this\.attachShadow/,
  )
})

test('throws a clear error when the target is not a dashboard', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 'not-a-dashboard' }), { status: 200 }))
  await assert.rejects(
    () => addWidgetToDashboard(creds, 'not-a-dashboard', { title: 't', code: validWidgetCode }),
    /no c8y_Dashboard fragment/,
  )
})

test('surfaces a non-2xx GET as an error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }))
  await assert.rejects(() => addWidgetToDashboard(creds, 'missing', { title: 't', code: validWidgetCode }), /HTTP 404/)
})

test('clones an existing widget type via componentId+config instead of an HTML widget', async (t) => {
  const existingDashboard = { name: 'My dashboard', children: {} }
  const calls: { method: string, body?: unknown }[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined })
    if (!init?.method) return new Response(JSON.stringify({ id: 'dash-1', c8y_Dashboard: existingDashboard }), { status: 200 })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })

  const { widgetId } = await addWidgetToDashboard(creds, 'dash-1', {
    title: 'Speed',
    componentId: 'Gauge widget',
    config: { deviceId: '123', fragment: 'c8y_Speed' },
  })

  const putBody = calls[1]!.body as { c8y_Dashboard: { children: Record<string, unknown> } }
  const added = putBody.c8y_Dashboard.children[widgetId] as { componentId: string, config: unknown }
  assert.equal(added.componentId, 'Gauge widget')
  assert.deepEqual(added.config, { deviceId: '123', fragment: 'c8y_Speed' })
})

test('rejects a call with neither code nor componentId', async () => {
  await assert.rejects(
    () => addWidgetToDashboard(creds, 'dash-1', { title: 't' }),
    /needs either code.*or componentId\+config/,
  )
})
