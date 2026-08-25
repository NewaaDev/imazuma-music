import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('newaa', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: unknown) => ipcRenderer.invoke('config:set', config),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  saveLibrary: (library: unknown) => ipcRenderer.invoke('library:set', library),
  searchYouTube: (query: string, pageToken?: string) => ipcRenderer.invoke('youtube:search', query, pageToken),
  startBot: () => ipcRenderer.invoke('bot:start'), stopBot: () => ipcRenderer.invoke('bot:stop'),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  onBotLog: (cb: (line: string) => void) => { const f = (_: unknown, line: string) => cb(line); ipcRenderer.on('bot:log', f); return () => ipcRenderer.removeListener('bot:log', f); },
  onUpdate: (cb: (event: unknown) => void) => { const f = (_: unknown, event: unknown) => cb(event); ipcRenderer.on('update:status', f); return () => ipcRenderer.removeListener('update:status', f); }
});
