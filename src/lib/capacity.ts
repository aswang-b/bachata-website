import { supabase } from './supabase';

// Capacity is set per class/event series (copied onto every occurrence, like
// its prices). A Whole Series (or event ticket) registration takes a spot in
// every occurrence of its series; a Drop-In takes one only in the occurrence
// it picked.
//
// A class can instead cap Leaders and Followers separately
// (capacity_by_role, migration 0044): then the general `capacity` is ignored
// (but kept, so the admin can switch back), and a role left blank is
// unlimited. Events never ask for a role, so they always use the general cap.

export const CAPACITY_COLUMNS = 'capacity, show_capacity, capacity_by_role, leader_capacity, follower_capacity';

export interface CapacityEventRow {
  id: string;
  google_recurring_event_id: string | null;
  capacity?: number | null;
  capacity_by_role?: boolean | null;
  leader_capacity?: number | null;
  follower_capacity?: number | null;
}

export type DancerRole = 'leader' | 'follower';

export interface SpotCount {
  capacity: number;
  taken: number;
  remaining: number;
}

export interface SpotsInfo {
  byRole: boolean;
  // The general cap; null when capped by role.
  total: SpotCount | null;
  // Role caps (byRole only); null = that role has no cap.
  leader: SpotCount | null;
  follower: SpotCount | null;
  // No one more can register: the general cap is reached, or both roles are capped and both full.
  full: boolean;
}

export const seriesKeyOf = (e: { id: string; google_recurring_event_id: string | null }) => e.google_recurring_event_id ?? e.id;

const positive = (n: number | null | undefined): n is number => n != null && n > 0;

function hasCapacity(e: CapacityEventRow): boolean {
  return e.capacity_by_role ? positive(e.leader_capacity) || positive(e.follower_capacity) : positive(e.capacity);
}

function spotCount(capacity: number | null | undefined, taken: number): SpotCount | null {
  return positive(capacity) ? { capacity, taken, remaining: Math.max(0, capacity - taken) } : null;
}

function isFull(s: Omit<SpotsInfo, 'full'>): boolean {
  if (!s.byRole) return s.total != null && s.total.remaining <= 0;
  return s.leader != null && s.follower != null && s.leader.remaining <= 0 && s.follower.remaining <= 0;
}

// Spots for every given occurrence that has a capacity, keyed by occurrence id.
// Reads the cached counts in event_spot_counts, which database triggers keep
// current on every sign-up change and which count each person once per class
// (see migrations 0039 and 0044) — so this never scans the sign-ups themselves.
// Through spot_counts_with_linked (migration 0062), which adds the sign-ups of
// a linked class that includes this one and counts its headcount.
export async function getSpotsByOccurrence(events: CapacityEventRow[]): Promise<Map<string, SpotsInfo>> {
  const limited = events.filter(hasCapacity);
  const result = new Map<string, SpotsInfo>();
  if (limited.length === 0) return result;

  const takenById = new Map<string, { taken: number; leaders: number; followers: number }>();
  const ids = Array.from(new Set(limited.map((e) => e.id)));
  // Chunked so a long list of ids doesn't overflow the request URL.
  const CHUNK = 150;
  const chunks = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) => supabase.rpc('spot_counts_with_linked', { p_event_ids: chunk }))
  );
  for (const { data, error } of results) {
    if (error) {
      console.error('Failed to load spot counts:', error.message);
      throw new Error('Failed to load spot counts.');
    }
    for (const r of data ?? []) takenById.set(r.event_id, { taken: r.taken, leaders: r.leaders_taken, followers: r.followers_taken });
  }

  for (const e of limited) {
    // No cached row yet just means nobody has signed up.
    const t = takenById.get(e.id) ?? { taken: 0, leaders: 0, followers: 0 };
    const byRole = Boolean(e.capacity_by_role);
    const info = {
      byRole,
      total: byRole ? null : spotCount(e.capacity, t.taken),
      leader: byRole ? spotCount(e.leader_capacity, t.leaders) : null,
      follower: byRole ? spotCount(e.follower_capacity, t.followers) : null,
    };
    result.set(e.id, { ...info, full: isFull(info) });
  }
  return result;
}

function tighter(a: SpotCount | null, b: SpotCount | null): SpotCount | null {
  if (!a) return b;
  if (!b) return a;
  return b.remaining < a.remaining ? b : a;
}

// The tightest occurrence among `occurrenceIds` (a series is only as open as
// its fullest class), per role when capped by role, or null when none of them
// has a capacity.
export function seriesSpots(spots: Map<string, SpotsInfo>, occurrenceIds: string[]): SpotsInfo | null {
  let combined: Omit<SpotsInfo, 'full'> | null = null;
  for (const id of occurrenceIds) {
    const s = spots.get(id);
    if (!s) continue;
    combined = combined
      ? { byRole: s.byRole, total: tighter(combined.total, s.total), leader: tighter(combined.leader, s.leader), follower: tighter(combined.follower, s.follower) }
      : s;
  }
  return combined ? { ...combined, full: isFull(combined) } : null;
}

export function remainingFor(s: SpotsInfo, role: DancerRole): number | null {
  return (role === 'leader' ? s.leader : s.follower)?.remaining ?? null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function roleParts(s: SpotsInfo, onlyFull: boolean): string[] {
  const parts: string[] = [];
  for (const [role, count] of [
    ['Leader', s.leader],
    ['Follower', s.follower],
  ] as const) {
    if (!count) continue;
    if (count.remaining <= 0) parts.push(`${role}s full`);
    else if (!onlyFull) parts.push(`${plural(count.remaining, `${role.toLowerCase()} spot`)} left`);
  }
  return parts;
}

// "5 spots remaining", "Full", or per role: "3 leader spots left · Followers full".
export function spotsLabel(s: SpotsInfo): string {
  if (s.full) return 'Full';
  if (!s.byRole) return `${plural(s.total?.remaining ?? 0, 'spot')} remaining`;
  return roleParts(s, false).join(' · ');
}

// What the public sees: the full label when the class shows its capacity,
// otherwise only that it (or one of its roles) is full — or nothing.
export function publicSpotsLabel(s: SpotsInfo | null, showCapacity: boolean): string | null {
  if (!s) return null;
  if (showCapacity || s.full) return spotsLabel(s);
  return roleParts(s, true).join(' · ') || null;
}

// The registration form's message when register_submission (migration 0046)
// refuses a sign-up for taking a class past its capacity. `detail` is the
// error's DETAIL: {"title", "role" ('' = the general cap), "remaining"}.
export function capacityErrorMessage(detail: string | null | undefined): string {
  let d: { title?: unknown; role?: unknown; remaining?: unknown } = {};
  try {
    d = JSON.parse(detail ?? '{}');
  } catch {
    // Fall through to the generic wording.
  }
  const title = typeof d.title === 'string' ? d.title : 'this class';
  const remaining = typeof d.remaining === 'number' ? d.remaining : 0;
  const role = d.role === 'leader' || d.role === 'follower' ? d.role : null;
  if (role) {
    return remaining === 0
      ? `Sorry, "${title}" is full for ${role}s.`
      : `Sorry, "${title}" only has ${plural(remaining, `${role} spot`)} left — please register fewer ${role}s.`;
  }
  return remaining === 0 ? `Sorry, "${title}" is full.` : `Sorry, "${title}" only has ${plural(remaining, 'spot')} remaining — please register fewer people.`;
}

// Admin form value → stored capacity: a positive whole number, or null (unlimited).
export function toCapacity(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The editor's capacity fields → the event row's capacity columns. Both the
// general and the per-role caps are saved (the one not in use is kept for
// switching back); events always use the general cap.
export function capacityColumns(
  body: { capacity?: unknown; showCapacity?: unknown; capacityByRole?: unknown; leaderCapacity?: unknown; followerCapacity?: unknown },
  eventType: 'class' | 'event'
) {
  const capacity = toCapacity(body.capacity);
  const leaderCapacity = toCapacity(body.leaderCapacity);
  const followerCapacity = toCapacity(body.followerCapacity);
  const byRole = eventType === 'class' && Boolean(body.capacityByRole);
  const limited = byRole ? leaderCapacity != null || followerCapacity != null : capacity != null;
  return {
    capacity,
    capacity_by_role: byRole,
    leader_capacity: leaderCapacity,
    follower_capacity: followerCapacity,
    show_capacity: limited && Boolean(body.showCapacity),
  };
}
