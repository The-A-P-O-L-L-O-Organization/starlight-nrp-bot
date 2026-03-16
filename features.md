# Starlight NRP Bot — Feature Backlog

## Completed

- [x] Research resources no longer accumulate stockpile during ticks
- [x] GM role name configurable via `GM_ROLE_NAME` env var
- [x] Tick schedule configurable via `TICK_CRON` env var
- [x] Graceful tick locking (prevents concurrent automatic + forced ticks)
- [ ] Automated tests — unit tests for DB functions and tick logic
- [ ] README — setup and deployment documentation

---

## Economy & Gameplay

- [ ] **Resource trade market** — A player-to-player `/trade propose` and `/trade accept` flow so nations can negotiate resource exchanges without GM intervention
- [ ] **Resource caps/limits** — Maximum stockpile sizes per resource type, so nations can't accumulate infinitely
- [ ] **Research spending** — A mechanic to "spend" research stockpiles to unlock bonuses or tier-up production rates
- [ ] **Debt/negative stockpiles** — Allow stockpiles to go negative with consequences, rather than silently allowing it
- [ ] **Production modifiers** — Temporary or permanent multipliers on production rates (e.g., bonus events, penalties)

## GM Tools

- [ ] **Bulk resource adjustment** — Apply a delta to all nations at once (e.g., a galaxy-wide event that drains food for everyone)
- [ ] **Event system** — A `/gm event` command that applies named modifiers to one or more nations and logs them
- [ ] **Nation notes** — Free-text notes attached to a nation visible only to the GM
- [ ] **Audit log** — Track all GM resource changes with timestamps and reasons, queryable via `/gm audit`
- [ ] **Snapshot/backup** — Export the current full game state as a JSON file attached to a Discord message

## Player Experience

- [ ] **Change notifications** — DM players when their nation receives a resource transfer or is affected by a GM adjustment
- [ ] **Resource history** — Track stockpile changes over time so players can see trends (requires a history table)
- [ ] **Leaderboard** — `/nation leaderboard` showing ranked nations by total resource wealth
- [ ] **Nation profile** — Allow players to set a description, flag emoji, or color for their nation's embeds
