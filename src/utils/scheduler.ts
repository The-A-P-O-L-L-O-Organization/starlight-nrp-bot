import cron from 'node-cron';
import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { applyTick, advanceYear } from '../db/schema';

const YEARS_PER_TICK = 25;

/** Default cron: midnight UTC every day. Override with TICK_CRON env var. */
const TICK_CRON = process.env.TICK_CRON ?? '0 0 * * *';

/** Prevents two ticks from running concurrently (e.g. a scheduled tick racing a force-tick). */
let tickRunning = false;

export function startScheduler(client: Client): void {
  if (!cron.validate(TICK_CRON)) {
    console.error(`[Scheduler] Invalid TICK_CRON expression: "${TICK_CRON}". Scheduler not started.`);
    return;
  }

  cron.schedule(TICK_CRON, () => runTick(client), { timezone: 'UTC' });
  console.log(`[Scheduler] Tick scheduled with cron expression "${TICK_CRON}" (UTC).`);
}

export async function runTick(client: Client): Promise<boolean> {
  if (tickRunning) {
    console.warn('[Scheduler] Tick already in progress — skipping.');
    return false;
  }

  tickRunning = true;
  try {
    applyTick();
    const newYear = advanceYear(YEARS_PER_TICK);

    const channelId = process.env.TIMELINE_CHANNEL_ID;
    if (!channelId) {
      console.warn('[Scheduler] TIMELINE_CHANNEL_ID not set — skipping announcement.');
      return true;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !(channel instanceof TextChannel) && !('send' in channel)) {
        console.warn('[Scheduler] #timeline-events channel not found or not a text channel.');
        return true;
      }

      const embed = new EmbedBuilder()
        .setTitle('📅 Year Advanced')
        .setDescription(
          `The galaxy moves forward.\n\n` +
          `**Current Year: ${newYear}**\n\n` +
          `All star-nations have received **${YEARS_PER_TICK * 12} months** of production (${YEARS_PER_TICK} years).\n` +
          `Use \`/resources\` to check your nation's current stockpiles.`,
        )
        .setColor(0x5865f2)
        .setFooter({ text: 'Starlight NRP' })
        .setTimestamp();

      await (channel as TextChannel).send({ embeds: [embed] });
    } catch (err) {
      console.error('[Scheduler] Failed to post tick announcement:', err);
    }

    return true;
  } finally {
    tickRunning = false;
  }
}
