const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('notif', {
  onNotif:   (cb) => ipcRenderer.on('notif',        (_, data) => cb(data)),
  onDismiss: (cb) => ipcRenderer.on('notif-dismiss', () => cb()),
})
