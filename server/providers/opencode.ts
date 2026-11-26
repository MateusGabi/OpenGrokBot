import { openMcpServers } from './mcp.js'
import { runOpenAiCompatibleTurn } from './openai.js'
import type { RunTurnParams, TurnResult } from './types.js'

/** Opencode's OpenAI-compatible API with the employee's MCP tools attached. */
export async function runOpencodeTurn(params: RunTurnParams): Promise<TurnResult> {
  const { agent, handlers } = params
  const bundle = await openMcpServers(params.team, agent, handlers.onActivity)
  try {
    const note = agent.mcpServers.length > 0 ? ` You also have MCP tools from: ${agent.mcpServers.join(', ')}.` : ''
    return await runOpenAiCompatibleTurn(params, bundle.tools, bundle.callTool, note)
  } finally {
    await bundle.close()
  }
}
