// Electron shell: one server child process per office, one window per office,
// plus a small manager window. Each office keeps its own team/data and port.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { childOptions } = require('./child.cjs')
const registryLib = require('../shared/offices.cjs')

const root = path.join(__dirname, '..')
const running = new Map() // office id -> { office, server, win }
let registry = null

function entry(id) {
  return registry.offices.find((o) => o.id === id)
}

function persist() {
  registryLib.saveOffices(app.getPath('userData'), registry)
}

function reload() {
  registry = registryLib.loadOffices(app.getPath('userData'))
}

function titleOf(office) {
  return `${office.name} — OpenGrokBot`
}

function waitForServer(port, retries = 60) {
  return new Promise((resolve, reject) => {
    const tryOnce = (left) => {
      const req = http.get(`http://127.0.0.1:${port}/api/state`, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (left <= 0) reject(new Error('server did not start'))
        else setTimeout(() => tryOnce(left - 1), 250)
      })
    }
    tryOnce(retries)
  })
}

function activeOffice() {
  for (const item of running.values()) {
    if (item.win && !item.win.isDestroyed() && item.win.isFocused()) return item.office
  }
  return entry(registry.lastId) ?? entry('default') ?? null
}

function rebuildMenu() {
  const items = registry.offices.map((office) => ({
    label: office.name,
    type: 'radio',
    checked: running.has(office.id),
    click: () => {
      try {
        openOffice(office)
      } catch (err) {
        dialog.showErrorBox('OpenGrokBot', err instanceof Error ? err.message : String(err))
      }
    },
  }))
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'Offices…', accelerator: 'CmdOrCtrl+Shift+O', click: () => BrowserWindow.getFocusedWindow()?.webContents.send('offices:open') },
      { type: 'separator' },
      ...items,
      { type: 'separator' },
      { role: 'quit' },
    ]),
  )
}

function stopOffice(id, closeWindow = true, resetLastId = true) {
  const item = running.get(id)
  if (!item) return
  running.delete(id)
  if (closeWindow && item.win && !item.win.isDestroyed()) {
    item.win.removeAllListeners('closed')
    item.win.close()
  }
  if (item.server && item.server.exitCode === null) item.server.kill()
  if (resetLastId && registry.lastId === id) {
    registry.lastId = 'default'
    persist()
  }
  rebuildMenu()
}

function openOffice(office) {
  const current = running.get(office.id)
  if (current && current.win && !current.win.isDestroyed()) {
    current.win.focus()
    return current
  }
  registryLib.assertOfficeDir(office)
  const options = childOptions(office.port, office.dir, { ...process.env })
  const server = spawn(process.execPath, [path.join(root, 'dist', 'server', 'index.js')], { ...options, stdio: 'inherit' })
  server.on('error', (err) => {
    console.error(`[desktop] could not start office "${office.name}":`, err)
    if (!app.isQuitting) dialog.showErrorBox('OpenGrokBot', `Could not start office "${office.name}": ${err.message}`)
  })
  server.on('exit', (code) => {
    if (code !== 0 && !app.isQuitting) console.error(`[desktop] office "${office.name}" server exited with code ${code}`)
  })

  const win = new BrowserWindow({
    width: 1320,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111111',
    title: titleOf(office),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#141414', symbolColor: '#8f8f8f', height: 40 },
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'offices-preload.cjs') },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('page-title-updated', (event) => {
    event.preventDefault()
    win.setTitle(titleOf(office))
  })
  win.on('closed', () => stopOffice(office.id, false, false))

  running.set(office.id, { office, server, win })
  registry.lastId = office.id
  persist()
  rebuildMenu()
  waitForServer(office.port)
    .then(() => {
      if (!win.isDestroyed()) void win.loadURL(registryLib.officeUrl(office))
    })
    .catch((err) => {
      console.error(`[desktop] office "${office.name}" did not start:`, err)
      if (!app.isQuitting) dialog.showErrorBox('OpenGrokBot', `Office "${office.name}" did not start: ${err.message}`)
    })
  return running.get(office.id)
}

function publicOffice(office) {
  return { id: office.id, name: office.name, dir: office.dir, port: office.port }
}

function handle(name, fn) {
  ipcMain.handle(`offices:${name}`, (_event, ...args) => fn(...args))
}

handle('list', () => ({
  offices: registry.offices.map(publicOffice),
  activeId: activeOffice()?.id ?? null,
}))
handle('create', async (name) => {
  const office = await registryLib.createOffice(app.getPath('userData'), name)
  reload()
  rebuildMenu()
  return publicOffice(office)
})
handle('add', async (dir, name) => {
  const office = await registryLib.addOffice(app.getPath('userData'), dir, name)
  reload()
  rebuildMenu()
  return publicOffice(office)
})
handle('open', (id) => {
  const office = entry(id)
  if (!office) throw new Error(`unknown office "${id}"`)
  openOffice(office)
  return true
})
handle('rename', (id, name) => {
  registryLib.renameOffice(app.getPath('userData'), id, name)
  reload()
  const item = running.get(id)
  if (item) {
    item.office = entry(id)
    if (item.win && !item.win.isDestroyed()) item.win.setTitle(titleOf(item.office))
  }
  rebuildMenu()
  return true
})
handle('remove', (id, deleteData) => {
  registryLib.removeOffice(app.getPath('userData'), id, { deleteData: deleteData === true })
  stopOffice(id, true, true)
  reload()
  rebuildMenu()
  return true
})
handle('close', () => true)

app.whenReady()
  .then(async () => {
    const stateDir = app.getPath('userData')
    mkdirSync(stateDir, { recursive: true })
    registry = registryLib.loadOffices(stateDir)
    const id = registryLib.startupId(registry)
    const office = id ? entry(id) : null
    if (!office) {
      dialog.showErrorBox('OpenGrokBot', 'No office is available. Check offices.json in your OpenGrokBot data folder.')
      app.quit()
      return
    }
    rebuildMenu()
    openOffice(office)
  })
  .catch((err) => {
    console.error('[desktop] startup failed:', err)
    dialog.showErrorBox('OpenGrokBot', err instanceof Error ? err.message : String(err))
    app.quit()
  })

app.on('window-all-closed', () => {
  app.isQuitting = true
  for (const id of [...running.keys()]) stopOffice(id, false, false)
  app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  for (const id of [...running.keys()]) stopOffice(id, false, false)
})
