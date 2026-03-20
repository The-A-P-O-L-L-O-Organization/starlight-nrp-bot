import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember, Colors } from 'discord.js';
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
    const mapUrl = getCurrentMapUrl();

    if (!mapUrl) {
      await interaction.reply({
        content: 'No map has been uploaded yet.',
        flags: 64,
      });
      return;
    }

    await interaction.reply({
      content: '**Current Map**',
      files: [{ attachment: mapUrl }],
    });
    return;
  }

  if (subcommand === 'upload') {
    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.reply({
        content: 'Unable to verify permissions.',
        flags: 64,
      });
      return;
    }

    if (!canManageMap(member as GuildMember)) {
      await interaction.reply({
        content: 'You do not have permission to upload maps. Only Owner/GM or Map Guy roles can do this.',
        flags: 64,
      });
      return;
    }

    const attachment = interaction.options.getAttachment('map', true);

    if (!attachment.contentType?.startsWith('image/')) {
      await interaction.reply({
        content: 'The uploaded file must be an image.',
        flags: 64,
      });
      return;
    }

    setMapUrl(attachment.url);

    await interaction.reply({
      content: `Map updated successfully.`,
    });
  }
}
