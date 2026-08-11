const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ctrl', {
  getState:         ()      => ipcRenderer.invoke('get-overlay-state'),
  ttsToggle:        ()      => ipcRenderer.invoke('tts-toggle'),
  getDisplayInfo:   ()      => ipcRenderer.invoke('get-display-info'),
  openLog:          ()      => ipcRenderer.send('open-battle-log'),
  openAI:           ()      => ipcRenderer.send('open-ai-setup'),
  openUrl:          (url)   => ipcRenderer.send('open-url', url),
  minimize:         ()      => ipcRenderer.send('minimize-window'),
  closeApp:         ()      => ipcRenderer.send('close-window'),
  close:            ()      => ipcRenderer.send('close-control-panel'),
  switchToDashboard:()      => ipcRenderer.send('switch-to-dashboard'),
  getDashboardAutoStart: ()    => ipcRenderer.invoke('get-dashboard-autostart'),
  setDashboardAutoStart: (val) => ipcRenderer.invoke('set-dashboard-autostart', val),
  onStateChange:    (cb)    => ipcRenderer.on('overlay-state', (_, s) => cb(s)),
})
