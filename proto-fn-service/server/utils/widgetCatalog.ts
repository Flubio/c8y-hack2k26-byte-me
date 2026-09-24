import type { Creds } from './sandbox.ts'

/**
 * One widget instance as it actually exists on a tenant dashboard right now - the
 * ground truth for "what widgets are available", since Cockpit's built-in widget
 * registry lives in the Angular app, not anywhere this server can query. Scanning
 * live dashboards instead tells the agent what's *actually in use* in this tenant,
 * which is exactly what it needs to keep new widgets looking the same as existing ones.
 */
export interface TenantWidget {
  componentId: string
  title?: string
  dashboardId: string
  dashboardName?: string
  /** Full widget config, so a matching widget can be cloned and rebound rather than hand-built. */
  config: unknown
}

interface DashboardMO {
  id: string
  c8y_Dashboard?: { name?: string, children?: Record<string, { componentId?: string, title?: string, config?: unknown }> }
}

const PAGE_SIZE = 2000 // inventory API maximum

/** Pages through every dashboard - a short (or empty) page means there is no next one. */
export async function listTenantWidgets(creds: Creds): Promise<TenantWidget[]> {
  const managedObjects: DashboardMO[] = []
  for (let page = 1; ; page++) {
    const res = await fetch(`${creds.baseUrl}/inventory/managedObjects?fragmentType=c8y_Dashboard&pageSize=${PAGE_SIZE}&currentPage=${page}`, {
      headers: { ...creds.headers, accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`GET dashboards failed: HTTP ${res.status}`)
    const batch = (await res.json() as { managedObjects: DashboardMO[] }).managedObjects
    managedObjects.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  return managedObjects.flatMap((mo) => {
    const children = mo.c8y_Dashboard?.children ?? {}
    return Object.values(children)
      .filter(child => child.componentId)
      .map(child => ({
        componentId: child.componentId!,
        title: child.title,
        dashboardId: mo.id,
        dashboardName: mo.c8y_Dashboard?.name,
        config: child.config,
      }))
  })
}

/** Groups widget instances by componentId so the agent sees each widget *type* once, with one example config. */
export function summarizeCatalog(widgets: TenantWidget[]): { componentId: string, count: number, examples: TenantWidget[] }[] {
  const byType = new Map<string, TenantWidget[]>()
  for (const w of widgets) byType.set(w.componentId, [...(byType.get(w.componentId) ?? []), w])
  return [...byType.entries()]
    .map(([componentId, instances]) => ({ componentId, count: instances.length, examples: instances.slice(0, 2) }))
    .sort((a, b) => b.count - a.count)
}
