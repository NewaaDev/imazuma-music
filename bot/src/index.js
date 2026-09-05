import { AuditLogEvent, Client, Events, GatewayIntentBits } from 'discord.js';
import { assertRuntimeConfig, config } from './config.js';
import { handleInteraction } from './interactions.js';
import { MusicManager } from './music-manager.js';
import { createDesktopBridge } from './desktop-bridge.js';
import { createRemoteRelay } from './remote-relay.js';
import { restoreSessions, saveSessions } from './session-store.js';
import { announceRelease, restoreDeletedReleaseMessage, selectedReleaseChannels } from './release-announcer.js';

assertRuntimeConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages] });
const music = new MusicManager();
let desktopBridge;
let remoteRelay;
let announcementMonitor;

async function logReleaseDeletionActor(message) {
  if (!message?.guild) return;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  try {
    const logs = await message.guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 6 });
    const entry = logs.entries.find((candidate) => {
      const sameChannel = candidate.extra?.channel?.id === message.channelId;
      const recent = Math.abs(Date.now() - candidate.createdTimestamp) < 10_000;
      const sameAuthor = !message.author?.id || candidate.target?.id === message.author.id;
      return sameChannel && recent && sameAuthor;
    });
    if (entry?.executor) {
      console.warn(`[Inazuma Music] Suppression attribuée à ${entry.executor.tag || entry.executor.id} (${entry.executor.id}).`);
    } else {
      console.warn('[Inazuma Music] Aucun responsable trouvé dans le journal Discord; suppression probable par l’auteur, un webhook ou une automatisation externe.');
    }
  } catch (error) {
    console.warn(`[Inazuma Music] Auteur de la suppression non identifiable (${error.message}). Il faut la permission Voir le journal d’audit.`);
  }
}

async function ensureReleaseAnnouncements(readyClient) {
  for (const { guildId, channelId } of selectedReleaseChannels(config.guildId, config.releaseChannelId)) {
    if (!readyClient.guilds.cache.has(guildId)) continue;
    await announceRelease(readyClient, { channelId, enabled: config.releaseAnnouncements })
      .then((result) => { if (result.sent) console.log(`[Inazuma Music] Mise à jour ${result.version} annoncée dans ${channelId}.`); })
      .catch((error) => console.error('[Inazuma Music] Annonce de mise à jour:', error.message));
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Connecté en tant que ${readyClient.user.tag} (${readyClient.guilds.cache.size} serveur(s)).`);
  desktopBridge = createDesktopBridge(client, music);
  remoteRelay = createRemoteRelay();
  void restoreSessions(readyClient, music).then((count) => {
    if (count) console.log(`${count} session(s) Inazuma restaurée(s).`);
  });
  void ensureReleaseAnnouncements(readyClient);
  announcementMonitor = setInterval(() => void ensureReleaseAnnouncements(readyClient), 60_000);
});
client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction, music));
client.on(Events.VoiceStateUpdate, (oldState, newState) => desktopBridge?.handleVoiceStateUpdate(oldState, newState));
client.on(Events.MessageDelete, (message) => {
  music.handleDeletedMessage(message);
  void logReleaseDeletionActor(message);
  void restoreDeletedReleaseMessage(client, message, { enabled: config.releaseAnnouncements })
    .then((result) => { if (result.restored) console.log(`[Inazuma Music] Annonce restaurée immédiatement dans ${message.channelId}.`); })
    .catch((error) => console.error('[Inazuma Music] Restauration immédiate de l’annonce:', error.message));
});
client.on(Events.Error, (error) => console.error('Erreur Discord:', error));
const persistenceTimer = setInterval(() => {
  try { saveSessions(music); } catch (error) { console.error('[Inazuma Music] Sauvegarde:', error.message); }
}, 2_000);

async function shutdown(signal) {
  console.log(`${signal} reçu, arrêt propre…`);
  clearInterval(persistenceTimer);
  clearInterval(announcementMonitor);
  try { saveSessions(music); } catch {}
  music.destroyAll();
  desktopBridge?.close();
  remoteRelay?.close();
  client.destroy();
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => console.error('Promesse rejetée:', error));

await client.login(config.token);
