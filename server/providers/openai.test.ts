import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTeam } from '../team.js'
import { runOpenAiCompatibleTurn, runOpenAiTurn } from './openai.js'
import type { RunTurnParams, TurnHandlers } from './types.js'
import type { ExternalTool } from './types.js'

const EXTRA: ExternalTool = { name: 'mcp__fake__ping', description: 'Ping', parameters: { type: 'object', properties: {} } }

function sse(...chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

function fixture(responses: string[]): { captured: Record<string, unknown>[]; restore: () => void } {
  const captured: Record<string, unknown>[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    captured.push(JSON.parse(String(init?.body)))
    const body = responses.shift() ?? sse({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  return { captured, restore: () => { globalThis.fetch = original } }
}

function params(tools: string[], mcpServers: string[] = []): RunTurnParams {
  const team = parseTeam({
    company: 'T', owner: { id: 'user', name: 'B', title: 'CEO' }, workspace: '.',
    providers: { api: { kind: 'openai', label: 'API', baseUrl: 'http://mock/v1', apiKey: 'k' } },
    mcpServers: { notion: { type: 'stdio', command: 'npx', args: ['fake'] } },
    agents: [{ id: 'a', name: 'A', role: 'R', color: '#fff', shape: 'blob', provider: 'api', model: 'm', effort: 'low', personality: 'p', tools, mcpServers }],
    skills: {}, settings: {},
  }, '.')
  const handlers: TurnHandlers = { onDelta() {}, onActivity() {}, onSession() {} }
  return { team, conversation: { id: 'c', kind: 'dm', name: 'c', memberIds: ['a'], messages: [], sessions: {} }, agent: team.agents[0]!, provider: team.providers.api!, sessionId: undefined, signal: new AbortController().signal, handlers }
}

function toolNames(body: Record<string, unknown>): string[] {
  return ((body.tools as { function: { name: string } }[] | undefined) ?? []).map((t) => t.function.name)
}

test('openai runner keeps sending only local tools even when the agent lists MCP servers', async () => {
  const fx = fixture([sse({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })])
  try {
    await runOpenAiTurn(params(['Read'], ['notion']))
    assert.deepEqual(toolNames(fx.captured[0]!), ['read_file'])
  } finally {
    fx.restore()
  }
})

test('shared loop offers and executes injected external tools', async () => {
  const fx = fixture([
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'mcp__fake__ping', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }),
    sse({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }),
  ])
  const calls: string[] = []
  try {
    const p = params(['Read'])
    const result = await runOpenAiCompatibleTurn(p, [EXTRA], async (name, args) => {
      calls.push(name)
      return `pong:${JSON.stringify(args)}`
    }, ' You also have MCP tools from: fake.')
    assert.ok(toolNames(fx.captured[0]!).includes('mcp__fake__ping'))
    assert.deepEqual(calls, ['mcp__fake__ping'])
    const secondMessages = fx.captured[1]!.messages as { role: string; content: string | null }[]
    assert.equal(secondMessages.at(-1)?.role, 'tool')
    assert.equal(secondMessages.at(-1)?.content, 'pong:{}')
    assert.match(JSON.stringify(fx.captured[0]!.messages), /You also have MCP tools from: fake/)
    assert.equal(result.text.trim(), 'done')
  } finally {
    fx.restore()
  }
})

test('shared loop streams text through onDelta', async () => {
  const fx = fixture([sse({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] })])
  const deltas: string[] = []
  try {
    const p = params(['Read'])
    await runOpenAiCompatibleTurn({ ...p, handlers: { ...p.handlers, onDelta: (t: string) => deltas.push(t) } }, [], undefined, '')
    assert.deepEqual(deltas, ['hi'])
  } finally {
    fx.restore()
  }
})
