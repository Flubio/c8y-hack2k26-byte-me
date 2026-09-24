import { defineHandler } from 'nitro/h3'
import { useUserRoles } from 'c8y-nitro/utils'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { deployFunction, functionUrl, type DeployInput } from '../../utils/functions.ts'
import { credsFrom } from '../../utils/creds.ts'
import { useStore } from '../../utils/store.ts'
import { buildLitWidget } from '../../utils/widget.ts'
import { addWidgetToDashboard } from '../../utils/dashboard.ts'
import { listTenantWidgets, summarizeCatalog } from '../../utils/widgetCatalog.ts'

const CREATE_ROLE = 'ROLE_PROTO_FN_CREATE'

export default defineHandler({
  handler: async (event) => {
    const creds = credsFrom(event.req)

    /**
     * Checked inside the tools that create/mutate things, not as connection-level middleware -
     * the AI Agent Manager fetches the tool list itself (tools/list) before any user turn,
     * under a context that doesn't carry the calling user's roles, so gating the whole /mcp
     * POST 403s that discovery step and the manager never sees any tool, for any user.
     */
    async function requireCreateRole() {
      const roles = await useUserRoles(event)
      if (roles.includes(CREATE_ROLE)) return null
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: `User does not have required role(s) to access this resource: ${CREATE_ROLE}` }) }],
        isError: true as const,
      }
    }

    const server = new McpServer({ name: 'proto-fn', version: '1.0.0' })
    server.registerTool('deploy_function', {
      title: 'Deploy an edge function',
      description:
        'Deploys an agent-written function body. Validates it, dry-runs it in a QuickJS sandbox '
        + 'with exampleInput, stores it, and returns a callable URL. On failure returns the phase '
        + 'and errors so you can fix the code and call this again.',
      inputSchema: {
        slug: z.string().describe('kebab-case, 2-63 chars of a-z 0-9 -'),
        code: z.string().describe('FUNCTION BODY: top-level await + return; NO import/export/fetch/Node APIs; globals: input, c8y, log'),
        description: z.string().optional(),
        inputSchema: z.object({}).passthrough().optional().describe('JSON schema of `input`'),
        exampleInput: z.object({}).passthrough().optional().describe('sample input for the dry-run'),
        allowWrite: z.boolean().optional().describe('true to allow c8y.post/put/delete'),
      },
    }, async (args) => {
      const denied = await requireCreateRole()
      if (denied) return denied
      const result = await deployFunction(args as DeployInput, creds)
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok }
    })

    server.registerTool('generate_widget', {
      title: 'Get a starting-point Cockpit widget for a deployed function',
      description:
        'Returns a correct, contract-compliant Lit web component (Cumulocity\'s HTML widget in '
        + 'Advanced mode) that calls the function and dumps its JSON result: the right imports, '
        + 'the fetch call, loading/error state. Nothing here validates widget code before it runs '
        + 'on a dashboard (unlike deploy_function, there is no dry-run) - starting from this and '
        + 'editing it (e.g. replacing the raw JSON dump with a chart/gauge/table that fits the '
        + 'data) is safer than writing the Lit boilerplate from scratch. Use the result as-is or '
        + 'edited with add_widget_to_dashboard, or give it to the user as a fenced code block with: '
        + '"dashboard -> Add widget -> HTML -> enable Advanced mode -> paste."',
      inputSchema: { slug: z.string() },
    }, ({ slug }) => {
      const fn = useStore().get(slug)
      if (!fn) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'unknown function' }) }], isError: true }
      return { content: [{ type: 'text', text: buildLitWidget({ ...fn, url: functionUrl(fn.slug) }) }] }
    })

    server.registerTool('list_tenant_widgets', {
      title: 'List widget types already used on this tenant\'s dashboards',
      description:
        'Scans every dashboard in the tenant and returns the widget types (componentId) actually '
        + 'in use, grouped with a count and up to 2 example configs each. Call this before '
        + 'generate_widget to decide whether an existing widget type already fits the data - '
        + 'reusing one (via add_widget_to_dashboard with componentId+config, adapting the example '
        + 'config to the new data source) keeps the tenant\'s dashboards visually consistent '
        + 'instead of adding another one-off custom widget. Only fall back to generate_widget\'s '
        + 'custom HTML widget when nothing in this list fits the shape of the data.',
      inputSchema: {},
    }, async () => {
      try {
        const widgets = await listTenantWidgets(creds)
        return { content: [{ type: 'text', text: JSON.stringify(summarizeCatalog(widgets)) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: (err as Error).message }) }], isError: true }
      }
    })

    server.registerTool('add_widget_to_dashboard', {
      title: 'Add a widget directly to a Cockpit dashboard',
      description:
        'Adds a widget to a dashboard in one step, so it appears live without the user pasting '
        + 'anything. Two mutually exclusive ways to specify it:\n'
        + '1. code: Cumulocity HTML-widget Advanced-mode Lit source (see generate_widget for the '
        + 'contract and a safe starting point). Must contain `export default class ... extends '
        + 'LitElement`; never call `customElements.define()` or extend HTMLElement, because '
        + 'Cockpit can evaluate widget modules more than once. Never call `this.attachShadow()` '
        + 'either: LitElement already creates its shadow root; use `this.renderRoot` when '
        + 'imperative DOM APIs are necessary. Any HTTP call (including to this service\'s own '
        + '/service/proto-fn/run/<slug> endpoints) MUST use `import { fetch } from \'fetch\';` - '
        + 'Cockpit\'s sandbox only attaches the viewer\'s Cumulocity auth to that import, never to '
        + 'the ambient global `fetch`, which goes out unauthenticated and comes back 401.\n'
        + '2. componentId + config: clone an existing widget type (from list_tenant_widgets) by '
        + 'reusing its componentId and an adapted copy of its example config, when that widget '
        + 'type already fits the data - keeps the new widget looking like the rest of the tenant.\n'
        + 'Only call this when a dashboard id is known (the user\'s message may include a '
        + '"[Context: current Cockpit dashboard id = ...]" line - use that one unless the user '
        + 'names a different dashboard, or ask for the id if none is known). BEST-EFFORT: the '
        + 'dashboard-write config shape is unverified against a live tenant - if it returns '
        + 'ok:true but the tile appears blank or broken on the dashboard, give the user the code '
        + 'as a fenced block to paste manually instead.',
      inputSchema: {
        dashboardId: z.string(),
        title: z.string(),
        code: z.string().optional().describe('full widget source, e.g. from generate_widget (verbatim or edited) or written from scratch'),
        componentId: z.string().optional().describe('an existing widget type\'s componentId, from list_tenant_widgets'),
        config: z.unknown().optional().describe('that widget type\'s config, adapted to the new data source'),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      },
    }, async ({ dashboardId, title, code, componentId, config, ...position }) => {
      const denied = await requireCreateRole()
      if (denied) return denied
      try {
        const { widgetId } = await addWidgetToDashboard(creds, dashboardId, { title, code, componentId, config, ...position })
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, widgetId, dashboardId }) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: (err as Error).message }) }], isError: true }
      }
    })

    // web-standard transport: Nitro hands the handler a web Request/Response, not Node's req/res
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(event.req)
  },
})
