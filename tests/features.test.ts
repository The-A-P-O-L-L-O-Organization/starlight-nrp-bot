/**
 * Tests for new gameplay systems added in schema.ts
 *
 * Uses an in-memory SQLite database so each test suite gets a fresh, isolated DB.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { RESOURCE_TYPES, RESEARCH_TYPES, DEFAULT_PRODUCTION, DEFAULT_STOCKPILE } from '../src/types';

// ── Shared in-memory DB setup ─────────────────────────────────────────────────

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS game_state (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      current_year INTEGER NOT NULL DEFAULT 2200
    );
    INSERT OR IGNORE INTO game_state (id, current_year) VALUES (1, 2200);

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

    CREATE TABLE IF NOT EXISTS nation_statuses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id  INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      status     TEXT    NOT NULL,
      label      TEXT    NOT NULL,
      applied_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (nation_id, status)
    );

    CREATE TABLE IF NOT EXISTS production_modifiers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id       INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      resource_type   TEXT,
      multiplier      REAL    NOT NULL,
      label           TEXT    NOT NULL,
      ticks_remaining INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alliances (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_a_id INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      nation_b_id INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      formed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (nation_a_id, nation_b_id)
    );

    CREATE TABLE IF NOT EXISTS sanctions (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      target_nation_id     INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      imposed_by_nation_id INTEGER REFERENCES nations(id) ON DELETE SET NULL,
      reason               TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tribute_agreements (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      payer_nation_id    INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      receiver_nation_id INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      resource_type      TEXT    NOT NULL,
      amount_per_tick    REAL    NOT NULL,
      label              TEXT,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stockpile_caps (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id     INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      resource_type TEXT    NOT NULL,
      cap           REAL    NOT NULL,
      UNIQUE (nation_id, resource_type)
    );

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

    CREATE TABLE IF NOT EXISTS market_offers (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id           INTEGER NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
      offer_type          TEXT    NOT NULL,
      resource_type       TEXT    NOT NULL,
      amount              REAL    NOT NULL,
      price_per_unit      REAL    NOT NULL,
      price_resource_type TEXT    NOT NULL,
      status              TEXT    NOT NULL DEFAULT 'open',
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id  INTEGER REFERENCES nations(id) ON DELETE SET NULL,
      action     TEXT    NOT NULL,
      actor      TEXT    NOT NULL,
      details    TEXT    NOT NULL DEFAULT '{}',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function createNation(db: Database.Database, discordUserId: string, name: string): number {
  const info = db.prepare('INSERT INTO nations (discord_user_id, name) VALUES (?, ?)').run(discordUserId, name);
  const nationId = info.lastInsertRowid as number;
  const insert = db.prepare('INSERT OR IGNORE INTO resources (nation_id, resource_type, stockpile, production) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (const type of RESOURCE_TYPES) {
      insert.run(nationId, type, DEFAULT_STOCKPILE[type], DEFAULT_PRODUCTION[type]);
    }
  })();
  return nationId;
}

function getStockpile(db: Database.Database, nationId: number, type: string): number {
  const row = db.prepare('SELECT stockpile FROM resources WHERE nation_id = ? AND resource_type = ?').get(nationId, type) as { stockpile: number } | undefined;
  return row?.stockpile ?? 0;
}

function setStockpile(db: Database.Database, nationId: number, type: string, value: number): void {
  db.prepare("UPDATE resources SET stockpile = ? WHERE nation_id = ? AND resource_type = ?").run(value, nationId, type);
}

function setProduction(db: Database.Database, nationId: number, type: string, value: number): void {
  db.prepare("UPDATE resources SET production = ? WHERE nation_id = ? AND resource_type = ?").run(value, nationId, type);
}

/** Mirrors the real applyTick with modifier + cap support */
function applyTick(db: Database.Database): void {
  const MONTHS_PER_TICK = 300;
  const nations = db.prepare('SELECT id FROM nations').all() as { id: number }[];

  db.transaction(() => {
    for (const { id: nationId } of nations) {
      const resources = db.prepare(
        `SELECT * FROM resources WHERE nation_id = ? AND resource_type NOT IN (${RESEARCH_TYPES.map(() => '?').join(',')})`
      ).all(nationId, ...RESEARCH_TYPES) as { resource_type: string; stockpile: number; production: number }[];

      const modifiers = db.prepare(
        'SELECT * FROM production_modifiers WHERE nation_id = ? AND ticks_remaining > 0'
      ).all(nationId) as { resource_type: string | null; multiplier: number }[];

      for (const res of resources) {
        let totalMultiplier = 1.0;
        for (const mod of modifiers) {
          if (mod.resource_type === null || mod.resource_type === res.resource_type) {
            totalMultiplier += (mod.multiplier - 1.0);
          }
        }
        totalMultiplier = Math.max(0, totalMultiplier);
        const gain = res.production * MONTHS_PER_TICK * totalMultiplier;

        const capRow = db.prepare('SELECT cap FROM stockpile_caps WHERE nation_id = ? AND resource_type = ?').get(nationId, res.resource_type) as { cap: number } | undefined;
        if (capRow) {
          db.prepare("UPDATE resources SET stockpile = MIN(?, stockpile + ?) WHERE nation_id = ? AND resource_type = ?").run(capRow.cap, gain, nationId, res.resource_type);
        } else {
          db.prepare("UPDATE resources SET stockpile = stockpile + ? WHERE nation_id = ? AND resource_type = ?").run(gain, nationId, res.resource_type);
        }
      }
    }

    db.prepare('UPDATE production_modifiers SET ticks_remaining = ticks_remaining - 1 WHERE ticks_remaining > 0').run();
    db.prepare('DELETE FROM production_modifiers WHERE ticks_remaining <= 0').run();

    const tributes = db.prepare('SELECT * FROM tribute_agreements').all() as { payer_nation_id: number; receiver_nation_id: number; resource_type: string; amount_per_tick: number }[];
    for (const t of tributes) {
      db.prepare("UPDATE resources SET stockpile = stockpile - ? WHERE nation_id = ? AND resource_type = ?").run(t.amount_per_tick, t.payer_nation_id, t.resource_type);
      db.prepare("UPDATE resources SET stockpile = stockpile + ? WHERE nation_id = ? AND resource_type = ?").run(t.amount_per_tick, t.receiver_nation_id, t.resource_type);
    }
  })();
}

// ── Nation Statuses ───────────────────────────────────────────────────────────

describe('Nation statuses', () => {
  let db: Database.Database;
  let nationId: number;

  beforeEach(() => {
    db = createInMemoryDb();
    nationId = createNation(db, 'user1', 'Empire A');
  });

  it('sets a status on a nation', () => {
    db.prepare('INSERT INTO nation_statuses (nation_id, status, label) VALUES (?, ?, ?)').run(nationId, 'at_war', 'At War');
    const rows = db.prepare('SELECT * FROM nation_statuses WHERE nation_id = ?').all(nationId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('at_war');
    expect(rows[0].label).toBe('At War');
  });

  it('upserts label on duplicate status', () => {
    db.prepare('INSERT INTO nation_statuses (nation_id, status, label) VALUES (?, ?, ?)').run(nationId, 'at_war', 'At War');
    db.prepare('INSERT INTO nation_statuses (nation_id, status, label) VALUES (?, ?, ?) ON CONFLICT(nation_id, status) DO UPDATE SET label = excluded.label').run(nationId, 'at_war', 'Total War');
    const rows = db.prepare('SELECT * FROM nation_statuses WHERE nation_id = ?').all(nationId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Total War');
  });

  it('removes a status', () => {
    db.prepare('INSERT INTO nation_statuses (nation_id, status, label) VALUES (?, ?, ?)').run(nationId, 'golden_age', 'Golden Age');
    db.prepare('DELETE FROM nation_statuses WHERE nation_id = ? AND status = ?').run(nationId, 'golden_age');
    const rows = db.prepare('SELECT * FROM nation_statuses WHERE nation_id = ?').all(nationId) as any[];
    expect(rows).toHaveLength(0);
  });
});

// ── Market offers ─────────────────────────────────────────────────────────────

describe('Market offers', () => {
  let db: Database.Database;
  let sellerId: number;
  let buyerId: number;

  beforeEach(() => {
    db = createInMemoryDb();
    sellerId = createNation(db, 'market-seller', 'Seller Nation');
    buyerId  = createNation(db, 'market-buyer',  'Buyer Nation');
    // Seller has minerals to sell; buyer has credits to spend
    setStockpile(db, sellerId, 'minerals',       500);
    setStockpile(db, sellerId, 'energy_credits', 0);
    setStockpile(db, buyerId,  'minerals',       0);
    setStockpile(db, buyerId,  'energy_credits', 1000);
    setProduction(db, sellerId, 'minerals',       0);
    setProduction(db, sellerId, 'energy_credits', 0);
    setProduction(db, buyerId,  'minerals',       0);
    setProduction(db, buyerId,  'energy_credits', 0);
  });

  type OfferRow = {
    id: number; nation_id: number; offer_type: string;
    resource_type: string; amount: number;
    price_per_unit: number; price_resource_type: string; status: string;
  };

  function postOffer(
    nationId: number, offerType: 'sell' | 'buy',
    resourceType: string, amount: number,
    pricePerUnit: number, priceResourceType: string
  ): number {
    const info = db.prepare(`
      INSERT INTO market_offers (nation_id, offer_type, resource_type, amount, price_per_unit, price_resource_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nationId, offerType, resourceType, amount, pricePerUnit, priceResourceType);
    return info.lastInsertRowid as number;
  }

  function getOffer(id: number): OfferRow | undefined {
    return db.prepare('SELECT * FROM market_offers WHERE id = ?').get(id) as OfferRow | undefined;
  }

  function fillOffer(offerId: number, fillerNationId: number): boolean {
    const offer = getOffer(offerId);
    if (!offer || offer.status !== 'open') return false;
    if (offer.nation_id === fillerNationId) return false;
    const totalPrice = offer.price_per_unit * offer.amount;

    if (offer.offer_type === 'sell') {
      const fillerStock = db.prepare('SELECT stockpile FROM resources WHERE nation_id = ? AND resource_type = ?')
        .get(fillerNationId, offer.price_resource_type) as { stockpile: number } | undefined;
      if (!fillerStock || fillerStock.stockpile < totalPrice) return false;
      db.transaction(() => {
        db.prepare(`UPDATE resources SET stockpile = stockpile - ? WHERE nation_id = ? AND resource_type = ?`)
          .run(totalPrice, fillerNationId, offer.price_resource_type);
        db.prepare(`UPDATE resources SET stockpile = stockpile + ? WHERE nation_id = ? AND resource_type = ?`)
          .run(offer.amount, fillerNationId, offer.resource_type);
        db.prepare(`UPDATE resources SET stockpile = stockpile + ? WHERE nation_id = ? AND resource_type = ?`)
          .run(totalPrice, offer.nation_id, offer.price_resource_type);
        db.prepare(`UPDATE market_offers SET status = 'filled' WHERE id = ?`).run(offerId);
      })();
    } else {
      const fillerStock = db.prepare('SELECT stockpile FROM resources WHERE nation_id = ? AND resource_type = ?')
        .get(fillerNationId, offer.resource_type) as { stockpile: number } | undefined;
      if (!fillerStock || fillerStock.stockpile < offer.amount) return false;
      db.transaction(() => {
        db.prepare(`UPDATE resources SET stockpile = stockpile - ? WHERE nation_id = ? AND resource_type = ?`)
          .run(offer.amount, fillerNationId, offer.resource_type);
        db.prepare(`UPDATE resources SET stockpile = stockpile + ? WHERE nation_id = ? AND resource_type = ?`)
          .run(totalPrice, fillerNationId, offer.price_resource_type);
        db.prepare(`UPDATE resources SET stockpile = stockpile + ? WHERE nation_id = ? AND resource_type = ?`)
          .run(offer.amount, offer.nation_id, offer.resource_type);
        db.prepare(`UPDATE market_offers SET status = 'filled' WHERE id = ?`).run(offerId);
      })();
    }
    return true;
  }

  it('posts a sell offer and it appears as open', () => {
    const id = postOffer(sellerId, 'sell', 'minerals', 100, 2, 'energy_credits');
    const offer = getOffer(id);
    expect(offer?.status).toBe('open');
    expect(offer?.offer_type).toBe('sell');
    expect(offer?.amount).toBe(100);
  });

  it('filling a sell offer transfers resources correctly', () => {
    // seller posts 100 minerals at 2 credits each (total 200)
    const id = postOffer(sellerId, 'sell', 'minerals', 100, 2, 'energy_credits');
    const ok = fillOffer(id, buyerId);
    expect(ok).toBe(true);
    expect(getOffer(id)?.status).toBe('filled');
    expect(getStockpile(db, buyerId,  'minerals')).toBe(100);
    expect(getStockpile(db, buyerId,  'energy_credits')).toBe(800);
    expect(getStockpile(db, sellerId, 'minerals')).toBe(500); // seller didn't deduct minerals (they posted the offer, buyer pays credits)
    expect(getStockpile(db, sellerId, 'energy_credits')).toBe(200);
  });

  it('filling a buy offer transfers resources correctly', () => {
    // buyer posts: wants 50 minerals, paying 3 credits each (total 150)
    const id = postOffer(buyerId, 'buy', 'minerals', 50, 3, 'energy_credits');
    const ok = fillOffer(id, sellerId);
    expect(ok).toBe(true);
    expect(getOffer(id)?.status).toBe('filled');
    expect(getStockpile(db, sellerId, 'minerals')).toBe(450);
    expect(getStockpile(db, sellerId, 'energy_credits')).toBe(150);
    expect(getStockpile(db, buyerId,  'minerals')).toBe(50);
  });

  it('cannot fill own offer', () => {
    const id = postOffer(sellerId, 'sell', 'minerals', 100, 2, 'energy_credits');
    const ok = fillOffer(id, sellerId);
    expect(ok).toBe(false);
    expect(getOffer(id)?.status).toBe('open');
  });

  it('fill returns false when filler has insufficient funds', () => {
    // buyer only has 1000 credits but total cost is 2000
    const id = postOffer(sellerId, 'sell', 'minerals', 100, 20, 'energy_credits');
    const ok = fillOffer(id, buyerId);
    expect(ok).toBe(false);
    expect(getOffer(id)?.status).toBe('open');
  });

  it('cancelling an open offer sets status to cancelled', () => {
    const id = postOffer(sellerId, 'sell', 'minerals', 100, 2, 'energy_credits');
    const changes = (db.prepare(`UPDATE market_offers SET status = 'cancelled' WHERE id = ? AND status = 'open'`).run(id) as any).changes;
    expect(changes).toBe(1);
    expect(getOffer(id)?.status).toBe('cancelled');
  });

  it('cascade deletes offer when nation is deleted', () => {
    postOffer(sellerId, 'sell', 'minerals', 100, 2, 'energy_credits');
    db.prepare('DELETE FROM nations WHERE id = ?').run(sellerId);
    const rows = db.prepare('SELECT * FROM market_offers').all();
    expect(rows).toHaveLength(0);
  });
});

// ── Alliances ─────────────────────────────────────────────────────────────────

describe('Alliances', () => {
  let db: Database.Database;
  let nationA: number;
  let nationB: number;
  let nationC: number;

  beforeEach(() => {
    db = createInMemoryDb();
    nationA = createNation(db, 'userA', 'Nation A');
    nationB = createNation(db, 'userB', 'Nation B');
    nationC = createNation(db, 'userC', 'Nation C');
  });

  function formAlliance(a: number, b: number) {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    db.prepare('INSERT INTO alliances (nation_a_id, nation_b_id) VALUES (?, ?)').run(lo, hi);
  }

  function areAllied(a: number, b: number): boolean {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return !!db.prepare('SELECT id FROM alliances WHERE nation_a_id = ? AND nation_b_id = ?').get(lo, hi);
  }

  it('creates an alliance between two nations', () => {
    formAlliance(nationA, nationB);
    expect(areAllied(nationA, nationB)).toBe(true);
  });

  it('is symmetric — order of arguments does not matter', () => {
    formAlliance(nationA, nationB);
    expect(areAllied(nationB, nationA)).toBe(true);
  });

  it('prevents duplicate alliances', () => {
    formAlliance(nationA, nationB);
    expect(() => formAlliance(nationA, nationB)).toThrow();
  });

  it('dissolves an alliance', () => {
    formAlliance(nationA, nationB);
    const [lo, hi] = nationA < nationB ? [nationA, nationB] : [nationB, nationA];
    db.prepare('DELETE FROM alliances WHERE nation_a_id = ? AND nation_b_id = ?').run(lo, hi);
    expect(areAllied(nationA, nationB)).toBe(false);
  });

  it('dissolving one alliance does not affect others', () => {
    formAlliance(nationA, nationB);
    formAlliance(nationA, nationC);
    const [lo, hi] = nationA < nationB ? [nationA, nationB] : [nationB, nationA];
    db.prepare('DELETE FROM alliances WHERE nation_a_id = ? AND nation_b_id = ?').run(lo, hi);
    expect(areAllied(nationA, nationB)).toBe(false);
    expect(areAllied(nationA, nationC)).toBe(true);
  });

  it('cascades delete when a nation is removed', () => {
    formAlliance(nationA, nationB);
    db.prepare('DELETE FROM nations WHERE id = ?').run(nationA);
    expect(areAllied(nationA, nationB)).toBe(false);
  });
});

// ── Sanctions ─────────────────────────────────────────────────────────────────

describe('Sanctions', () => {
  let db: Database.Database;
  let nationA: number;
  let nationB: number;

  beforeEach(() => {
    db = createInMemoryDb();
    nationA = createNation(db, 'userA', 'Nation A');
    nationB = createNation(db, 'userB', 'Nation B');
  });

  function addSanction(target: number, reason: string | null = null): number {
    const r = db.prepare('INSERT INTO sanctions (target_nation_id, imposed_by_nation_id, reason) VALUES (?, ?, ?)').run(target, null, reason);
    return r.lastInsertRowid as number;
  }

  function isSanctioned(nationId: number): boolean {
    return !!db.prepare('SELECT id FROM sanctions WHERE target_nation_id = ? LIMIT 1').get(nationId);
  }

  it('adds a sanction to a nation', () => {
    addSanction(nationA);
    expect(isSanctioned(nationA)).toBe(true);
  });

  it('sanction does not affect other nations', () => {
    addSanction(nationA);
    expect(isSanctioned(nationB)).toBe(false);
  });

  it('removes a sanction by id', () => {
    const id = addSanction(nationA, 'Test reason');
    db.prepare('DELETE FROM sanctions WHERE id = ?').run(id);
    expect(isSanctioned(nationA)).toBe(false);
  });

  it('stores the reason text', () => {
    addSanction(nationA, 'Illegal trade routes');
    const row = db.prepare('SELECT * FROM sanctions WHERE target_nation_id = ?').get(nationA) as any;
    expect(row.reason).toBe('Illegal trade routes');
  });

  it('a nation can have multiple sanctions', () => {
    addSanction(nationA, 'First offence');
    addSanction(nationA, 'Second offence');
    const rows = db.prepare('SELECT * FROM sanctions WHERE target_nation_id = ?').all(nationA) as any[];
    expect(rows).toHaveLength(2);
  });

  it('cascades delete when sanctioned nation is removed', () => {
    addSanction(nationA);
    db.prepare('DELETE FROM nations WHERE id = ?').run(nationA);
    expect(isSanctioned(nationA)).toBe(false);
  });
});

// ── Production modifiers ──────────────────────────────────────────────────────

describe('Production modifiers', () => {
  let db: Database.Database;
  let nationId: number;

  beforeEach(() => {
    db = createInMemoryDb();
    nationId = createNation(db, 'user1', 'Empire A');
    // Give a known, clean production value for easy math
    for (const type of RESOURCE_TYPES) {
      setProduction(db, nationId, type, 10);
      setStockpile(db, nationId, type, 0);
    }
  });

  function addModifier(nId: number, multiplier: number, ticks: number, resourceType: string | null = null) {
    db.prepare('INSERT INTO production_modifiers (nation_id, resource_type, multiplier, label, ticks_remaining) VALUES (?, ?, ?, ?, ?)')
      .run(nId, resourceType, multiplier, 'Test Mod', ticks);
  }

  it('a +20% global modifier increases non-research stockpile by 120% of base gain', () => {
    addModifier(nationId, 1.2, 1);
    const before = getStockpile(db, nationId, 'energy_credits');
    applyTick(db);
    const after = getStockpile(db, nationId, 'energy_credits');
    // base gain = 10 * 300 = 3000; with +20% = 3600
    expect(after - before).toBeCloseTo(3600);
  });

  it('a -20% global modifier reduces non-research stockpile gain', () => {
    addModifier(nationId, 0.8, 1);
    applyTick(db);
    const after = getStockpile(db, nationId, 'minerals');
    // base gain = 3000; with -20% = 2400
    expect(after).toBeCloseTo(2400);
  });

  it('a resource-scoped modifier only affects that resource', () => {
    addModifier(nationId, 1.5, 1, 'energy_credits');
    applyTick(db);
    const energy = getStockpile(db, nationId, 'energy_credits');
    const minerals = getStockpile(db, nationId, 'minerals');
    // energy: 10 * 300 * 1.5 = 4500
    expect(energy).toBeCloseTo(4500);
    // minerals: 10 * 300 * 1.0 = 3000 (unaffected)
    expect(minerals).toBeCloseTo(3000);
  });

  it('modifier expires after its tick count', () => {
    addModifier(nationId, 1.5, 1);
    applyTick(db); // consumes the modifier
    setStockpile(db, nationId, 'energy_credits', 0);
    applyTick(db); // modifier should be gone
    expect(getStockpile(db, nationId, 'energy_credits')).toBeCloseTo(3000);
  });

  it('modifier with 3 ticks persists for 3 ticks then expires', () => {
    addModifier(nationId, 2.0, 3);
    for (let i = 0; i < 3; i++) {
      setStockpile(db, nationId, 'energy_credits', 0);
      applyTick(db);
      // Should be boosted each tick
      expect(getStockpile(db, nationId, 'energy_credits')).toBeCloseTo(6000);
    }
    // Tick 4: modifier expired
    setStockpile(db, nationId, 'energy_credits', 0);
    applyTick(db);
    expect(getStockpile(db, nationId, 'energy_credits')).toBeCloseTo(3000);
  });

  it('multiple modifiers stack additively', () => {
    addModifier(nationId, 1.2, 1); // +20%
    addModifier(nationId, 1.1, 1); // +10%
    applyTick(db);
    // total multiplier = 1.0 + 0.2 + 0.1 = 1.3 → gain = 10 * 300 * 1.3 = 3900
    expect(getStockpile(db, nationId, 'energy_credits')).toBeCloseTo(3900);
  });

  it('a modifier that would bring total multiplier below 0 is clamped to 0', () => {
    addModifier(nationId, 0.0, 1); // -100%
    addModifier(nationId, 0.5, 1); // -50%
    applyTick(db);
    // total = 1.0 - 1.0 - 0.5 = -0.5 → clamped to 0 → no gain
    expect(getStockpile(db, nationId, 'energy_credits')).toBeCloseTo(0);
  });

  it('modifiers do not affect research stockpiles', () => {
    addModifier(nationId, 2.0, 1);
    applyTick(db);
    expect(getStockpile(db, nationId, 'physics')).toBe(0);
  });
});

// ── Stockpile caps ────────────────────────────────────────────────────────────

describe('Stockpile caps', () => {
  let db: Database.Database;
  let nationId: number;

  beforeEach(() => {
    db = createInMemoryDb();
    nationId = createNation(db, 'user1', 'Empire A');
    setProduction(db, nationId, 'energy_credits', 10);
    setStockpile(db, nationId, 'energy_credits', 0);
  });

  function setCap(nId: number, type: string, cap: number) {
    db.prepare('INSERT INTO stockpile_caps (nation_id, resource_type, cap) VALUES (?, ?, ?) ON CONFLICT(nation_id, resource_type) DO UPDATE SET cap = excluded.cap').run(nId, type, cap);
  }

  it('caps stockpile at the configured maximum after a tick', () => {
    setCap(nationId, 'energy_credits', 1000);
    applyTick(db); // would normally gain 10 * 300 = 3000
    expect(getStockpile(db, nationId, 'energy_credits')).toBe(1000);
  });

  it('does not cap a resource that has no cap set', () => {
    applyTick(db);
    expect(getStockpile(db, nationId, 'energy_credits')).toBeCloseTo(3000);
  });

  it('a cap of 0 keeps stockpile at 0', () => {
    setCap(nationId, 'energy_credits', 0);
    applyTick(db);
    expect(getStockpile(db, nationId, 'energy_credits')).toBe(0);
  });

  it('cap only affects the targeted resource', () => {
    setProduction(db, nationId, 'minerals', 10);
    setStockpile(db, nationId, 'minerals', 0);
    setCap(nationId, 'energy_credits', 500);
    applyTick(db);
    expect(getStockpile(db, nationId, 'energy_credits')).toBe(500);
    expect(getStockpile(db, nationId, 'minerals')).toBeCloseTo(3000);
  });

  it('removing a cap allows full gain on next tick', () => {
    setCap(nationId, 'energy_credits', 500);
    db.prepare('DELETE FROM stockpile_caps WHERE nation_id = ? AND resource_type = ?').run(nationId, 'energy_credits');
    applyTick(db);
    expect(getStockpile(db, nationId, 'energy_credits')).toBeCloseTo(3000);
  });
});

// ── Tribute agreements ────────────────────────────────────────────────────────

describe('Tribute agreements', () => {
  let db: Database.Database;
  let payerId: number;
  let receiverId: number;

  beforeEach(() => {
    db = createInMemoryDb();
    payerId   = createNation(db, 'payer-user',    'Payer Nation');
    receiverId = createNation(db, 'receiver-user', 'Receiver Nation');
    setStockpile(db, payerId,    'energy_credits', 5000);
    setStockpile(db, receiverId, 'energy_credits', 1000);
    setProduction(db, payerId,    'energy_credits', 0);
    setProduction(db, receiverId, 'energy_credits', 0);
  });

  function addTribute(payerId: number, receiverId: number, type: string, amount: number): number {
    const info = db.prepare(
      'INSERT INTO tribute_agreements (payer_nation_id, receiver_nation_id, resource_type, amount_per_tick) VALUES (?, ?, ?, ?)'
    ).run(payerId, receiverId, type, amount);
    return info.lastInsertRowid as number;
  }

  it('creates a tribute agreement and can be queried', () => {
    const id = addTribute(payerId, receiverId, 'energy_credits', 100);
    const row = db.prepare('SELECT * FROM tribute_agreements WHERE id = ?').get(id) as any;
    expect(row.payer_nation_id).toBe(payerId);
    expect(row.receiver_nation_id).toBe(receiverId);
    expect(row.amount_per_tick).toBe(100);
  });

  it('debits payer and credits receiver on tick', () => {
    addTribute(payerId, receiverId, 'energy_credits', 200);
    applyTick(db);
    expect(getStockpile(db, payerId,    'energy_credits')).toBeCloseTo(4800);
    expect(getStockpile(db, receiverId, 'energy_credits')).toBeCloseTo(1200);
  });

  it('processes multiple tributes in the same tick', () => {
    addTribute(payerId, receiverId, 'energy_credits', 100);
    addTribute(payerId, receiverId, 'energy_credits', 50);
    applyTick(db);
    expect(getStockpile(db, payerId,    'energy_credits')).toBeCloseTo(4850);
    expect(getStockpile(db, receiverId, 'energy_credits')).toBeCloseTo(1150);
  });

  it('allows payer stockpile to go negative (debt)', () => {
    addTribute(payerId, receiverId, 'energy_credits', 6000);
    applyTick(db);
    expect(getStockpile(db, payerId, 'energy_credits')).toBeCloseTo(-1000);
  });

  it('removing a tribute stops transfers on next tick', () => {
    const id = addTribute(payerId, receiverId, 'energy_credits', 200);
    db.prepare('DELETE FROM tribute_agreements WHERE id = ?').run(id);
    applyTick(db);
    expect(getStockpile(db, payerId,    'energy_credits')).toBe(5000);
    expect(getStockpile(db, receiverId, 'energy_credits')).toBe(1000);
  });

  it('cascade deletes tribute when payer nation is deleted', () => {
    addTribute(payerId, receiverId, 'energy_credits', 100);
    db.prepare('DELETE FROM nations WHERE id = ?').run(payerId);
    const rows = db.prepare('SELECT * FROM tribute_agreements').all();
    expect(rows).toHaveLength(0);
  });
});

// ── Bulk resource adjustment ──────────────────────────────────────────────────

describe('Bulk resource adjustment', () => {
  let db: Database.Database;
  let nation1: number;
  let nation2: number;

  beforeEach(() => {
    db = createInMemoryDb();
    nation1 = createNation(db, 'bulk-user-1', 'Alpha');
    nation2 = createNation(db, 'bulk-user-2', 'Beta');
    setStockpile(db, nation1, 'energy_credits', 1000);
    setStockpile(db, nation2, 'energy_credits', 500);
  });

  function bulkAdjust(type: string, delta: number): number {
    const result = db.prepare(
      `UPDATE resources SET stockpile = MAX(0, stockpile + ?), updated_at = datetime('now') WHERE resource_type = ?`
    ).run(delta, type);
    return result.changes as number;
  }

  it('adds the delta to all nations for the given resource', () => {
    bulkAdjust('energy_credits', 200);
    expect(getStockpile(db, nation1, 'energy_credits')).toBeCloseTo(1200);
    expect(getStockpile(db, nation2, 'energy_credits')).toBeCloseTo(700);
  });

  it('subtracts the delta from all nations', () => {
    bulkAdjust('energy_credits', -300);
    expect(getStockpile(db, nation1, 'energy_credits')).toBeCloseTo(700);
    expect(getStockpile(db, nation2, 'energy_credits')).toBeCloseTo(200);
  });

  it('floors at 0 when subtraction exceeds stockpile', () => {
    bulkAdjust('energy_credits', -2000);
    expect(getStockpile(db, nation1, 'energy_credits')).toBe(0);
    expect(getStockpile(db, nation2, 'energy_credits')).toBe(0);
  });

  it('only affects the specified resource type', () => {
    setStockpile(db, nation1, 'minerals', 300);
    bulkAdjust('energy_credits', 100);
    expect(getStockpile(db, nation1, 'energy_credits')).toBeCloseTo(1100);
    expect(getStockpile(db, nation1, 'minerals')).toBeCloseTo(300);
  });

  it('returns the number of rows changed', () => {
    const changes = bulkAdjust('energy_credits', 50);
    expect(changes).toBe(2); // two nations both have energy_credits rows
  });
});

// ── Trade proposals ───────────────────────────────────────────────────────────

describe('Trade proposals', () => {
  let db: Database.Database;
  let proposerId: number;
  let targetId: number;

  beforeEach(() => {
    db = createInMemoryDb();
    proposerId = createNation(db, 'trade-proposer', 'Proposer Nation');
    targetId   = createNation(db, 'trade-target',   'Target Nation');
    setStockpile(db, proposerId, 'energy_credits', 1000);
    setStockpile(db, proposerId, 'minerals',       500);
    setStockpile(db, targetId,   'energy_credits', 800);
    setStockpile(db, targetId,   'minerals',       600);
    setProduction(db, proposerId, 'energy_credits', 0);
    setProduction(db, proposerId, 'minerals',       0);
    setProduction(db, targetId,   'energy_credits', 0);
    setProduction(db, targetId,   'minerals',       0);
  });

  const TRADE_TTL_HOURS = 24;

  function createTrade(
    pId: number, tId: number,
    offerType: string, offerAmt: number,
    reqType: string,   reqAmt: number,
    hoursUntilExpiry = TRADE_TTL_HOURS
  ): number {
    const modifier = `${hoursUntilExpiry >= 0 ? '+' : ''}${hoursUntilExpiry} hours`;
    const info = db.prepare(`
      INSERT INTO trade_proposals
        (proposer_nation_id, target_nation_id, offer_type, offer_amount, request_type, request_amount, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
    `).run(pId, tId, offerType, offerAmt, reqType, reqAmt, modifier);
    return info.lastInsertRowid as number;
  }

  type TradeRow = {
    id: number; proposer_nation_id: number; target_nation_id: number;
    offer_type: string; offer_amount: number;
    request_type: string; request_amount: number;
    status: string; expires_at: string;
  };

  function getTrade(id: number): TradeRow | undefined {
    return db.prepare('SELECT * FROM trade_proposals WHERE id = ?').get(id) as TradeRow | undefined;
  }

  function executeTrade(tradeId: number): boolean {
    const trade = getTrade(tradeId);
    if (!trade || trade.status !== 'pending') return false;
    // Use SQLite to compare times (avoids JS Date timezone parsing issues)
    const expired = (db.prepare(`SELECT 1 AS v FROM trade_proposals WHERE id = ? AND expires_at <= datetime('now')`)
      .get(tradeId) as { v: number } | undefined)?.v === 1;
    if (expired) {
      db.prepare(`UPDATE trade_proposals SET status = 'expired' WHERE id = ?`).run(tradeId);
      return false;
    }
    const pStock = db.prepare('SELECT stockpile FROM resources WHERE nation_id = ? AND resource_type = ?')
      .get(trade.proposer_nation_id, trade.offer_type) as { stockpile: number } | undefined;
    const tStock = db.prepare('SELECT stockpile FROM resources WHERE nation_id = ? AND resource_type = ?')
      .get(trade.target_nation_id, trade.request_type) as { stockpile: number } | undefined;
    if (!pStock || pStock.stockpile < trade.offer_amount) return false;
    if (!tStock || tStock.stockpile < trade.request_amount) return false;
    db.transaction(() => {
      db.prepare(`UPDATE resources SET stockpile = stockpile - ? WHERE nation_id = ? AND resource_type = ?`)
        .run(trade.offer_amount, trade.proposer_nation_id, trade.offer_type);
      db.prepare(`UPDATE resources SET stockpile = stockpile + ? WHERE nation_id = ? AND resource_type = ?`)
        .run(trade.request_amount, trade.proposer_nation_id, trade.request_type);
      db.prepare(`UPDATE resources SET stockpile = stockpile - ? WHERE nation_id = ? AND resource_type = ?`)
        .run(trade.request_amount, trade.target_nation_id, trade.request_type);
      db.prepare(`UPDATE resources SET stockpile = stockpile + ? WHERE nation_id = ? AND resource_type = ?`)
        .run(trade.offer_amount, trade.target_nation_id, trade.offer_type);
      db.prepare(`UPDATE trade_proposals SET status = 'accepted' WHERE id = ?`).run(tradeId);
    })();
    return true;
  }

  it('creates a trade proposal with pending status', () => {
    const id = createTrade(proposerId, targetId, 'energy_credits', 100, 'minerals', 50);
    const row = getTrade(id);
    expect(row?.status).toBe('pending');
    expect(row?.offer_amount).toBe(100);
    expect(row?.request_amount).toBe(50);
  });

  it('executeTrade swaps resources atomically', () => {
    const id = createTrade(proposerId, targetId, 'energy_credits', 200, 'minerals', 100);
    const ok = executeTrade(id);
    expect(ok).toBe(true);
    expect(getStockpile(db, proposerId, 'energy_credits')).toBe(800);
    expect(getStockpile(db, proposerId, 'minerals')).toBe(600);
    expect(getStockpile(db, targetId,   'energy_credits')).toBe(1000);
    expect(getStockpile(db, targetId,   'minerals')).toBe(500);
    expect(getTrade(id)?.status).toBe('accepted');
  });

  it('executeTrade returns false when proposer has insufficient funds', () => {
    const id = createTrade(proposerId, targetId, 'energy_credits', 5000, 'minerals', 50);
    const ok = executeTrade(id);
    expect(ok).toBe(false);
    // stockpiles unchanged
    expect(getStockpile(db, proposerId, 'energy_credits')).toBe(1000);
    expect(getStockpile(db, targetId,   'minerals')).toBe(600);
  });

  it('executeTrade returns false when target has insufficient funds', () => {
    const id = createTrade(proposerId, targetId, 'energy_credits', 100, 'minerals', 9999);
    const ok = executeTrade(id);
    expect(ok).toBe(false);
  });

  it('executeTrade returns false on an already-expired trade', () => {
    const id = createTrade(proposerId, targetId, 'energy_credits', 100, 'minerals', 50, -1);
    const ok = executeTrade(id);
    expect(ok).toBe(false);
    expect(getTrade(id)?.status).toBe('expired');
  });

  it('can set trade status to rejected', () => {
    const id = createTrade(proposerId, targetId, 'energy_credits', 100, 'minerals', 50);
    db.prepare(`UPDATE trade_proposals SET status = 'rejected' WHERE id = ?`).run(id);
    expect(getTrade(id)?.status).toBe('rejected');
  });

  it('can set trade status to cancelled', () => {
    const id = createTrade(proposerId, targetId, 'energy_credits', 100, 'minerals', 50);
    db.prepare(`UPDATE trade_proposals SET status = 'cancelled' WHERE id = ?`).run(id);
    expect(getTrade(id)?.status).toBe('cancelled');
  });

  it('cascade deletes trade when proposer nation is deleted', () => {
    createTrade(proposerId, targetId, 'energy_credits', 100, 'minerals', 50);
    db.prepare('DELETE FROM nations WHERE id = ?').run(proposerId);
    const rows = db.prepare('SELECT * FROM trade_proposals').all();
    expect(rows).toHaveLength(0);
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

describe('Audit log', () => {
  let db: Database.Database;
  let nationId: number;

  beforeEach(() => {
    db = createInMemoryDb();
    nationId = createNation(db, 'audit-user', 'Audit Nation');
  });

  type AuditRow = { id: number; nation_id: number | null; action: string; actor: string; details: string; created_at: string };

  function log(action: string, actor: string, details: Record<string, unknown>, nId?: number): void {
    db.prepare('INSERT INTO audit_log (nation_id, action, actor, details) VALUES (?, ?, ?, ?)')
      .run(nId ?? null, action, actor, JSON.stringify(details));
  }

  function getAll(limit = 50): AuditRow[] {
    return db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit) as AuditRow[];
  }

  function getForNation(nId: number, limit = 50): AuditRow[] {
    return db.prepare('SELECT * FROM audit_log WHERE nation_id = ? ORDER BY created_at DESC LIMIT ?').all(nId, limit) as AuditRow[];
  }

  it('inserts an audit entry and can be retrieved', () => {
    log('gm_adjust', 'GM#1234', { resource: 'minerals', delta: 100 }, nationId);
    const rows = getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('gm_adjust');
    expect(rows[0].actor).toBe('GM#1234');
    expect(JSON.parse(rows[0].details)).toMatchObject({ resource: 'minerals', delta: 100 });
  });

  it('stores nation_id when provided', () => {
    log('trade_accepted', 'System', {}, nationId);
    const rows = getAll();
    expect(rows[0].nation_id).toBe(nationId);
  });

  it('stores null nation_id for global events', () => {
    log('season_reset', 'System', { new_year: 2301 });
    const rows = getAll();
    expect(rows[0].nation_id).toBeNull();
  });

  it('nation-filtered query returns only entries for that nation', () => {
    const nation2 = createNation(db, 'audit-user-2', 'Other Nation');
    log('gm_adjust', 'GM', {}, nationId);
    log('gm_adjust', 'GM', {}, nation2);
    log('season_reset', 'System', {});
    const forNation = getForNation(nationId);
    expect(forNation).toHaveLength(1);
    expect(forNation[0].nation_id).toBe(nationId);
  });

  it('global query returns all entries regardless of nation', () => {
    const nation2 = createNation(db, 'audit-user-3', 'Third Nation');
    log('event_a', 'GM', {}, nationId);
    log('event_b', 'GM', {}, nation2);
    log('event_c', 'System', {});
    const all = getAll();
    expect(all).toHaveLength(3);
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      log('tick', 'System', { i });
    }
    const limited = getAll(3);
    expect(limited).toHaveLength(3);
  });

  it('entry details survive a JSON round-trip', () => {
    const payload = { foo: 'bar', nested: { x: 42 } };
    log('test_event', 'Actor', payload, nationId);
    const row = getAll()[0];
    expect(JSON.parse(row.details)).toEqual(payload);
  });

  it('nation_id is set to null on delete (ON DELETE SET NULL)', () => {
    log('trade_accepted', 'System', {}, nationId);
    db.prepare('DELETE FROM nations WHERE id = ?').run(nationId);
    const rows = getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].nation_id).toBeNull();
  });
});

// ── Season reset ──────────────────────────────────────────────────────────────

describe('Season reset', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
    // Seed data across all systems
    const n1 = createNation(db, 'reset-user-1', 'Reset Alpha');
    const n2 = createNation(db, 'reset-user-2', 'Reset Beta');
    setStockpile(db, n1, 'energy_credits', 500);
    setProduction(db, n1, 'energy_credits', 5);

    // alliance
    const aId = Math.min(n1, n2), bId = Math.max(n1, n2);
    db.prepare('INSERT INTO alliances (nation_a_id, nation_b_id) VALUES (?, ?)').run(aId, bId);
    // sanction
    db.prepare('INSERT INTO sanctions (target_nation_id, reason) VALUES (?, ?)').run(n2, 'test');
    // tribute
    db.prepare('INSERT INTO tribute_agreements (payer_nation_id, receiver_nation_id, resource_type, amount_per_tick) VALUES (?, ?, ?, ?)')
      .run(n1, n2, 'energy_credits', 10);
    // modifier
    db.prepare('INSERT INTO production_modifiers (nation_id, resource_type, multiplier, label, ticks_remaining) VALUES (?, ?, ?, ?, ?)')
      .run(n1, 'energy_credits', 1.5, 'test', 3);
    // cap
    db.prepare('INSERT INTO stockpile_caps (nation_id, resource_type, cap) VALUES (?, ?, ?)').run(n1, 'energy_credits', 9999);
    // status
    db.prepare('INSERT INTO nation_statuses (nation_id, status, label) VALUES (?, ?, ?)').run(n1, 'at_war', 'War State');
    // trade proposal
    const modifier = '+24 hours';
    db.prepare('INSERT INTO trade_proposals (proposer_nation_id, target_nation_id, offer_type, offer_amount, request_type, request_amount, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\', ?))')
      .run(n1, n2, 'energy_credits', 50, 'minerals', 25, modifier);
    // market offer
    db.prepare('INSERT INTO market_offers (nation_id, offer_type, resource_type, amount, price_per_unit, price_resource_type) VALUES (?, ?, ?, ?, ?, ?)')
      .run(n1, 'sell', 'minerals', 100, 2, 'energy_credits');
    // audit log
    db.prepare('INSERT INTO audit_log (nation_id, action, actor, details) VALUES (?, ?, ?, ?)').run(n1, 'test_event', 'GM', '{}');
  });

  function resetForNewSeason(db: Database.Database, startYear = 2200): void {
    db.transaction(() => {
      db.prepare(`DELETE FROM audit_log`).run();
      db.prepare(`DELETE FROM market_offers`).run();
      db.prepare(`DELETE FROM trade_proposals`).run();
      db.prepare(`DELETE FROM tribute_agreements`).run();
      db.prepare(`DELETE FROM sanctions`).run();
      db.prepare(`DELETE FROM alliances`).run();
      db.prepare(`DELETE FROM production_modifiers`).run();
      db.prepare(`DELETE FROM nation_statuses`).run();
      db.prepare(`DELETE FROM stockpile_caps`).run();
      db.prepare(`DELETE FROM resources`).run();
      db.prepare(`DELETE FROM nations`).run();
      db.prepare(`UPDATE game_state SET current_year = ? WHERE id = 1`).run(startYear);
    })();
  }

  it('wipes all nations and resources', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM nations').get()).toMatchObject({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM resources').get()).toMatchObject({ c: 0 });
  });

  it('wipes alliances', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM alliances').get()).toMatchObject({ c: 0 });
  });

  it('wipes sanctions', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM sanctions').get()).toMatchObject({ c: 0 });
  });

  it('wipes tribute agreements', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM tribute_agreements').get()).toMatchObject({ c: 0 });
  });

  it('wipes production modifiers', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM production_modifiers').get()).toMatchObject({ c: 0 });
  });

  it('wipes stockpile caps', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM stockpile_caps').get()).toMatchObject({ c: 0 });
  });

  it('wipes nation statuses', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM nation_statuses').get()).toMatchObject({ c: 0 });
  });

  it('wipes trade proposals', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM trade_proposals').get()).toMatchObject({ c: 0 });
  });

  it('wipes market offers', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM market_offers').get()).toMatchObject({ c: 0 });
  });

  it('wipes audit log', () => {
    resetForNewSeason(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM audit_log').get()).toMatchObject({ c: 0 });
  });

  it('resets current_year to the specified start year', () => {
    resetForNewSeason(db, 2400);
    const row = db.prepare('SELECT current_year FROM game_state WHERE id = 1').get() as { current_year: number };
    expect(row.current_year).toBe(2400);
  });

  it('defaults current_year to 2200', () => {
    resetForNewSeason(db);
    const row = db.prepare('SELECT current_year FROM game_state WHERE id = 1').get() as { current_year: number };
    expect(row.current_year).toBe(2200);
  });
});
