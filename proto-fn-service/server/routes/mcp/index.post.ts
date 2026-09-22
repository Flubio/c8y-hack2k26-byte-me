import { defineHandler } from 'nitro/h3'
// import { hasUserRequiredRole } from 'c8y-nitro/utils'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { deployFunction, functionUrl, type DeployInput } from '../../utils/functions.ts'
import { credsFrom } from '../../utils/creds.ts'
import { useStore } from '../../utils/store.ts'
import { buildLitWidget } from '../../utils/widget.ts'
import { addWidgetToDashboard } from '../../utils/dashboard.ts'

export default defineHandler({
  // middleware: [hasUserRequiredRole('ROLE_PROTO_FN_CREATE')],
  handler: async (event) => {
    const creds = credsFrom(event.req)

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

    server.registerTool('add_widget_to_dashboard', {
      title: 'Add widget code directly to a Cockpit dashboard',
      description:
        'Adds the given widget source (Cumulocity HTML-widget Advanced-mode Lit code - see '
        + 'generate_widget for the contract and a safe starting point) to a dashboard, so it '
        + 'appears live without the user pasting anything. Only call this when a dashboard id is '
        + 'known (the user\'s message may include a "[Context: current Cockpit dashboard id = ...]" '
        + 'line - use that one unless the user names a different dashboard, or ask for the id if '
        + 'none is known). BEST-EFFORT: the dashboard-write config shape is unverified against a '
        + 'live tenant - if it returns ok:true but the tile appears blank or broken on the '
        + 'dashboard, give the user the code as a fenced block to paste manually instead.',
      inputSchema: {
        dashboardId: z.string(),
        title: z.string(),
        code: z.string().describe('full widget source, e.g. from generate_widget (verbatim or edited) or written from scratch'),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      },
    }, async ({ dashboardId, title, code, ...position }) => {
      try {
        const { widgetId } = await addWidgetToDashboard(creds, dashboardId, { title, code, ...position })
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
