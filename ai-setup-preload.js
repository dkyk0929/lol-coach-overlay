const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aiSetup', {
  getStatus:   ()              => ipcRenderer.invoke('get-ai-status'),
  saveKey:     (provider, key) => ipcRenderer.invoke('save-api-key-from-setup', provider, key),
  setProvider: (provider)      => ipcRenderer.invoke('set-ai-provider', provider),
  close:       ()              => ipcRenderer.send('close-ai-setup'),
  openUrl:     (url)           => ipcRenderer.send('open-url', url),
  getRiotStatus:  ()                   => ipcRenderer.invoke('get-riot-status'),
  saveRiotKey:    (key, region)        => ipcRenderer.invoke('save-riot-api-key', key, region),
})
