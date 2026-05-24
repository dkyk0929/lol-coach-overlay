const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('recentGames', {
  onData: (cb) => ipcRenderer.on('recent-data', (_, data) => cb(data)),
  close:  () => ipcRenderer.send('close-recent-games'),
})
