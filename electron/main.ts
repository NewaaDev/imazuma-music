import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { autoUpdater } from 'electron-updater';

app.setName('Inazuma Music');

type Config = { wsUrl: string; apiToken: string; youtubeApiKey: string; botCommand: string; botCwd: string; demoMode: boolean; discordUserId: string; discordUserName: string; discordAvatar: string; preferredGuildId: string; preferredTextChannelId: string };
function bundledRemote(): Partial<Config> {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/remote-config.json'), 'utf8'));
    const token = fs.readFileSync(path.join(__dirname, '../assets/remote-access-token.txt'), 'utf8').trim();
    return { ...config, apiToken: token };
  } catch { return {}; }
}
const remote = bundledRemote();
const defaults: Config = { wsUrl: remote.wsUrl || 'ws://127.0.0.1:8765', apiToken: remote.apiToken || '', youtubeApiKey: '', botCommand: '', botCwd: '', demoMode: false, discordUserId: '', discordUserName: '', discordAvatar: '', preferredGuildId: '', preferredTextChannelId: '' };
let botProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

function readStore(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')); } catch { return {}; }
}
function writeStore(value: Record<string, unknown>) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(value, null, 2), { mode: 0o600 });
}
const libraryFile=()=>path.join(app.getPath('userData'),'library.json');
function getLibrary(){try{const x=JSON.parse(fs.readFileSync(libraryFile(),'utf8'));return{history:Array.isArray(x.history)?x.history.slice(0,200):[],playlists:Array.isArray(x.playlists)?x.playlists:[]}}catch{return{history:[],playlists:[]}}}
function saveLibrary(value:any){const clean={history:Array.isArray(value?.history)?value.history.slice(0,200):[],playlists:Array.isArray(value?.playlists)?value.playlists.map((p:any)=>({id:String(p.id),name:String(p.name).slice(0,80),createdAt:Number(p.createdAt)||Date.now(),tracks:Array.isArray(p.tracks)?p.tracks.slice(0,500):[]})):[]};fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(libraryFile(),JSON.stringify(clean,null,2));return clean}

function protect(value: string) {
  if (!value) return '';
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : Buffer.from(value).toString('base64');
}
function reveal(value: unknown) {
  if (typeof value !== 'string' || !value) return '';
  try { const b = Buffer.from(value, 'base64'); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString(); } catch { return ''; }
}
function getConfig(): Config {
  let store = readStore();
  if (remote.apiToken && !store.apiToken) {
    const currentPublic = store.public as Partial<Config> || {};
    store = { ...store, public: { ...currentPublic, wsUrl: remote.wsUrl || currentPublic.wsUrl }, apiToken: protect(remote.apiToken) };
    writeStore(store);
  }
  const saved = store.public as Partial<Config> || {};
  const permanent = Boolean(remote.wsUrl && remote.apiToken);
  return {
    ...defaults,
    ...saved,
    wsUrl: permanent ? defaults.wsUrl : (saved.wsUrl || defaults.wsUrl),
    apiToken: permanent ? defaults.apiToken : (reveal(store.apiToken) || defaults.apiToken),
    youtubeApiKey: reveal(store.youtubeApiKey),
  };
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 900, minWidth: 1080, minHeight: 680, icon: path.join(__dirname, '../assets/icon.png'), backgroundColor: '#08070c', titleBarStyle: 'hidden', titleBarOverlay: { color: '#08070c', symbolColor: '#c9c2d8', height: 42 }, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const dev = process.env.VITE_DEV_SERVER_URL;
  dev ? mainWindow.loadURL(dev) : mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}
function setupUpdates(){if(!app.isPackaged)return;autoUpdater.autoDownload=true;autoUpdater.autoInstallOnAppQuit=true;autoUpdater.on('checking-for-update',()=>mainWindow?.webContents.send('update:status',{state:'checking'}));autoUpdater.on('update-available',x=>mainWindow?.webContents.send('update:status',{state:'downloading',version:x.version}));autoUpdater.on('download-progress',x=>mainWindow?.webContents.send('update:status',{state:'progress',percent:Math.round(x.percent)}));autoUpdater.on('update-downloaded',x=>{mainWindow?.webContents.send('update:status',{state:'ready',version:x.version});setTimeout(()=>autoUpdater.quitAndInstall(false,true),2500)});autoUpdater.on('error',()=>mainWindow?.webContents.send('update:status',{state:'error'}));setTimeout(()=>autoUpdater.checkForUpdates().catch(()=>{}),5000)}

ipcMain.handle('config:get', () => getConfig());
ipcMain.handle('library:get',()=>getLibrary());
ipcMain.handle('library:set',(_e,value)=>saveLibrary(value));
ipcMain.handle('config:set', (_e, config: Config) => {
  const { apiToken, youtubeApiKey, ...publicConfig } = config;
  writeStore({ public: publicConfig, apiToken: protect(apiToken), youtubeApiKey: protect(youtubeApiKey) });
  return getConfig();
});
ipcMain.handle('youtube:search', async (_e, query: string, pageToken = '') => {
  const config = getConfig();
  if (!config.apiToken || !config.wsUrl) throw new Error('La connexion permanente Inazuma Music est indisponible.');
  const endpoint = new URL(config.wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
  endpoint.pathname = '/youtube/search';
  endpoint.search = new URLSearchParams({ q: query, ...(pageToken ? { pageToken } : {}) }).toString();
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${config.apiToken}` } });
  const data = await response.json() as { error?: string; items?: unknown[]; nextPageToken?: string };
  if (!response.ok) throw new Error(data.error || `Recherche YouTube indisponible (${response.status}).`);
  return data;
});
function relayEndpoint(pathname:string){const config=getConfig();if(!config.apiToken||!config.wsUrl)throw new Error('Connexion Inazuma indisponible.');const endpoint=new URL(config.wsUrl.replace(/^wss:/,'https:').replace(/^ws:/,'http:'));endpoint.pathname=pathname;endpoint.search='';return{endpoint,config}}
ipcMain.handle('playlists:public',async(_e,query='')=>{const{endpoint,config}=relayEndpoint('/playlists');endpoint.searchParams.set('q',String(query).slice(0,80));const response=await fetch(endpoint,{headers:{authorization:`Bearer ${config.apiToken}`}});const data=await response.json() as {items?:unknown[];error?:string};if(!response.ok)throw new Error(data.error||'Playlists publiques indisponibles.');return data.items||[]});
ipcMain.handle('playlists:publish',async(_e,playlist)=>{const{endpoint,config}=relayEndpoint('/playlists');const response=await fetch(endpoint,{method:'PUT',headers:{authorization:`Bearer ${config.apiToken}`,'content-type':'application/json'},body:JSON.stringify({...playlist,ownerName:config.discordUserName||'Utilisateur',ownerAvatar:config.discordAvatar||''})});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||'Publication impossible.');});
ipcMain.handle('playlists:unpublish',async(_e,id,shareKey)=>{const{endpoint,config}=relayEndpoint(`/playlists/${encodeURIComponent(String(id))}`);const response=await fetch(endpoint,{method:'DELETE',headers:{authorization:`Bearer ${config.apiToken}`,'content-type':'application/json'},body:JSON.stringify({shareKey})});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||'Retrait impossible.');});
ipcMain.handle('discord:login', async (_e, clientId: string) => {
  if (!/^\d{17,20}$/.test(clientId)) throw new Error('Application Discord indisponible.');
  const redirectUri = 'http://127.0.0.1:53682/callback';
  const state = crypto.randomBytes(24).toString('hex');
  return new Promise<{id:string;name:string;avatar:string}>((resolve, reject) => {
    let finished = false;
    const done = (error?: Error, value?: {id:string;name:string;avatar:string}) => { if(finished)return;finished=true;server.close();clearTimeout(timeout);error?reject(error):resolve(value!); };
    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url || '/', redirectUri);
      if (url.pathname === '/callback') {
        response.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
        response.end(`<!doctype html><meta charset="utf-8"><title>Inazuma Music</title><style>body{background:#0b0910;color:#fff;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0}div{text-align:center}b{color:#ffc34d}</style><div><h2>Connexion à <b>Inazuma Music</b></h2><p>Validation en cours…</p></div><script>const p=new URLSearchParams(location.hash.slice(1));fetch('/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(p))}).then(()=>{document.querySelector('p').textContent='Connexion réussie. Tu peux fermer cette page.'}).catch(()=>{document.querySelector('p').textContent='Connexion impossible.'});</script>`);
        return;
      }
      if (url.pathname === '/complete' && request.method === 'POST') {
        let raw='';for await(const chunk of request)raw+=chunk;const body=JSON.parse(raw||'{}');
        response.writeHead(204).end();
        if(body.state!==state||!body.access_token)return done(new Error('Réponse Discord invalide.'));
        try{const api=await fetch('https://discord.com/api/v10/users/@me',{headers:{authorization:`Bearer ${body.access_token}`}});if(!api.ok)throw new Error('Discord a refusé la connexion.');const user=await api.json() as {id:string;username:string;global_name?:string|null;avatar?:string|null};const avatar=user.avatar?`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`:'';done(undefined,{id:user.id,name:user.global_name||user.username,avatar})}catch(error){done(error instanceof Error?error:new Error(String(error)))}
        return;
      }
      response.writeHead(404).end();
    });
    server.once('error',()=>done(new Error('Impossible d’ouvrir la connexion Discord. Ferme les autres fenêtres Inazuma et réessaie.')));
    server.listen(53682,'127.0.0.1',()=>{const params=new URLSearchParams({response_type:'token',client_id:clientId,redirect_uri:redirectUri,scope:'identify',state,prompt:'consent'});shell.openExternal(`https://discord.com/oauth2/authorize?${params}`).catch(error=>done(error));});
    const timeout=setTimeout(()=>done(new Error('La connexion Discord a expiré.')),120_000);
  });
});
ipcMain.handle('bot:start', () => {
  if (botProcess) return { ok: true, message: 'Le bot est déjà lancé.' };
  const c = getConfig(); if (!c.botCommand) throw new Error('Configure la commande de démarrage du bot.');
  botProcess = spawn(c.botCommand, { cwd: c.botCwd || undefined, shell: true, windowsHide: true });
  botProcess.stdout?.on('data', d => mainWindow?.webContents.send('bot:log', d.toString()));
  botProcess.stderr?.on('data', d => mainWindow?.webContents.send('bot:log', d.toString()));
  botProcess.on('exit', code => { mainWindow?.webContents.send('bot:log', `Bot arrêté (${code ?? 'inconnu'})\n`); botProcess = null; });
  return { ok: true, message: 'Démarrage demandé.' };
});
ipcMain.handle('bot:stop', () => { if (!botProcess) return { ok: true, message: 'Aucun bot lancé par l’application.' }; botProcess.kill(); botProcess = null; return { ok: true, message: 'Arrêt demandé.' }; });
ipcMain.handle('external:open', (_e, url: string) => { if (/^https:\/\/(www\.)?youtube\.com\//.test(url)) return shell.openExternal(url); });
ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion() }));
ipcMain.handle('app:quit', () => app.quit());
app.whenReady().then(() => {
  const bootstrapKey = process.env.NEWAA_YOUTUBE_API_KEY;
  if (bootstrapKey) {
    const current = readStore();
    writeStore({ ...current, youtubeApiKey: protect(bootstrapKey.trim()) });
    delete process.env.NEWAA_YOUTUBE_API_KEY;
    app.quit();
    return;
  }
  createWindow();setupUpdates();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
