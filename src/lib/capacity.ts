import { supabase } from './supabase';
import type { ParsedClassSelection, ClassSelectionError } from './classRegistrations';

// Capacity is set per class/event series (copied onto every occurrence, like
// its prices). A Whole Series (or event ticket) registration takes a spot in
// every occurrence of its series; a Drop-In takes one only in the occurrence
// it picked.

export interface CapacityEventRow {
  id: string;
  google_recurring_event_id: string | null;
  capacity?: number | null;
}

export interface SpotsInfo {
  capacity: number;
  taken: number;
  remaining: number;
}

export const seriesKeyOf = (e: { id: string; google_recurring_event_id: string | null }) => e.google_recurring_event_id ?? e.id;

// Spots for every given occurrence that has a capacity, keyed by occurrence id.
export async function getSpotsByOccurrence(events: CapacityEventRow[]): Promise<Map<string, SpotsInfo>> {
  const limited = events.filter((e) => e.capacity != null && e.capacity > 0);
  const result = new Map<string, SpotsInfo>();
  if (limited.length === 0) return result;

  const keys = Array.from(new Set(limited.map(seriesKeyOf)));
  const wholeByKey = new Map<string, number>();
  const dropInByOccurrence = new Map<string, number>();

  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('class_registrations')
      .select('id, series_key, is_drop_in, occurrence_event_id')
      .in('series_key', keys)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error('Failed to count registrations for capacity:', error.message);
      throw new Error('Failed to count registrations.');
    }
    for (const r of data ?? []) {
      if (r.is_drop_in) {
        if (r.occurrence_event_id) dropInByOccurrence.set(r.occurrence_event_id, (dropInByOccurrence.get(r.occurrence_event_id) ?? 0) + 1);
      } else if (r.series_key) {
        wholeByKey.set(r.series_key, (wholeByKey.get(r.series_key) ?? 0) + 1);
      }
    }
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  for (const e of limited) {
    const taken = (wholeByKey.get(seriesKeyOf(e)) ?? 0) + (dropInByOccurrence.get(e.id) ?? 0);
    result.set(e.id, { capacity: e.capacity!, taken, remaining: Math.max(0, e.capacity! - taken) });
  }
  return result;
}

// The tightest occurrence among `occurrenceIds` (a series is only as open as
// its fullest class), or null when none of them has a capacity.
export function seriesSpots(spots: Map<string, SpotsInfo>, occurrenceIds: string[]): SpotsInfo | null {
  let tightest: SpotsInfo | null = null;
  for (const id of occurrenceIds) {
    const s = spots.get(id);
    if (s && (!tightest || s.remaining < tightest.remaining)) tightest = s;
  }
  return tightest;
}

export function spotsLabel(remaining: number): string {
  if (remaining <= 0) return 'Full';
  return `${remaining} ${remaining === 1 ? 'spot' : 'spots'} remaining`;
}

// Server-side capacity check for a registration of `attendeeCount` people.
// Fails closed (503) if the count can't be loaded.
export async function validateCapacity(selections: ParsedClassSelection[], attendeeCount: number): Promise<ClassSelectionError | null> {
  const keys = Array.from(new Set(selections.map((s) => s.key).filter((k): k is string => !!k && /^[A-Za-z0-9_-]+$/.test(k))));
  if (keys.length === 0 || attendeeCount <= 0) return null;
  const ids = keys.filter((k) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k));

  const nowIso = new Date().toISOString();
  const base = () =>
    supabase.from('events').select('id, google_recurring_event_id, capacity, start_time').not('capacity', 'is', null).gte('start_time', nowIso);
  const [byId, byRecurring] = await Promise.all([ids.length > 0 ? base().in('id', ids) : null, base().in('google_recurring_event_id', keys)]);
  if (byId?.error || byRecurring.error) {
    console.error('Failed to load capacities:', byId?.error?.message ?? byRecurring.error?.message);
    return { message: "We couldn't confirm there's still room right now. Please try again in a minute.", status: 503 };
  }
  const events = [...(byId?.data ?? []), ...(byRecurring.data ?? [])];
  if (events.length === 0) return null;

  let spots: Map<string, SpotsInfo>;
  try {
    spots = await getSpotsByOccurrence(events);
  } catch {
    return { message: "We couldn't confirm there's still room right now. Please try again in a minute.", status: 503 };
  }

  for (const sel of selections) {
    if (!sel.key) continue;
    const occurrenceIds =
      sel.mode === 'dropin' && sel.occurrenceEventId
        ? [sel.occurrenceEventId]
        : events.filter((e) => seriesKeyOf(e) === sel.key).map((e) => e.id);
    const tightest = seriesSpots(spots, occurrenceIds);
    if (!tightest || tightest.remaining >= attendeeCount) continue;
    return {
      message:
        tightest.remaining === 0
          ? `Sorry, "${sel.title}" is full.`
          : `Sorry, "${sel.title}" only has ${spotsLabel(tightest.remaining)} — please register fewer people.`,
      status: 400,
    };
  }
  return null;
}

// Admin form value → stored capacity: a positive whole number, or null (unlimited).
export function toCapacity(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}
