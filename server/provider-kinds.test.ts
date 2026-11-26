import test from 'node:test'
import assert from 'node:assert/strict'
import { MODEL_SUGGESTIONS, PROVIDER_KINDS } from '../shared/catalog.js'
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
