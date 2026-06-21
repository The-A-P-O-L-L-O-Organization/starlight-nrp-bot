# Starlight NRP Bot

A Discord bot for the **Starlight** space nation roleplay (NRP) game. Players manage their nations' economies, diplomatic relations, and trade across a persistent, simulated galaxy starting in the year **2200**. Time advances automatically in 25-year ticks, crediting each nation's stockpiles with their monthly production.

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

| Variable              | Required | Description                                                         |
|-----------------------|----------|---------------------------------------------------------------------|
| `DISCORD_TOKEN`       | Yes      | Bot token from the Discord Developer Portal                         |
| `GUILD_ID`            | Yes      | Discord server (guild) ID                                           |
| `TIMELINE_CHANNEL_ID` | Yes      | Channel ID where tick announcements are posted                      |
| `DB_PATH`             | Yes      | Path to the SQLite database file (e.g. `./data/starlight.db`)       |
| `GM_ROLE_NAME`        | No       | Discord role name that grants GM permissions (default: `Owner/GM`)  |
| `MAP_ROLE_NAME`       | No       | Discord role name that can manage the map (default: `Map Guy`)      |
| `TICK_CRON`           | No       | Cron expression for the automatic tick schedule in UTC (default: `0 0 * * *` — midnight daily) |

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

| Command                 | Description                                              |
|-------------------------|----------------------------------------------------------|
| `/resources`            | View your own nation's resource stockpiles (private)     |
| `/nation view`          | View any nation's resource sheet                         |
| `/nation list`          | List all registered nations                              |
| `/diplomacy propose-alliance` | Propose a formal alliance with another nation       |
| `/diplomacy dissolve-alliance` | Dissolve an alliance with another nation           |
| `/diplomacy list-alliances` | View all active alliances in the galaxy              |
| `/diplomacy status`     | View your nation's diplomatic standing                   |
| `/trade propose`        | Propose a resource trade with another nation             |
| `/trade accept`         | Accept an incoming trade proposal by ID                  |
| `/trade reject`         | Reject an incoming trade proposal by ID                  |
| `/trade cancel`         | Cancel one of your own pending trade proposals           |
| `/trade list`           | View all pending trades involving your nation            |
| `/market list`          | Browse all open market offers                            |
| `/market post`          | Post a buy or sell offer on the galactic market          |
| `/market fill`          | Fill an open market offer by ID                          |
| `/market cancel`        | Cancel one of your own open market offers                |
| `/map view`             | View the current map                                     |

### GM commands

GM access requires the `Administrator` Discord permission or the configured GM role (`Owner/GM` by default).

| Command                        | Description                                                      |
|--------------------------------|------------------------------------------------------------------|
| `/nation register`             | Register a new nation for a Discord user                         |
| `/resource set`                | Set a nation's stockpile or production for a resource             |
| `/resource set-production-all` | Set all 9 production rates to the same value                     |
| `/resource add`                | Add to a nation's stockpile                                      |
| `/resource subtract`           | Subtract from a nation's stockpile                               |
| `/gm view-nation`              | View a nation's full resource sheet (private)                    |
| `/gm overview`                 | Summary of all nations' production and stockpiles                |
| `/gm delete-nation`            | Permanently delete a nation                                      |
| `/gm rename-nation`            | Rename a nation                                                  |
| `/gm reset-stockpiles`         | Zero out all stockpiles for a nation                             |
| `/gm set-year`                 | Override the current in-game year                                |
| `/gm force-tick`               | Trigger a production tick immediately                            |
| `/gm freeze-tick`              | Freeze automatic tick progression                                |
| `/gm unfreeze-tick`            | Unfreeze automatic tick progression                              |
| `/gm transfer`                 | Transfer resources from one nation to another                    |
| `/gm backfill-defaults`        | Patch nations with zero production to default values             |
| `/gm bulk-adjust`              | Add or subtract a resource across all nations at once            |
| `/gm set-status`               | Apply a status flag to a nation (e.g. at war, golden age)        |
| `/gm remove-status`            | Remove a status flag from a nation                               |
| `/gm set-modifier`             | Add a tick-expiring production multiplier                        |
| `/gm remove-modifier`          | Remove a production modifier by ID                               |
| `/gm set-cap`                  | Set a stockpile cap for a nation's resource                      |
| `/gm remove-cap`               | Remove a stockpile cap                                           |
| `/gm audit`                    | View the audit log (optionally filtered to one nation)           |
| `/gm2 tributes`                | List all active tribute agreements                               |
| `/gm2 add-tribute`             | Create a recurring tribute agreement (paid each tick)            |
| `/gm2 remove-tribute`          | Remove a tribute agreement by ID                                 |
| `/gm2 sanctions-list`          | List all active sanctions                                        |
| `/gm2 add-sanction`            | Sanction a nation (blocks receiving transfers/trades)            |
| `/gm2 remove-sanction`         | Lift a sanction by ID                                            |
| `/gm2 export-state`            | Export the current game state as a JSON file                     |
| `/gm2 new-season`              | Archive current game and reset everything for a new season       |
| `/map upload`                  | Upload a new map image (GM or Map Guy)                           |
| `/map view-full`               | View the full map (GM or Map Guy)                                |
| `/map upload-full`             | Upload a new full map image (GM or Map Guy)                      |

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
- **Tick locking**: If a tick is triggered while another is already running, the second is skipped to prevent double-crediting.
- **Tick freeze**: Ticks can be frozen (`/gm freeze-tick`) to pause automatic progression and unfrozen (`/gm unfreeze-tick`) to resume.
- **Status flags**: Nations can have status effects (At War, In Recession, Golden Age, Blockaded, In Civil War, Prosperous, Custom) that apply production modifiers (e.g., blockade severity escalates each tick). Set via `/gm set-status`, removed via `/gm remove-status`.
- **Production modifiers**: Temporary multipliers applied to a nation's production for a set number of ticks. Multiple modifiers stack additively. Set via `/gm set-modifier`, removed via `/gm remove-modifier`. Modifiers cannot reduce production below zero.
- **Stockpile caps**: Per-nation, per-resource maximum stockpiles. Stockpiles are clamped to the cap during ticks. Set via `/gm set-cap`, removed via `/gm remove-cap`.
- **Tribute agreements**: Recurring resource transfers from one nation to another, processed each tick. Managed via `/gm2 add-tribute` and `/gm2 remove-tribute`.
- **Sanctions**: Prevent a sanctioned nation from receiving transfers or trades. Managed via `/gm2 add-sanction` and `/gm2 remove-sanction`.
- **Alliances**: Formal bilateral agreements between nations. Proposed (`/diplomacy propose-alliance`) and dissolved (`/diplomacy dissolve-alliance`) by the proposing nation.
- **Trade proposals**: Player-to-player resource exchange proposals with expiration. Flow: propose → accept/reject. Managed via `/trade`.
- **Galactic market**: Public buy/sell offers for resources priced in another resource. Flow: post → fill. Managed via `/market`.
- **Bulk adjustment**: `/gm bulk-adjust` applies a resource delta to all nations at once (e.g., galaxy-wide events).
- **Audit log**: All GM actions, trades, tick events, and system changes are logged. Queryable via `/gm audit`.
- **Season reset**: `/gm2 new-season` archives the current game state and wipes all data to start a new season at a configurable starting year.

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
  commands/         Slash command handlers (nation, resource, resources, gm, gm2,
                    diplomacy, trade, market, map)
  context-menus/    User context menu handlers
  db/schema.ts      SQLite schema, init, and all query functions
  utils/
    embeds.ts       Discord embed builder for resource sheets
    permissions.ts  GM / Map Guy permission checks
    scheduler.ts    Cron-based tick scheduler with tick locking and freeze
  types.ts          Resource types, status flags, and game constants
  index.ts          Bot entrypoint
  deploy-commands.ts  One-shot command registration script
tests/
  schema.test.ts    DB layer unit tests
  scheduler.test.ts Scheduler / tick logic unit tests
  features.test.ts  Integration tests for all gameplay systems
```
