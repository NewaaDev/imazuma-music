import { Client, Events, GatewayIntentBits } from 'discord.js';
import { assertRuntimeConfig, config } from './config.js';
import { handleInteraction } from './interactions.js';
import { MusicManager } from './music-manager.js';
import { createDesktopBridge } from './desktop-bridge.js';
import { createRemoteRelay } from './remote-relay.js';
import { restoreSessions, saveSessions } from './session-store.js';

assertRuntimeConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const music = new MusicManager();
let desktopBridge;
let remoteRelay;

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Connecté en tant que ${readyClient.user.tag} (${readyClient.guilds.cache.size} serveur(s)).`);
  desktopBridge = createDesktopBridge(client, music);
  remoteRelay = createRemoteRelay();
  void restoreSessions(readyClient, music).then((count) => {
    if (count) console.log(`${count} session(s) Inazuma restaurée(s).`);
  });
});
client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction, music));
client.on(Events.VoiceStateUpdate, (oldState, newState) => desktopBridge?.handleVoiceStateUpdate(oldState, newState));
client.on(Events.Error, (error) => console.error('Erreur Discord:', error));
const persistenceTimer = setInterval(() => {
  try { saveSessions(music); } catch (error) { console.error('[Inazuma Music] Sauvegarde:', error.message); }
}, 2_000);

async function shutdown(signal) {
  console.log(`${signal} reçu, arrêt propre…`);
  clearInterval(persistenceTimer);
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
