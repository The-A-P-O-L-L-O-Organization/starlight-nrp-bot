import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import {
  getNationByUserId,
  getNationById,
  createTradeProposal,
  getTradeProposal,
  getPendingTradesForNation,
  setTradeStatus,
  executeTrade,
  expireOldTrades,
  isSanctioned,
  areAllied,
  logAuditEvent,
  getResources,
} from '../db/schema';
import { RESOURCE_TYPES, RESOURCE_META } from '../types';

export const data = new SlashCommandBuilder()
  .setName('trade')
  .setDescription('Propose and manage resource trades with other nations')

  // ── propose ──────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('propose')
      .setDescription('Propose a trade with another nation')
      .addUserOption((o) =>
        o.setName('nation').setDescription('The nation to trade with').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('offer-type')
          .setDescription('Resource you are offering')
          .setRequired(true)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      )
      .addNumberOption((o) =>
        o.setName('offer-amount').setDescription('Amount you are offering').setRequired(true).setMinValue(1),
      )
      .addStringOption((o) =>
        o
          .setName('request-type')
          .setDescription('Resource you are requesting in return')
          .setRequired(true)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      )
      .addNumberOption((o) =>
        o.setName('request-amount').setDescription('Amount you are requesting').setRequired(true).setMinValue(1),
      ),
  )

  // ── accept ───────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('accept')
      .setDescription('Accept an incoming trade proposal')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Trade proposal ID').setRequired(true).setMinValue(1),
      ),
  )

  // ── reject ───────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('reject')
      .setDescription('Reject an incoming trade proposal')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Trade proposal ID').setRequired(true).setMinValue(1),
      ),
  )

  // ── cancel ───────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel one of your own pending trade proposals')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Trade proposal ID').setRequired(true).setMinValue(1),
      ),
  )

  // ── list ─────────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('View all pending trades involving your nation'),
  );

// ── Handler ──────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  // Expire stale trades on every interaction
  expireOldTrades();

  const myNation = getNationByUserId(interaction.user.id);
  if (!myNation) {
    await interaction.reply({
      content: 'You do not have a registered nation. Ask the GM to register one for you.',
      ephemeral: true,
    });
    return;
  }

  // ── propose ──────────────────────────────────────────────────────────────────
  if (sub === 'propose') {
    const targetUser = interaction.options.getUser('nation', true);
    const offerType = interaction.options.getString('offer-type', true);
    const offerAmount = interaction.options.getNumber('offer-amount', true);
    const requestType = interaction.options.getString('request-type', true);
    const requestAmount = interaction.options.getNumber('request-amount', true);

    if (targetUser.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot trade with yourself.', ephemeral: true });
      return;
    }

    const targetNation = getNationByUserId(targetUser.id);
    if (!targetNation) {
      await interaction.reply({ content: `<@${targetUser.id}> does not have a registered nation.`, ephemeral: true });
      return;
    }

    // Check target is not sanctioned
    if (isSanctioned(targetNation.id)) {
      await interaction.reply({
        content: `**${targetNation.name}** is currently under sanctions and cannot receive trades.`,
        ephemeral: true,
      });
      return;
    }

    // Check proposer has enough to offer
    const myResources = getResources(myNation.id);
    const myOfferRow = myResources.find((r) => r.resource_type === offerType);
    if (!myOfferRow || myOfferRow.stockpile < offerAmount) {
      const current = myOfferRow ? Math.floor(myOfferRow.stockpile).toLocaleString() : '0';
      const offerMeta = RESOURCE_META[offerType as keyof typeof RESOURCE_META];
      await interaction.reply({
        content: `You only have **${current} ${offerMeta.label}** — cannot offer **${offerAmount.toLocaleString()}**.`,
        ephemeral: true,
      });
      return;
    }

    const allied = areAllied(myNation.id, targetNation.id);
    const discount = allied ? 0.10 : 0.0;
    const effectiveOffer = Math.floor(offerAmount * (1 - discount));

    const tradeId = createTradeProposal(
      myNation.id,
      targetNation.id,
      offerType,
      offerAmount,
      requestType,
      requestAmount,
    );

    const offerMeta = RESOURCE_META[offerType as keyof typeof RESOURCE_META];
    const requestMeta = RESOURCE_META[requestType as keyof typeof RESOURCE_META];

    const discountNote = allied
      ? `\n> *Alliance discount: you receive ${effectiveOffer.toLocaleString()} effective ${offerMeta.label} (10% less due to alliance terms — recipient gets full amount).*`
      : '';

    await interaction.reply({
      content:
        `📦 Trade proposal **#${tradeId}** sent to **${targetNation.name}** (<@${targetUser.id}>)!\n\n` +
        `You offer: **${offerAmount.toLocaleString()} ${offerMeta.emoji} ${offerMeta.label}**\n` +
        `You request: **${requestAmount.toLocaleString()} ${requestMeta.emoji} ${requestMeta.label}**\n` +
        `Expires in **24 hours**. They can use \`/trade accept ${tradeId}\` or \`/trade reject ${tradeId}\`.` +
        discountNote,
    });
    return;
  }

  // ── accept ───────────────────────────────────────────────────────────────────
  if (sub === 'accept') {
    const tradeId = interaction.options.getInteger('id', true);
    const trade = getTradeProposal(tradeId);

    if (!trade || trade.status !== 'pending') {
      await interaction.reply({ content: `Trade proposal **#${tradeId}** is not pending or does not exist.`, ephemeral: true });
      return;
    }

    if (trade.target_nation_id !== myNation.id) {
      await interaction.reply({ content: `Trade **#${tradeId}** was not sent to your nation.`, ephemeral: true });
      return;
    }

    const success = executeTrade(tradeId);
    if (!success) {
      await interaction.reply({
        content: `Trade **#${tradeId}** could not be completed — one or both nations no longer have sufficient resources.`,
        ephemeral: true,
      });
      return;
    }

    const proposerNation = getNationById(trade.proposer_nation_id);
    const offerMeta = RESOURCE_META[trade.offer_type as keyof typeof RESOURCE_META];
    const requestMeta = RESOURCE_META[trade.request_type as keyof typeof RESOURCE_META];

    logAuditEvent('player_trade', interaction.user.id, {
      trade_id: tradeId,
      proposer: proposerNation?.name,
      target: myNation.name,
      offer: `${trade.offer_amount} ${trade.offer_type}`,
      request: `${trade.request_amount} ${trade.request_type}`,
    }, myNation.id);

    await interaction.reply({
      content:
        `✅ Trade **#${tradeId}** completed!\n\n` +
        `**${proposerNation?.name ?? 'Unknown'}** gave: **${trade.offer_amount.toLocaleString()} ${offerMeta.emoji} ${offerMeta.label}**\n` +
        `**${myNation.name}** gave: **${trade.request_amount.toLocaleString()} ${requestMeta.emoji} ${requestMeta.label}**`,
    });
    return;
  }

  // ── reject ───────────────────────────────────────────────────────────────────
  if (sub === 'reject') {
    const tradeId = interaction.options.getInteger('id', true);
    const trade = getTradeProposal(tradeId);

    if (!trade || trade.status !== 'pending') {
      await interaction.reply({ content: `Trade proposal **#${tradeId}** is not pending or does not exist.`, ephemeral: true });
      return;
    }

    if (trade.target_nation_id !== myNation.id) {
      await interaction.reply({ content: `Trade **#${tradeId}** was not sent to your nation.`, ephemeral: true });
      return;
    }

    setTradeStatus(tradeId, 'rejected');

    const proposerNation = getNationById(trade.proposer_nation_id);
    await interaction.reply({
      content: `❌ Trade proposal **#${tradeId}** from **${proposerNation?.name ?? 'Unknown'}** has been rejected.`,
    });
    return;
  }

  // ── cancel ───────────────────────────────────────────────────────────────────
  if (sub === 'cancel') {
    const tradeId = interaction.options.getInteger('id', true);
    const trade = getTradeProposal(tradeId);

    if (!trade || trade.status !== 'pending') {
      await interaction.reply({ content: `Trade proposal **#${tradeId}** is not pending or does not exist.`, ephemeral: true });
      return;
    }

    if (trade.proposer_nation_id !== myNation.id) {
      await interaction.reply({ content: `Trade **#${tradeId}** is not your proposal.`, ephemeral: true });
      return;
    }

    setTradeStatus(tradeId, 'cancelled');

    await interaction.reply({
      content: `Trade proposal **#${tradeId}** has been cancelled.`,
      ephemeral: true,
    });
    return;
  }

  // ── list ─────────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const trades = getPendingTradesForNation(myNation.id);

    if (trades.length === 0) {
      await interaction.reply({ content: 'No pending trades involving your nation.', ephemeral: true });
      return;
    }

    const lines = trades.map((t) => {
      const proposer = getNationById(t.proposer_nation_id);
      const target = getNationById(t.target_nation_id);
      const offerMeta = RESOURCE_META[t.offer_type as keyof typeof RESOURCE_META];
      const requestMeta = RESOURCE_META[t.request_type as keyof typeof RESOURCE_META];
      const direction = t.proposer_nation_id === myNation.id ? '→ outgoing' : '← incoming';
      const expiresAt = t.expires_at.split('T')[0];

      return (
        `**#${t.id}** *(${direction})* — **${proposer?.name ?? '?'}** ↔ **${target?.name ?? '?'}**\n` +
        `  Offer: ${offerMeta.emoji} ${t.offer_amount.toLocaleString()} ${offerMeta.label} | ` +
        `Request: ${requestMeta.emoji} ${t.request_amount.toLocaleString()} ${requestMeta.label} | ` +
        `Expires: ${expiresAt}`
      );
    });

    const embed = new EmbedBuilder()
      .setTitle(`📦 Pending Trades — ${myNation.name}`)
      .setDescription(lines.join('\n\n'))
      .setColor(0xf0a500)
      .setFooter({ text: 'Starlight NRP • Use /trade accept or /trade reject' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
