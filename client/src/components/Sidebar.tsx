import { useState } from 'react'
import { orderConversations } from '../../../shared/conversationOrder'
import type { ApprovalRequest, Conversation, Team } from '../../../shared/types'
import { conversationAvatars, conversationTitle, formatTime, personFor } from '../people'
import type { Theme } from '../theme'
import { lastRead } from '../unread'
import { Avatar, AvatarCluster } from './Avatar'

interface SidebarProps {
  team: Team
  conversations: Conversation[]
  activeId: string
  busy: Set<string>
  approvals: ApprovalRequest[]
  /** Bumped by the parent whenever read markers change, so badges refresh. */
  readTick: number
  onSelect: (id: string) => void
  onMenu: (conversationId: string, x: number, y: number) => void
  onSettings: () => void
  onNewChat: () => void
  onSearch: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function Sidebar({ team, conversations, activeId, busy, approvals, readTick, onSelect, onMenu, onSettings, onNewChat, onSearch, theme, onToggleTheme }: SidebarProps) {
  const [q, setQ] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const owner = personFor(team, 'user')
  void readTick
  const ordered = orderConversations(conversations, team)
  const filtered = ordered.filter((c) => conversationTitle(team, c).toLowerCase().includes(q.trim().toLowerCase()))
  const visible = filtered.filter((c) => !c.hidden)
  const hidden = filtered.filter((c) => c.hidden)
  const attention = new Set(approvals.map((a) => a.conversationId))

  const row = (c: Conversation) => {
    const last = c.messages[c.messages.length - 1]
    const people = conversationAvatars(c).map((id) => personFor(team, id))
    const active = c.id === activeId
    const preview = last ? previewOf(team, c, last.authorId, last.text) : c.kind === 'group' ? 'Say hi to the team' : 'Start a conversation'
    const agent = c.kind === 'dm' ? people[0]?.agent : undefined
    const since = lastRead(c.id)
    const unread = active ? 0 : c.messages.filter((m) => m.authorId !== 'user' && m.status === 'done' && m.createdAt > since).length
    const needs = attention.has(c.id)
    return (
      <button
        key={c.id}
        type="button"
        className={`conversation${active ? ' is-active' : ''}${unread > 0 ? ' is-unread' : ''}`}
        onClick={() => onSelect(c.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(c.id, e.clientX, e.clientY)
        }}
      >
        <span className="conversation-avatar">
          <AvatarCluster people={people} size={c.kind === 'group' ? 40 : 44} />
        </span>
        <span className="conversation-body">
          <span className="conversation-row">
            <span className="conversation-title">
              {c.pinned && <PinIcon />}
              {conversationTitle(team, c)}
            </span>
            {agent?.department && <span className="badge">{agent.department}</span>}
            {agent?.muted && <span className="badge" title="Muted in groups">muted</span>}
            {last && <span className="conversation-time">{formatTime(last.createdAt)}</span>}
          </span>
          <span className="conversation-row">
            <span className="conversation-preview">{preview}</span>
            {needs ? <span className="dot is-attention" title="Needs your approval" /> : busy.has(c.id) ? <span className="dot" aria-label="Replying" /> : unread > 0 ? <span className="unread">{unread > 99 ? '99+' : unread}</span> : null}
          </span>
        </span>
        <span
          className="conversation-more"
          role="button"
          tabIndex={-1}
          aria-label="More"
          onClick={(e) => {
            e.stopPropagation()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onMenu(c.id, r.left, r.bottom + 4)
          }}
        >
          <MoreIcon />
        </span>
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button
          type="button"
          className="icon-button"
          title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          onClick={onToggleTheme}
        >
          {theme === 'light' ? <MoonIcon /> : <SunIcon />}
        </button>
        <button type="button" className="icon-button" title="Search (Ctrl+K)" aria-label="Search" onClick={onSearch}>
          <SearchIcon />
        </button>
        <button type="button" className="icon-button" title="New group chat" aria-label="New group chat" onClick={onNewChat}>
          <PlusIcon />
        </button>
      </div>
      <label className="search">
        <SearchIcon />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" />
      </label>
      <nav className="conversation-list">
        {visible.map(row)}
        {hidden.length > 0 && (
          <button type="button" className="hidden-toggle" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? 'Hide hidden chats' : `Show ${hidden.length} hidden chat${hidden.length === 1 ? '' : 's'}`}
          </button>
        )}
        {showHidden && hidden.map(row)}
      </nav>
      <div className="sidebar-bottom">
        <button type="button" className="sidebar-item" onClick={onSettings}>
          <span className="sidebar-item-icon">
            <GearIcon />
          </span>
          <span>Settings</span>
        </button>
        <button type="button" className="sidebar-item" onClick={onSettings}>
          <Avatar person={owner} size={30} />
          <span>{owner.name}</span>
          <span className="muted small">{team.company}</span>
        </button>
      </div>
    </aside>
  )
}

function previewOf(team: Team, c: Conversation, authorId: string, text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return `${personFor(team, authorId).name} is typing…`
  if (c.kind === 'dm' || authorId === 'user') return clean
  return `${personFor(team, authorId).name}: ${clean}`
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M10 4v12M4 10h12" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg className="pin-icon" width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
      <path d="M12 2l6 6-2 1-3-1-3 3 1 4-1 1-4-4-4 4-1-1 4-4-4-4 1-1 4 1 3-3-1-3z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="9" cy="9" r="6" />
      <path d="M14 14l3.5 3.5" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
      <circle cx="4" cy="10" r="1.8" />
      <circle cx="10" cy="10" r="1.8" />
      <circle cx="16" cy="10" r="1.8" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" />
    </svg>
  )
}
