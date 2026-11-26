import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQueryOptions } from './claude.js'
import { OAuthNeedsAuthError, type OAuthAccess } from '../oauth.js'
import type { Agent, Conversation, Team } from '../../shared/types.js'

const agent: Agent = { id: 'khaled', name: 'KHALED', role: 'ROLE', color: '#fff', model: 'claude-opus-5', effort: 'low', personality: 'p', tools: [], permissionMode: 'dontAsk', shape: 'blob', mcpServers: ['google-drive'], inheritClaudeSettings: false, autoApproveTools: false, provider: 'claude', muted: false, approvals: 'auto' }
const team: Team = {
  company: 'Co',
  owner: { id: 'user', name: 'Owner', title: 'CEO' },
  workspace: '.',
  agents: [agent],
  mcpServers: { 'google-drive': { type: 'http', url: 'https://drivemcp.googleapis.com/mcp/v1self' } },
  providers: { claude: { kind: 'claude', label: 'Claude' } },
  settings: { maxMessagesPerRound: 8, maxTurnsPerAgentPerRound: 2, maxTurnsPerReply: 40, groupMode: 'everyone', language: 'auto', notifications: true, autoReview: [] },
  skills: {},
}
const conversation: Conversation = { id: 'dm', kind: 'dm', name: 'DM', memberIds: ['user', 'khaled'], messages: [], sessions: {} }
const oauth: OAuthAccess = { accessToken: async () => 'fresh-token', authProvider: () => undefined, status: () => 'connected' }

function serverDef(options: Awaited<ReturnType<typeof buildQueryOptions>>): { headers?: Record<string, string> } | undefined {
  return options.mcpServers?.['google-drive'] as { headers?: Record<string, string> } | undefined
}

test('Claude recebe o token OAuth renovado no header do MCP', async () => {
  const options = await buildQueryOptions(team, conversation, agent, team.providers.claude!, undefined, new AbortController(), undefined, '', oauth)
  assert.equal(serverDef(options)?.headers?.Authorization, 'Bearer fresh-token')
})

test('sem OAuth o MCP continua sem header de autorização', async () => {
  const options = await buildQueryOptions(team, conversation, agent, team.providers.claude!, undefined, new AbortController())
  assert.equal(serverDef(options)?.headers?.Authorization, undefined)
})

test('refresh OAuth revogado vira aviso e não impede a montagem do turno', async () => {
  const revoked: OAuthAccess = { ...oauth, accessToken: async () => { throw new OAuthNeedsAuthError('invalid_grant') } }
  const notices: string[] = []
  const handlers = { onDelta: () => {}, onActivity: (line: string) => notices.push(line), onSession: () => {} }
  const options = await buildQueryOptions(team, conversation, agent, team.providers.claude!, undefined, new AbortController(), handlers, '', revoked)
  assert.equal(serverDef(options)?.headers?.Authorization, undefined)
  assert.ok(notices.some((n) => n.includes('not authorized')))
})
