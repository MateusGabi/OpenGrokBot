// Bridge used by the chat window: office management lives inside the app,
// so the renderer gets only these calls plus the menu-open notification.
const { contextBridge, ipcRenderer } = require('electron')

const calls = ['list', 'create', 'add', 'open', 'rename', 'remove', 'close']
const api = Object.fromEntries(calls.map((name) => [name, (...args) => ipcRenderer.invoke(`offices:${name}`, ...args)]))
api.onOpen = (callback) => {
  const listener = () => callback()
  ipcRenderer.on('offices:open', listener)
  return () => ipcRenderer.removeListener('offices:open', listener)
}

contextBridge.exposeInMainWorld('offices', api)
