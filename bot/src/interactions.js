import { EmbedBuilder, MessageFlags } from 'discord.js';
import { resolveTracks } from './services/youtube.js';
import { duration, truncate } from './utils/format.js';

function voiceChannelOf(interaction) { return interaction.member?.voice?.channel ?? null; }

function activePlayer(interaction, manager) {
  const player = manager.get(interaction.guildId);
  if (!player?.current) throw new Error('Aucune musique n’est en cours.');
  const voice = voiceChannelOf(interaction);
  if (!voice || voice.id !== player.connection?.joinConfig.channelId) {
    throw new Error('Rejoins mon salon vocal pour utiliser cette commande.');
  }
  return player;
}

export async function handleInteraction(interaction, manager) {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;
  manager.rememberTextChannel(interaction.guildId, interaction.channel);
  try {
    if (interaction.commandName === 'play') {
      const voice = voiceChannelOf(interaction);
      if (!voice) throw new Error('Rejoins d’abord un salon vocal.');
      const existing = manager.get(interaction.guildId);
      if (existing?.connection && existing.connection.joinConfig.channelId !== voice.id) {
        throw new Error('Je joue déjà dans un autre salon vocal.');
      }
      await interaction.deferReply();
      const query = interaction.options.getString('recherche', true).trim();
      const tracks = await resolveTracks(query, interaction.user.toString());
      const player = manager.getOrCreate(interaction.guildId);
      await player.connect(voice, interaction.channel);
      const positions = tracks.map((track) => player.enqueue(track));
      const track = tracks[0];
      const position = positions[0];
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(truncate(track.title, 256)).setURL(track.url)
        .setDescription(tracks.length > 1
          ? `✅ **${tracks.length} titres** ajoutés à la file (maximum 100).`
          : position === 0 ? 'Lecture en cours de préparation.' : `Ajoutée à la file • position ${position}`)
        .addFields({ name: 'Durée', value: duration(track.duration), inline: true });
      if (track.thumbnail) embed.setThumbnail(track.thumbnail);
      return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'queue') {
      const player = manager.get(interaction.guildId);
      if (!player?.current) throw new Error('La file est vide.');
      const upcoming = player.queue.slice(0, 10).map((t, i) => `${i + 1}. [${truncate(t.title, 70)}](${t.url}) • ${duration(t.duration)}`);
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('File d’attente')
        .setDescription(`**En cours :** [${truncate(player.current.title, 90)}](${player.current.url})\n\n${upcoming.join('\n') || '*Aucune musique ensuite.*'}`)
        .setFooter({ text: `${player.queue.length} en attente • Volume ${player.volume}% • Boucle ${player.loop}` });
      return interaction.reply({ embeds: [embed] });
    }

    const player = activePlayer(interaction, manager);
    if (interaction.commandName === 'pause') {
      if (!player.pause()) throw new Error('La lecture est déjà en pause.');
      return interaction.reply('⏸️ Lecture en pause.');
    }
    if (interaction.commandName === 'resume') {
      if (!player.resume()) throw new Error('La lecture n’est pas en pause.');
      return interaction.reply('▶️ Lecture reprise.');
    }
    if (interaction.commandName === 'skip') {
      player.skip();
      return interaction.reply('⏭️ Musique passée.');
    }
    if (interaction.commandName === 'stop') {
      player.stop();
      return interaction.reply('⏹️ Lecture arrêtée, file vidée et salon quitté.');
    }
    if (interaction.commandName === 'loop') {
      player.loop = interaction.options.getString('mode', true);
      return interaction.reply(`🔁 Boucle : **${player.loop}**.`);
    }
    if (interaction.commandName === 'volume') {
      const value = interaction.options.getInteger('niveau', true);
      player.setVolume(value);
      return interaction.reply(`🔊 Volume réglé sur **${value}%**.`);
    }
  } catch (error) {
    console.error(`Commande /${interaction.commandName}:`, error);
    const payload = { content: `❌ ${error.message || 'Une erreur inattendue est survenue.'}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) return interaction.editReply({ content: payload.content, embeds: [] }).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  }
}
