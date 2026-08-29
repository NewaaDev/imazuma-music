import { AudioPlayerStatus } from '@discordjs/voice';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import { announceRelease, saveReleaseChannel } from './release-announcer.js';

function durationLabel(value) {
  if (typeof value === 'string') return value;
  const seconds = Math.max(0, Number(value) || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h ? `${h}:` : ''}${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
}

function durationSeconds(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function desktopTrack(track) {
  if (!track) return null;
  return { id: track.id, title: track.title, channel: track.channel || 'YouTube', thumbnail: track.thumbnail || '', duration: durationLabel(track.duration), requestedBy: track.requestedBy || 'Desktop', source:track.source||'youtube', url:track.url };
}

function botTrack(track) {
  if (!track?.id) throw new Error('Morceau invalide.');
  const mp3=track.source==='mp3'&&/^https:\/\//i.test(track.url||'');
  return {
    id: track.id,
    title: track.title || 'Vidéo YouTube',
    channel: track.channel || 'YouTube',
    thumbnail: track.thumbnail || null,
    duration: durationSeconds(track.duration),
    requestedBy: 'Inazuma Music',
    source:mp3?'mp3':'youtube',url:mp3?track.url:`https://www.youtube.com/watch?v=${track.id}`,
  };
}

export function createDesktopBridge(client, music) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: config.desktopPort });
  const authenticated = new WeakSet();
  const contexts = new WeakMap();
  const trackedUsers = new Map();
  const controlPolicies = new Map();
  let selectedGuildId = config.guildId && client.guilds.cache.has(config.guildId) ? config.guildId : client.guilds.cache.firstKey();
  let lastContext = {};

  function guild() {
    return client.guilds.cache.get(selectedGuildId) || client.guilds.cache.first() || null;
  }

  async function voiceChannel(targetGuild, context = {}) {
    const userId = String(context.discordUserId || '').trim();
    if (userId) {
      const member = await targetGuild.members.fetch(userId).catch(() => null);
      if (!member) throw new Error('Ton compte Discord n’est pas présent sur le serveur sélectionné.');
      if (member.voice?.channel) return member.voice.channel;
      throw new Error('Tu dois rejoindre un salon vocal sur Discord avant de lancer une musique.');
    }
    throw new Error('Configure ton identifiant Discord dans les paramètres de l’application.');
  }

  function textChannel(targetGuild, context = {}) {
    const preferredId = String(context.preferredTextChannelId || config.defaultTextChannelId || '');
    const preferred = preferredId ? targetGuild.channels.cache.get(preferredId) : null;
    if (preferred?.isTextBased?.() && preferred?.isSendable?.()) return preferred;
    return music.getLastTextChannel(targetGuild.id) || targetGuild.systemChannel || targetGuild.channels.cache.find((channel) => channel.isTextBased?.() && channel.isSendable?.()) || null;
  }

  function state(context = {}) {
    const targetGuild = guild();
    const userId = String(context.discordUserId || '').trim();
    const member = userId ? targetGuild?.members.cache.get(userId) : null;
    const user = member?.user || (userId ? client.users.cache.get(userId) : null);
    const player = targetGuild ? music.get(targetGuild.id) : null;
    const channelId = player?.connection?.joinConfig?.channelId;
    const channel = channelId ? targetGuild.channels.cache.get(channelId) : null;
    const voiceMembers = channel?.members?.map((member) => ({
      id: member.id,
      name: member.displayName || member.user.globalName || member.user.username,
      avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
      bot: member.user.bot,
    })) || [];
    const elapsed = Math.floor((player?.seekOffset || 0) + (player?.player?.state?.resource?.playbackDuration || 0) / 1000);
    const total = durationSeconds(player?.current?.duration);
    return {
      botOnline: client.isReady(), latencyMs: Math.max(0, Math.round(client.ws.ping || 0)), discordClientId: client.application?.id || client.user?.id || '', userName: member?.displayName || user?.globalName || user?.username || '', userAvatar: user?.displayAvatarURL({ extension: 'png', size: 128 }) || '', guildId: targetGuild?.id || '', guildName: targetGuild?.name || 'Aucun serveur',
      guilds: client.guilds.cache.map((item) => ({ id: item.id, name: item.name, icon: item.iconURL({ extension: 'png', size: 64 }) || '' })),
      textChannels: targetGuild?.channels.cache.filter((item) => item.isTextBased?.() && item.isSendable?.() && !item.isThread?.()).map((item) => ({ id: item.id, name: item.name })) || [],
      voiceChannel: channel?.name || 'Aucun salon', voiceMembers,
      playing: player?.player?.state?.status === AudioPlayerStatus.Playing, volume: player?.volume ?? config.defaultVolume, loop:player?.loop||'off',
      audioPreset: player?.audioPreset || 'normal', normalizeVolume: player?.normalizeVolume ?? true, crossfadeSeconds: player?.crossfadeSeconds ?? 3,
      position: total > 0 ? Math.min(100, (elapsed / total) * 100) : 0, elapsed,
      current: desktopTrack(player?.current), queue: (player?.queue || []).map(desktopTrack), history: [],
    };
  }

  function send(socket, message) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  function broadcast() { for (const socket of server.clients) if (socket.readyState === WebSocket.OPEN && authenticated.has(socket)) send(socket, { type: 'state', payload: state(contexts.get(socket) || {}) }); }

  async function connectedPlayer(context) {
    const targetGuild = guild();
    if (!targetGuild) throw new Error('Le bot ne se trouve sur aucun serveur Discord.');
    const channel = await voiceChannel(targetGuild, context);
    if (!channel) throw new Error('Tu dois rejoindre un salon vocal sur Discord.');
    if (!channel.joinable || !channel.speakable) throw new Error('Le bot n’a pas la permission de rejoindre/parler dans ce salon.');
    const player = music.getOrCreate(targetGuild.id);
    await player.connect(channel, textChannel(targetGuild, context));
    player.setAudioSettings({ preset: context.audioPreset, normalize: context.normalizeVolume, crossfadeSeconds: context.crossfadeSeconds });
    return player;
  }

  async function command(action, payload, context = {}) {
    lastContext = context;
    if (context.discordUserId) trackedUsers.set(String(context.discordUserId), context);
    const preferredGuildId = String(context.preferredGuildId || '');
    if (preferredGuildId) {
      if (!client.guilds.cache.has(preferredGuildId)) throw new Error('Le bot n’est pas présent sur ton serveur préféré.');
      selectedGuildId = preferredGuildId;
    }
    if (action === 'select_guild') {
      if (!client.guilds.cache.has(String(payload))) throw new Error('Ce serveur est inaccessible au bot.');
      selectedGuildId = String(payload);
      return;
    }
    const targetGuild = guild();
    const userId = String(context.discordUserId || '').trim();
    const member = userId && targetGuild ? await targetGuild.members.fetch(userId).catch(() => null) : null;
    let player = targetGuild ? music.get(targetGuild.id) : null;
    if (action === 'get_state') return;
    if (!member) throw new Error('Connecte ton compte Discord pour contrôler cette session.');
    if (action === 'set_release_channel') {
      const channelId = saveReleaseChannel(targetGuild.id, payload || context.releaseChannelId);
      await announceRelease(client, { channelId, enabled: config.releaseAnnouncements });
      return;
    }
    let policy = controlPolicies.get(targetGuild.id);
    if (!policy) {
      policy = { ownerId: userId, mode: context.controlMode === 'shared' ? 'shared' : 'private', roleIds: String(context.allowedRoleIds || '').split(',').map((id) => id.trim()).filter(Boolean) };
      controlPolicies.set(targetGuild.id, policy);
    }
    const sharedRole = policy.mode === 'shared' && policy.roleIds.some((roleId) => member.roles.cache.has(roleId));
    if (policy.ownerId !== userId && !sharedRole) throw new Error('Cette session est privée ou ton rôle ne permet pas de la contrôler.');
    if (policy.ownerId === userId) {
      policy.mode = context.controlMode === 'shared' ? 'shared' : 'private';
      policy.roleIds = String(context.allowedRoleIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    }
    if (['play_now', 'play_next', 'enqueue'].includes(action)) player = await connectedPlayer(context);
    if (!player && !['volume'].includes(action)) throw new Error('Aucun lecteur actif.');
    if (action === 'play_now') { player.stopping = false; player.queue = []; player.skip(); player.enqueue(botTrack(payload)); }
    else if (action === 'play_next') { const track = botTrack(payload); if (player.current) player.queue.unshift(track); else player.enqueue(track); }
    else if (action === 'enqueue') player.enqueue(botTrack(payload));
    else if (action === 'toggle_pause') player.player.state.status === AudioPlayerStatus.Paused ? player.resume() : player.pause();
    else if (action === 'skip') player.skip();
    else if (action === 'stop') player.stop();
    else if (action === 'volume') { if (!player) player = await connectedPlayer(context); player.setVolume(Math.max(0, Math.min(100, Number(payload)))); }
    else if (action === 'loop') { player.loop = ['off','track','queue'].includes(String(payload)) ? String(payload) : 'off'; }
    else if (action === 'audio_settings') { if (!player) player = await connectedPlayer(context); player.setAudioSettings(payload || {}); }
    else if (action === 'seek') player.seek(Number(payload));
    else if (action === 'remove_queue') player.queue.splice(Number(payload), 1);
    else if (action === 'clear_queue') player.queue = [];
    else if (action === 'reorder_queue') player.queue = (payload || []).map(botTrack);
  }

  server.on('connection', (socket) => {
    socket.on('message', async (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (message.type === 'auth') {
          if (config.desktopToken && message.token !== config.desktopToken) return socket.close(4001, 'Authentification refusée');
          authenticated.add(socket); send(socket, { type: 'state', payload: state() }); return;
        }
        if (!authenticated.has(socket) || message.type !== 'command') return;
        const context = message.context || lastContext; contexts.set(socket, context); await command(message.action, message.payload, context);
        send(socket, { type: 'event', event: 'command_result', payload: { requestId: message.requestId, ok: true } });
        setTimeout(broadcast, 250);
      } catch (error) {
        send(socket, { type: 'event', event: 'command_result', payload: { ok: false, message: error.message } });
        console.error('[Desktop]', error.message);
      }
    });
  });
  const timer = setInterval(broadcast, 2_000);
  server.on('listening', () => console.log(`Passerelle Inazuma Music : ws://127.0.0.1:${config.desktopPort}`));
  return {
    async handleVoiceStateUpdate(oldState, newState) {
      const context = trackedUsers.get(newState.id);
      if (!context || oldState.channelId === newState.channelId) return;
      const player = music.get(newState.guild.id);
      if (context.autoJoin !== false && newState.channel && player?.current) {
        await player.connect(newState.channel, textChannel(newState.guild, context)).catch((error) => console.error('[Inazuma Music] Auto-join:', error.message));
      }
      if (context.autoLeave !== false && oldState.channel && !newState.channelId && player?.voiceChannel?.id === oldState.channelId) {
        const listeners = oldState.channel.members.filter((member) => !member.user.bot);
        if (listeners.size === 0) player.destroy();
      }
      broadcast();
    },
    close: () => { clearInterval(timer); server.close(); },
  };
}
