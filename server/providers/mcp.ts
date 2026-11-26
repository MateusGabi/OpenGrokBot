import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { GOOGLE_DRIVE_MCP_URL, type OAuthAccess } from '../oauth.js'
import type { Agent, McpServerDef, Team } from '../../shared/types.js'
import type { ExternalTool, ExternalToolRunner } from './types.js'

export interface McpBundle {
  tools: ExternalTool[]
  callTool: ExternalToolRunner
  close: () => Promise<void>
}

function transportFor(def: McpServerDef, authProvider?: OAuthClientProvider) {
  if (def.type === 'stdio') {
    return new StdioClientTransport({
      command: def.command,
      args: def.args,
      env: { ...(process.env as Record<string, string>), ...def.env },
    })
  }
  const url = new URL(def.url)
  const options = { requestInit: { headers: def.headers }, ...(authProvider ? { authProvider } : {}) }
  if (def.type === 'http') return new StreamableHTTPClientTransport(url, options)
  return new SSEClientTransport(url, options)
}

/** Opens the MCP servers enabled for one agent and exposes their tools as OpenAI function tools. */
export async function openMcpServers(team: Team, agent: Agent, onNotice?: (line: string) => void, oauth?: OAuthAccess): Promise<McpBundle> {
  const tools: ExternalTool[] = []
  const targets = new Map<string, { client: Client; toolName: string }>()
  const clients: Client[] = []

  for (const name of agent.mcpServers) {
    const def = team.mcpServers[name]
    if (!def) continue
    const status = oauth?.status(name)
    if (oauth && status === 'configured') {
      // "configured" includes an expired but refreshable grant — try the refresh before giving up.
      let token: string | undefined
      try {
        token = await oauth.accessToken(name)
      } catch {
        token = undefined
      }
      if (!token) {
        onNotice?.(`MCP ${name}: not authorized — reconnect in Settings → Marketplace`)
        continue
      }
    }
    if (oauth && status === 'absent' && def.type !== 'stdio' && def.url === GOOGLE_DRIVE_MCP_URL) {
      onNotice?.(`MCP ${name}: not authorized — reconnect in Settings → Marketplace`)
      continue
    }
    let client: Client | undefined
    try {
      client = new Client({ name: 'opengrokbot', version: '1.0.0' })
      await client.connect(transportFor(def, oauth?.authProvider(name)))
      const listed = await client.listTools()
      clients.push(client)
      for (const tool of listed.tools) {
        const fullName = `mcp__${name}__${tool.name}`
        tools.push({
          name: fullName,
          description: tool.description ?? '',
          parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        })
        targets.set(fullName, { client, toolName: tool.name })
      }
    } catch (err) {
      onNotice?.(`MCP ${name}: ${err instanceof Error ? err.message : String(err)}`)
      if (client) await client.close().catch(() => {})
    }
  }

  return {
    tools,
    callTool: async (name, args) => {
      const target = targets.get(name)
      if (!target) return `Error: unknown MCP tool ${name}`
      const result = await target.client.callTool({ name: target.toolName, arguments: args })
      const content = result.content as { type: string; text?: string }[]
      const text = content.map((item) => (item.type === 'text' ? (item.text ?? '') : JSON.stringify(item))).join('\n')
      return result.isError ? `MCP error: ${text}` : text
    },
    close: async () => {
      await Promise.all(clients.map((client) => client.close().catch(() => {})))
    },
  }
}
