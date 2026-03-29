import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
} from 'discord.js';
import { isGM } from '../utils/permissions';
import {
  getNationByUserId,
  getNationById,
  getTributes,
  createTribute,
  removeTribute,
  addSanction,
  getAllSanctions,
  removeSanction,
  archiveSeason,
  resetForNewSeason,
  logAuditEvent,
} from '../db/schema';
import { RESOURCE_TYPES, RESOURCE_META } from '../types';
import path from 'path';

export const data = new SlashCommandBuilder()
  .setName('gm2')
  .setDescription('[GM] Additional Game Master commands')

  .addSubcommand((sub) =>
    sub
      .setName('tributes')
      .setDescription('[GM] List all active tribute agreements'),
  )

  .addSubcommand((sub) =>
    sub
      .setName('add-tribute')
      .setDescription('[GM] Create a recurring tribute agreement (payer → receiver each tick)')
      .addUserOption((o) =>
        o.setName('payer').setDescription('Nation that pays tribute').setRequired(true),
      )
      .addUserOption((o) =>
        o.setName('receiver').setDescription('Nation that receives tribute').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Resource type')
          .setRequired(true)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      )
      .addNumberOption((o) =>
        o.setName('amount').setDescription('Amount transferred per tick').setRequired(true).setMinValue(1),
      )
      .addStringOption((o) =>
        o.setName('label').setDescription('Label for this agreement').setRequired(false),
      ),
  )

  .addSubcommand((sub) =>
    sub
      .setName('remove-tribute')
      .setDescription('[GM] Remove a tribute agreement by ID')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Tribute agreement ID').setRequired(true).setMinValue(1),
      ),
  )

  .addSubcommand((sub) =>
    sub
      .setName('sanctions-list')
      .setDescription('[GM] List all active sanctions'),
  )

  .addSubcommand((sub) =>
    sub
      .setName('add-sanction')
      .setDescription('[GM] Sanction a nation (blocks receiving transfers and trades)')
      .addUserOption((o) =>
        o.setName('player').setDescription('Nation to sanction').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for the sanction').setRequired(false),
      ),
  )

  .addSubcommand((sub) =>
    sub
      .setName('remove-sanction')
      .setDescription('[GM] Lift a sanction by ID')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Sanction ID').setRequired(true).setMinValue(1),
      ),
  )

  .addSubcommand((sub) =>
    sub
      .setName('export-state')
      .setDescription('[GM] Export the current game state to a JSON file')
      .addStringOption((o) =>
        o.setName('label').setDescription('Label for the snapshot file (e.g. "midgame")').setRequired(true),
      ),
  )

  .addSubcommand((sub) =>
    sub
      .setName('new-season')
      .setDescription('[GM] Archive the current game and reset everything for a new season')
      .addStringOption((o) =>
        o.setName('label').setDescription('Label for the archive file (e.g. "season1")').setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('start-year')
          .setDescription('Starting year for the new season (default: 2200)')
          .setRequired(false)
          .setMinValue(1),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isGM(interaction.member as GuildMember)) {
    await interaction.reply({ content: 'Only the **Owner/GM** can use `/gm2` commands.', flags: 64 });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'tributes') {
    const tributes = getTributes();

    if (tributes.length === 0) {
      await interaction.reply({ content: 'No active tribute agreements.', flags: 64 });
      return;
    }

    const lines = tributes.map((t) => {
      const payer = getNationById(t.payer_nation_id);
      const receiver = getNationById(t.receiver_nation_id);
      const meta = RESOURCE_META[t.resource_type as keyof typeof RESOURCE_META];
      const labelStr = t.label ? ` *"${t.label}"*` : '';
      return `**#${t.id}**${labelStr}: **${payer?.name ?? 'Unknown'}** → **${receiver?.name ?? 'Unknown'}** | ${meta?.emoji ?? ''} ${t.amount_per_tick.toLocaleString()} ${meta?.label ?? t.resource_type}/tick`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Tribute Agreements')
      .setDescription(lines.join('\n'))
      .setColor(0xf0a500)
      .setFooter({ text: 'Starlight NRP • GM Eyes Only' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  if (sub === 'add-tribute') {
    const payerUser = interaction.options.getUser('payer', true);
    const receiverUser = interaction.options.getUser('receiver', true);
    const resourceType = interaction.options.getString('type', true);
    const amount = interaction.options.getNumber('amount', true);
    const label = interaction.options.getString('label');

    if (payerUser.id === receiverUser.id) {
      await interaction.reply({ content: 'Payer and receiver cannot be the same nation.', flags: 64 });
      return;
    }

    const payerNation = getNationByUserId(payerUser.id);
    const receiverNation = getNationByUserId(receiverUser.id);

    if (!payerNation) {
      await interaction.reply({ content: `<@${payerUser.id}> has no registered nation.`, flags: 64 });
      return;
    }
    if (!receiverNation) {
      await interaction.reply({ content: `<@${receiverUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    const tributeId = createTribute(payerNation.id, receiverNation.id, resourceType, amount, label ?? null);
    const meta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];

    logAuditEvent('tribute_added', interaction.user.id, {
      tribute_id: tributeId,
      payer: payerNation.name,
      receiver: receiverNation.name,
      resource: resourceType,
      amount_per_tick: amount,
    });

    await interaction.reply({
      content: `💸 Tribute agreement created (ID: ${tributeId}): **${payerNation.name}** → **${receiverNation.name}** | **${amount.toLocaleString()} ${meta.label}** per tick${label ? ` ("${label}")` : ''}.`,
    });
    return;
  }

  if (sub === 'remove-tribute') {
    const tributeId = interaction.options.getInteger('id', true);
    const tributes = getTributes();
    const tribute = tributes.find((t) => t.id === tributeId);

    if (!tribute) {
      await interaction.reply({ content: `No tribute agreement found with ID **${tributeId}**.`, flags: 64 });
      return;
    }

    removeTribute(tributeId);

    const payerNation = getNationById(tribute.payer_nation_id);
    const receiverNation = getNationById(tribute.receiver_nation_id);
    const meta = RESOURCE_META[tribute.resource_type as keyof typeof RESOURCE_META];

    logAuditEvent('tribute_removed', interaction.user.id, { tribute_id: tributeId });

    await interaction.reply({
      content: `Tribute agreement (ID: ${tributeId}) between **${payerNation?.name ?? 'Unknown'}** → **${receiverNation?.name ?? 'Unknown'}** for **${tribute.amount_per_tick} ${meta?.label ?? tribute.resource_type}/tick** has been removed.`,
    });
    return;
  }

  if (sub === 'sanctions-list') {
    const sanctions = getAllSanctions();

    if (sanctions.length === 0) {
      await interaction.reply({ content: 'No active sanctions.', flags: 64 });
      return;
    }

    const lines = sanctions.map((s) => {
      const nation = getNationById(s.target_nation_id);
      const reasonStr = s.reason ? ` — *${s.reason}*` : '';
      return `**#${s.id}** **${nation?.name ?? 'Unknown'}**${reasonStr} *(${s.created_at.split('T')[0]})*`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Active Sanctions')
      .setDescription(lines.join('\n'))
      .setColor(0xe74c3c)
      .setFooter({ text: 'Starlight NRP • GM Eyes Only' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  if (sub === 'add-sanction') {
    const targetUser = interaction.options.getUser('player', true);
    const reason = interaction.options.getString('reason');
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    const sanctionId = addSanction(nation.id, null, reason ?? null);

    logAuditEvent('sanction_added', interaction.user.id, { sanction_id: sanctionId, reason }, nation.id);

    await interaction.reply({
      content: `🚫 **${nation.name}** has been sanctioned (ID: ${sanctionId})${reason ? ` — *${reason}*` : ''}. They cannot receive transfers or trades while sanctioned.`,
    });
    return;
  }

  if (sub === 'remove-sanction') {
    const sanctionId = interaction.options.getInteger('id', true);
    const allSanctions = getAllSanctions();
    const sanction = allSanctions.find((s) => s.id === sanctionId);

    if (!sanction) {
      await interaction.reply({ content: `No sanction found with ID **${sanctionId}**.`, flags: 64 });
      return;
    }

    removeSanction(sanctionId);

    const nation = getNationById(sanction.target_nation_id);
    logAuditEvent('sanction_removed', interaction.user.id, { sanction_id: sanctionId }, sanction.target_nation_id ?? undefined);

    await interaction.reply({
      content: `Sanction (ID: ${sanctionId}) lifted from **${nation?.name ?? 'Unknown'}**.`,
    });
    return;
  }

  if (sub === 'export-state') {
    const label = interaction.options.getString('label', true).trim();
    await interaction.deferReply({ flags: 64 });

    const filePath = archiveSeason(label);
    const fileName = filePath.split(path.sep).pop() ?? filePath;

    logAuditEvent('season_reset', interaction.user.id, { action: 'export', label, file: fileName });

    await interaction.editReply({
      content: `[SUCCESS] Game state exported to **\`${fileName}\`** in the \`data/\` directory.`,
    });
    return;
  }

  if (sub === 'new-season') {
    const label = interaction.options.getString('label', true).trim();
    const startYear = interaction.options.getInteger('start-year') ?? 2200;

    await interaction.deferReply();

    const filePath = archiveSeason(label);
    const fileName = filePath.split(path.sep).pop() ?? filePath;

    resetForNewSeason(startYear);

    await interaction.editReply({
      content:
        `**New Season Started!**\n\n` +
        `Previous game archived to **\`${fileName}\`**.\n` +
        `All nations, resources, alliances, tributes, sanctions, and modifiers have been reset.\n` +
        `Starting year: **${startYear}**.\n\n` +
        `Use \`/nation register\` to begin registering nations for the new season.`,
    });
  }
}
