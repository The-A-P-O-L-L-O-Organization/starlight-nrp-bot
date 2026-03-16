# Starlight NRP Bot

A Discord bot for the **Starlight** space nation roleplay (NRP) game. Players manage their nations' economies across a persistent, simulated galaxy starting in the year **2300**. Time advances automatically in 25-year ticks, crediting each nation's stockpiles with their monthly production.

---

## Requirements

- Node.js 20+
- pnpm 9+
- A Discord bot application with a bot token ([Discord Developer Portal](https://discord.com/developers/applications))

Or, to run via Docker:

- Docker + Docker Compose

---

## Setup

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd starlight-nrp-bot
pnpm install
```

### 2. Configure environment variables

Copy the example env file and fill in the values:

```bash
cp .env.example .env
```

| Variable            | Required | Description                                                         |
|---------------------|----------|---------------------------------------------------------------------|
| `DISCORD_TOKEN`     | Yes      | Bot token from the Discord Developer Portal                         |
| `GUILD_ID`          | Yes      | Discord server (guild) ID                                           |
| `TIMELINE_CHANNEL_ID` | Yes    | Channel ID where tick announcements are posted                      |
| `DB_PATH`           | Yes      | Path to the SQLite database file (e.g. `./data/starlight.db`)       |
| `GM_ROLE_NAME`      | No       | Discord role name that grants GM permissions (default: `Owner/GM`)  |
| `TICK_CRON`         | No       | Cron expression for the automatic tick schedule in UTC (default: `0 0 * * *` — midnight daily) |

### 3. Register slash commands

This must be run once before starting the bot, and again whenever commands change:

```bash
pnpm deploy
```

### 4. Start the bot

**Development (ts-node, auto-reloads on save):**
```bash
pnpm dev
```

**Production (compiled JS):**
```bash
pnpm build
pnpm start
```

---

## Docker

Build and run with Docker Compose. The SQLite database is persisted in `./data/`:

```bash
docker compose up -d
```

To register slash commands inside the container:

```bash
docker compose run --rm bot pnpm deploy
```

---

## Commands

### Player commands

| Command       | Description                                              |
|---------------|----------------------------------------------------------|
| `/resources`  | View your own nation's resource stockpiles (private)     |
| `/nation view` | View any nation's resource sheet                        |
| `/nation list` | List all registered nations                             |

### GM commands

GM access requires the `Administrator` Discord permission or the configured GM role (`Owner/GM` by default).

| Command                        | Description                                              |
|--------------------------------|----------------------------------------------------------|
| `/nation register`             | Register a new nation for a Discord user                 |
| `/resource set`                | Set a nation's stockpile or production for a resource    |
| `/resource set-production-all` | Set all 9 production rates to the same value             |
| `/resource add`                | Add to a nation's stockpile                              |
| `/resource subtract`           | Subtract from a nation's stockpile                       |
| `/gm view-nation`              | View a nation's full resource sheet (private)            |
| `/gm overview`                 | Summary of all nations' production and stockpiles        |
| `/gm delete-nation`            | Permanently delete a nation                              |
| `/gm rename-nation`            | Rename a nation                                          |
| `/gm reset-stockpiles`         | Zero out all stockpiles for a nation                     |
| `/gm set-year`                 | Override the current in-game year                        |
| `/gm force-tick`               | Trigger a production tick immediately                    |
| `/gm transfer`                 | Transfer resources from one nation to another            |
| `/gm backfill-defaults`        | Patch nations with zero production to default values     |

### Context menu

Right-click any user → **Apps** → **View Nation Resources** to see that user's resource sheet.

---

## Resource types

| Category | Resource         |
|----------|-----------------|
| Basic    | Energy Credits, Minerals, Food, Trade |
| Advanced | Alloys, Consumer Goods |
| Research | Physics, Society, Engineering |

Research resources represent an ongoing rate — their stockpile is always zero and does not accumulate during ticks.

---

## Game mechanics

- **Tick**: Each tick represents 25 years. All non-research stockpiles are credited with `production_rate × 300` (25 years × 12 months).
- **Schedule**: Ticks run automatically on the configured cron schedule (default: midnight UTC daily). The schedule can be overridden with the `TICK_CRON` env var.
- **Tick locking**: If a manual `/gm force-tick` is triggered while an automatic tick is already running, the second tick is skipped to prevent double-crediting.

---

## Development

### Run tests

```bash
pnpm test          # run once
pnpm test:watch    # watch mode
pnpm test:coverage # with coverage report
```

Tests use [Vitest](https://vitest.dev) and run against an in-memory SQLite database — no `.env` file is needed.

### Project structure

```
src/
  commands/         Slash command handlers (nation, resource, resources, gm)
  context-menus/    User context menu handlers
  db/schema.ts      SQLite schema, init, and all query functions
  utils/
    embeds.ts       Discord embed builder for resource sheets
    permissions.ts  GM permission check
    scheduler.ts    Cron-based tick scheduler with tick locking
  types.ts          Resource types and game constants
  index.ts          Bot entrypoint
  deploy-commands.ts  One-shot command registration script
tests/
  schema.test.ts    DB layer unit tests
  scheduler.test.ts Scheduler / tick logic unit tests
```
