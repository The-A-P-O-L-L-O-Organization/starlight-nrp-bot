import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
} from 'discord.js';
import { isGM } from '../utils/permissions';
import { createNation, getNationByUserId, getAllNations } from '../db/schema';
import { buildResourceEmbed } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('nation')
  .setDescription('Manage star-nations')
  .addSubcommand((sub) =>
    sub
      .setName('register')
      .setDescription('[GM] Register a nation for a player')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player to register').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('name').setDescription('Nation name').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription("View a player's nation resource sheet")
      .addUserOption((o) =>
        o.setName('player').setDescription('The player (defaults to you)').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List all registered nations'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'register') {
    if (!isGM(interaction.member as GuildMember)) {
      await interaction.reply({ content: 'Only the **Owner/GM** can register nations.', ephemeral: true });
      return;
    }

    const target = interaction.options.getUser('player', true);
    const name = interaction.options.getString('name', true).trim();

    if (getNationByUserId(target.id)) {
      await interaction.reply({ content: `<@${target.id}> already has a registered nation.`, ephemeral: true });
      return;
    }

    try {
      createNation(target.id, name);
      await interaction.reply({ content: `Nation **${name}** registered for <@${target.id}>.` });
    } catch {
      await interaction.reply({ content: `A nation named **${name}** already exists.`, ephemeral: true });
    }
    return;
  }

  if (sub === 'view') {
    const targetUser = interaction.options.getUser('player') ?? interaction.user;
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({
        content: `<@${targetUser.id}> does not have a registered nation.`,
        ephemeral: true,
      });
      return;
    }

    const embed = buildResourceEmbed(nation, nation.id);
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (sub === 'list') {
    const nations = getAllNations();

    if (nations.length === 0) {
      await interaction.reply({ content: 'No nations registered yet.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🌌 Registered Star-Nations')
      .setColor(0x2b2d31)
      .setDescription(
        nations.map((n, i) => `**${i + 1}.** ${n.name} — <@${n.discord_user_id}>`).join('\n'),
      )
      .setFooter({ text: 'Starlight NRP' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}
