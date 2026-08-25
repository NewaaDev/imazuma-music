import { Client, Events, GatewayIntentBits } from 'discord.js';
import { assertRuntimeConfig, config } from './config.js';
import { handleInteraction } from './interactions.js';
import { MusicManager } from './music-manager.js';
import { createDesktopBridge } from './desktop-bridge.js';
import { createRemoteRelay } from './remote-relay.js';

assertRuntimeConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const music = new MusicManager();
let desktopBridge;
let remoteRelay;

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Connecté en tant que ${readyClient.user.tag} (${readyClient.guilds.cache.size} serveur(s)).`);
  desktopBridge = createDesktopBridge(client, music);
  remoteRelay = createRemoteRelay();
});
client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction, music));
client.on(Events.Error, (error) => console.error('Erreur Discord:', error));

async function shutdown(signal) {
  console.log(`${signal} reçu, arrêt propre…`);
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
