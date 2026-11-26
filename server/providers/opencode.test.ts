import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { parseTeam } from '../team.js'
import { runProviderTurn } from './index.js'
import { runOpencodeTurn } from './opencode.js'
import type { RunTurnParams, TurnHandlers } from './types.js'

const FIXTURE = path.join(process.cwd(), 'server/providers/fixtures/fake-mcp.mjs')

function sse(...chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

function fixture(responses: string[]): { captured: Record<string, unknown>[]; restore: () => void } {
  const captured: Record<string, unknown>[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    captured.push(JSON.parse(String(init?.body)))
    return new Response(responses.shift() ?? sse({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }), {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    })
  }) as typeof fetch
  return { captured, restore: () => { globalThis.fetch = original } }
}

function params(deny = false): RunTurnParams {
  const team = parseTeam({
    company: 'T', owner: { id: 'user', name: 'B', title: 'CEO' }, workspace: '.',
    providers: { opencode2: { kind: 'opencode', label: 'Opencode 2', baseUrl: 'http://mock/v1', apiKey: 'k' } },
    mcpServers: { fake: { type: 'stdio', command: process.execPath, args: [FIXTURE] } },
    agents: [{ id: 'a', name: 'A', role: 'R', color: '#fff', shape: 'blob', provider: 'opencode2', model: 'm', effort: 'low', personality: 'p', tools: ['Read'], mcpServers: ['fake'], approvals: deny ? 'ask-dangerous' : 'auto' }],
    skills: {}, settings: {},
  }, '.')
  const notices: string[] = []
  const handlers: TurnHandlers = { onDelta() {}, onActivity: (line) => notices.push(line), onSession() {}, onToolPermission: async () => !deny }
  return { team, conversation: { id: 'c', kind: 'dm', name: 'c', memberIds: ['a'], messages: [], sessions: {} }, agent: team.agents[0]!, provider: team.providers.opencode2!, sessionId: undefined, signal: new AbortController().signal, handlers }
}

function toolCallAndStop(): string[] {
  return [
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'mcp__fake__ping', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }),
    sse({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }),
  ]
}

test('opencode runner is registered and sends MCP tools to the model', async () => {
  const fx = fixture(toolCallAndStop())
  try {
    await runProviderTurn(params())
    const names = ((fx.captured[0]!.tools as { function: { name: string } }[]) ?? []).map((t) => t.function.name)
    assert.ok(names.includes('mcp__fake__ping'))
    const messages = fx.captured[1]!.messages as { role: string; content: string | null }[]
    assert.match(messages.at(-1)?.content ?? '', /pong:/)
  } finally {
    fx.restore()
  }
})

test('denied MCP tool is not executed', async () => {
  const fx = fixture(toolCallAndStop())
  try {
    await runOpencodeTurn(params(true))
    const messages = fx.captured[1]!.messages as { role: string; content: string | null }[]
    assert.match(messages.at(-1)?.content ?? '', /Denied by the boss/)
    assert.doesNotMatch(messages.at(-1)?.content ?? '', /pong:/)
  } finally {
    fx.restore()
  }
})
