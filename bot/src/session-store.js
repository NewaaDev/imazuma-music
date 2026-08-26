import fs from 'node:fs';
import path from 'node:path';

const sessionFile = path.resolve(process.env.INAZUMA_SESSION_FILE || './data/sessions.json');

function serializableTrack(track) {
  if (!track?.id) return null;
  return {
    id: track.id,
    title: track.title,
    channel: track.channel,
    thumbnail: track.thumbnail,
    duration: track.duration,
    requestedBy: track.requestedBy,
    url: track.url,
  };
}

export function saveSessions(music) {
  const sessions = [...music.guilds.values()].filter((player) => player.voiceChannel).map((player) => ({
    guildId: player.guildId,
    voiceChannelId: player.voiceChannel?.id || '',
    textChannelId: player.textChannel?.id || '',
    volume: player.volume,
    loop: player.loop,
    current: serializableTrack(player.current),
    queue: player.queue.map(serializableTrack).filter(Boolean),
    savedAt: Date.now(),
  }));
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  const temporary = `${sessionFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, sessions }, null, 2));
  fs.renameSync(temporary, sessionFile);
}

export async function restoreSessions(client, music) {
  let sessions = [];
  try { sessions = JSON.parse(fs.readFileSync(sessionFile, 'utf8')).sessions || []; } catch { return 0; }
  let restored = 0;
  for (const snapshot of sessions) {
    try {
      const guild = await client.guilds.fetch(snapshot.guildId);
      const voice = await guild.channels.fetch(snapshot.voiceChannelId);
      const text = snapshot.textChannelId ? await guild.channels.fetch(snapshot.textChannelId).catch(() => null) : null;
      if (!voice?.isVoiceBased?.() || !voice.joinable || !voice.speakable) continue;
      const player = music.getOrCreate(guild.id);
      await player.connect(voice, text);
      player.setVolume(Math.max(0, Math.min(100, Number(snapshot.volume) || 50)));
      player.loop = ['off', 'track', 'queue'].includes(snapshot.loop) ? snapshot.loop : 'off';
      const tracks = [snapshot.current, ...(Array.isArray(snapshot.queue) ? snapshot.queue : [])].filter((track) => track?.id);
      for (const track of tracks.slice(0, 500)) player.enqueue(track);
      restored += 1;
    } catch (error) {
      console.error(`[Inazuma Music] Reprise ${snapshot.guildId}:`, error instanceof Error ? error.message : String(error));
    }
  }
  return restored;
}
