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

const contextMenus = new Collection<string, { execute: (i: UserContextMenuCommandInteraction) => Promise<void> }>();
contextMenus.set('View Nation Resources', viewNationCtx);

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', () => {
  console.log(`[Bot] Logged in as ${client.user?.tag}`);
  startScheduler(client);
});

client.on('interactionCreate', async (interaction: Interaction) => {
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
    console.error('[Bot] Interaction error:', err);
    const reply = { content: 'An error occurred. Please try again.', ephemeral: true };
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => null);
      } else {
        await interaction.reply(reply).catch(() => null);
      }
    }
  }
});

client.login(token);
