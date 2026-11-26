import { useEffect, useRef, useState } from 'react'
import { officesApi, type OfficeInfo } from '../offices'

interface OfficesProps {
  onClose: () => void
}

/** Office manager inside the app, opened with Ctrl+Shift+O (Electron only). */
export function Offices({ onClose }: OfficesProps) {
  const api = officesApi()
  const [offices, setOffices] = useState<OfficeInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [status, setStatus] = useState('')
  const search = useRef<HTMLInputElement | null>(null)
  const newInput = useRef<HTMLInputElement | null>(null)

  const refresh = async (): Promise<void> => {
    if (!api) return
    try {
      const state = await api.list()
      setOffices(state.offices)
      setActiveId(state.activeId)
      setSelectedId((current) => (state.offices.some((o) => o.id === current) ? current : state.activeId ?? state.offices[0]?.id ?? null))
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (showNew) newInput.current?.focus()
  }, [showNew])

  const selected = offices.find((o) => o.id === selectedId)
  const needle = filter.trim().toLowerCase()
  const shown = offices.filter((o) => !needle || o.name.toLowerCase().includes(needle) || o.id.includes(needle))

  const run = async (fn: () => Promise<unknown>, nextId?: (result: unknown) => string): Promise<void> => {
    if (!api) return
    try {
      const result = await fn()
      setStatus('')
      if (nextId) setSelectedId(nextId(result))
      await refresh()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const create = () => {
    const name = newName.trim()
    if (!name || !api) return
    void run(() => api.create(name), (result) => (result as OfficeInfo).id).then(() => {
      setNewName('')
      setShowNew(false)
    })
  }

  const addExisting = () => {
    if (!api) return
    const dir = window.prompt('Folder containing team.json')
    if (!dir?.trim()) return
    const suggested = dir.trim().split(/[\\/]/).filter(Boolean).pop() ?? 'Office'
    const name = window.prompt('Office name', suggested)
    if (!name?.trim()) return
    void run(() => api.add(dir.trim(), name.trim()), (result) => (result as OfficeInfo).id)
  }

  const rename = () => {
    if (!api || !selected) return
    const next = window.prompt('Office name', selected.name)
    if (!next?.trim()) return
    void run(() => api.rename(selected.id, next.trim()))
  }

  const remove = () => {
    if (!api || !selected || selected.id === 'default') return
    if (!window.confirm(`Remove "${selected.name}" from the list? Files stay on disk.`)) return
    const underOffices = /[\\/]offices[\\/][^\\/]+$/.test(selected.dir)
    const deleteData = underOffices && window.confirm('Also delete the files? This cannot be undone.')
    void run(() => api.remove(selected.id, deleteData), () => 'default')
  }

  if (!api) {
    return (
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal offices-modal" role="dialog" aria-label="Offices">
          <p className="offices-page-hint">Office management is available in the desktop app.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal offices-modal" role="dialog" aria-label="Offices">
        <aside className="offices-side">
          <div className="offices-workspace">
            <span className="offices-logo">O</span>
            <strong>OpenGrokBot</strong>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close (Esc)">
              ×
            </button>
          </div>

          <button type="button" className="offices-item" onClick={() => search.current?.focus()}>
            <span className="offices-icon">⌕</span> Quick find <kbd>Ctrl K</kbd>
          </button>
          <input ref={search} className="offices-search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter offices…" aria-label="Filter offices" />
          <button type="button" className="offices-item offices-new" onClick={() => setShowNew(true)}>
            <span className="offices-icon">＋</span> New office
          </button>
          {showNew && (
            <form
              className="offices-new-form"
              onSubmit={(e) => {
                e.preventDefault()
                create()
              }}
            >
              <input ref={newInput} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder="Office name…" aria-label="New office name" />
              <button type="submit">Create office</button>
            </form>
          )}

          <div className="offices-label">Private</div>
          <nav className="offices-list" aria-label="Your offices">
            {shown.map((office) => (
              <button key={office.id} type="button" className={`offices-row${office.id === selectedId ? ' is-selected' : ''}`} onClick={() => setSelectedId(office.id)}>
                <span className="offices-icon">🏢</span>
                <span className="offices-row-name">{office.name}</span>
                <span className="offices-port">{office.port}</span>
              </button>
            ))}
            {shown.length === 0 && <p className="offices-empty-hint">{needle ? 'No match.' : 'No offices yet.'}</p>}
          </nav>

          <div className="offices-footer">
            <button type="button" className="offices-item" onClick={addExisting}>
              <span className="offices-icon">↗</span> Add existing folder…
            </button>
          </div>
        </aside>

        <div className="offices-page">
          <header className="offices-crumb">
            Offices <span>/</span> <strong>{selected?.name ?? ''}</strong>
          </header>
          {selected ? (
            <section className="offices-content">
              <div className="offices-page-icon">🏢</div>
              <h1>{selected.name}</h1>
              <div className="offices-props">
                <div><span>Status</span><span>{selected.id === activeId ? 'Open' : 'Available'}</span></div>
                <div><span>Port</span><span className="mono">{selected.port}</span></div>
                <div><span>Folder</span><span className="path">{selected.dir}</span></div>
              </div>
              <div className="offices-actions">
                <button type="button" className="primary" onClick={() => void run(() => api.open(selected.id), () => selected.id)}>
                  Open office
                </button>
                <button type="button" className="ghost" onClick={rename}>Rename</button>
                <button type="button" className="ghost danger" onClick={remove} disabled={selected.id === 'default'}>
                  Delete
                </button>
              </div>
              <p className="offices-page-hint">Each office has its own team, conversations and workspace folder.</p>
            </section>
          ) : (
            <section className="offices-content offices-blank">
              <div className="offices-page-icon">🏢</div>
              <h2>No office selected</h2>
              <p>Choose one in the sidebar, or create a new office.</p>
            </section>
          )}
          {status && <p className="offices-status" role="alert">{status}</p>}
        </div>
      </div>
    </div>
  )
}
