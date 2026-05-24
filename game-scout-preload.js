const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('scout', {
  onData:   (cb) => ipcRenderer.on('scout-data', (_, data) => cb(data)),
  getStats: (summonerName) => ipcRenderer.invoke('scout-stats', { summonerName }),
  close:    () => ipcRenderer.send('close-scout'),
})
