const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('logApi', {
  selectLogFile: () => ipcRenderer.invoke('select-log-file'),
  readLogPage: (payload) => ipcRenderer.invoke('read-log-page', payload),
  readLastLogPage: (payload) => ipcRenderer.invoke('read-log-last-page', payload),
  getLogLineCount: (payload) => ipcRenderer.invoke('get-log-line-count', payload),
  loadBookmark: (payload) => ipcRenderer.invoke('load-bookmark', payload),
  saveBookmark: (payload) => ipcRenderer.invoke('save-bookmark', payload),
  startTail: (payload) => ipcRenderer.invoke('start-tail', payload),
  stopTail: () => ipcRenderer.invoke('stop-tail'),
  getTailPosition: () => ipcRenderer.invoke('get-tail-position'),
  onTailLines: (handler) => {
    const listener = (_, data) => handler(data);
    ipcRenderer.on('tail-lines', listener);
    return () => ipcRenderer.removeListener('tail-lines', listener);
  },
  onTailError: (handler) => {
    const listener = (_, data) => handler(data);
    ipcRenderer.on('tail-error', listener);
    return () => ipcRenderer.removeListener('tail-error', listener);
  }
});
