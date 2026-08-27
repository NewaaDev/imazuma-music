import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification, safeStorage, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { autoUpdater } from 'electron-updater';
import DiscordRPC from 'discord-rpc';

app.setName('Inazuma Music');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const YOUTUBE_CLIENT_IDENTITY = 'https://github.com/NewaaDev/imazuma-music/';

type Config = { wsUrl: string; apiToken: string; youtubeApiKey: string; botCommand: string; botCwd: string; demoMode: boolean; theme:'inazuma'|'midnight'|'ember'; playbackTarget:'local'|'discord'; autoRadio:boolean; discordClientId: string; discordUserId: string; discordUserName: string; discordAvatar: string; preferredGuildId: string; preferredTextChannelId: string; autoJoin: boolean; autoLeave: boolean; controlMode:'private'|'shared'; allowedRoleIds:string; audioPreset:'normal'|'bass'|'vocal'|'night'; normalizeVolume:boolean; crossfadeSeconds:number; presenceEnabled: boolean; presenceType:'playing'|'listening'|'watching'|'competing'; presenceShowTrack:boolean; presenceDetails: string; presenceState:string; presenceLargeImageKey:string; presenceLargeImageText:string; presenceLinkLabel: string; presenceLinkUrl: string; presenceDownloadLabel: string; presenceDownloadUrl: string };
function bundledRemote(): Partial<Config> {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/remote-config.json'), 'utf8'));
  } catch { return {}; }
}
const remote = bundledRemote();
const defaults: Config = { wsUrl: remote.wsUrl || 'ws://127.0.0.1:8765', apiToken: '', youtubeApiKey: '', botCommand: '', botCwd: '', demoMode: false, theme: 'inazuma', playbackTarget:'discord', autoRadio:true, discordClientId: remote.discordClientId || '', discordUserId: '', discordUserName: '', discordAvatar: '', preferredGuildId: '', preferredTextChannelId: '', autoJoin: true, autoLeave: true, controlMode: 'private', allowedRoleIds: '', audioPreset: 'normal', normalizeVolume: true, crossfadeSeconds: 3, presenceEnabled: true, presenceType:'listening', presenceShowTrack:true, presenceDetails: 'En écoute sur Inazuma Music', presenceState:'Version 2.1.4 • OFFICIEL', presenceLargeImageKey:'inazuma_music_logo', presenceLargeImageText:'Inazuma Music', presenceLinkLabel: '', presenceLinkUrl: '', presenceDownloadLabel: 'Télécharger Inazuma', presenceDownloadUrl: 'https://github.com/NewaaDev/imazuma-music/releases/latest' };
let botProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let discordRpc: DiscordRPC.Client | null = null;
let discordRpcClientId = '';
let discordRpcConnecting: Promise<void> | null = null;
let presenceRetry: NodeJS.Timeout | null = null;
let presenceTrack: {title?:string;channel?:string}|null = null;
let presencePlaying = false;

function validPresenceButton(label: string, url: string) {
  return label.trim() && /^https:\/\//i.test(url) ? { label: label.trim().slice(0, 32), url } : null;
}

function presenceActivity(config: Config) {
  const buttons = [validPresenceButton(config.presenceLinkLabel, config.presenceLinkUrl),validPresenceButton(config.presenceDownloadLabel, config.presenceDownloadUrl)].filter((button): button is {label:string;url:string} => Boolean(button));
  const activityTypes={playing:0,listening:2,watching:3,competing:5} as const;
  return {type:activityTypes[config.presenceType]??2,details:(config.presenceShowTrack&&presenceTrack?.title?presenceTrack.title:config.presenceDetails||'En écoute sur Inazuma Music').trim().slice(0,128),state:(config.presenceShowTrack&&presenceTrack?`${presencePlaying?'En lecture':'En pause'} • ${presenceTrack.channel||'Inazuma Music'}`:config.presenceState||'Version 2.1.4 • OFFICIEL').trim().slice(0,128),assets:{large_image:config.presenceLargeImageKey.trim().slice(0,128)||'inazuma_music_logo',large_text:config.presenceLargeImageText.trim().slice(0,128)||'Inazuma Music'},buttons:buttons.length?buttons:undefined,instance:false};
}

function resetRichPresence(rpc?: DiscordRPC.Client) {
  if (rpc && discordRpc !== rpc) return;
  const current = discordRpc;
  discordRpc = null;
  discordRpcClientId = '';
  discordRpcConnecting = null;
  current?.destroy().catch(() => {});
}

function retryRichPresence() {
  if (presenceRetry) clearTimeout(presenceRetry);
  presenceRetry = setTimeout(() => { presenceRetry=null; void setupRichPresence(getConfig()); }, 5_000);
}

async function setupRichPresence(config: Config) {
  if (!config.presenceEnabled || !/^\d{17,20}$/.test(config.discordClientId)) {
    if (presenceRetry) clearTimeout(presenceRetry);
    presenceRetry = null;
    resetRichPresence();
    return;
  }
  if (discordRpc && discordRpcClientId !== config.discordClientId) resetRichPresence();
  if (!discordRpc) {
    if (!discordRpcConnecting) {
      const rpc = new DiscordRPC.Client({ transport: 'ipc' });
      discordRpc = rpc;
      discordRpcClientId = config.discordClientId;
      rpc.on('disconnected', () => { resetRichPresence(rpc); retryRichPresence(); });
      discordRpcConnecting = rpc.login({ clientId: config.discordClientId }).then(() => undefined).catch((error) => {
        console.error('[Inazuma Music] Connexion Rich Presence indisponible:', error instanceof Error ? error.message : String(error));
        resetRichPresence(rpc);
        retryRichPresence();
        throw error;
      }).finally(() => { if (discordRpc === rpc) discordRpcConnecting=null; });
    }
    try { await discordRpcConnecting; } catch { return; }
  }
  const rpc = discordRpc;
  if (!rpc) return;
  try {
    await (rpc as unknown as {request:(command:string,args:unknown)=>Promise<unknown>}).request('SET_ACTIVITY',{pid:process.pid,activity:presenceActivity(config)});
  } catch (error) {
    console.error('[Inazuma Music] Mise à jour Rich Presence indisponible:', error instanceof Error ? error.message : String(error));
    resetRichPresence(rpc);
    retryRichPresence();
  }
}

function readStore(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')); } catch { return {}; }
}
function writeStore(value: Record<string, unknown>) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(value, null, 2), { mode: 0o600 });
}
const libraryFile=()=>path.join(app.getPath('userData'),'library.json');
const emptyStats=()=>({totalSeconds:0,tracksPlayed:0,playCount:{},lastPlayedAt:0});
function getLibrary(){try{const x=JSON.parse(fs.readFileSync(libraryFile(),'utf8'));return{history:Array.isArray(x.history)?x.history.slice(0,200):[],playlists:Array.isArray(x.playlists)?x.playlists:[],favorites:Array.isArray(x.favorites)?x.favorites.slice(0,500):[],pinned:Array.isArray(x.pinned)?x.pinned.slice(0,100):[],searchHistory:Array.isArray(x.searchHistory)?x.searchHistory.slice(0,12):[],stats:{...emptyStats(),...(x.stats||{})}}}catch{return{history:[],playlists:[],favorites:[],pinned:[],searchHistory:[],stats:emptyStats()}}}
function saveLibrary(value:any){const clean={history:Array.isArray(value?.history)?value.history.slice(0,200):[],playlists:Array.isArray(value?.playlists)?value.playlists.map((p:any)=>({id:String(p.id),name:String(p.name).slice(0,80),createdAt:Number(p.createdAt)||Date.now(),tracks:Array.isArray(p.tracks)?p.tracks.slice(0,500):[]})):[],favorites:Array.isArray(value?.favorites)?value.favorites.slice(0,500):[],pinned:Array.isArray(value?.pinned)?value.pinned.slice(0,100):[],searchHistory:Array.isArray(value?.searchHistory)?value.searchHistory.map(String).slice(0,12):[],stats:{...emptyStats(),...(value?.stats||{})}};fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(libraryFile(),JSON.stringify(clean,null,2));return clean}

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
  if (store.sessionVersion !== 2) {
    store = { ...store, sessionVersion: 2, apiToken: '' };
    writeStore(store);
  }
  const saved = store.public as Partial<Config> || {};
  if(saved.presenceState&&(/B[ÊE]TA/i.test(saved.presenceState)||/^Version 2\.(?:0|1(?:\.[123])?) • OFFICIEL$/.test(saved.presenceState)))saved.presenceState='Version 2.1.4 • OFFICIEL';
  return {
    ...defaults,
    ...saved,
    wsUrl: remote.wsUrl || saved.wsUrl || defaults.wsUrl,
    discordClientId: remote.discordClientId || saved.discordClientId || defaults.discordClientId,
    apiToken: reveal(store.apiToken),
    youtubeApiKey: reveal(store.youtubeApiKey),
  };
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 900, minWidth: 1080, minHeight: 680, icon: path.join(__dirname, '../assets/icon.png'), backgroundColor: '#08070c', titleBarStyle: 'hidden', titleBarOverlay: { color: '#08070c', symbolColor: '#c9c2d8', height: 42 }, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const dev = process.env.VITE_DEV_SERVER_URL;
  dev ? mainWindow.loadURL(dev) : mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}
function configureYouTubeRequests() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://youtube.com/*', 'https://*.youtube.com/*'] },
    (details, callback) => {
      details.requestHeaders.Referer = YOUTUBE_CLIENT_IDENTITY;
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}
function toggleMiniPlayer() {
  if (miniWindow && !miniWindow.isDestroyed()) { miniWindow.close(); miniWindow = null; return false; }
  miniWindow = new BrowserWindow({ width: 420, height: 138, minWidth: 380, minHeight: 120, maxHeight: 180, alwaysOnTop: true, frame: false, resizable: true, backgroundColor: '#100d14', icon: path.join(__dirname, '../assets/icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const dev = process.env.VITE_DEV_SERVER_URL;
  dev ? miniWindow.loadURL(`${dev}?mini=1`) : miniWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { mini: '1' } });
  miniWindow.on('closed', () => { miniWindow = null; });
  return true;
}
function registerMediaShortcuts() {
  const commands = new Map([['MediaPlayPause','toggle_pause'],['MediaNextTrack','skip'],['MediaStop','stop']]);
  for (const [accelerator, action] of commands) globalShortcut.register(accelerator, () => {
    mainWindow?.webContents.send('media:command', action);
    miniWindow?.webContents.send('media:command', action);
  });
}
function setupUpdates(){if(!app.isPackaged)return;autoUpdater.autoDownload=true;autoUpdater.autoInstallOnAppQuit=true;autoUpdater.on('checking-for-update',()=>mainWindow?.webContents.send('update:status',{state:'checking'}));autoUpdater.on('update-available',x=>mainWindow?.webContents.send('update:status',{state:'downloading',version:x.version}));autoUpdater.on('download-progress',x=>mainWindow?.webContents.send('update:status',{state:'progress',percent:Math.round(x.percent)}));autoUpdater.on('update-downloaded',x=>{mainWindow?.webContents.send('update:status',{state:'ready',version:x.version});setTimeout(()=>autoUpdater.quitAndInstall(false,true),2500)});autoUpdater.on('error',()=>mainWindow?.webContents.send('update:status',{state:'error'}));setTimeout(()=>autoUpdater.checkForUpdates().catch(()=>{}),5000)}

ipcMain.handle('config:get', () => getConfig());
ipcMain.handle('library:get',()=>getLibrary());
ipcMain.handle('library:set',(_e,value)=>saveLibrary(value));
ipcMain.handle('config:set', (_e, config: Config) => {
  const { apiToken, youtubeApiKey, ...publicConfig } = config;
  const current = readStore();
  const previousPublic = current.public as Partial<Config> || {};
  writeStore({ sessionVersion: 2, public: { ...previousPublic, ...publicConfig, discordClientId: publicConfig.discordClientId || previousPublic.discordClientId || '' }, apiToken: protect(apiToken), youtubeApiKey: protect(youtubeApiKey) });
  const saved = getConfig();
  void setupRichPresence(saved);
  return saved;
});
ipcMain.handle('youtube:search', async (_e, query: string, pageToken = '') => {
  const config = getConfig();
  if (!config.apiToken || !config.wsUrl) throw new Error('Connecte-toi avec Discord pour utiliser les services Inazuma Music.');
  const endpoint = new URL(config.wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
  endpoint.pathname = '/youtube/search';
  endpoint.search = new URLSearchParams({ q: query, ...(pageToken ? { pageToken } : {}) }).toString();
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${config.apiToken}` } });
  const data = await response.json() as { error?: string; items?: unknown[]; nextPageToken?: string };
  if (!response.ok) throw new Error(data.error || `Recherche YouTube indisponible (${response.status}).`);
  return data;
});
ipcMain.handle('lyrics:search', async (_e, title: string, artist = '', duration = 0, broad = false) => {
  const endpoint = new URL('https://lrclib.net/api/search');
  const cleanTitle=String(title||'').replace(/\s*[\[(](official|lyrics?|audio|video|clip).*?[\])]/gi,'').replace(/\s*[-–—]\s*(official|lyrics?|audio|video|clip).*$/gi,'').trim();
  if(broad) endpoint.searchParams.set('q',`${cleanTitle} ${artist}`.trim().slice(0,220)); else { endpoint.searchParams.set('track_name',cleanTitle.slice(0,160));if(artist)endpoint.searchParams.set('artist_name',String(artist).slice(0,120)); }
  const response = await fetch(endpoint, { headers: { 'user-agent': `Inazuma Music/${app.getVersion()} (desktop lyrics)` } });
  if (!response.ok) throw new Error(`Paroles indisponibles (${response.status}).`);
  const records = await response.json() as Array<{trackName?:string;artistName?:string;duration?:number;syncedLyrics?:string|null;plainLyrics?:string|null;instrumental?:boolean}>;
  const ranked=[...records].sort((a,b)=>{const sync=(b.syncedLyrics?1000:0)-(a.syncedLyrics?1000:0);const distance=duration?Math.abs((a.duration||0)-duration)-Math.abs((b.duration||0)-duration):0;return sync+distance});
  const record = ranked.find((item) => item.syncedLyrics) || ranked.find((item) => item.plainLyrics) || null;
  return record ? { trackName: record.trackName || title, artistName: record.artistName || artist, duration: record.duration || 0, syncedLyrics: record.syncedLyrics || '', plainLyrics: record.plainLyrics || '', instrumental: Boolean(record.instrumental) } : null;
});
ipcMain.handle('presence:update',async(_e,track:{title?:string;channel?:string}|null,playing:boolean)=>{presenceTrack=track;presencePlaying=Boolean(playing);await setupRichPresence(getConfig())});
ipcMain.handle('media:select-upload',async()=>{const picked=await dialog.showOpenDialog(mainWindow!,{title:'Ajouter un MP3 à Inazuma Music',properties:['openFile'],filters:[{name:'Fichiers audio MP3',extensions:['mp3']}]});if(picked.canceled||!picked.filePaths[0])return null;const file=picked.filePaths[0];const stat=fs.statSync(file);if(stat.size>30*1024*1024)throw new Error('Le MP3 dépasse la limite de 30 Mo.');const{endpoint,config}=relayEndpoint('/media');const response=await fetch(endpoint,{method:'PUT',headers:{authorization:`Bearer ${config.apiToken}`,'content-type':'audio/mpeg','content-length':String(stat.size),'x-file-name':encodeURIComponent(path.basename(file))},body:fs.readFileSync(file) as unknown as BodyInit});const data=await response.json() as {id?:string;url?:string;title?:string;error?:string};if(!response.ok||!data.url)throw new Error(data.error||'Upload MP3 impossible.');return{id:data.id||crypto.randomUUID(),title:data.title||path.basename(file,'.mp3'),channel:'Fichier MP3',thumbnail:'',duration:'MP3',source:'mp3',url:data.url}});
function relayEndpoint(pathname:string){const config=getConfig();if(!config.apiToken||!config.wsUrl)throw new Error('Connexion Inazuma indisponible.');const endpoint=new URL(config.wsUrl.replace(/^wss:/,'https:').replace(/^ws:/,'http:'));endpoint.pathname=pathname;endpoint.search='';return{endpoint,config}}
ipcMain.handle('playlists:public',async(_e,query='')=>{const{endpoint,config}=relayEndpoint('/playlists');endpoint.searchParams.set('q',String(query).slice(0,80));const response=await fetch(endpoint,{headers:{authorization:`Bearer ${config.apiToken}`}});const data=await response.json() as {items?:unknown[];error?:string};if(!response.ok)throw new Error(data.error||'Playlists publiques indisponibles.');return data.items||[]});
ipcMain.handle('playlists:publish',async(_e,playlist)=>{const{endpoint,config}=relayEndpoint('/playlists');const response=await fetch(endpoint,{method:'PUT',headers:{authorization:`Bearer ${config.apiToken}`,'content-type':'application/json'},body:JSON.stringify({...playlist,ownerName:config.discordUserName||'Utilisateur',ownerAvatar:config.discordAvatar||''})});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||'Publication impossible.');});
ipcMain.handle('playlists:unpublish',async(_e,id,shareKey)=>{const{endpoint,config}=relayEndpoint(`/playlists/${encodeURIComponent(String(id))}`);const response=await fetch(endpoint,{method:'DELETE',headers:{authorization:`Bearer ${config.apiToken}`,'content-type':'application/json'},body:JSON.stringify({shareKey})});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||'Retrait impossible.');});
ipcMain.handle('discord:login', async (_e, clientId: string) => {
  if (!/^\d{17,20}$/.test(clientId)) throw new Error('Application Discord indisponible.');
  const current = readStore();
  writeStore({ ...current, public: { ...(current.public as Partial<Config> || {}), discordClientId: clientId } });
  const redirectUri = 'http://127.0.0.1:53682/callback';
  const state = crypto.randomBytes(24).toString('hex');
  return new Promise<{id:string;name:string;avatar:string;apiToken:string}>((resolve, reject) => {
    let finished = false;
    const done = (error?: Error, value?: {id:string;name:string;avatar:string;apiToken:string}) => { if(finished)return;finished=true;server.close();clearTimeout(timeout);error?reject(error):resolve(value!); };
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
        try{const config=getConfig();const sessionUrl=new URL(config.wsUrl.replace(/^wss:/,'https:').replace(/^ws:/,'http:'));sessionUrl.pathname='/session';sessionUrl.search='';const api=await fetch(sessionUrl,{method:'POST',headers:{authorization:`Bearer ${body.access_token}`}});const data=await api.json() as {token?:string;user?:{id:string;name:string;avatar:string};error?:string};if(!api.ok||!data.token||!data.user)throw new Error(data.error||'Discord a refusé la connexion.');done(undefined,{...data.user,apiToken:data.token})}catch(error){done(error instanceof Error?error:new Error(String(error)))}
        return;
      }
      response.writeHead(404).end();
    });
    server.once('error',()=>done(new Error('Impossible d’ouvrir la connexion Discord. Ferme les autres fenêtres Inazuma et réessaie.')));
    server.listen(53682,'127.0.0.1',()=>{const params=new URLSearchParams({response_type:'token',client_id:clientId,redirect_uri:redirectUri,scope:'identify',state,prompt:'consent'});shell.openExternal(`https://discord.com/oauth2/authorize?${params}`).catch(error=>done(error));});
    const timeout=setTimeout(()=>done(new Error('La connexion Discord a expiré.')),120_000);
  });
});
ipcMain.handle('discord:invite',async(_e,clientId:string)=>{if(!/^\d{17,20}$/.test(clientId))throw new Error('Le bot doit être connecté une première fois.');const url=new URL('https://discord.com/oauth2/authorize');url.search=new URLSearchParams({client_id:clientId,scope:'bot applications.commands',permissions:'3165184'}).toString();await shell.openExternal(url.href)});
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
ipcMain.handle('mini:toggle', () => toggleMiniPlayer());
ipcMain.handle('notification:track', (_e, track: {title?:string;channel?:string}) => {
  if (!Notification.isSupported() || !track?.title) return;
  new Notification({ title: 'Inazuma Music', body: `${track.title}\n${track.channel || ''}`, icon: path.join(__dirname, '../assets/icon.png'), silent: true }).show();
});
app.whenReady().then(() => {
  const bootstrapKey = process.env.NEWAA_YOUTUBE_API_KEY;
  if (bootstrapKey) {
    const current = readStore();
    writeStore({ ...current, youtubeApiKey: protect(bootstrapKey.trim()) });
    delete process.env.NEWAA_YOUTUBE_API_KEY;
    app.quit();
    return;
  }
  configureYouTubeRequests();createWindow();setupUpdates();registerMediaShortcuts();void setupRichPresence(getConfig());
});
app.on('window-all-closed', () => { discordRpc?.destroy().catch(() => {}); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
