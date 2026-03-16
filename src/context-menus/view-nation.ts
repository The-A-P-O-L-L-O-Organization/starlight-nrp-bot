import { ContextMenuCommandBuilder, ApplicationCommandType, UserContextMenuCommandInteraction } from 'discord.js';
import { getNationByUserId } from '../db/schema';
import { buildResourceEmbed } from '../utils/embeds';

export const data = new ContextMenuCommandBuilder()
  .setName('View Nation Resources')
  .setType(ApplicationCommandType.User);

export async function execute(interaction: UserContextMenuCommandInteraction): Promise<void> {
  const targetUser = interaction.targetUser;
  const nation = getNationByUserId(targetUser.id);

  if (!nation) {
    await interaction.reply({
      content: `<@${targetUser.id}> does not have a registered nation.`,
      ephemeral: true,
    });
    return;
  }

  const embed = buildResourceEmbed(nation, nation.id);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
