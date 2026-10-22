import { supabase } from './supabase';
import { DEAL_KINDS, type Deal, type DealKind } from './deals';

// The deals table (migration 0047), for admin → Deals and for pricing a
// registration. See deals.ts for how a deal applies.

export interface DealRecord extends Deal {
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
}

interface DealRow {
  id: string;
  name: string;
  kind: string;
  amount: number | string;
  series_keys: string[] | null;
  required_count: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
}

const COLUMNS = 'id, name, kind, amount, series_keys, required_count, starts_at, ends_at, active';
const SAFE_KEY_RE = /^[A-Za-z0-9_-]+$/;
const MAX_KEYS = 50;

function fromRow(r: DealRow): DealRecord {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as DealKind,
    amount: Number(r.amount),
    seriesKeys: r.series_keys ?? [],
    requiredCount: r.required_count,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    active: r.active,
  };
}

export async function listDeals(): Promise<DealRecord[]> {
  const { data, error } = await supabase.from('deals').select(COLUMNS).order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load deals: ${error.message}`);
  return (data ?? []).map(fromRow);
}

// The deals in effect right now. A failure just means no discounts (logged),
// never a failed registration.
export async function listActiveDeals(now = new Date()): Promise<Deal[]> {
  const { data, error } = await supabase.from('deals').select(COLUMNS).eq('active', true);
  if (error) {
    console.error('Failed to load deals:', error.message);
    return [];
  }
  const t = now.getTime();
  return (data ?? [])
    .map(fromRow)
    .filter((d) => (!d.startsAt || Date.parse(d.startsAt) <= t) && (!d.endsAt || Date.parse(d.endsAt) > t));
}

// An admin's deal from the Deals tab, checked: what's wrong with it, or the
// row to save.
export function validateDeal(input: unknown): { error: string } | { row: Omit<DealRow, 'id'> } {
  const d = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (!name || name.length > 100) return { error: 'Give the deal a name (up to 100 characters).' };
  if (!DEAL_KINDS.includes(d.kind as DealKind)) return { error: 'Pick a discount type.' };
  const amount = Number(d.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a discount amount above zero.' };
  if (d.kind === 'percent_off' && amount > 100) return { error: 'A percent off can be at most 100%.' };

  const keys = Array.isArray(d.seriesKeys) ? [...new Set(d.seriesKeys.filter((k): k is string => typeof k === 'string' && SAFE_KEY_RE.test(k)))] : [];
  if (keys.length > MAX_KEYS) return { error: `A deal can cover at most ${MAX_KEYS} classes.` };
  const requiredCount = d.requiredCount == null || d.requiredCount === '' ? null : Number(d.requiredCount);
  if (requiredCount != null && (!Number.isInteger(requiredCount) || requiredCount < 2)) return { error: '"Any" needs a whole number of at least 2.' };
  const needed = requiredCount ?? 2;
  if (keys.length < needed) return { error: requiredCount == null ? 'Pick at least 2 classes or events.' : `Pick at least ${requiredCount} classes or events.` };

  const date = (v: unknown) => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  const startsAt = date(d.startsAt);
  const endsAt = date(d.endsAt);
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'The end date has to be after the start date.' };

  return {
    row: {
      name,
      kind: d.kind as DealKind,
      amount: Math.round(amount * 100) / 100,
      series_keys: keys,
      required_count: requiredCount,
      starts_at: startsAt,
      ends_at: endsAt,
      active: d.active !== false,
    },
  };
}

export async function saveDeal(id: string | null, row: Omit<DealRow, 'id'>): Promise<void> {
  const write = { ...row, updated_at: new Date().toISOString() };
  const { error } = id ? await supabase.from('deals').update(write).eq('id', id) : await supabase.from('deals').insert(write);
  if (error) throw new Error(`Failed to save the deal: ${error.message}`);
}

export async function deleteDeal(id: string): Promise<void> {
  const { error } = await supabase.from('deals').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete the deal: ${error.message}`);
}
