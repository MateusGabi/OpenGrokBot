// Electron shell: starts the office server as a child Node process and opens it in a window.
const { app, BrowserWindow, shell, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { childOptions } = require('./child.cjs')

const PORT = Number(process.env.PORT ?? 4310)
const URL = `http://127.0.0.1:${PORT}/`
const root = path.join(__dirname, '..')
let server = null

function startServer() {
  const stateDir = app.getPath('userData')
  mkdirSync(stateDir, { recursive: true })
  const options = childOptions(PORT, stateDir)
  server = spawn(process.execPath, [path.join(root, 'dist', 'server', 'index.js')], { ...options, stdio: 'inherit' })
  server.on('error', (err) => {
    console.error('[desktop] could not start server:', err)
    if (!app.isQuitting) app.quit()
  })
  server.on('exit', (code) => {
    server = null
    if (code !== 0 && !app.isQuitting) console.error(`[desktop] server exited with code ${code}`)
  })
}

function waitForServer(retries = 60) {
  return new Promise((resolve, reject) => {
    const tryOnce = (left) => {
      const req = http.get(`${URL}api/state`, (res) => {
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

async function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111111',
    title: 'OpenGrokBot',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    // No titleBarOverlay: its native buttons sat on top of the web content and
    // covered the custom chat header. The header itself is the drag handle and
    // draws its own controls, wired up through the preload bridge below.
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  })
  ipcMain.handle('window:minimize', () => win.minimize())
  ipcMain.handle('window:toggle-maximize', () => (win.isMaximized() ? win.restore() : win.maximize()))
  ipcMain.handle('window:close', () => win.close())
  ipcMain.handle('window:is-maximized', () => win.isMaximized())
  win.on('maximize', () => win.webContents.send('window:maximized-change', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized-change', false))
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  await waitForServer()
  await win.loadURL(URL)
}

app.whenReady().then(async () => {
  startServer()
  try {
    await createWindow()
  } catch (err) {
    console.error(err)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  app.isQuitting = true
  if (server) server.kill()
  app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  if (server) server.kill()
})
