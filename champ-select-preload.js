const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cs', {
  onUpdate:    (cb) => ipcRenderer.on('cs-update', (_, data) => cb(data)),
  aiRecommend: (prompt) => ipcRenderer.invoke('ai-champ-select', prompt),
  getBuild:    (champName, position, champId) => ipcRenderer.invoke('get-build', { champName, position, champId }),
  applyBuild:  (payload) => ipcRenderer.invoke('apply-build', payload),
})
