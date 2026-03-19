import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  RESOURCE_TYPES,
  RESEARCH_TYPES,
  DEFAULT_PRODUCTION,
  DEFAULT_STOCKPILE,
  AuditAction,
  StatusFlag,
  STATUS_META,
} from '../types';

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'starlight.db');

// Lazily created so that deploy-commands.ts (which never calls initDb) doesn't
// fail when the data/ directory doesn't exist yet.
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialised. Call initDb() first.');
  }
  return _db;
}

export function initDb(): void {
  // Ensure the directory exists before opening the file.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  _db = new Database(dbPath);

  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS game_state (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      current_year INTEGER NOT NULL DEFAULT 2300
    );

    INSERT OR IGNORE INTO game_state (id, current_year) VALUES (1, 2300);

    CREATE TABLE IF NOT EXISTS nations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT    NOT NULL UNIQUE,
      name            TEXT    NOT NULL UNIQUE,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS resources (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id     INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      resource_type TEXT    NOT NULL,
      stockpile     REAL    NOT NULL DEFAULT 0,
      production    REAL    NOT NULL DEFAULT 0,
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (nation_id, resource_type)
    );

    -- Nation status flags (At War, Golden Age, etc.)
    CREATE TABLE IF NOT EXISTS nation_statuses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id  INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      status     TEXT    NOT NULL,
      label      TEXT    NOT NULL,
      applied_at TEXT    NOT NULL DEFAULT (datetime('now')),
      metadata   TEXT,   -- JSON data for additional config (e.g., blockade direction: 'incoming', 'outgoing', 'both')
      UNIQUE (nation_id, status)
    );

    -- Production multipliers (tick-expiring)
    CREATE TABLE IF NOT EXISTS production_modifiers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id       INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      resource_type   TEXT,           -- NULL means all non-research resources
      multiplier      REAL    NOT NULL,
      label           TEXT    NOT NULL,
      ticks_remaining INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Alliances between nations
    CREATE TABLE IF NOT EXISTS alliances (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_a_id INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      nation_b_id INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      formed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (nation_a_id, nation_b_id)
    );

    -- Sanctions (nation_a imposes sanction on nation_b)
    CREATE TABLE IF NOT EXISTS sanctions (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      target_nation_id     INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      imposed_by_nation_id INTEGER REFERENCES nations(id) ON DELETE SET NULL,
      reason               TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tribute agreements (payer sends X of resource_type to receiver each tick)
    CREATE TABLE IF NOT EXISTS tribute_agreements (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      payer_nation_id    INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      receiver_nation_id INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      resource_type      TEXT    NOT NULL,
      amount_per_tick    REAL    NOT NULL,
      label              TEXT,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Stockpile caps per nation per resource
    CREATE TABLE IF NOT EXISTS stockpile_caps (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id     INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      resource_type TEXT    NOT NULL,
      cap           REAL    NOT NULL,
      UNIQUE (nation_id, resource_type)
    );

    -- Player-to-player trade proposals
    CREATE TABLE IF NOT EXISTS trade_proposals (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      proposer_nation_id  INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      target_nation_id    INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      offer_type          TEXT    NOT NULL,
      offer_amount        REAL    NOT NULL,
      request_type        TEXT    NOT NULL,
      request_amount      REAL    NOT NULL,
      status              TEXT    NOT NULL DEFAULT 'pending',
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      expires_at          TEXT    NOT NULL
    );

    -- Public market offers
    CREATE TABLE IF NOT EXISTS market_offers (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id           INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      offer_type          TEXT    NOT NULL, -- 'sell' or 'buy'
      resource_type       TEXT    NOT NULL,
      amount              REAL    NOT NULL,
      price_per_unit      REAL    NOT NULL,
      price_resource_type TEXT    NOT NULL,
      status              TEXT    NOT NULL DEFAULT 'open',
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Full audit log
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id  INTEGER REFERENCES nations(id) ON DELETE SET NULL,
      action     TEXT    NOT NULL,
      actor      TEXT    NOT NULL,
      details    TEXT    NOT NULL DEFAULT '{}',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  
  // Run migrations for existing databases
  runMigrations();
}

function runMigrations(): void {
  const db = getDb();
  
  // Check if metadata column exists in nation_statuses
  const tableInfo = db.prepare(`PRAGMA table_info(nation_statuses)`).all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: any;
    pk: number;
  }>;
  
  const hasMetadata = tableInfo.some(col => col.name === 'metadata');
  
  if (!hasMetadata) {
    console.log('🔄 Running migration: Adding metadata column to nation_statuses...');
    db.exec(`ALTER TABLE nation_statuses ADD COLUMN metadata TEXT`);
    console.log('✅ Migration complete: metadata column added');
  }
}

// ── Game state ────────────────────────────────────────────────────────────────

export function getCurrentYear(): number {
  const row = getDb().prepare('SELECT current_year FROM game_state WHERE id = 1').get() as
    | { current_year: number }
    | undefined;
  return row?.current_year ?? 2300;
}

export function advanceYear(years: number): number {
  getDb().prepare('UPDATE game_state SET current_year = current_year + ? WHERE id = 1').run(years);
  return getCurrentYear();
}

// ── Nations ───────────────────────────────────────────────────────────────────

export function createNation(discordUserId: string, name: string): number {
  const db = getDb();
  const info = db
    .prepare('INSERT INTO nations (discord_user_id, name) VALUES (?, ?)')
    .run(discordUserId, name);

  const nationId = info.lastInsertRowid as number;

  // Seed all resource rows with default starting values
  const insertResource = db.prepare(`
    INSERT OR IGNORE INTO resources (nation_id, resource_type, stockpile, production)
    VALUES (?, ?, ?, ?)
  `);
  const seedAll = db.transaction(() => {
    for (const type of RESOURCE_TYPES) {
      insertResource.run(nationId, type, DEFAULT_STOCKPILE[type], DEFAULT_PRODUCTION[type]);
    }
  });
  seedAll();

  return nationId;
}

export function getNationByUserId(discordUserId: string) {
  return getDb()
    .prepare('SELECT * FROM nations WHERE discord_user_id = ?')
    .get(discordUserId) as { id: number; discord_user_id: string; name: string; created_at: string } | undefined;
}

export function getNationById(nationId: number) {
  return getDb()
    .prepare('SELECT * FROM nations WHERE id = ?')
    .get(nationId) as { id: number; discord_user_id: string; name: string; created_at: string } | undefined;
}

export function getAllNations() {
  return getDb().prepare('SELECT * FROM nations ORDER BY name').all() as {
    id: number;
    discord_user_id: string;
    name: string;
    created_at: string;
  }[];
}

// ── Resources ─────────────────────────────────────────────────────────────────

export function getResources(nationId: number) {
  return getDb()
    .prepare('SELECT * FROM resources WHERE nation_id = ? ORDER BY resource_type')
    .all(nationId) as {
      id: number;
      nation_id: number;
      resource_type: string;
      stockpile: number;
      production: number;
      updated_at: string;
    }[];
}

export function setResourceField(
  nationId: number,
  resourceType: string,
  field: 'stockpile' | 'production',
  value: number,
): void {
  getDb().prepare(`
    UPDATE resources
    SET ${field} = ?, updated_at = datetime('now')
    WHERE nation_id = ? AND resource_type = ?
  `).run(value, nationId, resourceType);
}

export function addToStockpile(nationId: number, resourceType: string, delta: number): void {
  getDb().prepare(`
    UPDATE resources
    SET stockpile = stockpile + ?, updated_at = datetime('now')
    WHERE nation_id = ? AND resource_type = ?
  `).run(delta, nationId, resourceType);
}

/** Bulk-adjust a single resource type across ALL nations. */
export function bulkAdjustResource(resourceType: string, delta: number): number {
  const result = getDb().prepare(`
    UPDATE resources
    SET stockpile = MAX(0, stockpile + ?), updated_at = datetime('now')
    WHERE resource_type = ?
  `).run(delta, resourceType);
  return result.changes;
}

/** Apply one tick: add production × months to stockpile for every nation, respecting modifiers and caps.
 *  Research resources (physics, society, engineering) are excluded — their production rate is
 *  meaningful but their stockpile is intentionally kept at zero (spent-as-produced). */
export function applyTick(): void {
  const MONTHS_PER_TICK = 25 * 12; // 300
  const db = getDb();
  const placeholders = RESEARCH_TYPES.map(() => '?').join(', ');

  const nations = getAllNations();

  const tick = db.transaction(() => {
    for (const nation of nations) {
      const resources = db.prepare(`
        SELECT * FROM resources WHERE nation_id = ? AND resource_type NOT IN (${placeholders})
      `).all(nation.id, ...RESEARCH_TYPES) as { resource_type: string; stockpile: number; production: number }[];

      const modifiers = db.prepare(`
        SELECT * FROM production_modifiers WHERE nation_id = ? AND ticks_remaining > 0
      `).all(nation.id) as { resource_type: string | null; multiplier: number }[];

      // Get status flags for this nation
      const statuses = db.prepare(`
        SELECT status, applied_at, metadata FROM nation_statuses WHERE nation_id = ?
      `).all(nation.id) as { status: StatusFlag; applied_at: string; metadata: string | null }[];

      for (const res of resources) {
        // Sum all applicable multipliers additively (1.0 base + all bonuses/penalties)
        let totalMultiplier = 1.0;
        
        // Apply temporary production modifiers from production_modifiers table
        for (const mod of modifiers) {
          if (mod.resource_type === null || mod.resource_type === res.resource_type) {
            totalMultiplier += (mod.multiplier - 1.0);
          }
        }
        
        // Apply status flag production modifiers (stacking)
        for (const statusRow of statuses) {
          const statusFlag = statusRow.status as StatusFlag;
          
          // Special handling for blockade - use time-based severity
          if (statusFlag === 'blockaded') {
            const severity = getBlockadeSeverity(nation.id);
            totalMultiplier += severity; // severity is already negative
          } else if (STATUS_META[statusFlag]) {
            // All other status flags use their static modifier
            totalMultiplier += STATUS_META[statusFlag].productionModifier;
          }
        }
        
        // Clamp to minimum of 0 (production can't go negative)
        totalMultiplier = Math.max(0, totalMultiplier);

        const gain = res.production * MONTHS_PER_TICK * totalMultiplier;

        // Check for stockpile cap
        const capRow = db.prepare(`
          SELECT cap FROM stockpile_caps WHERE nation_id = ? AND resource_type = ?
        `).get(nation.id, res.resource_type) as { cap: number } | undefined;

        if (capRow) {
          db.prepare(`
            UPDATE resources
            SET stockpile = MIN(?, stockpile + ?), updated_at = datetime('now')
            WHERE nation_id = ? AND resource_type = ?
          `).run(capRow.cap, gain, nation.id, res.resource_type);
        } else {
          db.prepare(`
            UPDATE resources
            SET stockpile = stockpile + ?, updated_at = datetime('now')
            WHERE nation_id = ? AND resource_type = ?
          `).run(gain, nation.id, res.resource_type);
        }
      }
    }

    // Decrement ticks_remaining and remove expired modifiers
    db.prepare(`
      UPDATE production_modifiers SET ticks_remaining = ticks_remaining - 1
      WHERE ticks_remaining > 0
    `).run();
    db.prepare(`DELETE FROM production_modifiers WHERE ticks_remaining <= 0`).run();

    // Apply tribute agreements
    // NOTE: Tributes are processed regardless of blockade status - they represent
    // treaty obligations that continue even when a nation is blockaded
    const tributes = db.prepare(`SELECT * FROM tribute_agreements`).all() as {
      payer_nation_id: number;
      receiver_nation_id: number;
      resource_type: string;
      amount_per_tick: number;
    }[];

    for (const tribute of tributes) {
      // Check payer has enough stockpile (allow going into debt)
      db.prepare(`
        UPDATE resources
        SET stockpile = stockpile - ?, updated_at = datetime('now')
        WHERE nation_id = ? AND resource_type = ?
      `).run(tribute.amount_per_tick, tribute.payer_nation_id, tribute.resource_type);
      db.prepare(`
        UPDATE resources
        SET stockpile = stockpile + ?, updated_at = datetime('now')
        WHERE nation_id = ? AND resource_type = ?
      `).run(tribute.amount_per_tick, tribute.receiver_nation_id, tribute.resource_type);
    }
  });

  tick();
}

// ── GM helpers ────────────────────────────────────────────────────────────────

export function deleteNation(nationId: number): void {
  // Resources cascade-delete via FK
  getDb().prepare('DELETE FROM nations WHERE id = ?').run(nationId);
}

export function renameNation(nationId: number, newName: string): void {
  getDb()
    .prepare("UPDATE nations SET name = ? WHERE id = ?")
    .run(newName, nationId);
}

export function resetStockpiles(nationId: number): void {
  getDb()
    .prepare("UPDATE resources SET stockpile = 0, updated_at = datetime('now') WHERE nation_id = ?")
    .run(nationId);
}

export function setYear(year: number): void {
  getDb().prepare('UPDATE game_state SET current_year = ? WHERE id = 1').run(year);
}

export function transferResource(
  fromNationId: number,
  toNationId: number,
  resourceType: string,
  amount: number,
): void {
  const db = getDb();
  const transfer = db.transaction(() => {
    db.prepare(`
      UPDATE resources SET stockpile = stockpile - ?, updated_at = datetime('now')
      WHERE nation_id = ? AND resource_type = ?
    `).run(amount, fromNationId, resourceType);
    db.prepare(`
      UPDATE resources SET stockpile = stockpile + ?, updated_at = datetime('now')
      WHERE nation_id = ? AND resource_type = ?
    `).run(amount, toNationId, resourceType);
  });
  transfer();
}

/** Apply default starting production and stockpile to every nation that still has all-zero values. */
export function applyDefaultsToAllNations(): number {
  const db = getDb();
  const nations = getAllNations();
  let patched = 0;

  const update = db.transaction((nationId: number) => {
    for (const type of RESOURCE_TYPES) {
      db.prepare(`
        UPDATE resources
        SET production = ?,
            stockpile  = CASE WHEN stockpile = 0 THEN ? ELSE stockpile END,
            updated_at = datetime('now')
        WHERE nation_id = ? AND resource_type = ? AND production = 0
      `).run(DEFAULT_PRODUCTION[type], DEFAULT_STOCKPILE[type], nationId, type);
    }
  });

  for (const nation of nations) {
    const changed = db.prepare(`
      SELECT COUNT(*) as cnt FROM resources
      WHERE nation_id = ? AND production = 0
    `).get(nation.id) as { cnt: number };

    if (changed.cnt > 0) {
      update(nation.id);
      patched++;
    }
  }

  return patched;
}

// ── Nation Statuses ───────────────────────────────────────────────────────────

export function setNationStatus(nationId: number, status: StatusFlag, label: string, metadata?: Record<string, any>): void {
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  getDb().prepare(`
    INSERT INTO nation_statuses (nation_id, status, label, metadata)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(nation_id, status) DO UPDATE SET label = excluded.label, metadata = excluded.metadata, applied_at = datetime('now')
  `).run(nationId, status, label, metadataJson);
}

export function removeNationStatus(nationId: number, status: StatusFlag): boolean {
  const result = getDb().prepare(`
    DELETE FROM nation_statuses WHERE nation_id = ? AND status = ?
  `).run(nationId, status);
  return result.changes > 0;
}

export function getNationStatuses(nationId: number) {
  return getDb().prepare(`
    SELECT * FROM nation_statuses WHERE nation_id = ? ORDER BY applied_at DESC
  `).all(nationId) as { id: number; nation_id: number; status: string; label: string; applied_at: string }[];
}

// ── Production Modifiers ──────────────────────────────────────────────────────

export function addProductionModifier(
  nationId: number,
  multiplier: number,
  label: string,
  ticksRemaining: number,
  resourceType?: string,
): number {
  const result = getDb().prepare(`
    INSERT INTO production_modifiers (nation_id, resource_type, multiplier, label, ticks_remaining)
    VALUES (?, ?, ?, ?, ?)
  `).run(nationId, resourceType ?? null, multiplier, label, ticksRemaining);
  return result.lastInsertRowid as number;
}

export function getProductionModifiers(nationId: number) {
  return getDb().prepare(`
    SELECT * FROM production_modifiers WHERE nation_id = ? AND ticks_remaining > 0 ORDER BY created_at
  `).all(nationId) as {
    id: number;
    nation_id: number;
    resource_type: string | null;
    multiplier: number;
    label: string;
    ticks_remaining: number;
    created_at: string;
  }[];
}

export function removeProductionModifier(modifierId: number): boolean {
  const result = getDb().prepare(`DELETE FROM production_modifiers WHERE id = ?`).run(modifierId);
  return result.changes > 0;
}

// ── Alliances ─────────────────────────────────────────────────────────────────

/** Returns the normalised pair (smaller id first) to prevent duplicates. */
function normaliseAlliancePair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

export function createAlliance(nationAId: number, nationBId: number): void {
  const [a, b] = normaliseAlliancePair(nationAId, nationBId);
  getDb().prepare(`
    INSERT INTO alliances (nation_a_id, nation_b_id) VALUES (?, ?)
  `).run(a, b);
}

export function getAlliancesForNation(nationId: number) {
  return getDb().prepare(`
    SELECT * FROM alliances WHERE nation_a_id = ? OR nation_b_id = ?
  `).all(nationId, nationId) as {
    id: number;
    nation_a_id: number;
    nation_b_id: number;
    formed_at: string;
  }[];
}

export function getAllAlliances() {
  return getDb().prepare(`SELECT * FROM alliances ORDER BY formed_at`).all() as {
    id: number;
    nation_a_id: number;
    nation_b_id: number;
    formed_at: string;
  }[];
}

export function dissolveAlliance(nationAId: number, nationBId: number): boolean {
  const [a, b] = normaliseAlliancePair(nationAId, nationBId);
  const result = getDb().prepare(`
    DELETE FROM alliances WHERE nation_a_id = ? AND nation_b_id = ?
  `).run(a, b);
  return result.changes > 0;
}

export function areAllied(nationAId: number, nationBId: number): boolean {
  const [a, b] = normaliseAlliancePair(nationAId, nationBId);
  const row = getDb().prepare(`
    SELECT id FROM alliances WHERE nation_a_id = ? AND nation_b_id = ?
  `).get(a, b);
  return !!row;
}

// ── Sanctions ─────────────────────────────────────────────────────────────────

export function addSanction(targetNationId: number, imposedByNationId: number | null, reason: string | null): number {
  const result = getDb().prepare(`
    INSERT INTO sanctions (target_nation_id, imposed_by_nation_id, reason) VALUES (?, ?, ?)
  `).run(targetNationId, imposedByNationId, reason);
  return result.lastInsertRowid as number;
}

export function getSanctionsAgainst(nationId: number) {
  return getDb().prepare(`
    SELECT * FROM sanctions WHERE target_nation_id = ? ORDER BY created_at DESC
  `).all(nationId) as {
    id: number;
    target_nation_id: number;
    imposed_by_nation_id: number | null;
    reason: string | null;
    created_at: string;
  }[];
}

export function getAllSanctions() {
  return getDb().prepare(`SELECT * FROM sanctions ORDER BY created_at DESC`).all() as {
    id: number;
    target_nation_id: number;
    imposed_by_nation_id: number | null;
    reason: string | null;
    created_at: string;
  }[];
}

export function removeSanction(sanctionId: number): boolean {
  const result = getDb().prepare(`DELETE FROM sanctions WHERE id = ?`).run(sanctionId);
  return result.changes > 0;
}

export function isSanctioned(nationId: number): boolean {
  const row = getDb().prepare(`
    SELECT id FROM sanctions WHERE target_nation_id = ? LIMIT 1
  `).get(nationId);
  return !!row;
}

// ── Blockade Helpers ──────────────────────────────────────────────────────────

export function isBlockaded(nationId: number): boolean {
  const row = getDb().prepare(`
    SELECT id FROM nation_statuses WHERE nation_id = ? AND status = 'blockaded' LIMIT 1
  `).get(nationId);
  return !!row;
}

export type BlockadeDirection = 'incoming' | 'outgoing' | 'both';

export function getBlockadeInfo(nationId: number): { direction: BlockadeDirection; appliedAt: string } | null {
  const row = getDb().prepare(`
    SELECT applied_at, metadata FROM nation_statuses 
    WHERE nation_id = ? AND status = 'blockaded'
  `).get(nationId) as { applied_at: string; metadata: string | null } | undefined;
  
  if (!row) return null;
  
  let direction: BlockadeDirection = 'both'; // default
  if (row.metadata) {
    try {
      const parsed = JSON.parse(row.metadata);
      if (parsed.direction && ['incoming', 'outgoing', 'both'].includes(parsed.direction)) {
        direction = parsed.direction;
      }
    } catch {
      // Invalid JSON, use default
    }
  }
  
  return { direction, appliedAt: row.applied_at };
}

export function getBlockadeSeverity(nationId: number): number {
  const info = getBlockadeInfo(nationId);
  if (!info) return 0;
  
  const appliedDate = new Date(info.appliedAt);
  const now = new Date();
  const msElapsed = now.getTime() - appliedDate.getTime();
  const daysElapsed = Math.floor(msElapsed / (1000 * 60 * 60 * 24));
  const weeksElapsed = Math.floor(daysElapsed / 7);
  
  // Escalating penalties over time
  if (weeksElapsed < 4) return -0.10;      // -10% weeks 0-3
  if (weeksElapsed < 8) return -0.15;      // -15% weeks 4-7
  if (weeksElapsed < 12) return -0.20;     // -20% weeks 8-11
  return -0.25;                             // -25% week 12+
}

export function getBlockadeWeeksUntilNextTier(nationId: number): number | null {
  const info = getBlockadeInfo(nationId);
  if (!info) return null;
  
  const appliedDate = new Date(info.appliedAt);
  const now = new Date();
  const msElapsed = now.getTime() - appliedDate.getTime();
  const daysElapsed = Math.floor(msElapsed / (1000 * 60 * 60 * 24));
  const weeksElapsed = Math.floor(daysElapsed / 7);
  
  // Calculate weeks until next tier
  if (weeksElapsed < 4) return 4 - weeksElapsed;   // Until -15%
  if (weeksElapsed < 8) return 8 - weeksElapsed;   // Until -20%
  if (weeksElapsed < 12) return 12 - weeksElapsed; // Until -25%
  return null; // Already at max penalty
}

// ── Tribute Agreements ────────────────────────────────────────────────────────

export function createTribute(
  payerNationId: number,
  receiverNationId: number,
  resourceType: string,
  amountPerTick: number,
  label: string | null,
): number {
  const result = getDb().prepare(`
    INSERT INTO tribute_agreements (payer_nation_id, receiver_nation_id, resource_type, amount_per_tick, label)
    VALUES (?, ?, ?, ?, ?)
  `).run(payerNationId, receiverNationId, resourceType, amountPerTick, label);
  return result.lastInsertRowid as number;
}

export function getTributes() {
  return getDb().prepare(`SELECT * FROM tribute_agreements ORDER BY created_at`).all() as {
    id: number;
    payer_nation_id: number;
    receiver_nation_id: number;
    resource_type: string;
    amount_per_tick: number;
    label: string | null;
    created_at: string;
  }[];
}

export function getTributesForNation(nationId: number) {
  return getDb().prepare(`
    SELECT * FROM tribute_agreements WHERE payer_nation_id = ? OR receiver_nation_id = ?
    ORDER BY created_at
  `).all(nationId, nationId) as {
    id: number;
    payer_nation_id: number;
    receiver_nation_id: number;
    resource_type: string;
    amount_per_tick: number;
    label: string | null;
    created_at: string;
  }[];
}

export function removeTribute(tributeId: number): boolean {
  const result = getDb().prepare(`DELETE FROM tribute_agreements WHERE id = ?`).run(tributeId);
  return result.changes > 0;
}

// ── Stockpile Caps ────────────────────────────────────────────────────────────

export function setStockpileCap(nationId: number, resourceType: string, cap: number): void {
  getDb().prepare(`
    INSERT INTO stockpile_caps (nation_id, resource_type, cap)
    VALUES (?, ?, ?)
    ON CONFLICT(nation_id, resource_type) DO UPDATE SET cap = excluded.cap
  `).run(nationId, resourceType, cap);
}

export function removeStockpileCap(nationId: number, resourceType: string): boolean {
  const result = getDb().prepare(`
    DELETE FROM stockpile_caps WHERE nation_id = ? AND resource_type = ?
  `).run(nationId, resourceType);
  return result.changes > 0;
}

export function getStockpileCaps(nationId: number) {
  return getDb().prepare(`
    SELECT * FROM stockpile_caps WHERE nation_id = ?
  `).all(nationId) as { id: number; nation_id: number; resource_type: string; cap: number }[];
}

// ── Trade Proposals ───────────────────────────────────────────────────────────

const TRADE_TTL_HOURS = 24;

export function createTradeProposal(
  proposerNationId: number,
  targetNationId: number,
  offerType: string,
  offerAmount: number,
  requestType: string,
  requestAmount: number,
): number {
  const result = getDb().prepare(`
    INSERT INTO trade_proposals
      (proposer_nation_id, target_nation_id, offer_type, offer_amount, request_type, request_amount, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${TRADE_TTL_HOURS} hours'))
  `).run(proposerNationId, targetNationId, offerType, offerAmount, requestType, requestAmount);
  return result.lastInsertRowid as number;
}

export function getTradeProposal(tradeId: number) {
  return getDb().prepare(`SELECT * FROM trade_proposals WHERE id = ?`).get(tradeId) as {
    id: number;
    proposer_nation_id: number;
    target_nation_id: number;
    offer_type: string;
    offer_amount: number;
    request_type: string;
    request_amount: number;
    status: string;
    created_at: string;
    expires_at: string;
  } | undefined;
}

export function getPendingTradesForNation(nationId: number) {
  return getDb().prepare(`
    SELECT * FROM trade_proposals
    WHERE (proposer_nation_id = ? OR target_nation_id = ?)
      AND status = 'pending'
      AND expires_at > datetime('now')
    ORDER BY created_at DESC
  `).all(nationId, nationId) as {
    id: number;
    proposer_nation_id: number;
    target_nation_id: number;
    offer_type: string;
    offer_amount: number;
    request_type: string;
    request_amount: number;
    status: string;
    created_at: string;
    expires_at: string;
  }[];
}

export function setTradeStatus(tradeId: number, status: 'accepted' | 'rejected' | 'cancelled' | 'expired'): void {
  getDb().prepare(`UPDATE trade_proposals SET status = ? WHERE id = ?`).run(status, tradeId);
}

/** Execute an accepted trade atomically. Returns false if either side lacks funds. */
export function executeTrade(tradeId: number): boolean {
  const db = getDb();
  const trade = getTradeProposal(tradeId);
  if (!trade || trade.status !== 'pending') return false;

  // Expire stale
  if (new Date(trade.expires_at) <= new Date()) {
    setTradeStatus(tradeId, 'expired');
    return false;
  }

  const proposerStock = db.prepare(`
    SELECT stockpile FROM resources WHERE nation_id = ? AND resource_type = ?
  `).get(trade.proposer_nation_id, trade.offer_type) as { stockpile: number } | undefined;

  const targetStock = db.prepare(`
    SELECT stockpile FROM resources WHERE nation_id = ? AND resource_type = ?
  `).get(trade.target_nation_id, trade.request_type) as { stockpile: number } | undefined;

  if (!proposerStock || proposerStock.stockpile < trade.offer_amount) return false;
  if (!targetStock || targetStock.stockpile < trade.request_amount) return false;

  const doTrade = db.transaction(() => {
    // Proposer gives offer, receives request
    db.prepare(`UPDATE resources SET stockpile = stockpile - ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
      .run(trade.offer_amount, trade.proposer_nation_id, trade.offer_type);
    db.prepare(`UPDATE resources SET stockpile = stockpile + ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
      .run(trade.request_amount, trade.proposer_nation_id, trade.request_type);
    // Target gives request, receives offer
    db.prepare(`UPDATE resources SET stockpile = stockpile - ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
      .run(trade.request_amount, trade.target_nation_id, trade.request_type);
    db.prepare(`UPDATE resources SET stockpile = stockpile + ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
      .run(trade.offer_amount, trade.target_nation_id, trade.offer_type);
    db.prepare(`UPDATE trade_proposals SET status = 'accepted' WHERE id = ?`).run(tradeId);
  });

  doTrade();
  return true;
}

/** Expire all pending trades whose expires_at has passed. */
export function expireOldTrades(): number {
  const result = getDb().prepare(`
    UPDATE trade_proposals SET status = 'expired'
    WHERE status = 'pending' AND expires_at <= datetime('now')
  `).run();
  return result.changes;
}

// ── Market Offers ─────────────────────────────────────────────────────────────

export function createMarketOffer(
  nationId: number,
  offerType: 'sell' | 'buy',
  resourceType: string,
  amount: number,
  pricePerUnit: number,
  priceResourceType: string,
): number {
  const result = getDb().prepare(`
    INSERT INTO market_offers (nation_id, offer_type, resource_type, amount, price_per_unit, price_resource_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(nationId, offerType, resourceType, amount, pricePerUnit, priceResourceType);
  return result.lastInsertRowid as number;
}

export function getOpenMarketOffers() {
  return getDb().prepare(`
    SELECT * FROM market_offers WHERE status = 'open' ORDER BY created_at DESC
  `).all() as {
    id: number;
    nation_id: number;
    offer_type: string;
    resource_type: string;
    amount: number;
    price_per_unit: number;
    price_resource_type: string;
    status: string;
    created_at: string;
  }[];
}

export function getMarketOffer(offerId: number) {
  return getDb().prepare(`SELECT * FROM market_offers WHERE id = ?`).get(offerId) as {
    id: number;
    nation_id: number;
    offer_type: string;
    resource_type: string;
    amount: number;
    price_per_unit: number;
    price_resource_type: string;
    status: string;
    created_at: string;
  } | undefined;
}

/** Fill a market offer. buyer fills a sell offer; seller fills a buy offer. Returns false if insufficient funds. */
export function fillMarketOffer(offerId: number, fillerNationId: number): boolean {
  const db = getDb();
  const offer = getMarketOffer(offerId);
  if (!offer || offer.status !== 'open') return false;
  if (offer.nation_id === fillerNationId) return false; // can't fill own offer

  const totalPrice = offer.price_per_unit * offer.amount;

  if (offer.offer_type === 'sell') {
    // Filler buys: filler pays price_resource, receives resource
    const fillerPriceStock = db.prepare(`
      SELECT stockpile FROM resources WHERE nation_id = ? AND resource_type = ?
    `).get(fillerNationId, offer.price_resource_type) as { stockpile: number } | undefined;
    if (!fillerPriceStock || fillerPriceStock.stockpile < totalPrice) return false;

    const doFill = db.transaction(() => {
      db.prepare(`UPDATE resources SET stockpile = stockpile - ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
        .run(totalPrice, fillerNationId, offer.price_resource_type);
      db.prepare(`UPDATE resources SET stockpile = stockpile + ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
        .run(offer.amount, fillerNationId, offer.resource_type);
      db.prepare(`UPDATE resources SET stockpile = stockpile + ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
        .run(totalPrice, offer.nation_id, offer.price_resource_type);
      db.prepare(`UPDATE market_offers SET status = 'filled' WHERE id = ?`).run(offerId);
    });
    doFill();
  } else {
    // Buy offer: filler sells resource, receives price_resource
    const fillerResourceStock = db.prepare(`
      SELECT stockpile FROM resources WHERE nation_id = ? AND resource_type = ?
    `).get(fillerNationId, offer.resource_type) as { stockpile: number } | undefined;
    if (!fillerResourceStock || fillerResourceStock.stockpile < offer.amount) return false;

    const doFill = db.transaction(() => {
      db.prepare(`UPDATE resources SET stockpile = stockpile - ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
        .run(offer.amount, fillerNationId, offer.resource_type);
      db.prepare(`UPDATE resources SET stockpile = stockpile + ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
        .run(totalPrice, fillerNationId, offer.price_resource_type);
      db.prepare(`UPDATE resources SET stockpile = stockpile + ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?`)
        .run(offer.amount, offer.nation_id, offer.resource_type);
      db.prepare(`UPDATE market_offers SET status = 'filled' WHERE id = ?`).run(offerId);
    });
    doFill();
  }

  return true;
}

export function cancelMarketOffer(offerId: number): boolean {
  const result = getDb().prepare(`
    UPDATE market_offers SET status = 'cancelled' WHERE id = ? AND status = 'open'
  `).run(offerId);
  return result.changes > 0;
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

export function logAuditEvent(
  action: AuditAction,
  actor: string,
  details: Record<string, unknown>,
  nationId?: number,
): void {
  getDb().prepare(`
    INSERT INTO audit_log (nation_id, action, actor, details)
    VALUES (?, ?, ?, ?)
  `).run(nationId ?? null, action, actor, JSON.stringify(details));
}

export function getAuditLog(nationId?: number, limit = 50) {
  if (nationId !== undefined) {
    return getDb().prepare(`
      SELECT * FROM audit_log WHERE nation_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(nationId, limit) as {
      id: number;
      nation_id: number | null;
      action: string;
      actor: string;
      details: string;
      created_at: string;
    }[];
  }
  return getDb().prepare(`
    SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?
  `).all(limit) as {
    id: number;
    nation_id: number | null;
    action: string;
    actor: string;
    details: string;
    created_at: string;
  }[];
}

// ── Season / Reset ────────────────────────────────────────────────────────────

/** Build a full JSON snapshot of the current game state. */
export function buildGameSnapshot(): Record<string, unknown> {
  const db = getDb();
  const year = getCurrentYear();
  const nations = getAllNations();

  const snapshot = {
    exported_at: new Date().toISOString(),
    current_year: year,
    nations: nations.map((n) => ({
      ...n,
      resources: getResources(n.id),
      statuses: getNationStatuses(n.id),
      modifiers: getProductionModifiers(n.id),
      caps: getStockpileCaps(n.id),
    })),
    alliances: getAllAlliances(),
    sanctions: getAllSanctions(),
    tributes: getTributes(),
  };

  return snapshot;
}

/** Write the snapshot to a JSON file and return the file path. */
export function archiveSeason(seasonLabel: string): string {
  const snapshot = buildGameSnapshot();
  const safeLabel = seasonLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `season_${safeLabel}_${timestamp}.json`;
  const filePath = path.join(path.dirname(dbPath), fileName);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return filePath;
}

/** Wipe all gameplay data and reset the year. Nations table is cleared; all related data cascades. */
export function resetForNewSeason(startYear = 2300): void {
  const db = getDb();
  const reset = db.transaction(() => {
    db.prepare(`DELETE FROM audit_log`).run();
    db.prepare(`DELETE FROM market_offers`).run();
    db.prepare(`DELETE FROM trade_proposals`).run();
    db.prepare(`DELETE FROM tribute_agreements`).run();
    db.prepare(`DELETE FROM sanctions`).run();
    db.prepare(`DELETE FROM alliances`).run();
    db.prepare(`DELETE FROM production_modifiers`).run();
    db.prepare(`DELETE FROM nation_statuses`).run();
    db.prepare(`DELETE FROM stockpile_caps`).run();
    // Resources + nations (cascade)
    db.prepare(`DELETE FROM resources`).run();
    db.prepare(`DELETE FROM nations`).run();
    db.prepare(`UPDATE game_state SET current_year = ? WHERE id = 1`).run(startYear);
  });
  reset();
}
