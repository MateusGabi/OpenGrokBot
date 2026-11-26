import test from 'node:test'
import assert from 'node:assert/strict'
import { API_PRESETS, MODEL_SUGGESTIONS, PROVIDER_KINDS, TOOLS } from '../shared/catalog.js'
import { parseTeam } from './team.js'

test('opencode is a valid provider kind', () => {
  assert.deepEqual(MODEL_SUGGESTIONS.opencode, [])
  assert.ok(PROVIDER_KINDS.some((k) => k.id === 'opencode'))
  const team = parseTeam({
    company: 'T', owner: { id: 'user', name: 'B', title: 'CEO' }, workspace: '.',
    providers: { opencode2: { kind: 'opencode', label: 'Opencode 2', baseUrl: 'https://x/v1', apiKey: 'k' } },
    agents: [], skills: {}, settings: {},
  }, '.')
  assert.equal(team.providers.opencode2?.kind, 'opencode')
})

test('the Opencode + MCP preset creates a provider that can enable marketplace MCPs', () => {
  const preset = API_PRESETS.find((p) => p.id === 'opencode2')
  assert.ok(preset)
  assert.equal(preset.kind, 'opencode')
  assert.ok(preset.baseUrl)
  const team = parseTeam({
    company: 'T', owner: { id: 'user', name: 'B', title: 'CEO' }, workspace: '.',
    providers: { [preset.id]: { kind: preset.kind, label: preset.label, baseUrl: preset.baseUrl } },
    agents: [{ id: 'a', name: 'A', role: 'R', color: '#fff', shape: 'blob', provider: preset.id, model: 'm', effort: 'low', personality: 'p', tools: [], mcpServers: ['github'], approvals: 'auto' }],
    skills: {}, settings: {}, mcpServers: { github: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } },
  }, '.')
  assert.equal(team.providers.opencode2?.kind, 'opencode')
  assert.deepEqual(team.agents[0]?.mcpServers, ['github'])
})

test('opencode agent can configure the local tools the provider actually runs', () => {
  assert.deepEqual(TOOLS.filter((t) => t.kinds.includes('opencode')).map((t) => t.id), [
    'Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'WebFetch',
  ])
})
