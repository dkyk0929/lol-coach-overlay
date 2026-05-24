const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cs', {
  onUpdate:    (cb) => ipcRenderer.on('cs-update', (_, data) => cb(data)),
  aiRecommend: (prompt) => ipcRenderer.invoke('ai-champ-select', prompt),
  getBuild:    (champName, position) => ipcRenderer.invoke('get-build', { champName, position }),
  applyRunes:  (page) => ipcRenderer.invoke('apply-runes', page),
})
