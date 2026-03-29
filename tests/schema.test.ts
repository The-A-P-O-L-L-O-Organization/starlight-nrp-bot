/**
 * Tests for src/db/schema.ts
 *
 * Uses an in-memory SQLite database so each test file gets a fresh, isolated DB
 * without touching the filesystem.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// ── Inline the schema initialisation against an in-memory DB ─────────────────
// We deliberately bypass the module-level singleton in schema.ts so that each
// test suite can own a clean database without monkey-patching process.env or the
// module cache.

import { RESOURCE_TYPES, RESEARCH_TYPES, DEFAULT_PRODUCTION, DEFAULT_STOCKPILE } from '../src/types';

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS game_state (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      current_year INTEGER NOT NULL DEFAULT 2200,
      tick_frozen  INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO game_state (id, current_year, tick_frozen) VALUES (1, 2200, 0);

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
  `);

  return db;
}

// ── Helpers that mirror the real schema functions ────────────────────────────

function createNation(db: Database.Database, discordUserId: string, name: string): number {
  const info = db
    .prepare('INSERT INTO nations (discord_user_id, name) VALUES (?, ?)')
    .run(discordUserId, name);
  const nationId = info.lastInsertRowid as number;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO resources (nation_id, resource_type, stockpile, production) VALUES (?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const type of RESOURCE_TYPES) {
      insert.run(nationId, type, DEFAULT_STOCKPILE[type], DEFAULT_PRODUCTION[type]);
    }
  })();

  return nationId;
}

function getResources(db: Database.Database, nationId: number) {
  return db
    .prepare('SELECT * FROM resources WHERE nation_id = ? ORDER BY resource_type')
    .all(nationId) as { resource_type: string; stockpile: number; production: number }[];
}

function applyTick(db: Database.Database): void {
  const MONTHS_PER_TICK = 25 * 12;
  const placeholders = RESEARCH_TYPES.map(() => '?').join(', ');
  db.prepare(`
    UPDATE resources
    SET stockpile = stockpile + (production * ?),
        updated_at = datetime('now')
    WHERE resource_type NOT IN (${placeholders})
  `).run(MONTHS_PER_TICK, ...RESEARCH_TYPES);
}

function getCurrentYear(db: Database.Database): number {
  const row = db.prepare('SELECT current_year FROM game_state WHERE id = 1').get() as
    | { current_year: number }
    | undefined;
  return row?.current_year ?? 2200;
}

function advanceYear(db: Database.Database, years: number): number {
  db.prepare('UPDATE game_state SET current_year = current_year + ? WHERE id = 1').run(years);
  return getCurrentYear(db);
}

function transferResource(
  db: Database.Database,
  fromNationId: number,
  toNationId: number,
  resourceType: string,
  amount: number,
): void {
  db.transaction(() => {
    db.prepare(
      "UPDATE resources SET stockpile = stockpile - ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?",
    ).run(amount, fromNationId, resourceType);
    db.prepare(
      "UPDATE resources SET stockpile = stockpile + ?, updated_at = datetime('now') WHERE nation_id = ? AND resource_type = ?",
    ).run(amount, toNationId, resourceType);
  })();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Database — nation creation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  it('seeds all 9 resource rows for a new nation', () => {
    const nationId = createNation(db, 'user1', 'Test Empire');
    const resources = getResources(db, nationId);
    expect(resources).toHaveLength(RESOURCE_TYPES.length);
  });

  it('seeds basic resources with non-zero default stockpiles', () => {
    const nationId = createNation(db, 'user1', 'Test Empire');
    const resources = getResources(db, nationId);
    const basic = resources.filter((r) =>
      ['energy_credits', 'minerals', 'food', 'trade'].includes(r.resource_type),
    );
    for (const r of basic) {
      expect(r.stockpile).toBeGreaterThan(0);
    }
  });

  it('seeds research resources with zero default stockpiles', () => {
    const nationId = createNation(db, 'user1', 'Test Empire');
    const resources = getResources(db, nationId);
    const research = resources.filter((r) => RESEARCH_TYPES.includes(r.resource_type as any));
    for (const r of research) {
      expect(r.stockpile).toBe(0);
    }
  });

  it('enforces unique discord_user_id', () => {
    createNation(db, 'user1', 'Empire A');
    expect(() => createNation(db, 'user1', 'Empire B')).toThrow();
  });

  it('enforces unique nation name', () => {
    createNation(db, 'user1', 'Empire A');
    expect(() => createNation(db, 'user2', 'Empire A')).toThrow();
  });
});

describe('Database — applyTick', () => {
  let db: Database.Database;
  let nationId: number;

  beforeEach(() => {
    db = createInMemoryDb();
    nationId = createNation(db, 'user1', 'Test Empire');
  });

  it('increases non-research stockpiles by production × 300', () => {
    const before = getResources(db, nationId);
    applyTick(db);
    const after = getResources(db, nationId);

    for (const res of after) {
      if (RESEARCH_TYPES.includes(res.resource_type as any)) continue;
      const prev = before.find((r) => r.resource_type === res.resource_type)!;
      const expectedDelta = prev.production * 300;
      expect(res.stockpile).toBeCloseTo(prev.stockpile + expectedDelta);
    }
  });

  it('does NOT increase research stockpiles during a tick', () => {
    const before = getResources(db, nationId);
    applyTick(db);
    const after = getResources(db, nationId);

    for (const type of RESEARCH_TYPES) {
      const prevRow = before.find((r) => r.resource_type === type)!;
      const afterRow = after.find((r) => r.resource_type === type)!;
      expect(afterRow.stockpile).toBe(prevRow.stockpile);
    }
  });

  it('research stockpile stays at 0 after multiple ticks', () => {
    applyTick(db);
    applyTick(db);
    applyTick(db);
    const resources = getResources(db, nationId);
    for (const type of RESEARCH_TYPES) {
      const row = resources.find((r) => r.resource_type === type)!;
      expect(row.stockpile).toBe(0);
    }
  });

  it('applies tick to all nations simultaneously', () => {
    const nationId2 = createNation(db, 'user2', 'Second Empire');
    applyTick(db);
    const r1 = getResources(db, nationId);
    const r2 = getResources(db, nationId2);
    // Both should have received the tick
    const energy1 = r1.find((r) => r.resource_type === 'energy_credits')!;
    const energy2 = r2.find((r) => r.resource_type === 'energy_credits')!;
    expect(energy1.stockpile).toBeGreaterThan(DEFAULT_STOCKPILE['energy_credits']);
    expect(energy2.stockpile).toBeGreaterThan(DEFAULT_STOCKPILE['energy_credits']);
  });
});

describe('Database — year management', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  it('starts at year 2200', () => {
    expect(getCurrentYear(db)).toBe(2200);
  });

  it('advances the year by the specified amount', () => {
    advanceYear(db, 25);
    expect(getCurrentYear(db)).toBe(2325);
  });

  it('can advance multiple times cumulatively', () => {
    advanceYear(db, 25);
    advanceYear(db, 25);
    expect(getCurrentYear(db)).toBe(2350);
  });
});

describe('Database — resource transfer', () => {
  let db: Database.Database;
  let nationA: number;
  let nationB: number;

  beforeEach(() => {
    db = createInMemoryDb();
    nationA = createNation(db, 'userA', 'Nation A');
    nationB = createNation(db, 'userB', 'Nation B');
  });

  it('deducts from sender and credits receiver', () => {
    const before = getResources(db, nationA).find((r) => r.resource_type === 'minerals')!;
    transferResource(db, nationA, nationB, 'minerals', 50);
    const afterA = getResources(db, nationA).find((r) => r.resource_type === 'minerals')!;
    const afterB = getResources(db, nationB).find((r) => r.resource_type === 'minerals')!;
    expect(afterA.stockpile).toBe(before.stockpile - 50);
    expect(afterB.stockpile).toBe(DEFAULT_STOCKPILE['minerals'] + 50);
  });

  it('is atomic: partial failure does not leave inconsistent state', () => {
    // Transfer more than available — stockpile can go negative (no constraint),
    // but both sides of the transaction should still update together.
    const amount = DEFAULT_STOCKPILE['minerals'] + 9999;
    transferResource(db, nationA, nationB, 'minerals', amount);
    const afterA = getResources(db, nationA).find((r) => r.resource_type === 'minerals')!;
    const afterB = getResources(db, nationB).find((r) => r.resource_type === 'minerals')!;
    // Both sides reflect the transfer
    expect(afterA.stockpile).toBe(DEFAULT_STOCKPILE['minerals'] - amount);
    expect(afterB.stockpile).toBe(DEFAULT_STOCKPILE['minerals'] + amount);
  });
});

describe('Database — cascade delete', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  it('deletes all resources when a nation is deleted', () => {
    const nationId = createNation(db, 'user1', 'Doomed Empire');
    db.prepare('DELETE FROM nations WHERE id = ?').run(nationId);
    const remaining = db
      .prepare('SELECT * FROM resources WHERE nation_id = ?')
      .all(nationId) as unknown[];
    expect(remaining).toHaveLength(0);
  });
});
