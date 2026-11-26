import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server({ name: 'fake-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'ping', description: 'Ping the fake server', inputSchema: { type: 'object', properties: {} } },
    { name: 'read_file', description: 'Read a fake file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{
    type: 'text',
    text: `pong:${process.env.MCP_FIXTURE_TAG ?? ''}:${JSON.stringify(request.params.arguments ?? {})}`,
  }],
}))

await server.connect(new StdioServerTransport())
