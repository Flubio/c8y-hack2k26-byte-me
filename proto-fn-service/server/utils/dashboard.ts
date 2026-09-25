import type { Creds } from './sandbox.ts'

/**
 * Adds one widget to an existing Cockpit dashboard by read-modify-write on its
 * `c8y_Dashboard.children` map, so existing widgets on the dashboard are never
 * disturbed (PUT to a managed object replaces whatever top-level fragment you send
 * in full, so the *entire* current c8y_Dashboard fragment - not just the new child -
 * has to be sent back).
 *
 * The child shape below is traced from @c8y/ngx-components' own shipped type
 * declarations (not a guess against undocumented behaviour):
 *   ContextDashboard.children: { [id: string]: Widget }                      (context-dashboard.d.ts)
 *   Widget: { id, componentId, title?, _x, _y, _width, _height, config: any } (c8y-ngx-components.d.ts)
 *   componentId for the built-in HTML widget = defaultWidgetIds.HTML = "Html widget"
 *                                                        (widgets/definitions/index)
 *   Widget.config (for the HTML widget) = HtmlWidgetConfig: { config: HtmlWidget, ... }
 *   HtmlWidget: { css, code, options: { cssEncapsulation, advancedSecurity }, legacy, devMode }
 *                                          (widgets/implementations/html-widget)
 * `code` is the Advanced-mode Lit module source (what generate_widget/buildLitWidget
 * produces); `legacy: false` + `devMode: true` selects modern web-component
 * Advanced mode over the normal HTML/legacy renderer.
 *
 * Still unverified: this hasn't been run against a live tenant, so runtime-only details
 * (e.g. whether `devMode`/`cssEncapsulation` need a different value, or the widget needs
 * to appear in `dashboard.classes`/layout metadata elsewhere) could still be off. If the
 * tile doesn't render, add one Enhanced HTML widget by hand and diff its
 * c8y_Dashboard.children entry against WIDGET_CONFIG_SHAPE below.
 */
const WIDGET_CONFIG_SHAPE = {
  /** defaultWidgetIds.HTML from @c8y/ngx-components/widgets/definitions - verified, not guessed. */
  componentId: 'Html widget',
  buildConfig: (code: string) => ({
    config: {
      css: '',
      code,
      options: { cssEncapsulation: true, advancedSecurity: true },
      legacy: false,
      devMode: true,
    },
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
  x?: number
  y?: number
  width?: number
  height?: number
  /** Advanced-mode HTML widget source (mutually exclusive with componentId/config). */
  code?: string
  /** Clone an existing widget type (e.g. a builtin gauge/chart already used on the tenant's dashboards) with its own config, instead of an HTML widget. */
  componentId?: string
  config?: unknown
}

function assertAdvancedWidgetModule(code: string): void {
  if (/customElements\.define\s*\(/.test(code)) {
    throw new Error('widget code must not call customElements.define(): Cockpit can evaluate an HTML widget module more than once. Export a LitElement class as default instead.')
  }
  if (/\bthis\.attachShadow\s*\(/.test(code)) {
    throw new Error('widget code must not call this.attachShadow(): LitElement already creates a shadow root. Use this.renderRoot to create or query DOM nodes instead.')
  }
  if (!/export\s+default\s+class(?:\s+\w+)?\s+extends\s+LitElement\b/.test(code)) {
    throw new Error('widget code must be a Cumulocity Advanced-mode module that exports a class extending LitElement as default.')
  }
}

export async function addWidgetToDashboard(creds: Creds, dashboardId: string, opts: AddWidgetOptions): Promise<{ widgetId: string }> {
  // exactly one mode - both would pair the clone's componentId with an HTML-widget config
  if ((opts.code === undefined) === (opts.componentId === undefined)) {
    throw new Error('addWidgetToDashboard needs either code (HTML widget) or componentId+config (clone an existing widget type), not both')
  }
  if (opts.componentId !== undefined && opts.config == null) {
    throw new Error(`addWidgetToDashboard: cloning componentId '${opts.componentId}' needs its config (adapt the example from list_tenant_widgets)`)
  }
  if (opts.code !== undefined) assertAdvancedWidgetModule(opts.code)

  const mo = await getManagedObject(creds, dashboardId)
  const dashboard = mo.c8y_Dashboard
  if (!dashboard) throw new Error(`managed object ${dashboardId} has no c8y_Dashboard fragment - is this a dashboard id?`)

  const widgetId = crypto.randomUUID()
  const children = {
    ...(dashboard.children ?? {}),
    [widgetId]: {
      id: widgetId,
      componentId: opts.componentId ?? WIDGET_CONFIG_SHAPE.componentId,
      title: opts.title,
      _x: opts.x ?? 0,
      _y: opts.y ?? 0,
      _width: opts.width ?? 4,
      _height: opts.height ?? 4,
      config: opts.code !== undefined ? WIDGET_CONFIG_SHAPE.buildConfig(opts.code) : opts.config,
    },
  }

  await putFragment(creds, dashboardId, { c8y_Dashboard: { ...dashboard, children } })
  return { widgetId }
}
