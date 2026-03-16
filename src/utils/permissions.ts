import { GuildMember } from 'discord.js';

const GM_ROLE_NAME = process.env.GM_ROLE_NAME ?? 'Owner/GM';

export function isGM(member: GuildMember): boolean {
  return (
    member.permissions.has('Administrator') ||
    member.roles.cache.some((r) => r.name === GM_ROLE_NAME)
  );
}
