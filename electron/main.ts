import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification, safeStorage, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { autoUpdater } from 'electron-updater';
import DiscordRPC from 'discord-rpc';

app.setName('Inazuma Music');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const YOUTUBE_CLIENT_IDENTITY = 'https://github.com/NewaaDev/imazuma-music/';

type Config = { wsUrl: string; apiToken: string; youtubeApiKey: string; botCommand: string; botCwd: string; demoMode: boolean; theme:'inazuma'|'midnight'|'ember'; playbackTarget:'local'|'discord'; autoRadio:boolean; discordClientId: string; discordUserId: string; discordUserName: string; discordAvatar: string; preferredGuildId: string; preferredTextChannelId: string; releaseChannelId:string; releaseWebhookUrl:string; autoJoin: boolean; autoLeave: boolean; controlMode:'private'|'shared'; allowedRoleIds:string; audioPreset:'normal'|'bass'|'vocal'|'night'; normalizeVolume:boolean; crossfadeSeconds:number; presenceEnabled: boolean; presenceType:'playing'|'listening'|'watching'|'competing'; presenceShowTrack:boolean; presenceDetails: string; presenceState:string; presenceLargeImageKey:string; presenceLargeImageText:string; presenceLinkLabel: string; presenceLinkUrl: string; presenceDownloadLabel: string; presenceDownloadUrl: string };
function bundledRemote(): Partial<Config> {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/remote-config.json'), 'utf8'));
  } catch { return {}; }
}
const remote = bundledRemote();
const defaults: Config = { wsUrl: remote.wsUrl || 'ws://127.0.0.1:8765', apiToken: '', youtubeApiKey: '', botCommand: '', botCwd: '', demoMode: false, theme: 'inazuma', playbackTarget:'discord', autoRadio:true, discordClientId: remote.discordClientId || '', discordUserId: '', discordUserName: '', discordAvatar: '', preferredGuildId: '', preferredTextChannelId: '', releaseChannelId:'', releaseWebhookUrl:'', autoJoin: true, autoLeave: true, controlMode: 'private', allowedRoleIds:'', audioPreset:'normal', normalizeVolume:true, crossfadeSeconds:3, presenceEnabled:true, presenceType:'listening', presenceShowTrack:true, presenceDetails:'En écoute sur Inazuma Music', presenceState:'Version 2.2.10 • OFFICIEL', presenceLargeImageKey:'inazuma_music_logo', presenceLargeImageText:'Inazuma Music', presenceLinkLabel:'', presenceLinkUrl:'', presenceDownloadLabel:'Télécharger Inazuma', presenceDownloadUrl:'https://github.com/NewaaDev/imazuma-music/releases/latest' };
let botProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let discordRpc: DiscordRPC.Client | null = null;
let discordRpcClientId = '';
let discordRpcConnecting: Promise<void> | null = null;
let presenceRetry: NodeJS.Timeout | null = null;
let presenceTrack: {title?:string;channel?:string}|null = null;
let presencePlaying = false;
let releaseWebhookMonitor: NodeJS.Timeout | null = null;
let releaseWebhookCheckRunning = false;

function validPresenceButton(label: string, url: string) {
  return label.trim() && /^https:\/\//i.test(url) ? { label: label.trim().slice(0, 32), url } : null;
}

function presenceActivity(config: Config) {
  const buttons = [validPresenceButton(config.presenceLinkLabel, config.presenceLinkUrl),validPresenceButton(config.presenceDownloadLabel, config.presenceDownloadUrl)].filter((button): button is {label:string;url:string} => Boolean(button));
  const activityTypes={playing:0,listening:2,watching:3,competing:5} as const;
  return {type:activityTypes[config.presenceType]??2,details:(config.presenceShowTrack&&presenceTrack?.title?presenceTrack.title:config.presenceDetails||'En écoute sur Inazuma Music').trim().slice(0,128),state:(config.presenceShowTrack&&presenceTrack?`${presencePlaying?'En lecture':'En pause'} • ${presenceTrack.channel||'Inazuma Music'}`:config.presenceState||'Version 2.2.10 • OFFICIEL').trim().slice(0,128),assets:{large_image:config.presenceLargeImageKey.trim().slice(0,128)||'inazuma_music_logo',large_text:config.presenceLargeImageText.trim().slice(0,128)||'Inazuma Music'},buttons:buttons.length?buttons:undefined,instance:false};
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
function saveLibrary(value:any){const clean={history:Array.isArray(value?.history)?value.history.slice(0,200):[],playlists:Array.isArray(value?.playlists)?value.playlists.map((p:any)=>({id:String(p.id),name:String(p.name).slice(0,80),createdAt:Number(p.createdAt)||Date.now(),tracks:Array.isArray(p.tracks)?p.tracks.slice(0,500):[],visibility:p.visibility==='public'?'public':'private',shareKey:String(p.shareKey||'').slice(0,200),ownerName:String(p.ownerName||'').slice(0,80),ownerAvatar:String(p.ownerAvatar||'').slice(0,500),importedFrom:p.importedFrom==='spotify'?'spotify':p.importedFrom==='youtube'?'youtube':undefined,sourceUrl:String(p.sourceUrl||'').slice(0,1000)})):[],favorites:Array.isArray(value?.favorites)?value.favorites.slice(0,500):[],pinned:Array.isArray(value?.pinned)?value.pinned.slice(0,100):[],searchHistory:Array.isArray(value?.searchHistory)?value.searchHistory.map(String).slice(0,12):[],stats:{...emptyStats(),...(value?.stats||{})}};fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(libraryFile(),JSON.stringify(clean,null,2));return clean}

function protect(value: string) {
  if (!value) return '';
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : Buffer.from(value).toString('base64');
}
function reveal(value: unknown) {
  if (typeof value !== 'string' || !value) return '';
  try { const b = Buffer.from(value, 'base64'); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString(); } catch { return ''; }
}
function webhookMap(value: unknown): Record<string,string> {
  try { const parsed=JSON.parse(reveal(value)); return parsed&&typeof parsed==='object'?parsed:{}; } catch { return {}; }
}
function validWebhookUrl(value:string) {
  try { const url=new URL(value); return url.protocol==='https:'&&['discord.com','discordapp.com','canary.discord.com','ptb.discord.com'].includes(url.hostname)&&/^\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9._-]+$/.test(url.pathname); } catch { return false; }
}
function releaseNotesText(value:unknown){if(typeof value==='string')return value.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,3500);if(Array.isArray(value))return value.map((item:any)=>String(item?.note||'')).filter(Boolean).join('\n').slice(0,3500);return ''}
type ReleaseWebhookRecord = {version:string;messageId:string;payload:Record<string,unknown>};
function releaseWebhookPayload(version:string,releaseNotes:unknown){const notes=releaseNotesText(releaseNotes)||'Une nouvelle version officielle d’Inazuma Music est disponible.';return{username:'Inazuma Music',allowed_mentions:{parse:[]},embeds:[{color:0xf5b800,title:`⚡ Mise à jour ${version}`,description:notes,thumbnail:{url:'https://raw.githubusercontent.com/NewaaDev/imazuma-music/feature/inazuma-v2/assets/icon.png'},fields:[{name:'Version',value:version,inline:true}],url:'https://github.com/NewaaDev/imazuma-music/releases/latest',footer:{text:'Inazuma Music • Mise à jour officielle'},timestamp:new Date().toISOString()}],components:[{type:1,components:[{type:2,style:5,label:'Télécharger Inazuma Music',url:'https://github.com/NewaaDev/imazuma-music/releases/latest'}]}]}}
function releaseWebhookRecords(store:Record<string,unknown>){return store.releaseWebhookAnnouncements&&typeof store.releaseWebhookAnnouncements==='object'?store.releaseWebhookAnnouncements as Record<string,string|ReleaseWebhookRecord>:{};}
function webhookMessageUrl(webhook:string,messageId:string){const url=new URL(webhook);url.pathname+=`/messages/${messageId}`;return url.href;}
async function sendReleaseWebhook(webhook:string,payload:Record<string,unknown>){const url=new URL(webhook);url.searchParams.set('wait','true');const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(!response.ok)throw new Error(`Webhook Discord refusé (${response.status}).`);const message=await response.json() as {id?:string};if(!/^\d{17,20}$/.test(message.id||''))throw new Error('Discord n’a pas confirmé le message de mise à jour.');return message.id!;}
function saveReleaseWebhookRecord(guildId:string,record:ReleaseWebhookRecord){const store=readStore();const sent=releaseWebhookRecords(store);writeStore({...store,releaseWebhookAnnouncements:{...sent,[guildId]:record}});}
async function announceWebhookUpdate(version:string,releaseNotes:unknown){const config=getConfig();if(!config.preferredGuildId||!config.releaseWebhookUrl)return;const store=readStore();const sent=releaseWebhookRecords(store);const previous=sent[config.preferredGuildId];if(typeof previous==='object'&&previous.version===version&&/^\d{17,20}$/.test(previous.messageId)){const existing=await fetch(webhookMessageUrl(config.releaseWebhookUrl,previous.messageId));if(existing.ok)return;if(existing.status!==404)throw new Error(`Vérification du webhook refusée (${existing.status}).`);console.warn('[Inazuma Music] Annonce Discord supprimée : republication automatique.');}else if(previous===version)return;const payload=releaseWebhookPayload(version,releaseNotes);const messageId=await sendReleaseWebhook(config.releaseWebhookUrl,payload);saveReleaseWebhookRecord(config.preferredGuildId,{version,messageId,payload});}
async function repairStoredWebhookAnnouncement(){if(releaseWebhookCheckRunning)return;releaseWebhookCheckRunning=true;try{const config=getConfig();if(!config.preferredGuildId||!config.releaseWebhookUrl)return;const record=releaseWebhookRecords(readStore())[config.preferredGuildId];if(!record||typeof record==='string'||!/^\d{17,20}$/.test(record.messageId))return;const existing=await fetch(webhookMessageUrl(config.releaseWebhookUrl,record.messageId));if(existing.ok)return;if(existing.status!==404)throw new Error(`Vérification du webhook refusée (${existing.status}).`);console.warn('[Inazuma Music] Annonce Discord disparue : restauration automatique.');const messageId=await sendReleaseWebhook(config.releaseWebhookUrl,record.payload);saveReleaseWebhookRecord(config.preferredGuildId,{...record,messageId});}finally{releaseWebhookCheckRunning=false;}}
function getConfig(): Config {
  let store = readStore();
  if (store.sessionVersion !== 2) {
    store = { ...store, sessionVersion: 2, apiToken: '' };
    writeStore(store);
  }
  const saved = store.public as Partial<Config> || {};
  if(saved.presenceState&&(/B[ÊE]TA/i.test(saved.presenceState)||/^Version 2\.(?:0|1(?:\.[1-5])?|2\.(?:[0-9])) • OFFICIEL$/.test(saved.presenceState)))saved.presenceState='Version 2.2.10 • OFFICIEL';
  return {
    ...defaults,
    ...saved,
    wsUrl: remote.wsUrl || saved.wsUrl || defaults.wsUrl,
    discordClientId: remote.discordClientId || saved.discordClientId || defaults.discordClientId,
    apiToken: reveal(store.apiToken),
    youtubeApiKey: reveal(store.youtubeApiKey),
    releaseWebhookUrl: webhookMap(store.releaseWebhooks)[String(saved.preferredGuildId||'')] || '',
  };
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 900, minWidth: 1080, minHeight: 680, icon: path.join(__dirname, '../assets/icon.png'), backgroundColor: '#08070c', titleBarStyle: 'hidden', titleBarOverlay: { color: '#08070c', symbolColor: '#c9c2d8', height: 42 }, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const dev = process.env.VITE_DEV_SERVER_URL;
  const recovery = (reason:string) => mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>body{margin:0;background:#08070c;color:#fff;font:16px Arial;display:grid;place-items:center;height:100vh}main{max-width:620px;padding:40px;text-align:center}h1{color:#a855f7}p{color:#b8afc7;line-height:1.6}</style><main><h1>Inazuma Music</h1><h2>Installation incomplète</h2><p>${reason}</p><p>Réinstalle la dernière version officielle depuis github.com/NewaaDev/imazuma-music/releases/latest.</p></main>`)}`);
  if(dev) void mainWindow.loadURL(dev).catch(()=>recovery('Le serveur de développement ne répond pas.'));
  else { const entry=path.join(__dirname,'../dist/index.html'); fs.existsSync(entry)?void mainWindow.loadFile(entry).catch(()=>recovery("L'interface n'a pas pu être chargée.")):void recovery("Le fichier de l'interface est absent du paquet installé."); }
  mainWindow.webContents.on('did-fail-load',(_event,code,description,url)=>{if(code!==-3&&!url.startsWith('data:'))void recovery(`Erreur de chargement ${code} : ${description}`)});
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Inazuma Music] Le rendu a été interrompu:', details.reason);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  });
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
function setupUpdates(){if(!app.isPackaged)return;autoUpdater.autoDownload=true;autoUpdater.autoInstallOnAppQuit=true;autoUpdater.disableDifferentialDownload=true;autoUpdater.on('checking-for-update',()=>mainWindow?.webContents.send('update:status',{state:'checking'}));autoUpdater.on('update-available',x=>{mainWindow?.webContents.send('update:status',{state:'downloading',version:x.version});void announceWebhookUpdate(x.version,x.releaseNotes).catch(error=>console.error('[Inazuma Music] Webhook mise à jour:',error instanceof Error?error.message:String(error)))});autoUpdater.on('download-progress',x=>mainWindow?.webContents.send('update:status',{state:'progress',percent:Math.round(x.percent)}));autoUpdater.on('update-downloaded',x=>{mainWindow?.webContents.send('update:status',{state:'ready',version:x.version});setTimeout(()=>autoUpdater.quitAndInstall(false,true),2500)});autoUpdater.on('error',()=>mainWindow?.webContents.send('update:status',{state:'error'}));setTimeout(()=>autoUpdater.checkForUpdates().catch(()=>{}),5000)}

ipcMain.handle('config:get', () => getConfig());
ipcMain.handle('library:get',()=>getLibrary());
ipcMain.handle('library:set',(_e,value)=>saveLibrary(value));
ipcMain.handle('config:set', (_e, config: Config) => {
  const { apiToken, youtubeApiKey, releaseWebhookUrl, ...publicConfig } = config;
  const current = readStore();
  const previousPublic = current.public as Partial<Config> || {};
  const webhooks=webhookMap(current.releaseWebhooks); const guildId=String(publicConfig.preferredGuildId||'');
  if(guildId&&releaseWebhookUrl){if(!validWebhookUrl(releaseWebhookUrl))throw new Error('URL de webhook Discord invalide.');webhooks[guildId]=releaseWebhookUrl.trim()}else if(guildId)delete webhooks[guildId];
  writeStore({ ...current, sessionVersion: 2, public: { ...previousPublic, ...publicConfig, discordClientId: publicConfig.discordClientId || previousPublic.discordClientId || '' }, apiToken: protect(apiToken), youtubeApiKey: protect(youtubeApiKey), releaseWebhooks:protect(JSON.stringify(webhooks)) });
  const saved = getConfig();
  void setupRichPresence(saved);
  return saved;
});
ipcMain.handle('webhook:test',async(_e,value:string)=>{if(!validWebhookUrl(value))throw new Error('URL de webhook Discord invalide.');const response=await fetch(value,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'Inazuma Music',content:'✅ Inazuma Music : webhook de mises à jour configuré.'})});if(!response.ok)throw new Error(`Discord a refusé le webhook (${response.status}).`);return true});
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
ipcMain.handle('playlists:import',async(_e,url:string)=>{const{endpoint,config}=relayEndpoint('/playlists/import');const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${config.apiToken}`,'content-type':'application/json'},body:JSON.stringify({url:String(url||'').slice(0,1000)})});const data=await response.json() as {name?:string;source?:'youtube'|'spotify';tracks?:unknown[];unmatched?:number;error?:string};if(!response.ok)throw new Error(data.error||'Import de playlist impossible.');return data});
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
ipcMain.handle('discord:invite',async(_e,clientId:string)=>{if(!/^\d{17,20}$/.test(clientId))throw new Error('Le bot doit être connecté une première fois.');const url=new URL('https://discord.com/oauth2/authorize');url.search=new URLSearchParams({client_id:clientId,scope:'bot applications.commands',permissions:'3230720'}).toString();await shell.openExternal(url.href)});
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
  setTimeout(()=>void repairStoredWebhookAnnouncement().catch(error=>console.error('[Inazuma Music] Surveillance annonce:',error instanceof Error?error.message:String(error))),15_000);
  releaseWebhookMonitor=setInterval(()=>void repairStoredWebhookAnnouncement().catch(error=>console.error('[Inazuma Music] Surveillance annonce:',error instanceof Error?error.message:String(error))),120_000);
});
app.on('window-all-closed', () => { discordRpc?.destroy().catch(() => {}); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('will-quit', () => { if(releaseWebhookMonitor)clearInterval(releaseWebhookMonitor);globalShortcut.unregisterAll(); });
