const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('battleLog', {
  onData:      (cb)   => ipcRenderer.on('log-data', (_, data) => cb(data)),
  close:       ()     => ipcRenderer.send('close-battle-log'),
  deleteEntry: (date) => ipcRenderer.invoke('delete-log-entry', date),
  clearAll:    ()     => ipcRenderer.invoke('clear-all-logs'),
})
