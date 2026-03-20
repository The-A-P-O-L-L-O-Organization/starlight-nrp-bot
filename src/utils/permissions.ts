import { GuildMember } from 'discord.js';

const GM_ROLE_NAME = process.env.GM_ROLE_NAME ?? 'Owner/GM';
const MAP_ROLE_NAME = process.env.MAP_ROLE_NAME ?? 'Map Guy';

export function isGM(member: GuildMember): boolean {
  return (
    member.permissions.has('Administrator') ||
    member.roles.cache.some((r) => r.name === GM_ROLE_NAME)
  );
}

export function canManageMap(member: GuildMember): boolean {
  return (
    member.permissions.has('Administrator') ||
    member.roles.cache.some((r) => r.name === GM_ROLE_NAME || r.name === MAP_ROLE_NAME)
  );
}
