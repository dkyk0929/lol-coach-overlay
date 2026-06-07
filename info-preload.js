const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('infoWindow', {
  openUrl:    (url) => ipcRenderer.send('open-url', url),
  close:      () => ipcRenderer.send('close-info-window'),
  getVersion: () => ipcRenderer.invoke('get-version'),
})
