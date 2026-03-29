export type ResourceType =
  // Basic
  | 'energy_credits'
  | 'minerals'
  | 'food'
  | 'trade'
  // Advanced
  | 'alloys'
  | 'consumer_goods'
  // Abstract - Research
  | 'physics'
  | 'society'
  | 'engineering';

export const RESOURCE_TYPES: ResourceType[] = [
  'energy_credits',
  'minerals',
  'food',
  'trade',
  'alloys',
  'consumer_goods',
  'physics',
  'society',
  'engineering',
];

/** Resource types whose stockpile is never accumulated by ticks (spent-as-produced). */
export const RESEARCH_TYPES: ResourceType[] = ['physics', 'society', 'engineering'];

export const DEFAULT_PRODUCTION: Record<ResourceType, number> = {
  energy_credits: 10,
  minerals:       10,
  food:           10,
  trade:          10,
  alloys:          5,
  consumer_goods:  5,
  physics:        25,
  society:        25,
  engineering:    25,
};

export const DEFAULT_STOCKPILE: Record<ResourceType, number> = {
  energy_credits: 100,
  minerals:       100,
  food:           100,
  trade:          100,
  alloys:          25,
  consumer_goods:  25,
  // Research has no meaningful stockpile
  physics:          0,
  society:          0,
  engineering:      0,
};

export const RESOURCE_META: Record<
  ResourceType,
  { label: string; emoji: string; category: 'Basic' | 'Advanced' | 'Research' }
> = {
  energy_credits: { label: 'Energy Credits', emoji: 'EC', category: 'Basic' },
  minerals:       { label: 'Minerals',        emoji: 'MI',  category: 'Basic' },
  food:           { label: 'Food',            emoji: 'FO', category: 'Basic' },
  trade:          { label: 'Trade',           emoji: 'TR', category: 'Basic' },
  alloys:         { label: 'Alloys',          emoji: 'AL', category: 'Advanced' },
  consumer_goods: { label: 'Consumer Goods',  emoji: 'CG', category: 'Advanced' },
  physics:        { label: 'Physics',         emoji: 'PH', category: 'Research' },
  society:        { label: 'Society',         emoji: 'SO', category: 'Research' },
  engineering:    { label: 'Engineering',     emoji: 'EN',  category: 'Research' },
};

// ── Nation Status Flags ───────────────────────────────────────────────────────

export type StatusFlag =
  | 'at_war'
  | 'in_recession'
  | 'golden_age'
  | 'blockaded'
  | 'in_civil_war'
  | 'prosperous'
  | 'custom';

export const STATUS_META: Record<StatusFlag, { label: string; emoji: string; productionModifier: number }> = {
  at_war:       { label: 'At War',       emoji: 'WAR',  productionModifier: -0.15 },
  in_recession: { label: 'In Recession', emoji: 'REC', productionModifier: -0.20 },
  golden_age:   { label: 'Golden Age',   emoji: 'GOLD', productionModifier:  0.25 },
  blockaded:    { label: 'Blockaded',    emoji: 'BLOCK', productionModifier: -0.10 },
  in_civil_war: { label: 'Civil War',    emoji: 'CIVIL', productionModifier: -0.30 },
  prosperous:   { label: 'Prosperous',   emoji: 'PROS', productionModifier:  0.10 },
  custom:       { label: 'Custom',       emoji: 'TAG',  productionModifier:  0.00 },
};

export const STATUS_FLAGS: StatusFlag[] = [
  'at_war',
  'in_recession',
  'golden_age',
  'blockaded',
  'in_civil_war',
  'prosperous',
  'custom',
];

// ── Audit action types ────────────────────────────────────────────────────────

export type AuditAction =
  | 'resource_set'
  | 'resource_add'
  | 'resource_subtract'
  | 'gm_transfer'
  | 'player_trade'
  | 'market_fill'
  | 'tribute_payment'
  | 'tick'
  | 'season_reset'
  | 'status_set'
  | 'status_removed'
  | 'modifier_set'
  | 'cap_set'
  | 'sanction_added'
  | 'sanction_removed'
  | 'alliance_formed'
  | 'alliance_dissolved'
  | 'tribute_added'
  | 'tribute_removed'
  | 'tick_freeze';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface Nation {
  id: number;
  discord_user_id: string;
  name: string;
  created_at: string;
}

export interface Resource {
  id: number;
  nation_id: number;
  resource_type: ResourceType;
  stockpile: number;
  production: number;
  updated_at: string;
}

export interface GameState {
  id: number;
  current_year: number;
}

export interface NationStatus {
  id: number;
  nation_id: number;
  status: StatusFlag;
  label: string;
  applied_at: string;
}

export interface ProductionModifier {
  id: number;
  nation_id: number;
  resource_type: string | null; // null = all resources
  multiplier: number;           // e.g. 1.2 = +20%, 0.8 = -20%
  label: string;
  ticks_remaining: number;
  created_at: string;
}

export interface Alliance {
  id: number;
  nation_a_id: number;
  nation_b_id: number;
  formed_at: string;
}

export interface Sanction {
  id: number;
  target_nation_id: number;
  imposed_by_nation_id: number;
  reason: string | null;
  created_at: string;
}

export interface TributeAgreement {
  id: number;
  payer_nation_id: number;
  receiver_nation_id: number;
  resource_type: string;
  amount_per_tick: number;
  label: string | null;
  created_at: string;
}

export interface TradeProposal {
  id: number;
  proposer_nation_id: number;
  target_nation_id: number;
  offer_type: string;
  offer_amount: number;
  request_type: string;
  request_amount: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
  created_at: string;
  expires_at: string;
}

export interface MarketOffer {
  id: number;
  nation_id: number;
  offer_type: 'sell' | 'buy';
  resource_type: string;
  amount: number;
  price_per_unit: number;
  price_resource_type: string;
  status: 'open' | 'filled' | 'cancelled';
  created_at: string;
}

export interface StockpileCap {
  id: number;
  nation_id: number;
  resource_type: string;
  cap: number;
}

export interface AuditEntry {
  id: number;
  nation_id: number | null;
  action: AuditAction;
  actor: string;     // discord user ID or 'system'
  details: string;   // JSON blob
  created_at: string;
}
