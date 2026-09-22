import type { Creds } from './sandbox.ts'

/**
 * Adds one widget to an existing Cockpit dashboard by read-modify-write on its
 * `c8y_Dashboard.children` map, so existing widgets on the dashboard are never
 * disturbed (PUT to a managed object replaces whatever top-level fragment you send
 * in full, so the *entire* current c8y_Dashboard fragment - not just the new child -
 * has to be sent back).
 *
 * UNVERIFIED, best-effort guess: Cumulocity does not publicly document the JSON shape
 * of a c8y_Dashboard child, and there is no live tenant available here to check it
 * against. The `id`/`x`/`y`/`width`/`height` fields match a working reference tool
 * (https://community.cumulocity.com/t/ai-agent-manager-using-a-mcp-server-to-generate-widgets/14172),
 * whose tool only creates an *empty* widget - the `config` shape below (component id,
 * where the Advanced-mode source and its "advanced" flag live) is this function's own
 * guess, isolated here as the one place to fix once it's checked against a real
 * dashboard: add one Enhanced HTML widget by hand in Cockpit, then
 * GET /inventory/managedObjects/<dashboardId> and diff its c8y_Dashboard.children
 * against WIDGET_CONFIG_SHAPE below.
 */
const WIDGET_CONFIG_SHAPE = {
  /** Guessed component identifier for the built-in "HTML" widget type. */
  componentId: 'html.widget',
  /** Guessed field names for Advanced-mode source and its toggle. */
  buildConfig: (title: string, code: string) => ({
    name: title,
    advancedMode: true,
    code,
  }),
}

interface ManagedObject {
  id: string
  c8y_Dashboard?: { name?: string, children?: Record<string, unknown>, [key: string]: unknown }
  [key: string]: unknown
}

async function getManagedObject(creds: Creds, id: string): Promise<ManagedObject> {
  const res = await fetch(`${creds.baseUrl}/inventory/managedObjects/${encodeURIComponent(id)}`, {
    headers: { ...creds.headers, accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`GET managed object ${id} failed: HTTP ${res.status}`)
  return res.json()
}

async function putFragment(creds: Creds, id: string, fragment: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${creds.baseUrl}/inventory/managedObjects/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...creds.headers, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(fragment),
  })
  if (!res.ok) throw new Error(`PUT managed object ${id} failed: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

export interface AddWidgetOptions {
  title: string
  code: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export async function addWidgetToDashboard(creds: Creds, dashboardId: string, opts: AddWidgetOptions): Promise<{ widgetId: string }> {
  const mo = await getManagedObject(creds, dashboardId)
  const dashboard = mo.c8y_Dashboard
  if (!dashboard) throw new Error(`managed object ${dashboardId} has no c8y_Dashboard fragment - is this a dashboard id?`)

  const widgetId = crypto.randomUUID()
  const children = {
    ...(dashboard.children ?? {}),
    [widgetId]: {
      id: widgetId,
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      width: opts.width ?? 4,
      height: opts.height ?? 4,
      config: {
        ...WIDGET_CONFIG_SHAPE.buildConfig(opts.title, opts.code),
        componentId: WIDGET_CONFIG_SHAPE.componentId,
      },
    },
  }

  await putFragment(creds, dashboardId, { c8y_Dashboard: { ...dashboard, children } })
  return { widgetId }
}
