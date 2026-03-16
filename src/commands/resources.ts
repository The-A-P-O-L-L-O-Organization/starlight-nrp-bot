import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { getNationByUserId } from '../db/schema';
import { buildResourceEmbed } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('resources')
  .setDescription('View your nation\'s current resources and production rates');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const nation = getNationByUserId(interaction.user.id);

  if (!nation) {
    await interaction.reply({
      content: 'You do not have a registered nation. Ask the GM to register one for you.',
      ephemeral: true,
    });
    return;
  }

  const embed = buildResourceEmbed(nation, nation.id);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
