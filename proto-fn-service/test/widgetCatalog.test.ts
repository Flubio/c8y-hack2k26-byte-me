import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listTenantWidgets, summarizeCatalog } from '../server/utils/widgetCatalog.ts'

const creds = { baseUrl: 'http://fake', headers: { authorization: 'Basic xyz' } }

test('extracts widget instances from every dashboard, keeping componentId/title/config/origin', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    managedObjects: [
      {
        id: 'dash-1',
        c8y_Dashboard: {
          name: 'Fleet overview',
          children: {
            w1: { componentId: 'Gauge widget', title: 'Speed', config: { deviceId: '123', fragment: 'c8y_Speed' } },
            w2: { componentId: 'Html widget', title: 'Custom', config: { code: 'x' } },
          },
        },
      },
      { id: 'dash-2', c8y_Dashboard: { name: 'Empty', children: {} } },
    ],
  }), { status: 200 }))

  const widgets = await listTenantWidgets(creds)
  assert.equal(widgets.length, 2)
  assert.deepEqual(widgets[0], {
    componentId: 'Gauge widget',
    title: 'Speed',
    dashboardId: 'dash-1',
    dashboardName: 'Fleet overview',
    config: { deviceId: '123', fragment: 'c8y_Speed' },
  })
})

test('surfaces a non-2xx as an error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 500 }))
  await assert.rejects(() => listTenantWidgets(creds), /HTTP 500/)
})

test('summarizeCatalog groups by componentId, most-used first, capped at 2 examples', () => {
  const widgets = [
    { componentId: 'Gauge widget', dashboardId: 'd1', config: { a: 1 } },
    { componentId: 'Gauge widget', dashboardId: 'd2', config: { a: 2 } },
    { componentId: 'Gauge widget', dashboardId: 'd3', config: { a: 3 } },
    { componentId: 'Html widget', dashboardId: 'd1', config: { code: 'x' } },
  ]
  const summary = summarizeCatalog(widgets)
  assert.deepEqual(summary.map(s => [s.componentId, s.count, s.examples.length]), [
    ['Gauge widget', 3, 2],
    ['Html widget', 1, 1],
  ])
})
