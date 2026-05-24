const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aiSetup', {
  getStatus: ()    => ipcRenderer.invoke('get-ai-status'),
  saveKey:   (key) => ipcRenderer.invoke('save-api-key-from-setup', key),
  close:     ()    => ipcRenderer.send('close-ai-setup'),
  openUrl:   (url) => ipcRenderer.send('open-url', url),
})
