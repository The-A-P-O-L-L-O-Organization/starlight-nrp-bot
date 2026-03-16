import { EmbedBuilder } from 'discord.js';
import { RESOURCE_META, ResourceType, STATUS_META } from '../types';
import { getResources, getCurrentYear, getNationStatuses, getProductionModifiers } from '../db/schema';

interface NationData {
  name: string;
  discord_user_id: string;
}

export function buildResourceEmbed(nation: NationData, nationId: number): EmbedBuilder {
  const rows = getResources(nationId);
  const year = getCurrentYear();
  const statuses = getNationStatuses(nationId);
  const modifiers = getProductionModifiers(nationId);

  const byType = Object.fromEntries(rows.map((r) => [r.resource_type, r]));

  function formatCategory(types: ResourceType[]): string {
    return types
      .map((type) => {
        const meta = RESOURCE_META[type];
        const row = byType[type];
        const stockpile = row ? Math.floor(row.stockpile).toLocaleString() : '0';
        const prod = row ? row.production : 0;
        const prodStr = prod >= 0 ? `+${prod.toLocaleString()}` : prod.toLocaleString();
        return `${meta.emoji} **${meta.label}:** ${stockpile} *(${prodStr}/Month)*`;
      })
      .join('\n');
  }

  const basic = formatCategory(['energy_credits', 'minerals', 'food', 'trade'] as ResourceType[]);
  const advanced = formatCategory(['alloys', 'consumer_goods'] as ResourceType[]);
  const research = formatCategory(['physics', 'society', 'engineering'] as ResourceType[]);

  const embed = new EmbedBuilder()
    .setTitle(`🌌 ${nation.name}`)
    .setDescription(`Resource sheet — **Year ${year}**`)
    .setColor(0x2b2d31)
    .addFields(
      { name: '— Basic Resources —', value: basic },
      { name: '— Advanced Resources —', value: advanced },
      { name: '— Research —', value: research },
    );

  // Status flags
  if (statuses.length > 0) {
    const statusLines = statuses.map((s) => {
      const meta = STATUS_META[s.status as keyof typeof STATUS_META];
      if (meta) {
        const modStr = meta.productionModifier !== 0
          ? ` *(${meta.productionModifier > 0 ? '+' : ''}${Math.round(meta.productionModifier * 100)}% production)*`
          : '';
        return `${meta.emoji} **${s.label}**${modStr}`;
      }
      return `🏷️ **${s.label}**`;
    });
    embed.addFields({ name: '— National Status —', value: statusLines.join('\n') });
  }

  // Active production modifiers
  if (modifiers.length > 0) {
    const modLines = modifiers.map((m) => {
      const pct = Math.round((m.multiplier - 1) * 100);
      const sign = pct >= 0 ? '+' : '';
      const scope = m.resource_type
        ? RESOURCE_META[m.resource_type as ResourceType]?.label ?? m.resource_type
        : 'All Resources';
      const tickStr = m.ticks_remaining === 1 ? '1 tick' : `${m.ticks_remaining} ticks`;
      return `⚙️ **${m.label}:** ${sign}${pct}% ${scope} *(${tickStr} remaining)*`;
    });
    embed.addFields({ name: '— Active Modifiers —', value: modLines.join('\n') });
  }

  embed
    .setFooter({ text: 'Starlight NRP' })
    .setTimestamp();

  return embed;
}
