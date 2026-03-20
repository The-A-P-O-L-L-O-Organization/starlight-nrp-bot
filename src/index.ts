import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Collection,
  ChatInputCommandInteraction,
  UserContextMenuCommandInteraction,
  Interaction,
} from 'discord.js';
import { initDb } from './db/schema';
import { startScheduler } from './utils/scheduler';

import * as nationCmd from './commands/nation';
import * as resourceCmd from './commands/resource';
import * as resourcesCmd from './commands/resources';
import * as gmCmd from './commands/gm';
import * as diplomacyCmd from './commands/diplomacy';
import * as tradeCmd from './commands/trade';
import * as marketCmd from './commands/market';
import * as mapCmd from './commands/map';
import * as viewNationCtx from './context-menus/view-nation';

// ── Validate env ──────────────────────────────────────────────────────────────
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN is not set.');
  process.exit(1);
}

// ── Init DB ───────────────────────────────────────────────────────────────────
initDb();
console.log('[DB] Initialized.');

// ── Build command collections ─────────────────────────────────────────────────
const slashCommands = new Collection<string, { execute: (i: ChatInputCommandInteraction) => Promise<void> }>();
slashCommands.set('nation', nationCmd);
slashCommands.set('resource', resourceCmd);
slashCommands.set('resources', resourcesCmd);
slashCommands.set('gm', gmCmd);
slashCommands.set('diplomacy', diplomacyCmd);
slashCommands.set('trade', tradeCmd);
slashCommands.set('market', marketCmd);
slashCommands.set('map', mapCmd);

const contextMenus = new Collection<string, { execute: (i: UserContextMenuCommandInteraction) => Promise<void> }>();
contextMenus.set('View Nation Resources', viewNationCtx);

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('clientReady', () => {
  console.log(`[Bot] Logged in as ${client.user?.tag}`);
  startScheduler(client);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  const isNetworkError = (err: unknown): boolean => {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: string }).code;
      return code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_CONNECT' || code === 'ETIMEDOUT';
    }
    return false;
  };

  try {
    if (interaction.isChatInputCommand()) {
      const cmd = slashCommands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
      return;
    }

    if (interaction.isUserContextMenuCommand()) {
      const cmd = contextMenus.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
      return;
    }
  } catch (err) {
    if (!isNetworkError(err)) {
      console.error('[Bot] Interaction error:', err);
    }
    const reply = { content: 'An error occurred. Please try again.', flags: 64 };
    if (interaction.isRepliable()) {
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      } catch {
        // Failed to send error message - interaction may have timed out
      }
    }
  }
});

client.login(token);
