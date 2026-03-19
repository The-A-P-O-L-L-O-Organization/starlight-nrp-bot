import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import {
  getNationByUserId,
  getNationById,
  createMarketOffer,
  getOpenMarketOffers,
  getMarketOffer,
  fillMarketOffer,
  cancelMarketOffer,
  isSanctioned,
  logAuditEvent,
  getResources,
  getBlockadeInfo,
} from '../db/schema';
import { RESOURCE_TYPES, RESOURCE_META } from '../types';

export const data = new SlashCommandBuilder()
  .setName('market')
  .setDescription('Post and fill buy/sell offers on the galactic market')

  // ── post ─────────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('post')
      .setDescription('Post a buy or sell offer on the market')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Are you selling or buying?')
          .setRequired(true)
          .addChoices(
            { name: 'Sell', value: 'sell' },
            { name: 'Buy', value: 'buy' },
          ),
      )
      .addStringOption((o) =>
        o
          .setName('resource')
          .setDescription('Resource you are selling or buying')
          .setRequired(true)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      )
      .addNumberOption((o) =>
        o.setName('amount').setDescription('Quantity').setRequired(true).setMinValue(1),
      )
      .addNumberOption((o) =>
        o.setName('price').setDescription('Price per unit').setRequired(true).setMinValue(0.01),
      )
      .addStringOption((o) =>
        o
          .setName('price-resource')
          .setDescription('Resource used as currency (price per unit is in this resource)')
          .setRequired(true)
          .addChoices(...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t }))),
      ),
  )

  // ── fill ─────────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('fill')
      .setDescription('Fill an open market offer')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Market offer ID').setRequired(true).setMinValue(1),
      ),
  )

  // ── cancel ───────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel one of your own open market offers')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Market offer ID').setRequired(true).setMinValue(1),
      ),
  )

  // ── list ─────────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Browse all open market offers'),
  );

// ── Handler ──────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  const myNation = getNationByUserId(interaction.user.id);
  if (!myNation) {
    await interaction.reply({
      content: 'You do not have a registered nation. Ask the GM to register one for you.',
      flags: 64,
    });
    return;
  }

  // ── post ─────────────────────────────────────────────────────────────────────
  if (sub === 'post') {
    const offerType = interaction.options.getString('type', true) as 'sell' | 'buy';
    const resourceType = interaction.options.getString('resource', true);
    const amount = interaction.options.getNumber('amount', true);
    const price = interaction.options.getNumber('price', true);
    const priceResource = interaction.options.getString('price-resource', true);

    if (resourceType === priceResource) {
      await interaction.reply({ content: 'The traded resource and price resource cannot be the same.', flags: 64 });
      return;
    }

    // Check if poster is blockaded
    const blockadeInfo = getBlockadeInfo(myNation.id);
    if (blockadeInfo) {
      const directionText = blockadeInfo.direction === 'both' ? 'fully blockaded' : 
                           blockadeInfo.direction === 'outgoing' ? 'blockaded from sending resources' :
                           'blockaded from receiving resources';
      await interaction.reply({
        content: `Your nation is ${directionText} and cannot participate in market trades.`,
        flags: 64,
      });
      return;
    }

    // For sell offers: verify the nation has enough to put up
    if (offerType === 'sell') {
      const myResources = getResources(myNation.id);
      const row = myResources.find((r) => r.resource_type === resourceType);
      if (!row || row.stockpile < amount) {
        const current = row ? Math.floor(row.stockpile).toLocaleString() : '0';
        const meta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];
        await interaction.reply({
          content: `You only have **${current} ${meta.label}** — cannot post a sell offer for **${amount.toLocaleString()}**.`,
          flags: 64,
        });
        return;
      }
    }

    const offerId = createMarketOffer(myNation.id, offerType, resourceType, amount, price, priceResource);

    const resMeta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];
    const priceMeta = RESOURCE_META[priceResource as keyof typeof RESOURCE_META];
    const totalPrice = price * amount;
    const verb = offerType === 'sell' ? 'Selling' : 'Buying';

    await interaction.reply({
      content:
        `Market offer **#${offerId}** posted!\n\n` +
        `**${verb}:** ${resMeta.emoji} ${amount.toLocaleString()} ${resMeta.label}\n` +
        `**Price:** ${priceMeta.emoji} ${price.toLocaleString()} ${priceMeta.label}/unit (total: ${totalPrice.toLocaleString()})\n\n` +
        `Use \`/market list\` to see all open offers. Others can fill this with \`/market fill ${offerId}\`.`,
    });
    return;
  }

  // ── fill ─────────────────────────────────────────────────────────────────────
  if (sub === 'fill') {
    const offerId = interaction.options.getInteger('id', true);
    const offer = getMarketOffer(offerId);

    if (!offer || offer.status !== 'open') {
      await interaction.reply({ content: `Market offer **#${offerId}** is not available.`, flags: 64 });
      return;
    }

    if (offer.nation_id === myNation.id) {
      await interaction.reply({ content: `You cannot fill your own market offer.`, flags: 64 });
      return;
    }

    // Check target (poster) is not sanctioned
    if (isSanctioned(offer.nation_id)) {
      await interaction.reply({
        content: `The nation that posted offer **#${offerId}** is currently under sanctions.`,
        flags: 64,
      });
      return;
    }

    // Check filler is not sanctioned
    if (isSanctioned(myNation.id)) {
      await interaction.reply({
        content: `Your nation is under sanctions and cannot participate in market trades.`,
        flags: 64,
      });
      return;
    }

    // Check if poster is blockaded
    const posterBlockade = getBlockadeInfo(offer.nation_id);
    if (posterBlockade) {
      await interaction.reply({
        content: `The nation that posted offer **#${offerId}** is currently blockaded and cannot participate in trades.`,
        flags: 64,
      });
      return;
    }

    // Check if filler is blockaded
    const fillerBlockade = getBlockadeInfo(myNation.id);
    if (fillerBlockade) {
      const directionText = fillerBlockade.direction === 'both' ? 'fully blockaded' : 
                           fillerBlockade.direction === 'outgoing' ? 'blockaded from sending resources' :
                           'blockaded from receiving resources';
      await interaction.reply({
        content: `Your nation is ${directionText} and cannot participate in market trades.`,
        flags: 64,
      });
      return;
    }

    const success = fillMarketOffer(offerId, myNation.id);
    if (!success) {
      await interaction.reply({
        content: `You do not have sufficient resources to fill offer **#${offerId}**.`,
        flags: 64,
      });
      return;
    }

    const posterNation = getNationById(offer.nation_id);
    const resMeta = RESOURCE_META[offer.resource_type as keyof typeof RESOURCE_META];
    const priceMeta = RESOURCE_META[offer.price_resource_type as keyof typeof RESOURCE_META];
    const totalPrice = offer.price_per_unit * offer.amount;

    logAuditEvent('market_fill', interaction.user.id, {
      offer_id: offerId,
      poster: posterNation?.name,
      filler: myNation.name,
      type: offer.offer_type,
      resource: offer.resource_type,
      amount: offer.amount,
      total_price: totalPrice,
    }, myNation.id);

    const verb = offer.offer_type === 'sell' ? 'bought' : 'sold';
    await interaction.reply({
      content:
        `[SUCCESS] Market offer **#${offerId}** filled!\n\n` +
        `You **${verb}** ${resMeta.emoji} **${offer.amount.toLocaleString()} ${resMeta.label}** ` +
        `${offer.offer_type === 'sell' ? 'from' : 'to'} **${posterNation?.name ?? 'Unknown'}** ` +
        `for ${priceMeta.emoji} **${totalPrice.toLocaleString()} ${priceMeta.label}** total.`,
    });
    return;
  }

  // ── cancel ───────────────────────────────────────────────────────────────────
  if (sub === 'cancel') {
    const offerId = interaction.options.getInteger('id', true);
    const offer = getMarketOffer(offerId);

    if (!offer || offer.status !== 'open') {
      await interaction.reply({ content: `Market offer **#${offerId}** is not open or does not exist.`, flags: 64 });
      return;
    }

    if (offer.nation_id !== myNation.id) {
      await interaction.reply({ content: `Market offer **#${offerId}** is not yours.`, flags: 64 });
      return;
    }

    cancelMarketOffer(offerId);

    await interaction.reply({
      content: `Market offer **#${offerId}** has been cancelled.`,
      flags: 64,
    });
    return;
  }

  // ── list ─────────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const offers = getOpenMarketOffers();

    if (offers.length === 0) {
      await interaction.reply({ content: 'The market board is empty. Be the first to post an offer with `/market post`.', flags: 64 });
      return;
    }

    const sellOffers = offers.filter((o) => o.offer_type === 'sell');
    const buyOffers = offers.filter((o) => o.offer_type === 'buy');

    function formatOffers(list: typeof offers): string {
      if (list.length === 0) return '*None*';
      return list
        .map((o) => {
          const nation = getNationById(o.nation_id);
          const resMeta = RESOURCE_META[o.resource_type as keyof typeof RESOURCE_META];
          const priceMeta = RESOURCE_META[o.price_resource_type as keyof typeof RESOURCE_META];
          return (
            `**#${o.id}** | ${resMeta.emoji} ${o.amount.toLocaleString()} ${resMeta.label} ` +
            `@ ${priceMeta.emoji} ${o.price_per_unit.toLocaleString()} ${priceMeta.label}/unit ` +
            `— **${nation?.name ?? 'Unknown'}**`
          );
        })
        .join('\n');
    }

    const embed = new EmbedBuilder()
      .setTitle('Galactic Market Board')
      .setColor(0xf39c12)
      .addFields(
        { name: '— Sell Offers —', value: formatOffers(sellOffers) },
        { name: '— Buy Offers —', value: formatOffers(buyOffers) },
      )
      .setFooter({ text: 'Starlight NRP • Use /market fill <id> to complete a trade' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}
