export type Track = { id: string; title: string; channel: string; thumbnail: string; duration: string; requestedBy?: string };
export type Playlist = { id:string; name:string; createdAt:number; tracks:Track[] };
export type Library = { history:Track[]; playlists:Playlist[] };
export type ChannelChoice = { id:string; name:string };
export type PlayerState = { connected: boolean; botOnline: boolean; guildId: string; guildName: string; guilds: {id:string;name:string;icon?:string}[]; textChannels: ChannelChoice[]; voiceChannel: string; playing: boolean; volume: number; position: number; elapsed: number; current: Track | null; queue: Track[]; history: Track[] };
export type Config = { wsUrl: string; apiToken: string; youtubeApiKey: string; botCommand: string; botCwd: string; demoMode: boolean; discordUserId: string; preferredGuildId: string; preferredTextChannelId: string };
export type CommandContext = { discordUserId:string; preferredGuildId:string; preferredTextChannelId:string };
export type Command = { type: 'command'; action: string; payload?: unknown; requestId: string; context: CommandContext };
export type BotEvent = { type: 'state'; payload: Partial<PlayerState> } | { type: 'event'; event: string; payload: unknown };
declare global { interface Window { newaa: { getConfig(): Promise<Config>; setConfig(c: Config): Promise<Config>; getLibrary():Promise<Library>; saveLibrary(library:Library):Promise<Library>; searchYouTube(q: string, token?: string): Promise<{items: Track[]; nextPageToken: string}>; startBot(): Promise<{message:string}>; stopBot(): Promise<{message:string}>; openExternal(url:string): Promise<void>; onBotLog(cb:(line:string)=>void):()=>void; onUpdate(cb:(event:{state:string;version?:string;percent?:number})=>void):()=>void } } }
