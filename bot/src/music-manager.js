import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import ffmpegPath from 'ffmpeg-static';
import { EmbedBuilder, Routes } from 'discord.js';
import { config } from './config.js';
import { createDownload, findSimilarTrack } from './services/youtube.js';
import { duration, truncate } from './utils/format.js';

class GuildPlayer extends EventEmitter {
  constructor(guildId, onDispose) {
    super();
    this.guildId = guildId;
    this.onDispose = onDispose;
    this.queue = [];
    this.current = null;
    this.loop = 'off';
    this.volume = config.defaultVolume;
    this.audioPreset = 'normal';
    this.normalizeVolume = true;
    this.crossfadeSeconds = 3;
    this.connection = null;
    this.voiceChannel = null;
    this.textChannel = null;
    this.processes = [];
    this.disconnectTimer = null;
    this.stopping = false;
    this.recentTrackIds = [];
    this.seekOffset = 0;
    this.playbackAttempt = 0;
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.player.on(AudioPlayerStatus.Idle, () => this.#onIdle());
    this.player.on('error', (error) => this.#onPlayerError(error));
  }

  async connect(voiceChannel, textChannel) {
    clearTimeout(this.disconnectTimer);
    const configuredTextChannel = config.defaultTextChannelId
      ? voiceChannel.guild.channels.cache.get(config.defaultTextChannelId)
      : null;
    this.textChannel = configuredTextChannel?.isTextBased?.() && configuredTextChannel?.isSendable?.()
      ? configuredTextChannel
      : textChannel;
    this.voiceChannel = voiceChannel;
    if (this.connection?.joinConfig.channelId === voiceChannel.id) return;
    this.connection?.destroy();
    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try { await Promise.race([
        entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]); } catch { this.destroy(); }
    });
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    this.connection.subscribe(this.player);
  }

  enqueue(track) {
    clearTimeout(this.disconnectTimer);
    this.queue.push(track);
    if (!this.current) void this.#playNext();
    return this.queue.length;
  }

  pause() { return this.player.pause(); }
  resume() { return this.player.unpause(); }
  skip() {
    if (!this.current) return false;
    this.#killProcesses();
    return this.player.stop(true);
  }
  stop() {
    this.stopping = true;
    this.queue = [];
    this.current = null;
    this.#killProcesses();
    this.player.stop(true);
    this.destroy();
  }
  setVolume(value) {
    this.volume = value;
    this.player.state.resource?.volume?.setVolume(value / 100);
  }

  setAudioSettings(value = {}) {
    this.audioPreset = ['normal', 'bass', 'vocal', 'night'].includes(value.preset) ? value.preset : 'normal';
    this.normalizeVolume = value.normalize !== false;
    this.crossfadeSeconds = Math.max(0, Math.min(10, Number(value.crossfadeSeconds) || 0));
  }

  #audioFilter(track) {
    const filters = [];
    if (this.normalizeVolume) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    if (this.audioPreset === 'bass') filters.push('bass=g=7:f=110:w=0.6');
    if (this.audioPreset === 'vocal') filters.push('equalizer=f=2500:t=q:w=1.2:g=4,equalizer=f=180:t=q:w=1:g=-2');
    if (this.audioPreset === 'night') filters.push('acompressor=threshold=-20dB:ratio=4:attack=20:release=250,volume=0.78');
    if (this.crossfadeSeconds > 0) {
      filters.push(`afade=t=in:st=0:d=${this.crossfadeSeconds}`);
      const outAt = Math.max(0, Number(track.duration || 0) - this.crossfadeSeconds);
      if (outAt > 0) filters.push(`afade=t=out:st=${outAt}:d=${this.crossfadeSeconds}`);
    }
    return filters.join(',');
  }

  seek(value) {
    if (!this.current) throw new Error('Aucune musique n’est en cours.');
    const total = Number(this.current.duration) || 0;
    const target = Math.max(0, Math.min(total > 1 ? total - 1 : Number.MAX_SAFE_INTEGER, Number(value) || 0));
    this.#killProcesses();
    void this.#startTrack(this.current, target);
    return target;
  }

  async #playNext() {
    clearTimeout(this.disconnectTimer);
    const track = this.queue.shift();
    if (!track) {
      this.current = null;
      this.seekOffset = 0;
      void this.#setVoiceStatus(null);
      this.#scheduleDisconnect();
      return;
    }
    await this.#startTrack(track, 0);
  }

  async #startTrack(track, startAt = 0) {
    const attempt = ++this.playbackAttempt;
    this.current = track;
    this.seekOffset = startAt;
    this.recentTrackIds = [...this.recentTrackIds.filter((id) => id !== track.id), track.id].slice(-50);
    this.#killProcesses();
    const download = createDownload(track);
    const audioFilter = this.#audioFilter(track);
    const ffmpeg = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      ...(startAt > 0 ? ['-ss', String(startAt)] : []),
      ...(audioFilter ? ['-af', audioFilter] : []),
      '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.processes = [download, ffmpeg];
    const diagnostics = [];
    download.stderr.on('data', (d) => diagnostics.push(String(d)));
    ffmpeg.stderr.on('data', (d) => diagnostics.push(String(d)));
    // FFmpeg peut fermer son entrée avant yt-dlp (skip, URL refusée, fin de
    // processus). Sans listener, Node transforme ce cas normal en crash EPIPE.
    ffmpeg.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE' && this.current === track) this.#failCurrent(error, attempt);
    });
    download.stdout.on('error', (error) => {
      if (error.code !== 'EPIPE' && this.current === track) this.#failCurrent(error, attempt);
    });
    download.stdout.pipe(ffmpeg.stdin);
    download.on('error', (error) => this.#failCurrent(error, attempt));
    ffmpeg.on('error', (error) => this.#failCurrent(error, attempt));
    download.on('close', (code) => {
      if (code && this.current === track) this.#failCurrent(new Error(diagnostics.join('').trim() || `yt-dlp: code ${code}`), attempt);
    });
    const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw, inlineVolume: true, metadata: track });
    resource.volume.setVolume(this.volume / 100);
    this.player.play(resource);
    if (startAt === 0) {
      void this.#setVoiceStatus(track);
      await this.#announce(track);
    }
  }

  async #announce(track) {
    if (!this.textChannel?.isTextBased()) return;
    const embed = new EmbedBuilder().setColor(0xff0033).setTitle(truncate(track.title, 256)).setURL(track.url)
      .setDescription(`Demandé par ${track.requestedBy}`)
      .addFields(
        { name: 'Chaîne', value: truncate(track.channel, 1024), inline: true },
        { name: 'Durée', value: duration(track.duration), inline: true },
      ).setFooter({ text: `Volume ${this.volume}% • Boucle ${this.loop}` });
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);
    try { await this.textChannel.send({ content: '▶️ Lecture en cours', embeds: [embed] }); }
    catch (error) { console.error(`[${this.guildId}] Impossible d’envoyer l’embed:`, error.message); }
  }

  #onIdle() {
    const finished = this.current;
    this.#killProcesses();
    this.current = null;
    this.seekOffset = 0;
    if (!this.stopping && finished) {
      if (this.loop === 'track') this.queue.unshift(finished);
      if (this.loop === 'queue') this.queue.push(finished);
    }
    if (!this.stopping) void this.#continueAfterIdle(finished);
  }

  async #continueAfterIdle(finished) {
    if (config.autoplay && finished && this.loop === 'off' && this.queue.length === 0) {
      try {
        const similar = await findSimilarTrack(finished, new Set(this.recentTrackIds));
        if (!this.stopping && !this.current && this.queue.length === 0) {
          this.queue.push(similar);
          void this.textChannel?.send(`♾️ Lecture automatique : **${truncate(similar.title, 100)}**`).catch(() => {});
        }
      } catch (error) {
        console.error(`[${this.guildId}] Lecture automatique indisponible:`, error.message);
      }
    }
    if (!this.stopping && !this.current) await this.#playNext();
  }

  #onPlayerError(error) {
    console.error(`[${this.guildId}] Erreur audio:`, error);
    void this.textChannel?.send('⚠️ Cette musique n’a pas pu être lue. Je passe à la suivante.').catch(() => {});
    this.#killProcesses();
    this.player.stop(true);
  }

  async #setVoiceStatus(track) {
    if (!this.voiceChannel?.client?.rest) return;
    const status = track ? truncate(`🎵 ${track.title} — ${track.channel}`, 500) : '';
    try {
      await this.voiceChannel.client.rest.put(Routes.channelVoiceStatus(this.voiceChannel.id), { body: { status } });
    } catch (error) {
      console.error(`[${this.guildId}] Impossible de modifier le statut vocal:`, error.message);
    }
  }

  #failCurrent(error, attempt = this.playbackAttempt) {
    if (!this.current || attempt !== this.playbackAttempt) return;
    console.error(`[${this.guildId}] Erreur source:`, error.message);
    void this.textChannel?.send(`⚠️ Source YouTube indisponible : ${truncate(error.message, 300)}`).catch(() => {});
    this.#killProcesses();
    this.player.stop(true);
  }

  #killProcesses() {
    for (const process of this.processes) {
      if (!process.killed) process.kill();
    }
    this.processes = [];
  }

  #scheduleDisconnect() {
    if (config.idleDisconnectMs === 0 || this.disconnectTimer || this.stopping) return;
    this.disconnectTimer = setTimeout(() => this.destroy(), config.idleDisconnectMs);
  }

  destroy() {
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    this.stopping = true;
    this.queue = [];
    this.current = null;
    this.#killProcesses();
    this.player.stop(true);
    void this.#setVoiceStatus(null);
    try { this.connection?.destroy(); } catch {}
    this.connection = null;
    this.voiceChannel = null;
    this.onDispose(this.guildId);
  }
}

export class MusicManager {
  constructor() { this.guilds = new Map(); this.lastTextChannels = new Map(); }
  rememberTextChannel(guildId, channel) { if (guildId && channel?.isTextBased?.()) this.lastTextChannels.set(guildId, channel); }
  getLastTextChannel(guildId) { return this.lastTextChannels.get(guildId) || null; }
  get(guildId) { return this.guilds.get(guildId); }
  getOrCreate(guildId) {
    let guildPlayer = this.get(guildId);
    if (!guildPlayer) {
      guildPlayer = new GuildPlayer(guildId, (id) => this.guilds.delete(id));
      this.guilds.set(guildId, guildPlayer);
    }
    return guildPlayer;
  }
  destroyAll() { for (const player of this.guilds.values()) player.destroy(); }
}
