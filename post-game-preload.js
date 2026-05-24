const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('postGame', {
  onData:      (cb) => ipcRenderer.on('post-game-data', (_, d) => cb(d)),
  aiAnalysis:  (prompt) => ipcRenderer.invoke('ai-postgame', prompt),
  close:       () => ipcRenderer.send('close-post-game'),
  saveLog:     (entry) => ipcRenderer.send('save-battle-log', entry),
})
