// Renderer for the offices palette. Same shape as Ctrl+K: focus on load,
// one list, keyboard shortcuts, every action through the preload bridge.
const list = document.getElementById('list')
const form = document.getElementById('new')
const input = document.getElementById('name')
const status = document.getElementById('status')
const count = document.getElementById('count')
const closeButton = document.getElementById('close')
const themeButton = document.getElementById('theme')
const addButton = document.getElementById('add')
const THEME_KEY = 'opengrokbot-theme'

function fail(err) {
  status.textContent = err instanceof Error ? err.message : String(err)
}

function action(label, run, className = '') {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  if (className) button.className = className
  button.addEventListener('click', () => {
    void run().catch(fail)
  })
  return button
}

function row(office, active) {
  const li = document.createElement('li')
  li.className = active ? 'office is-active' : 'office'

  const info = document.createElement('div')
  info.className = 'office-name'
  const name = document.createElement('strong')
  name.textContent = office.name
  const meta = document.createElement('small')
  meta.textContent = `${office.id} · port ${office.port}`
  info.append(name, meta)

  const open = action('Open', async () => {
    await window.offices.open(office.id)
    await render()
  }, 'open')

  const more = document.createElement('details')
  more.className = 'more'
  const summary = document.createElement('summary')
  summary.setAttribute('aria-label', `Actions for ${office.name}`)
  summary.textContent = '•••'
  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.append(
    action('Rename', async () => {
      const next = window.prompt('Office name', office.name)
      if (next && next.trim()) {
        await window.offices.rename(office.id, next.trim())
        await render()
      }
    }),
    action(
      'Remove',
      async () => {
        if (office.id === 'default') {
          status.textContent = 'The default office cannot be removed.'
          return
        }
        if (!window.confirm(`Remove "${office.name}" from the list? Files stay on disk.`)) return
        const underOffices = /[\\/]offices[\\/][^\\/]+$/.test(office.dir)
        const deleteData = underOffices && window.confirm('Also delete the files? This cannot be undone.')
        await window.offices.remove(office.id, deleteData)
        await render()
      },
      'danger',
    ),
  )
  more.append(summary, menu)
  li.append(info, open, more)
  return li
}

async function render() {
  try {
    const { offices, activeId } = await window.offices.list()
    count.textContent = `${offices.length} office${offices.length === 1 ? '' : 's'}`
    list.replaceChildren(...offices.map((office) => row(office, office.id === activeId)))
    if (offices.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'palette-empty'
      empty.textContent = 'No offices yet. Create one above.'
      list.append(empty)
    }
  } catch (err) {
    fail(err)
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const name = input.value.trim()
  if (!name) return
  void window.offices
    .create(name)
    .then(() => {
      input.value = ''
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
    .then(() => {
      status.textContent = ''
      return render()
    })
    .catch(fail)
})

closeButton.addEventListener('click', () => {
  void window.offices.close().catch(fail)
})

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#fafafa' : '#141414')
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    input.focus()
    return
  }
  if (event.key !== 'Escape') return
  const openMenu = list.querySelector('details[open]')
  if (openMenu) openMenu.open = false
  else void window.offices.close().catch(fail)
})

try {
  if (localStorage.getItem(THEME_KEY) === 'dark') applyTheme('dark')
} catch {
  // Keep the light default when storage is unavailable.
}
input.focus()
void render()
