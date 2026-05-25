const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cs', {
  onUpdate:    (cb) => ipcRenderer.on('cs-update', (_, data) => cb(data)),
  aiRecommend: (prompt) => ipcRenderer.invoke('ai-champ-select', prompt),
})
