import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('newaa', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: unknown) => ipcRenderer.invoke('config:set', config),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  saveLibrary: (library: unknown) => ipcRenderer.invoke('library:set', library),
  searchYouTube: (query: string, pageToken?: string) => ipcRenderer.invoke('youtube:search', query, pageToken),
  getPublicPlaylists: (query?: string) => ipcRenderer.invoke('playlists:public', query),
  publishPlaylist: (playlist: unknown) => ipcRenderer.invoke('playlists:publish', playlist),
  unpublishPlaylist: (id: string, shareKey: string) => ipcRenderer.invoke('playlists:unpublish', id, shareKey),
  loginDiscord: (clientId: string) => ipcRenderer.invoke('discord:login', clientId),
  startBot: () => ipcRenderer.invoke('bot:start'), stopBot: () => ipcRenderer.invoke('bot:stop'),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onBotLog: (cb: (line: string) => void) => { const f = (_: unknown, line: string) => cb(line); ipcRenderer.on('bot:log', f); return () => ipcRenderer.removeListener('bot:log', f); },
  onUpdate: (cb: (event: unknown) => void) => { const f = (_: unknown, event: unknown) => cb(event); ipcRenderer.on('update:status', f); return () => ipcRenderer.removeListener('update:status', f); }
});
