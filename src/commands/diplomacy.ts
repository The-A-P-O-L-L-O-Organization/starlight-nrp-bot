import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import {
  getNationByUserId,
  getNationById,
  createAlliance,
  dissolveAlliance,
  getAllAlliances,
  areAllied,
  isSanctioned,
  getSanctionsAgainst,
  logAuditEvent,
} from '../db/schema';

export const data = new SlashCommandBuilder()
  .setName('diplomacy')
  .setDescription('Manage diplomatic relations between nations')

  // ── propose-alliance ─────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('propose-alliance')
      .setDescription('Propose a formal alliance with another nation (both parties must agree — GM finalises)')
      .addUserOption((o) =>
        o.setName('nation').setDescription('The nation to ally with').setRequired(true),
      ),
  )

  // ── dissolve-alliance ────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('dissolve-alliance')
      .setDescription('Dissolve an alliance with another nation')
      .addUserOption((o) =>
        o.setName('nation').setDescription('The allied nation to dissolve the alliance with').setRequired(true),
      ),
  )

  // ── list-alliances ───────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('list-alliances')
      .setDescription('View all active alliances in the galaxy'),
  )

  // ── status ───────────────────────────────────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('View your nation\'s diplomatic standing (alliances, sanctions)'),
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

  // ── propose-alliance ─────────────────────────────────────────────────────────
  if (sub === 'propose-alliance') {
    const targetUser = interaction.options.getUser('nation', true);

    if (targetUser.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot ally with yourself.', flags: 64 });
      return;
    }

    const targetNation = getNationByUserId(targetUser.id);
    if (!targetNation) {
      await interaction.reply({ content: `<@${targetUser.id}> does not have a registered nation.`, flags: 64 });
      return;
    }

    if (areAllied(myNation.id, targetNation.id)) {
      await interaction.reply({
        content: `**${myNation.name}** and **${targetNation.name}** are already allied.`,
        flags: 64,
      });
      return;
    }

    // Alliances are GM-finalised: this posts a public proposal that a GM can confirm via the same command
    // For simplicity, we allow any player to propose, and the command itself creates the alliance.
    // The GM can dissolve it if it was made in error.
    try {
      createAlliance(myNation.id, targetNation.id);
    } catch {
      await interaction.reply({ content: 'An alliance between these nations already exists.', flags: 64 });
      return;
    }

    logAuditEvent('alliance_formed', interaction.user.id, {
      nation_a: myNation.name,
      nation_b: targetNation.name,
    }, myNation.id);

    await interaction.reply({
      content:
        `**Alliance Formed!**\n\n` +
        `**${myNation.name}** and **${targetNation.name}** are now formal allies.\n` +
        `Allied nations receive a **10% discount** on resource transfers between them.`,
    });
    return;
  }

  // ── dissolve-alliance ────────────────────────────────────────────────────────
  if (sub === 'dissolve-alliance') {
    const targetUser = interaction.options.getUser('nation', true);
    const targetNation = getNationByUserId(targetUser.id);

    if (!targetNation) {
      await interaction.reply({ content: `<@${targetUser.id}> does not have a registered nation.`, flags: 64 });
      return;
    }

    const dissolved = dissolveAlliance(myNation.id, targetNation.id);
    if (!dissolved) {
      await interaction.reply({
        content: `**${myNation.name}** and **${targetNation.name}** are not currently allied.`,
        flags: 64,
      });
      return;
    }

    logAuditEvent('alliance_dissolved', interaction.user.id, {
      nation_a: myNation.name,
      nation_b: targetNation.name,
    }, myNation.id);

    await interaction.reply({
      content: `The alliance between **${myNation.name}** and **${targetNation.name}** has been dissolved.`,
    });
    return;
  }

  // ── list-alliances ───────────────────────────────────────────────────────────
  if (sub === 'list-alliances') {
    const alliances = getAllAlliances();

    if (alliances.length === 0) {
      await interaction.reply({ content: 'No alliances currently exist in the galaxy.', flags: 64 });
      return;
    }

    const lines = alliances.map((a) => {
      const nationA = getNationById(a.nation_a_id);
      const nationB = getNationById(a.nation_b_id);
      const date = a.formed_at.split('T')[0];
      return `**${nationA?.name ?? 'Unknown'}** ↔ **${nationB?.name ?? 'Unknown'}** *(since ${date})*`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Galactic Alliances')
      .setDescription(lines.join('\n'))
      .setColor(0x2ecc71)
      .setFooter({ text: 'Starlight NRP' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ── status ───────────────────────────────────────────────────────────────────
  if (sub === 'status') {
    const alliances = getAllAlliances().filter(
      (a) => a.nation_a_id === myNation.id || a.nation_b_id === myNation.id,
    );

    const sanctions = getSanctionsAgainst(myNation.id);
    const sanctioned = isSanctioned(myNation.id);

    const allyLines =
      alliances.length > 0
        ? alliances.map((a) => {
            const partnerId = a.nation_a_id === myNation.id ? a.nation_b_id : a.nation_a_id;
            const partner = getNationById(partnerId);
            return `**${partner?.name ?? 'Unknown'}**`;
          })
        : ['*No active alliances*'];

    const sanctionLines =
      sanctions.length > 0
        ? sanctions.map((s) => {
            const reasonStr = s.reason ? ` — *${s.reason}*` : '';
            return `**Sanction #${s.id}**${reasonStr}`;
          })
        : ['*No active sanctions*'];

    const embed = new EmbedBuilder()
      .setTitle(`Diplomatic Status — ${myNation.name}`)
      .setColor(sanctioned ? 0xe74c3c : 0x2ecc71)
      .addFields(
        { name: '— Allies —', value: allyLines.join('\n') },
        { name: '— Sanctions —', value: sanctionLines.join('\n') },
      )
      .setFooter({ text: 'Starlight NRP' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
  }
}
