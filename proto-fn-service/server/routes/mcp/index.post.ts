import { defineHandler } from 'nitro/h3'
// import { hasUserRequiredRole } from 'c8y-nitro/utils'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { deployFunction, type DeployInput } from '../../utils/functions.ts'
import { credsFrom } from '../../utils/creds.ts'

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

    // web-standard transport: Nitro hands the handler a web Request/Response, not Node's req/res
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(event.req)
  },
})
