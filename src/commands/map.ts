import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { canManageMap } from '../utils/permissions';
import { getCurrentMapUrl, setMapUrl } from '../db/schema';

export const data = new SlashCommandBuilder()
  .setName('map')
  .setDescription('Map commands')

  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View the current map'),
  )

  .addSubcommand((sub) =>
    sub
      .setName('upload')
      .setDescription('[GM] Upload a new map image')
      .addAttachmentOption((o) =>
        o.setName('map').setDescription('The map image to upload').setRequired(true),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'view') {
    await interaction.deferReply();

    const mapUrl = getCurrentMapUrl();

    if (!mapUrl) {
      await interaction.editReply({
        content: 'No map has been uploaded yet.',
      });
      return;
    }

    await interaction.editReply({
      content: '**Current Map**',
      files: [{ attachment: mapUrl }],
    });
    return;
  }

  if (subcommand === 'upload') {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({
        content: 'Unable to verify permissions.',
      });
      return;
    }

    if (!canManageMap(member as GuildMember)) {
      await interaction.editReply({
        content: 'You do not have permission to upload maps. Only Owner/GM or Map Guy roles can do this.',
      });
      return;
    }

    const attachment = interaction.options.getAttachment('map', true);

    if (!attachment.contentType?.startsWith('image/')) {
      await interaction.editReply({
        content: 'The uploaded file must be an image.',
      });
      return;
    }

    setMapUrl(attachment.url);

    await interaction.editReply({
      content: 'Map updated successfully.',
    });
  }
}
