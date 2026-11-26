// The manager screen gets exactly these seven IPC calls, nothing else.
const { contextBridge, ipcRenderer } = require('electron')

const calls = ['list', 'create', 'add', 'open', 'rename', 'remove', 'close']
contextBridge.exposeInMainWorld(
  'offices',
  Object.fromEntries(calls.map((name) => [name, (...args) => ipcRenderer.invoke(`offices:${name}`, ...args)])),
)
