import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import type { OAuthAccess } from '../oauth.js'
import { parseTeam } from '../team.js'
import { openMcpServers } from './mcp.js'

const FIXTURE = path.join(process.cwd(), 'server/providers/fixtures/fake-mcp.mjs')

function teamWith(serverName: string, env?: Record<string, string>) {
  return parseTeam({
    company: 'T', owner: { id: 'user', name: 'B', title: 'CEO' }, workspace: '.',
    providers: { api: { kind: 'openai', label: 'API', baseUrl: 'http://mock/v1', apiKey: 'k' } },
    mcpServers: { [serverName]: { type: 'stdio', command: process.execPath, args: [FIXTURE], ...(env ? { env } : {}) } },
    agents: [{ id: 'a', name: 'A', role: 'R', color: '#fff', shape: 'blob', provider: 'api', model: 'm', effort: 'low', personality: 'p', tools: [], mcpServers: [serverName] }],
    skills: {}, settings: {},
  }, '.')
}

test('lists MCP tools and calls them by their full mcp name', async () => {
  const team = teamWith('fake')
  const bundle = await openMcpServers(team, team.agents[0]!)
  try {
    assert.equal(bundle.tools[0]?.name, 'mcp__fake__ping')
    const result = await bundle.callTool('mcp__fake__ping', { n: 1 }, new AbortController().signal)
    assert.match(result, /pong::\{"n":1\}/)
  } finally {
    await bundle.close()
  }
})

test('server and tool names containing underscores still resolve', async () => {
  const team = teamWith('my_server')
  const bundle = await openMcpServers(team, team.agents[0]!)
  try {
    assert.ok(bundle.tools.some((t) => t.name === 'mcp__my_server__read_file'))
    const result = await bundle.callTool('mcp__my_server__read_file', { path: 'x' }, new AbortController().signal)
    assert.match(result, /pong::\{"path":"x"\}/)
  } finally {
    await bundle.close()
  }
})

test('stdio env reaches the MCP server', async () => {
  const team = teamWith('tagged', { MCP_FIXTURE_TAG: 'abc' })
  const bundle = await openMcpServers(team, team.agents[0]!)
  try {
    const result = await bundle.callTool('mcp__tagged__ping', {}, new AbortController().signal)
    assert.match(result, /pong:abc/)
  } finally {
    await bundle.close()
  }
})

test('a server that fails to start is reported and skipped', async () => {
  const team = parseTeam({
    company: 'T', owner: { id: 'user', name: 'B', title: 'CEO' }, workspace: '.',
    providers: { api: { kind: 'openai', label: 'API', baseUrl: 'http://mock/v1', apiKey: 'k' } },
    mcpServers: { broken: { type: 'stdio', command: process.execPath, args: ['-e', 'process.exit(1)'] } },
    agents: [{ id: 'a', name: 'A', role: 'R', color: '#fff', shape: 'blob', provider: 'api', model: 'm', effort: 'low', personality: 'p', tools: [], mcpServers: ['broken'] }],
    skills: {}, settings: {},
  }, '.')
  const notices: string[] = []
  const bundle = await openMcpServers(team, team.agents[0]!, (line) => notices.push(line))
  try {
    assert.deepEqual(bundle.tools, [])
    assert.ok(notices.some((n) => n.startsWith('MCP broken:')))
  } finally {
    await bundle.close()
  }
})

test('MCP sem autorização OAuth é ignorado com aviso em turno de funcionário', async () => {
  const team = teamWith('fake')
  const notices: string[] = []
  const oauth: OAuthAccess = { status: () => 'configured', accessToken: async () => undefined, authProvider: () => undefined }
  const bundle = await openMcpServers(team, team.agents[0]!, (line) => notices.push(line), oauth)
  try {
    assert.deepEqual(bundle.tools, [])
    assert.ok(notices.some((n) => n.includes('not authorized') && n.includes('fake')))
  } finally {
    await bundle.close()
  }
})
