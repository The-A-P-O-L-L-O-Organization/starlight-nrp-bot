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
import * as gm2Cmd from './commands/gm2';
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
slashCommands.set('gm2', gm2Cmd);
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
    if (err && typeof err === 'object') {
      if ('code' in err) {
        const code = (err as { code: string }).code;
        if (['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CONNECT', 'ETIMEDOUT', 'ABORT_ERR'].includes(code)) {
          return true;
        }
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        return true;
      }
    }
    return false;
  };

  const isUnknownInteraction = (err: unknown): boolean => {
    if (err && typeof err === 'object') {
      if ('code' in err) {
        const code = (err as { code: number | string }).code;
        return code === 10062 || code === '10062';
      }
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
    if (isUnknownInteraction(err)) {
      return;
    }
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
      } catch (followUpErr) {
        if (isUnknownInteraction(followUpErr)) {
          return;
        }
      }
    }
  }
});

async function loginWithRetry(client: Client, token: string, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.login(token);
      return;
    } catch (err) {
      const isDnsError = (err: unknown): boolean => {
        if (err && typeof err === 'object' && 'code' in err) {
          const code = (err as { code: string }).code;
          return code === 'EAI_AGAIN' || code === 'ENOTFOUND' || code === 'ECONNREFUSED';
        }
        return false;
      };

      if (isDnsError(err) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`[Bot] DNS lookup failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

loginWithRetry(client, token);
