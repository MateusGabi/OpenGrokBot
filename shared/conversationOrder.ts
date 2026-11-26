import type { Conversation, Team } from './types.js'

/**
 * Sidebar order: pinned chats first, then the conversation with the newest
 * message on top. Chats that have never been messaged keep the default
 * group/team order and sit below every chat with activity.
 */
export function orderConversations(conversations: Conversation[], team: Team): Conversation[] {
  const rank = (c: Conversation): number => {
    if (c.id === 'group') return -1
    if (c.kind === 'group') return -0.5
    const agentId = c.memberIds.find((id) => id !== 'user')
    const i = team.agents.findIndex((a) => a.id === agentId)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  const lastActivity = (c: Conversation): number => c.messages[c.messages.length - 1]?.createdAt ?? Number.NEGATIVE_INFINITY

  return [...conversations].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    const aAt = lastActivity(a)
    const bAt = lastActivity(b)
    if (aAt !== bAt) return bAt - aAt
    return rank(a) - rank(b) || (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
}
