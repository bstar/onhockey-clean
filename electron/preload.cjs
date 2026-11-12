const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hockey', {
  schedule: () => ipcRenderer.invoke('schedule'),
  profile: ids => ipcRenderer.invoke('profile', ids),
  scores: date => ipcRenderer.invoke('scores', date),
  refreshAll: (gameId, sourceUrl) => ipcRenderer.invoke('refresh-all', gameId, sourceUrl),
  play: (gameId, sourceIndex) => ipcRenderer.invoke('play', gameId, sourceIndex),
  stop: () => ipcRenderer.invoke('stop'),
  bounds: bounds => ipcRenderer.send('player-bounds', bounds),
  fullscreen: () => ipcRenderer.invoke('fullscreen'),
  privacy: () => ipcRenderer.invoke('privacy'),
  onPlayer: callback => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('player-state', listener);
    return () => ipcRenderer.removeListener('player-state', listener);
  },
});
