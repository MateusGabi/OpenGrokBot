import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Agent, Conversation, Team } from '../shared/types.js'
import { orderConversations } from '../shared/conversationOrder.js'

function agent(id: string): Agent {
  return { id, name: id, role: 'ROLE', color: '#fff', model: 'm', effort: 'low', personality: 'p', tools: [], permissionMode: 'dontAsk', shape: 'blob', mcpServers: [], inheritClaudeSettings: false, autoApproveTools: false, provider: 'claude', muted: false, approvals: 'auto' }
}

const team: Team = {
  company: 'Co',
  owner: { id: 'user', name: 'Owner', title: 'CEO' },
  workspace: '.',
  agents: [agent('first'), agent('second'), agent('third')],
  providers: {},
  mcpServers: {},
  skills: {},
  settings: { maxMessagesPerRound: 8, maxTurnsPerAgentPerRound: 2, maxTurnsPerReply: 40, groupMode: 'everyone', language: 'auto', notifications: true, autoReview: [] },
}

function chat(id: string, memberIds: string[], createdAt: number, messageAt?: number): Conversation {
  return {
    id,
    kind: id.startsWith('dm-') ? 'dm' : 'group',
    name: id,
    memberIds: ['user', ...memberIds],
    sessions: {},
    createdAt,
    messages: messageAt === undefined ? [] : [{ id: `${id}-m`, conversationId: id, authorId: 'user', text: 'hi', createdAt: messageAt, status: 'done' }],
  }
}

test('newest message goes to the top, regardless of team order or creation time', () => {
  const conversations = [
    chat('group', ['first', 'second'], 100, 200),
    chat('dm-first', ['first'], 110, 400),
    chat('dm-second', ['second'], 120, 300),
  ]
  assert.deepEqual(orderConversations(conversations, team).map((c) => c.id), ['dm-first', 'dm-second', 'group'])
})

test('a new message lifts an older conversation to the top without mutating input', () => {
  const idle = chat('group', ['first'], 100, 500)
  const active = chat('dm-second', ['second'], 110, 200)
  const before = orderConversations([idle, active], team).map((c) => c.id)
  assert.deepEqual(before, ['group', 'dm-second'])
  active.messages.push({ id: 'new', conversationId: active.id, authorId: 'user', text: 'later', createdAt: 600, status: 'done' })
  assert.deepEqual(orderConversations([idle, active], team).map((c) => c.id), ['dm-second', 'group'])
  assert.deepEqual([idle, active].map((c) => c.id), ['group', 'dm-second'], 'input order is unchanged')
})

test('pinned chats stay above the recency order', () => {
  const pinned = { ...chat('dm-third', ['third'], 100, 100), pinned: true }
  const newest = chat('dm-first', ['first'], 110, 900)
  assert.deepEqual(orderConversations([newest, pinned], team).map((c) => c.id), ['dm-third', 'dm-first'])
})

test('chats without messages keep the default order and sit below active chats', () => {
  const conversations = [
    chat('dm-third', ['third'], 400),
    chat('dm-first', ['first'], 300),
    chat('dm-second', ['second'], 200, 100),
    chat('group', ['first'], 100),
  ]
  assert.deepEqual(orderConversations(conversations, team).map((c) => c.id), ['dm-second', 'group', 'dm-first', 'dm-third'])
})
