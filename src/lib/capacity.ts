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
// Reads the cached counts in event_spot_counts, which database triggers keep
// current on every sign-up change and which count each person once per class
// (see migration 0039) — so this never scans the sign-ups themselves.
export async function getSpotsByOccurrence(events: CapacityEventRow[]): Promise<Map<string, SpotsInfo>> {
  const limited = events.filter((e) => e.capacity != null && e.capacity > 0);
  const result = new Map<string, SpotsInfo>();
  if (limited.length === 0) return result;

  const takenById = new Map<string, number>();
  const ids = Array.from(new Set(limited.map((e) => e.id)));
  // Chunked so a long list of ids doesn't overflow the request URL.
  const CHUNK = 150;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from('event_spot_counts').select('event_id, taken').in('event_id', ids.slice(i, i + CHUNK));
    if (error) {
      console.error('Failed to load spot counts:', error.message);
      throw new Error('Failed to load spot counts.');
    }
    for (const r of data ?? []) takenById.set(r.event_id, r.taken);
  }

  for (const e of limited) {
    // No cached row yet just means nobody has signed up.
    const taken = takenById.get(e.id) ?? 0;
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
// (Counts people who aren't already signed up for the class too, so someone
// re-registering when one spot is left is still turned away; rare enough to
// keep the check simple.)
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
