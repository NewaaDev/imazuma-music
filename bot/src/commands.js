import { SlashCommandBuilder } from 'discord.js';

export const commandData = [
  new SlashCommandBuilder().setName('play').setDescription('Ajoute une musique ou playlist YouTube à la file')
    .addStringOption((o) => o.setName('recherche').setDescription('Titre, URL vidéo ou URL de playlist YouTube').setRequired(true)),
  new SlashCommandBuilder().setName('pause').setDescription('Met la lecture en pause'),
  new SlashCommandBuilder().setName('resume').setDescription('Reprend la lecture'),
  new SlashCommandBuilder().setName('skip').setDescription('Passe à la musique suivante'),
  new SlashCommandBuilder().setName('stop').setDescription('Arrête la lecture et vide la file'),
  new SlashCommandBuilder().setName('queue').setDescription('Affiche la file d’attente'),
  new SlashCommandBuilder().setName('loop').setDescription('Configure la répétition')
    .addStringOption((o) => o.setName('mode').setDescription('Mode de répétition').setRequired(true)
      .addChoices(
        { name: 'Désactivée', value: 'off' },
        { name: 'Musique actuelle', value: 'track' },
        { name: 'Toute la file', value: 'queue' },
      )),
  new SlashCommandBuilder().setName('volume').setDescription('Règle le volume')
    .addIntegerOption((o) => o.setName('niveau').setDescription('De 0 à 100').setMinValue(0).setMaxValue(100).setRequired(true)),
];

export const commandJson = commandData.map((command) => command.toJSON());
