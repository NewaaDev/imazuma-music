import fs from 'node:fs';
import path from 'node:path';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const releaseFile = path.resolve(process.env.INAZUMA_RELEASE_FILE || './release.json');
const stateFile = path.resolve(process.env.INAZUMA_RELEASE_STATE_FILE || './data/release-announcement.json');
const selectionFile = path.resolve(process.env.INAZUMA_RELEASE_SELECTION_FILE || './data/release-channel.json');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function releaseAnnouncement(release) {
  const changes = Array.isArray(release?.changes) ? release.changes.map(String).filter(Boolean).slice(0, 20) : [];
  if (!release?.version || !changes.length) return null;
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xf5b800)
      .setAuthor({ name: 'Inazuma Music' })
      .setThumbnail('https://raw.githubusercontent.com/NewaaDev/imazuma-music/feature/inazuma-v2/assets/icon.png')
      .setTitle(`⚡ Mise à jour ${String(release.version).slice(0, 32)}`)
      .setDescription(changes.map((change) => `• ${change}`).join('\n').slice(0, 4000))
      .addFields({ name: 'Version', value: String(release.version).slice(0, 100), inline: true })
      .setURL(/^https:\/\//.test(release.downloadUrl || '') ? release.downloadUrl : 'https://github.com/NewaaDev/imazuma-music/releases/latest')
      .setFooter({ text: 'Inazuma Music • Mise à jour officielle' })
      .setTimestamp()],
    components: [],
  };
}

function savedAnnouncement(state, channelId) {
  if (state?.announcements?.[channelId]) return state.announcements[channelId];
  return state?.channelId === channelId ? state : null;
}

function messageMissing(error) {
  return error?.code === 10008 || error?.status === 404 || error?.httpStatus === 404;
}

export async function existingReleaseMessage(channel, state, release) {
  if (!state?.messageId || state.version !== release?.version || state.channelId !== channel.id) return null;
  try {
    return await channel.messages.fetch(state.messageId);
  } catch (error) {
    if (messageMissing(error)) return null;
    throw error;
  }
}

export async function announceRelease(client, { channelId, enabled = true } = {}) {
  if (!enabled || !channelId) return { sent: false, reason: 'disabled' };
  const release = readJson(releaseFile);
  const payload = releaseAnnouncement(release);
  if (!payload) return { sent: false, reason: 'invalid-release' };
  const state = readJson(stateFile, {});
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.() || !channel.isSendable?.()) throw new Error(`Le salon ${channelId} n'est pas un salon texte accessible.`);
  const permissions = channel.permissionsFor?.(client.user);
  if (permissions && (!permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks) || !permissions.has(PermissionFlagsBits.ReadMessageHistory))) {
    throw new Error(`Permissions insuffisantes dans le salon ${channelId} (Voir, Envoyer, Historique, Intégrer des liens).`);
  }
  const tracked = savedAnnouncement(state, channelId);
  if (await existingReleaseMessage(channel, tracked, release)) return { sent: false, reason: 'already-sent' };
  if (tracked?.messageId && tracked?.version === release.version) {
    console.warn(`[Inazuma Music] L'annonce ${tracked.messageId} a disparu du salon ${channelId}; republication.`);
  }
  const message = await channel.send(payload);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const entry = { version: release.version, channelId, messageId: message.id, sentAt: new Date().toISOString() };
  const announcements = state?.announcements && typeof state.announcements === 'object' ? state.announcements : {};
  fs.writeFileSync(stateFile, JSON.stringify({ announcements: { ...announcements, [channelId]: entry } }, null, 2));
  return { sent: true, version: release.version, messageId: message.id };
}

export function selectedReleaseChannels(fallbackGuildId = '', fallbackChannelId = '') {
  const saved = readJson(selectionFile, {});
  const channels = saved?.channels && typeof saved.channels === 'object' ? saved.channels : {};
  const entries = Object.entries(channels)
    .map(([guildId, channelId]) => ({ guildId: String(guildId), channelId: String(channelId) }))
    .filter(({ guildId, channelId }) => /^\d{17,20}$/.test(guildId) && /^\d{17,20}$/.test(channelId));
  if (entries.length) return entries;
  const guildId = String(fallbackGuildId || '').trim();
  const channelId = String(saved?.channelId || fallbackChannelId || '').trim();
  return /^\d{17,20}$/.test(guildId) && /^\d{17,20}$/.test(channelId) ? [{ guildId, channelId }] : [];
}

export function saveReleaseChannel(guildId, channelId) {
  const guild = String(guildId || '').trim();
  const value = String(channelId || '').trim();
  if (!/^\d{17,20}$/.test(guild)) throw new Error('Choisis un serveur Discord valide pour les mises à jour.');
  if (!/^\d{17,20}$/.test(value)) throw new Error('Choisis un salon Discord valide pour les mises à jour.');
  const saved = readJson(selectionFile, {});
  const channels = saved?.channels && typeof saved.channels === 'object' ? saved.channels : {};
  fs.mkdirSync(path.dirname(selectionFile), { recursive: true });
  fs.writeFileSync(selectionFile, JSON.stringify({ channels: { ...channels, [guild]: value }, updatedAt: new Date().toISOString() }, null, 2));
  return value;
}
