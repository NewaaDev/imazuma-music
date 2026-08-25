import { REST, Routes } from 'discord.js';
import { assertRuntimeConfig, config } from '../src/config.js';
import { commandJson } from '../src/commands.js';

assertRuntimeConfig({ deploy: true });
const rest = new REST({ version: '10' }).setToken(config.token);
const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId)
  : Routes.applicationCommands(config.clientId);

console.log(`Déploiement de ${commandJson.length} commandes ${config.guildId ? 'sur le serveur de test' : 'globalement'}…`);
await rest.put(route, { body: commandJson });
console.log('Commandes déployées.');
