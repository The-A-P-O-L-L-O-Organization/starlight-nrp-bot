import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember, TextChannel } from 'discord.js';
import { canManageMap } from '../utils/permissions';
import { getCurrentMapPath, saveMapImage, getFullMapPath, saveFullMapImage } from '../db/schema';

const ALLOWED_FULL_MAP_CHANNELS = ['maps-private', 'notes'];

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
      .setName('view-full')
      .setDescription('[GM] View the full map (restricted to Owner/GM or Map Guy, specific channels only)'),
  )

  .addSubcommand((sub) =>
    sub
      .setName('upload')
      .setDescription('[GM] Upload a new map image')
      .addAttachmentOption((o) =>
        o.setName('map').setDescription('The map image to upload').setRequired(true),
      ),
  )

  .addSubcommand((sub) =>
    sub
      .setName('upload-full')
      .setDescription('[GM] Upload a new full map image (restricted to Owner/GM or Map Guy, specific channels only)')
      .addAttachmentOption((o) =>
        o.setName('map').setDescription('The full map image to upload').setRequired(true),
      ),
  );

function isAllowedFullMapChannel(interaction: ChatInputCommandInteraction): boolean {
  const channel = interaction.channel;
  if (!channel || !('name' in channel)) return false;
  return ALLOWED_FULL_MAP_CHANNELS.includes((channel as TextChannel).name);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'view') {
    await interaction.deferReply();

    const mapPath = getCurrentMapPath();

    if (!mapPath) {
      await interaction.editReply({
        content: 'No map has been uploaded yet.',
      });
      return;
    }

    await interaction.editReply({
      content: '**Current Map**',
      files: [{ attachment: mapPath }],
    });
    return;
  }

  if (subcommand === 'view-full') {
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
        content: 'You do not have permission to use this command. Only Owner/GM or Map Guy roles can do this.',
      });
      return;
    }

    if (!isAllowedFullMapChannel(interaction)) {
      await interaction.editReply({
        content: `This command can only be used in the following channels: ${ALLOWED_FULL_MAP_CHANNELS.join(', ')}`,
      });
      return;
    }

    const mapPath = getFullMapPath();

    if (!mapPath) {
      await interaction.editReply({
        content: 'No full map has been uploaded yet.',
      });
      return;
    }

    await interaction.editReply({
      content: '**Full Map**',
      files: [{ attachment: mapPath }],
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

    // Download the image from Discord CDN
    const response = await fetch(attachment.url);
    if (!response.ok) {
      await interaction.editReply({
        content: 'Failed to download the image from Discord.',
      });
      return;
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    await saveMapImage(imageBuffer, attachment.name);

    await interaction.editReply({
      content: 'Map updated successfully.',
    });
    return;
  }

  if (subcommand === 'upload-full') {
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

    if (!isAllowedFullMapChannel(interaction)) {
      await interaction.editReply({
        content: `This command can only be used in the following channels: ${ALLOWED_FULL_MAP_CHANNELS.join(', ')}`,
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

    // Download the image from Discord CDN
    const response = await fetch(attachment.url);
    if (!response.ok) {
      await interaction.editReply({
        content: 'Failed to download the image from Discord.',
      });
      return;
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    await saveFullMapImage(imageBuffer, attachment.name);

    await interaction.editReply({
      content: 'Full map updated successfully.',
    });
    return;
  }
}
