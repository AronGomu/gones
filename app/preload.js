const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
  ping: () => ipcRenderer.invoke('ping'),
  spice_crawler: () => ipcRenderer.invoke('spice_crawler', url, top_index)
  // we can also expose variables, not just functions
})

contextBridge.exposeInMainWorld('electronAPI', {
	  ping: () => ipcRenderer.invoke('ping'),
    pingv2: () => ipcRenderer.invoke('pingv2'),
    pingv3: (value) => ipcRenderer.invoke('pingv3', value),
    crawlSpiceEvent: (spiceUrl, top_index) => ipcRenderer.invoke('crawlSpiceEvent', spiceUrl, top_index),
})