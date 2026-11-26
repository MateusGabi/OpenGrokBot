// Renderer for the offices manager. No framework, no network: every action
// goes through the preload bridge into the Electron main process.
const list = document.getElementById('list')
const form = document.getElementById('new')
const input = document.getElementById('name')
const status = document.getElementById('status')

function fail(err) {
  status.textContent = err instanceof Error ? err.message : String(err)
}

function action(label, run) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', () => {
    void run().catch(fail)
  })
  return button
}

function row(office, active) {
  const li = document.createElement('li')

  const info = document.createElement('div')
  info.className = 'name'
  const name = document.createElement('span')
  name.textContent = active ? `${office.name} · active` : office.name
  const meta = document.createElement('small')
  meta.textContent = `${office.id} · ${office.port}`
  info.append(name, meta)

  const open = action('Open', async () => {
    await window.offices.open(office.id)
    await render()
  })
  open.className = 'primary'

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
    action('Add existing…', async () => {
      const dir = window.prompt('Folder containing team.json')
      if (!dir || !dir.trim()) return
      const suggested = dir.trim().split(/[\\/]/).filter(Boolean).pop() ?? 'Office'
      const name = window.prompt('Office name', suggested)
      if (name && name.trim()) {
        await window.offices.add(dir.trim(), name)
        await render()
      }
    }),
    action('Remove', async () => {
      if (office.id === 'default') {
        status.textContent = 'The default office cannot be removed.'
        return
      }
      if (!window.confirm(`Remove "${office.name}" from the list? Files stay on disk.`)) return
      const underOffices = /[\\/]offices[\\/][^\\/]+$/.test(office.dir)
      const deleteData = underOffices && window.confirm('Also delete the files? This cannot be undone.')
      await window.offices.remove(office.id, deleteData)
      await render()
    }),
  )
  more.append(summary, menu)

  li.append(info, open, more)
  return li
}

async function render() {
  try {
    const { offices, activeId } = await window.offices.list()
    list.replaceChildren(...offices.map((office) => row(office, office.id === activeId)))
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

void render()
