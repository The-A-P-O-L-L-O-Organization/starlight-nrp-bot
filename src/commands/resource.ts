import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { isGM } from '../utils/permissions';
import { getNationByUserId, setResourceField, addToStockpile, getResources } from '../db/schema';
import { RESOURCE_TYPES, RESOURCE_META } from '../types';

export const data = new SlashCommandBuilder()
  .setName('resource')
  .setDescription('[GM] Manage nation resources')
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('[GM] Set a specific stockpile or production value for a nation')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Resource type')
          .setRequired(true)
          .addChoices(
            ...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t })),
          ),
      )
      .addStringOption((o) =>
        o
          .setName('field')
          .setDescription('What to set')
          .setRequired(true)
          .addChoices(
            { name: 'Stockpile', value: 'stockpile' },
            { name: 'Production (per Month)', value: 'production' },
          ),
      )
      .addNumberOption((o) =>
        o.setName('amount').setDescription('New value').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('set-production-all')
      .setDescription('[GM] Set production for ALL resources of a nation at once')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player').setRequired(true),
      )
      .addNumberOption((o) =>
        o.setName('amount').setDescription('Production value to apply to all resources').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('[GM] Add (or subtract) from a stockpile')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Resource type')
          .setRequired(true)
          .addChoices(
            ...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t })),
          ),
      )
      .addNumberOption((o) =>
        o.setName('amount').setDescription('Amount to add (negative to subtract)').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('subtract')
      .setDescription('[GM] Subtract an amount from a stockpile')
      .addUserOption((o) =>
        o.setName('player').setDescription('The player').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Resource type')
          .setRequired(true)
          .addChoices(
            ...RESOURCE_TYPES.map((t) => ({ name: RESOURCE_META[t].label, value: t })),
          ),
      )
      .addNumberOption((o) =>
        o.setName('amount').setDescription('Amount to subtract (positive number)').setRequired(true).setMinValue(0),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isGM(interaction.member as GuildMember)) {
    await interaction.reply({ content: 'Only the **Owner/GM** can modify resources.', flags: 64 });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const targetUser = interaction.options.getUser('player', true);
  const nation = getNationByUserId(targetUser.id);

  if (!nation) {
    await interaction.reply({
      content: `<@${targetUser.id}> does not have a registered nation. Use \`/nation register\` first.`,
      flags: 64,
    });
    return;
  }

  if (sub === 'set') {
    const resourceType = interaction.options.getString('type', true);
    const field = interaction.options.getString('field', true) as 'stockpile' | 'production';
    const amount = interaction.options.getNumber('amount', true);

    setResourceField(nation.id, resourceType, field, amount);

    const meta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];
    const fieldLabel = field === 'stockpile' ? 'Stockpile' : 'Production (per Month)';

    await interaction.reply({
      content: `${meta.emoji} **${nation.name}** — ${meta.label} ${fieldLabel} set to **${amount.toLocaleString()}**.`,
    });
    return;
  }

  if (sub === 'set-production-all') {
    const amount = interaction.options.getNumber('amount', true);

    for (const type of RESOURCE_TYPES) {
      setResourceField(nation.id, type, 'production', amount);
    }

    await interaction.reply({
      content: `**${nation.name}** — All production rates set to **${amount.toLocaleString()}** per Month.`,
    });
    return;
  }

  if (sub === 'add') {
    const resourceType = interaction.options.getString('type', true);
    const amount = interaction.options.getNumber('amount', true);

    addToStockpile(nation.id, resourceType, amount);

    const meta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];
    const sign = amount >= 0 ? '+' : '';

    await interaction.reply({
      content: `${meta.emoji} **${nation.name}** — ${meta.label} stockpile adjusted by **${sign}${amount.toLocaleString()}**.`,
    });
  }

  if (sub === 'subtract') {
    const resourceType = interaction.options.getString('type', true);
    const amount = interaction.options.getNumber('amount', true);

    addToStockpile(nation.id, resourceType, -amount);

    const meta = RESOURCE_META[resourceType as keyof typeof RESOURCE_META];

    await interaction.reply({
      content: `${meta.emoji} **${nation.name}** — ${meta.label} stockpile reduced by **${amount.toLocaleString()}**.`,
    });
  }
}
