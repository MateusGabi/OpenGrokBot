// Notion-style offices workspace: a sidebar of offices and a detail page.
// No framework, no network: every action goes through the preload bridge.
const list = document.getElementById('list')
const search = document.getElementById('search')
const find = document.getElementById('find')
const newSide = document.getElementById('new-side')
const newForm = document.getElementById('new')
const input = document.getElementById('name')
const addButton = document.getElementById('add')
const closeButton = document.getElementById('close')
const themeButton = document.getElementById('theme')
const detail = document.getElementById('detail')
const empty = document.getElementById('empty')
const crumb = document.getElementById('crumb-name')
const detailName = document.getElementById('detail-name')
const detailStatus = document.getElementById('detail-status')
const detailPort = document.getElementById('detail-port')
const detailDir = document.getElementById('detail-dir')
const openButton = document.getElementById('open')
const renameButton = document.getElementById('rename')
const removeButton = document.getElementById('remove')
const status = document.getElementById('status')
const THEME_KEY = 'opengrokbot-theme'

let offices = []
let activeId = null
let selectedId = null

function fail(err) {
  status.textContent = err instanceof Error ? err.message : String(err)
}

function select(id) {
  selectedId = id
  status.textContent = ''
  render()
}

async function render() {
  try {
    const state = await window.offices.list()
    offices = state.offices
    activeId = state.activeId
    if (!offices.some((o) => o.id === selectedId)) selectedId = activeId ?? offices[0]?.id ?? null

    const needle = search.value.trim().toLowerCase()
    const shown = offices.filter((o) => !needle || o.name.toLowerCase().includes(needle) || o.id.includes(needle))
    list.replaceChildren(
      ...shown.map((office) => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = office.id === selectedId ? 'office-row is-selected' : 'office-row'
        row.innerHTML = '<span class="emoji">🏢</span><span class="label"></span><span class="port"></span>'
        row.querySelector('.label').textContent = office.name
        row.querySelector('.port').textContent = String(office.port)
        row.addEventListener('click', () => select(office.id))
        return row
      }),
    )
    if (shown.length === 0) {
      const note = document.createElement('div')
      note.className = 'side-label'
      note.textContent = needle ? 'No match.' : 'No offices yet.'
      list.append(note)
    }

    const selected = offices.find((o) => o.id === selectedId)
    detail.hidden = !selected
    empty.hidden = !!selected
    if (selected) {
      crumb.textContent = selected.name
      detailName.textContent = selected.name
      detailStatus.textContent = selected.id === activeId ? 'Open' : 'Available'
      detailPort.textContent = String(selected.port)
      detailDir.textContent = selected.dir
      removeButton.disabled = selected.id === 'default'
      removeButton.title = selected.id === 'default' ? 'The default office cannot be removed' : ''
    } else {
      crumb.textContent = ''
    }
  } catch (err) {
    fail(err)
  }
}

openButton.addEventListener('click', () => {
  const office = offices.find((o) => o.id === selectedId)
  if (!office) return
  void window.offices
    .open(office.id)
    .then(() => render())
    .catch(fail)
})

renameButton.addEventListener('click', () => {
  const office = offices.find((o) => o.id === selectedId)
  if (!office) return
  const next = window.prompt('Office name', office.name)
  if (!next || !next.trim()) return
  void window.offices
    .rename(office.id, next.trim())
    .then(() => render())
    .catch(fail)
})

removeButton.addEventListener('click', () => {
  const office = offices.find((o) => o.id === selectedId)
  if (!office || office.id === 'default') return
  if (!window.confirm(`Remove "${office.name}" from the list? Files stay on disk.`)) return
  const underOffices = /[\\/]offices[\\/][^\\/]+$/.test(office.dir)
  const deleteData = underOffices && window.confirm('Also delete the files? This cannot be undone.')
  void window.offices
    .remove(office.id, deleteData)
    .then(() => {
      selectedId = null
      return render()
    })
    .catch(fail)
})

newSide.addEventListener('click', () => {
  newForm.hidden = !newForm.hidden
  if (!newForm.hidden) input.focus()
})

newForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const name = input.value.trim()
  if (!name) return
  void window.offices
    .create(name)
    .then((office) => {
      input.value = ''
      newForm.hidden = true
      selectedId = office.id
      status.textContent = ''
      return render()
    })
    .catch(fail)
})

addButton.addEventListener('click', () => {
  const dir = window.prompt('Folder containing team.json')
  if (!dir || !dir.trim()) return
  const suggested = dir.trim().split(/[\\/]/).filter(Boolean).pop() ?? 'Office'
  const name = window.prompt('Office name', suggested)
  if (!name || !name.trim()) return
  void window.offices
    .add(dir.trim(), name)
    .then((office) => {
      selectedId = office.id
      status.textContent = ''
      return render()
    })
    .catch(fail)
})

find.addEventListener('click', () => search.focus())
search.addEventListener('input', () => render())

closeButton.addEventListener('click', () => {
  void window.offices.close().catch(fail)
})

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#191919')
}

themeButton.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    // The theme still applies for this session.
  }
  applyTheme(next)
})

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    search.focus()
    search.select()
    return
  }
  if (event.key !== 'Escape') return
  if (!newForm.hidden) {
    newForm.hidden = true
    input.blur()
  } else if (search.value) {
    search.value = ''
    render()
  } else {
    void window.offices.close().catch(fail)
  }
})

try {
  if (localStorage.getItem(THEME_KEY) === 'dark') applyTheme('dark')
} catch {
  // Keep the light default when storage is unavailable.
}
void render()
