import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import * as nationCmd from './commands/nation';
import * as resourceCmd from './commands/resource';
import * as resourcesCmd from './commands/resources';
import * as gmCmd from './commands/gm';
import * as diplomacyCmd from './commands/diplomacy';
import * as tradeCmd from './commands/trade';
import * as marketCmd from './commands/market';
import * as viewNationCtx from './context-menus/view-nation';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;

if (!token || !guildId) {
  console.error('Missing DISCORD_TOKEN or GUILD_ID in environment.');
  process.exit(1);
}

const commands = [
  nationCmd.data.toJSON(),
  resourceCmd.data.toJSON(),
  resourcesCmd.data.toJSON(),
  gmCmd.data.toJSON(),
  diplomacyCmd.data.toJSON(),
  tradeCmd.data.toJSON(),
  marketCmd.data.toJSON(),
  viewNationCtx.data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(
      // Extract application ID from token (first segment before the first dot)
      Buffer.from(token.split('.')[0], 'base64').toString('utf8'),
      guildId,
    ), { body: commands });
    console.log('Commands registered successfully.');
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
