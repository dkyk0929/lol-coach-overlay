const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dashboard', {
  onData: (cb) => ipcRenderer.on('dashboard-data', (_, data) => cb(data)),
  close:  () => ipcRenderer.send('close-dashboard'),
})
