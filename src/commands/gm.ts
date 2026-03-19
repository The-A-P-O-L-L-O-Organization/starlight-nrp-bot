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
  getAllNations,
  deleteNation,
  renameNation,
  resetStockpiles,
  setYear,
  transferResource,
  getCurrentYear,
  getResources,
  applyDefaultsToAllNations,
  bulkAdjustResource,
  setNationStatus,
  removeNationStatus,
  addProductionModifier,
  getProductionModifiers,
  removeProductionModifier,
  setStockpileCap,
  removeStockpileCap,
  getStockpileCaps,
  createTribute,
  getTributes,
  removeTribute,
  addSanction,
  getSanctionsAgainst,
  getAllSanctions,
  removeSanction,
  getAuditLog,
  logAuditEvent,
  archiveSeason,
  resetForNewSeason,
  buildGameSnapshot,
  getBlockadeInfo,
} from '../db/schema';
import { buildResourceEmbed } from '../utils/embeds';
import { runTick } from '../utils/scheduler';
import { RESOURCE_TYPES, RESOURCE_META, STATUS_FLAGS, STATUS_META } from '../types';
import path from 'path';

export const data = new SlashCommandBuilder()
  .setName('gm')
  .setDescription('[GM] Game Master commands')

  // ── view-nation ─────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('view-nation')
      .setDescription('[GM] View full resource sheet of any nation')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player whose nation to view').setRequired(true),
      ),
  )

  // ── overview ────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('overview')
      .setDescription('[GM] See a production summary of every nation'),
  )

  // ── delete-nation ───────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('delete-nation')
      .setDescription('[GM] Permanently delete a nation and all its data')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player whose nation to delete').setRequired(true),
      ),
  )

  // ── rename-nation ───────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('rename-nation')
      .setDescription('[GM] Rename a nation')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player whose nation to rename').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('name').setDescription('New nation name').setRequired(true),
      ),
  )

  // ── reset-stockpiles ────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('reset-stockpiles')
      .setDescription('[GM] Zero out all stockpiles for a nation (keeps production rates)')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player whose stockpiles to reset').setRequired(true),
      ),
  )

  // ── set-year ────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('set-year')
      .setDescription('[GM] Manually set the current in-game year')
      .addIntegerOption((o) =>
        o.setName('year').setDescription('The year to set (e.g. 2300)').setRequired(true).setMinValue(1),
      ),
  )

  // ── force-tick ──────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('force-tick')
      .setDescription('[GM] Immediately trigger a production tick (+25 years) for all nations'),
  )

  // ── backfill-defaults ────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('backfill-defaults')
      .setDescription('[GM] Apply default starting production & stockpile to nations that still have zero values'),
  )

  // ── transfer ────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('transfer')
      .setDescription('[GM] Transfer a resource stockpile between two nations')
      .addUserOption((o) =>
        o.setName('from').setDescription('Nation sending the resources').setRequired(true),
      )
      .addUserOption((o) =>
        o.setName('to').setDescription('Nation receiving the resources').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Resource type to transfer')
          .setRequired(true)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      )
      .addNumberOption((o) =>
        o.setName('amount').setDescription('Amount to transfer').setRequired(true).setMinValue(1),
      )
      .addBooleanOption((o) =>
        o.setName('force').setDescription('Bypass blockade restrictions').setRequired(false),
      ),
  )

  // ── bulk-adjust ──────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('bulk-adjust')
      .setDescription('[GM] Add or subtract a resource stockpile across ALL nations at once')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Resource type to adjust')
          .setRequired(true)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      )
      .addNumberOption((o) =>
        o.setName('amount').setDescription('Amount to add (negative to subtract)').setRequired(true),
      ),
  )

  // ── set-status ───────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('set-status')
      .setDescription('[GM] Apply a status flag to a nation')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player whose nation to update').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Status flag to apply')
          .setRequired(true)
          .addChoices(...STATUS_FLAGS.map((s) => ({ name: STATUS_META[s].label, value: s }))),
      )
      .addStringOption((o) =>
        o.setName('label').setDescription('Custom display label (defaults to status name)').setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('direction')
          .setDescription('Blockade direction (only for blockaded status)')
          .setRequired(false)
          .addChoices(
            { name: 'Both (blocks sending & receiving)', value: 'both' },
            { name: 'Incoming (blocks receiving)', value: 'incoming' },
            { name: 'Outgoing (blocks sending)', value: 'outgoing' },
          ),
      ),
  )

  // ── remove-status ────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('remove-status')
      .setDescription('[GM] Remove a status flag from a nation')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player whose nation to update').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Status flag to remove')
          .setRequired(true)
          .addChoices(...STATUS_FLAGS.map((s) => ({ name: STATUS_META[s].label, value: s }))),
      ),
  )

  // ── set-modifier ─────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('set-modifier')
      .setDescription('[GM] Add a production multiplier to a nation (tick-expiring)')
      .addUserOption((o) =>
        o.setName('player').setDescription('Target nation').setRequired(true),
      )
      .addNumberOption((o) =>
        o
          .setName('multiplier')
          .setDescription('Multiplier value (e.g. 1.2 = +20%, 0.8 = -20%)')
          .setRequired(true)
          .setMinValue(0),
      )
      .addStringOption((o) =>
        o.setName('label').setDescription('Label for this modifier (e.g. "War Effort")').setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('ticks')
          .setDescription('How many ticks this lasts')
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((o) =>
        o
          .setName('resource')
          .setDescription('Specific resource to affect (omit for all non-research resources)')
          .setRequired(false)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      ),
  )

  // ── remove-modifier ──────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('remove-modifier')
      .setDescription('[GM] Remove a production modifier by its ID')
      .addUserOption((o) =>
        o.setName('player').setDescription('The nation to inspect modifiers on').setRequired(true),
      )
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Modifier ID (from /gm view-nation)').setRequired(true).setMinValue(1),
      ),
  )

  // ── set-cap ──────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('set-cap')
      .setDescription('[GM] Set a stockpile cap for a nation\'s resource')
      .addUserOption((o) =>
        o.setName('player').setDescription('Target nation').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Resource type')
          .setRequired(true)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      )
      .addNumberOption((o) =>
        o.setName('cap').setDescription('Maximum stockpile value').setRequired(true).setMinValue(0),
      ),
  )

  // ── remove-cap ───────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('remove-cap')
      .setDescription('[GM] Remove a stockpile cap from a nation\'s resource')
      .addUserOption((o) =>
        o.setName('player').setDescription('Target nation').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Resource type')
          .setRequired(true)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      ),
  )

  // ── add-tribute ──────────────────────────────────────────────────────────────
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

  // ── remove-tribute ───────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('remove-tribute')
      .setDescription('[GM] Remove a tribute agreement by ID')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Tribute agreement ID').setRequired(true).setMinValue(1),
      ),
  )

  // ── add-sanction ─────────────────────────────────────────────────────────────
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

  // ── remove-sanction ──────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('remove-sanction')
      .setDescription('[GM] Lift a sanction by ID')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Sanction ID').setRequired(true).setMinValue(1),
      ),
  )

  // ── audit ────────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('audit')
      .setDescription('[GM] View the audit log (optionally filtered to one nation)')
      .addUserOption((o) =>
        o.setName('player').setDescription('Filter to this player\'s nation (optional)').setRequired(false),
      ),
  )

  // ── tributes ─────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('tributes')
      .setDescription('[GM] List all active tribute agreements'),
  )

  // ── sanctions-list ───────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('sanctions-list')
      .setDescription('[GM] List all active sanctions'),
  )

  // ── export-state ─────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('export-state')
      .setDescription('[GM] Export the current game state to a JSON file')
      .addStringOption((o) =>
        o.setName('label').setDescription('Label for the snapshot file (e.g. "midgame")').setRequired(true),
      ),
  )

  // ── new-season ───────────────────────────────────────────────────────────────
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
          .setDescription('Starting year for the new season (default: 2300)')
          .setRequired(false)
          .setMinValue(1),
      ),
  );

// ── Handler ──────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isGM(interaction.member as GuildMember)) {
    await interaction.reply({ content: 'Only the **Owner/GM** can use `/gm` commands.', flags: 64 });
    return;
  }

  const sub = interaction.options.getSubcommand();

  // ── view-nation ─────────────────────────────────────────────────────────────
  if (sub === 'view-nation') {
    const targetUser = interaction.options.getUser('player', true);
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    const embed = buildResourceEmbed(nation, nation.id);
    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  // ── overview ────────────────────────────────────────────────────────────────
  if (sub === 'overview') {
    const nations = getAllNations();

    if (nations.length === 0) {
      await interaction.reply({ content: 'No nations registered yet.', flags: 64 });
      return;
    }

    const year = getCurrentYear();

    const fields = nations.map((n) => {
      const rows = getResources(n.id);
      const byType = Object.fromEntries(rows.map((r) => [r.resource_type, r]));

      const lines = RESOURCE_TYPES.map((t) => {
        const meta = RESOURCE_META[t];
        const prod = byType[t]?.production ?? 0;
        const stock = Math.floor(byType[t]?.stockpile ?? 0).toLocaleString();
        const prodStr = prod >= 0 ? `+${prod}` : `${prod}`;
        return `${meta.emoji} ${meta.label}: **${stock}** *(${prodStr}/Month)*`;
      });

      return {
        name: `${n.name} — <@${n.discord_user_id}>`,
        value: lines.join('\n'),
        inline: false,
      };
    });

    const embed = new EmbedBuilder()
      .setTitle(`GM Overview — Year ${year}`)
      .setDescription('Production summary for all star-nations')
      .setColor(0x5865f2)
      .addFields(fields)
      .setFooter({ text: 'Starlight NRP • GM Eyes Only' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  // ── delete-nation ───────────────────────────────────────────────────────────
  if (sub === 'delete-nation') {
    const targetUser = interaction.options.getUser('player', true);
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    deleteNation(nation.id);
    logAuditEvent('season_reset', interaction.user.id, { deleted_nation: nation.name }, nation.id);
    await interaction.reply({
      content: `Nation **${nation.name}** (<@${targetUser.id}>) has been permanently deleted.`,
    });
    return;
  }

  // ── rename-nation ───────────────────────────────────────────────────────────
  if (sub === 'rename-nation') {
    const targetUser = interaction.options.getUser('player', true);
    const newName = interaction.options.getString('name', true).trim();
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    try {
      renameNation(nation.id, newName);
      await interaction.reply({
        content: `Nation **${nation.name}** has been renamed to **${newName}**.`,
      });
    } catch {
      await interaction.reply({ content: `A nation named **${newName}** already exists.`, flags: 64 });
    }
    return;
  }

  // ── reset-stockpiles ────────────────────────────────────────────────────────
  if (sub === 'reset-stockpiles') {
    const targetUser = interaction.options.getUser('player', true);
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    resetStockpiles(nation.id);
    logAuditEvent('resource_set', interaction.user.id, { action: 'reset_all_stockpiles' }, nation.id);
    await interaction.reply({
      content: `All stockpiles for **${nation.name}** have been reset to **0**. Production rates are unchanged.`,
    });
    return;
  }

  // ── set-year ────────────────────────────────────────────────────────────────
  if (sub === 'set-year') {
    const year = interaction.options.getInteger('year', true);
    setYear(year);
    await interaction.reply({
      content: `In-game year set to **${year}**.`,
    });
    return;
  }

  // ── force-tick ──────────────────────────────────────────────────────────────
  if (sub === 'force-tick') {
    await interaction.deferReply();
    const ran = await runTick(interaction.client);
    if (!ran) {
      await interaction.editReply({ content: 'A tick is already in progress. Please wait and try again.' });
      return;
    }
    await interaction.editReply({
      content: `Production tick triggered manually. Year is now **${getCurrentYear()}**. Check <#${process.env.TIMELINE_CHANNEL_ID ?? 'timeline-events'}> for the announcement.`,
    });
    return;
  }

  // ── backfill-defaults ────────────────────────────────────────────────────────
  if (sub === 'backfill-defaults') {
    const patched = applyDefaultsToAllNations();
    if (patched === 0) {
      await interaction.reply({
        content: 'All nations already have production values set — nothing to backfill.',
        flags: 64,
      });
    } else {
      await interaction.reply({
        content: `Applied default production & stockpile values to **${patched}** nation${patched === 1 ? '' : 's'}.`,
      });
    }
    return;
  }

  // ── transfer ────────────────────────────────────────────────────────────────
  if (sub === 'transfer') {
    const fromUser = interaction.options.getUser('from', true);
    const toUser = interaction.options.getUser('to', true);
    const resourceType = interaction.options.getString('type', true);
    const amount = interaction.options.getNumber('amount', true);
    const force = interaction.options.getBoolean('force') ?? false;

    if (fromUser.id === toUser.id) {
      await interaction.reply({ content: 'Cannot transfer resources to the same nation.', flags: 64 });
      return;
    }

    const fromNation = getNationByUserId(fromUser.id);
    const toNation = getNationByUserId(toUser.id);

    if (!fromNation) {
      await interaction.reply({ content: `<@${fromUser.id}> has no registered nation.`, flags: 64 });
      return;
    }
    if (!toNation) {
      await interaction.reply({ content: `<@${toUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    // Check blockade restrictions unless --force is used
    if (!force) {
      const toBlockade = getBlockadeInfo(toNation.id);
      if (toBlockade && (toBlockade.direction === 'incoming' || toBlockade.direction === 'both')) {
        await interaction.reply({
          content: `**${toNation.name}** is blockaded and cannot receive transfers. Use \`force: True\` to override.`,
          flags: 64,
        });
        return;
      }

      const fromBlockade = getBlockadeInfo(fromNation.id);
      if (fromBlockade && (fromBlockade.direction === 'outgoing' || fromBlockade.direction === 'both')) {
        await interaction.reply({
          content: `**${fromNation.name}** is blockaded and cannot send transfers. Use \`force: True\` to override.`,
          flags: 64,
        });
        return;
      }
    }

    const fromResources = getResources(fromNation.id);
    const fromRow = fromResources.find((r) => r.resource_type === resourceType);
    if (!fromRow || fromRow.stockpile < amount) {
      const current = fromRow ? Math.floor(fromRow.stockpile).toLocaleString() : '0';
      await interaction.reply({
        content: `**${fromNation.name}** only has **${current}** ${RESOURCE_META[resourceType as keyof typeof RESOURCE_META].label} — cannot transfer **${amount.toLocaleString()}**.`,
        flags: 64,
      });
      return;
    }

    transferResource(fromNation.id, toNation.id, resourceType, amount);

    logAuditEvent('gm_transfer', interaction.user.id, {
      from: fromNation.name,
      to: toNation.name,
      resource: resourceType,
      amount,
      forced: force,
    }, fromNation.id);

    const meta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];
    const forceText = force ? ' **(forced)**' : '';
    await interaction.reply({
      content: `${meta.emoji} Transferred **${amount.toLocaleString()} ${meta.label}** from **${fromNation.name}** to **${toNation.name}**${forceText}.`,
    });
    return;
  }

  // ── bulk-adjust ──────────────────────────────────────────────────────────────
  if (sub === 'bulk-adjust') {
    const resourceType = interaction.options.getString('type', true);
    const amount = interaction.options.getNumber('amount', true);

    const changed = bulkAdjustResource(resourceType, amount);
    const meta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];
    const sign = amount >= 0 ? '+' : '';

    logAuditEvent('resource_add', interaction.user.id, {
      action: 'bulk_adjust',
      resource: resourceType,
      delta: amount,
      nations_affected: changed,
    });

    await interaction.reply({
      content: `${meta.emoji} Adjusted **${meta.label}** stockpile by **${sign}${amount.toLocaleString()}** across **${changed}** nation${changed === 1 ? '' : 's'}.`,
    });
    return;
  }

  // ── set-status ───────────────────────────────────────────────────────────────
  if (sub === 'set-status') {
    const targetUser = interaction.options.getUser('player', true);
    const status = interaction.options.getString('status', true) as import('../types').StatusFlag;
    const customLabel = interaction.options.getString('label');
    const direction = interaction.options.getString('direction') as 'incoming' | 'outgoing' | 'both' | null;
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    const label = customLabel?.trim() || STATUS_META[status].label;
    
    // Build metadata for blockade
    let metadata: Record<string, any> | undefined;
    if (status === 'blockaded' && direction) {
      metadata = { direction };
    } else if (status === 'blockaded') {
      // Default to 'both' if blockaded but no direction specified
      metadata = { direction: 'both' };
    }
    
    setNationStatus(nation.id, status, label, metadata);

    logAuditEvent('status_set', interaction.user.id, { status, label, metadata }, nation.id);

    const meta = STATUS_META[status];
    
    // Build response message
    let responseMsg = `${meta.emoji} **${nation.name}** status set to **${label}**`;
    
    if (status === 'blockaded') {
      const actualDirection = direction || 'both';
      const severity = -10; // Initial severity
      const directionText = actualDirection === 'both' ? 'blocks sending & receiving trades' :
                           actualDirection === 'incoming' ? 'blocks receiving trades' :
                           'blocks sending trades';
      responseMsg += ` (${directionText}, ${severity}% production, escalates over time)`;
    } else {
      const modStr = meta.productionModifier !== 0
        ? ` (${meta.productionModifier > 0 ? '+' : ''}${Math.round(meta.productionModifier * 100)}% production)`
        : '';
      responseMsg += modStr;
    }

    await interaction.reply({
      content: responseMsg + '.',
    });
    return;
  }

  // ── remove-status ────────────────────────────────────────────────────────────
  if (sub === 'remove-status') {
    const targetUser = interaction.options.getUser('player', true);
    const status = interaction.options.getString('status', true) as import('../types').StatusFlag;
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    const removed = removeNationStatus(nation.id, status);
    if (!removed) {
      await interaction.reply({ content: `**${nation.name}** does not have the **${STATUS_META[status].label}** status.`, flags: 64 });
      return;
    }

    logAuditEvent('status_removed', interaction.user.id, { status }, nation.id);

    await interaction.reply({
      content: `${STATUS_META[status].emoji} Removed **${STATUS_META[status].label}** status from **${nation.name}**.`,
    });
    return;
  }

  // ── set-modifier ─────────────────────────────────────────────────────────────
  if (sub === 'set-modifier') {
    const targetUser = interaction.options.getUser('player', true);
    const multiplier = interaction.options.getNumber('multiplier', true);
    const label = interaction.options.getString('label', true).trim();
    const ticks = interaction.options.getInteger('ticks', true);
    const resourceType = interaction.options.getString('resource') ?? undefined;
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    const modId = addProductionModifier(nation.id, multiplier, label, ticks, resourceType);
    const pct = Math.round((multiplier - 1) * 100);
    const sign = pct >= 0 ? '+' : '';
    const scope = resourceType
      ? RESOURCE_META[resourceType as keyof typeof RESOURCE_META]?.label ?? resourceType
      : 'All Resources';

    logAuditEvent('modifier_set', interaction.user.id, { modifier_id: modId, label, multiplier, ticks, resource: resourceType ?? 'all' }, nation.id);

    await interaction.reply({
      content: `⚙️ Added modifier **"${label}"** to **${nation.name}**: **${sign}${pct}%** ${scope} for **${ticks}** tick${ticks === 1 ? '' : 's'} (ID: ${modId}).`,
    });
    return;
  }

  // ── remove-modifier ──────────────────────────────────────────────────────────
  if (sub === 'remove-modifier') {
    const targetUser = interaction.options.getUser('player', true);
    const modId = interaction.options.getInteger('id', true);
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    const mods = getProductionModifiers(nation.id);
    const mod = mods.find((m) => m.id === modId);
    if (!mod) {
      await interaction.reply({ content: `No active modifier with ID **${modId}** found on **${nation.name}**.`, flags: 64 });
      return;
    }

    removeProductionModifier(modId);
    await interaction.reply({
      content: `⚙️ Removed modifier **"${mod.label}"** (ID: ${modId}) from **${nation.name}**.`,
    });
    return;
  }

  // ── set-cap ──────────────────────────────────────────────────────────────────
  if (sub === 'set-cap') {
    const targetUser = interaction.options.getUser('player', true);
    const resourceType = interaction.options.getString('type', true);
    const cap = interaction.options.getNumber('cap', true);
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    setStockpileCap(nation.id, resourceType, cap);
    const meta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];

    logAuditEvent('cap_set', interaction.user.id, { resource: resourceType, cap }, nation.id);

    await interaction.reply({
      content: `${meta.emoji} Stockpile cap for **${meta.label}** on **${nation.name}** set to **${cap.toLocaleString()}**.`,
    });
    return;
  }

  // ── remove-cap ───────────────────────────────────────────────────────────────
  if (sub === 'remove-cap') {
    const targetUser = interaction.options.getUser('player', true);
    const resourceType = interaction.options.getString('type', true);
    const nation = getNationByUserId(targetUser.id);

    if (!nation) {
      await interaction.reply({ content: `<@${targetUser.id}> has no registered nation.`, flags: 64 });
      return;
    }

    const removed = removeStockpileCap(nation.id, resourceType);
    const meta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];

    if (!removed) {
      await interaction.reply({ content: `No cap was set for **${meta.label}** on **${nation.name}**.`, flags: 64 });
      return;
    }

    await interaction.reply({
      content: `${meta.emoji} Stockpile cap for **${meta.label}** removed from **${nation.name}**.`,
    });
    return;
  }

  // ── add-tribute ──────────────────────────────────────────────────────────────
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

  // ── remove-tribute ───────────────────────────────────────────────────────────
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

  // ── add-sanction ─────────────────────────────────────────────────────────────
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

  // ── remove-sanction ──────────────────────────────────────────────────────────
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

  // ── tributes ─────────────────────────────────────────────────────────────────
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

  // ── sanctions-list ───────────────────────────────────────────────────────────
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

  // ── audit ────────────────────────────────────────────────────────────────────
  if (sub === 'audit') {
    const filterUser = interaction.options.getUser('player');
    let nationId: number | undefined;
    let nationName = 'All Nations';

    if (filterUser) {
      const nation = getNationByUserId(filterUser.id);
      if (!nation) {
        await interaction.reply({ content: `<@${filterUser.id}> has no registered nation.`, flags: 64 });
        return;
      }
      nationId = nation.id;
      nationName = nation.name;
    }

    const entries = getAuditLog(nationId, 25);

    if (entries.length === 0) {
      await interaction.reply({ content: `No audit entries found${nationId ? ` for **${nationName}**` : ''}.`, flags: 64 });
      return;
    }

    const lines = entries.map((e) => {
      let details: Record<string, unknown> = {};
      try { details = JSON.parse(e.details); } catch { /* ignore */ }

      const actorStr = e.actor === 'system' ? '`system`' : `<@${e.actor}>`;
      const detailStr = Object.entries(details)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      const timestamp = e.created_at.split('.')[0].replace('T', ' ');
      return `\`${timestamp}\` **${e.action}** by ${actorStr}${detailStr ? ` — ${detailStr}` : ''}`;
    });

    // Chunk into 4096-char pages if needed
    const description = lines.join('\n').slice(0, 4000);

    const embed = new EmbedBuilder()
      .setTitle(`Audit Log — ${nationName}`)
      .setDescription(description)
      .setColor(0x7289da)
      .setFooter({ text: 'Starlight NRP • Last 25 entries' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  // ── export-state ─────────────────────────────────────────────────────────────
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

  // ── new-season ───────────────────────────────────────────────────────────────
  if (sub === 'new-season') {
    const label = interaction.options.getString('label', true).trim();
    const startYear = interaction.options.getInteger('start-year') ?? 2300;

    await interaction.deferReply();

    // Archive first
    const filePath = archiveSeason(label);
    const fileName = filePath.split(path.sep).pop() ?? filePath;

    // Then wipe
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
