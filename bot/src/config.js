import 'dotenv/config';

function integer(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} doit être un entier entre ${min} et ${max}.`);
  }
  return value;
}

function boolean(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'off', 'non'].includes(value.toLowerCase());
}

export const config = Object.freeze({
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID || null,
  ytDlpPath: process.env.YTDLP_PATH || 'yt-dlp',
  idleDisconnectMs: integer('IDLE_DISCONNECT_MS', 30_000, 0, 600_000),
  defaultVolume: integer('DEFAULT_VOLUME', 50, 0, 100),
  desktopPort: integer('DESKTOP_PORT', 8765, 1024, 65535),
  desktopToken: process.env.DESKTOP_API_TOKEN || '',
  desktopVoiceChannelId: process.env.DESKTOP_VOICE_CHANNEL_ID || '',
  defaultTextChannelId: process.env.DEFAULT_TEXT_CHANNEL_ID || '',
  remoteRelayUrl: process.env.NEWAA_RELAY_URL || '',
  remoteRelayToken: process.env.NEWAA_RELAY_TOKEN || '',
  autoplay: boolean('AUTOPLAY', true),
  releaseAnnouncements: boolean('RELEASE_ANNOUNCEMENTS', true),
  releaseChannelId: process.env.RELEASE_CHANNEL_ID || '',
});

export function assertRuntimeConfig({ deploy = false } = {}) {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (deploy && !config.clientId) missing.push('DISCORD_CLIENT_ID');
  if (missing.length) throw new Error(`Variables manquantes dans .env : ${missing.join(', ')}`);
}
