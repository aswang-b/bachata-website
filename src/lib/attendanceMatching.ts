import type { ClassSeriesEntry } from './classSeries';

export function normalizeName(first: string, last: string): string {
  return `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface AttendanceRegistrationRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  class_title: string;
  series_mode: 'whole' | 'dropin' | null;
  price: number | null;
  created_at: string;
}

export interface AttendanceCheckinRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  class_title: string;
  event_id: string | null;
  created_at: string;
}

export interface AttendanceEntry {
  classRegistrationId: string;
  occurrenceEventId: string | null;
  // Used for the upcoming/orphaned cutoff. Null only when no matching series
  // could be found at all (e.g. the series was later deleted from `events`).
  occurrenceDate: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  classTitle: string;
  seriesMode: 'whole' | 'dropin' | null;
  price: number | null;
}

// A registration's `class_title` can recur across unrelated series over
// time (e.g. "Bachata Foundations" run again next quarter), so when more
// than one series shares a title, prefer the one whose start date is
// closest to when the registration was actually made.
function pickClosestSeries(candidates: ClassSeriesEntry[], createdAt: string): ClassSeriesEntry | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const createdTime = new Date(createdAt).getTime();
  return candidates.reduce((best, s) => {
    const bestDiff = Math.abs(new Date(best.nextStartTime).getTime() - createdTime);
    const diff = Math.abs(new Date(s.nextStartTime).getTime() - createdTime);
    return diff < bestDiff ? s : best;
  });
}

// Expands each registration into one "expected attendance" entry per class
// occurrence for a Whole Series sign-up (so partial attendance is visible),
// or a single entry for a Drop-In (or legacy/non-series) sign-up, satisfied
// by a check-in on any date within that series' window.
export function expandRegistrationsToEntries(
  registrations: AttendanceRegistrationRow[],
  classSeriesList: ClassSeriesEntry[]
): AttendanceEntry[] {
  const entries: AttendanceEntry[] = [];

  for (const reg of registrations) {
    const base = {
      classRegistrationId: reg.id,
      firstName: reg.first_name,
      lastName: reg.last_name,
      phone: reg.phone,
      email: reg.email,
      classTitle: reg.class_title,
      seriesMode: reg.series_mode,
      price: reg.price,
    };

    if (reg.series_mode === 'whole') {
      const candidates = classSeriesList.filter((s) => s.isSeries && s.title === reg.class_title);
      const series = pickClosestSeries(candidates, reg.created_at);
      if (series) {
        for (const occ of series.occurrences) {
          entries.push({ ...base, occurrenceEventId: occ.id, occurrenceDate: occ.startTime });
        }
        continue;
      }
      // No matching series found (e.g. deleted after the fact) — fall back
      // to a single unexpandable entry rather than losing it entirely.
      entries.push({ ...base, occurrenceEventId: null, occurrenceDate: null });
      continue;
    }

    // Drop-In (or a legacy/non-series row) — one entry, not pinned to a
    // specific date, but still needs *a* date to know when it becomes due:
    // the matching series' (or single event's) last/only occurrence.
    const candidates = classSeriesList.filter((s) => s.title === reg.class_title);
    const series = pickClosestSeries(candidates, reg.created_at);
    const lastOccurrence = series?.occurrences[series.occurrences.length - 1] ?? null;
    entries.push({ ...base, occurrenceEventId: null, occurrenceDate: lastOccurrence?.startTime ?? null });
  }

  return entries;
}

export type AttendanceStatus = 'matched' | 'no_show' | 'orphaned' | 'upcoming';

export interface ResolvedAttendanceEntry extends AttendanceEntry {
  status: AttendanceStatus;
  matchedCheckin: AttendanceCheckinRow | null;
}

export interface ManualMatch {
  classRegistrationId: string;
  occurrenceEventId: string | null;
  checkinId: string;
}

export interface ManualNoShow {
  classRegistrationId: string;
  occurrenceEventId: string | null;
}

function entryKey(classRegistrationId: string, occurrenceEventId: string | null): string {
  return `${classRegistrationId}::${occurrenceEventId ?? 'single'}`;
}

// The core matcher. Two records are only ever the same person if their
// (normalized) name matches — phone/email only disambiguates *within* a
// set of same-named candidates, and is never used to link different names
// (e.g. two siblings sharing one parent's phone number must stay distinct).
export function matchAttendance(
  entries: AttendanceEntry[],
  checkins: AttendanceCheckinRow[],
  manualMatches: ManualMatch[],
  manualNoShows: ManualNoShow[],
  now: Date = new Date()
): { resolved: ResolvedAttendanceEntry[]; orphanedCheckins: AttendanceCheckinRow[] } {
  const checkinById = new Map(checkins.map((c) => [c.id, c]));
  const manualMatchByEntry = new Map(manualMatches.map((m) => [entryKey(m.classRegistrationId, m.occurrenceEventId), m.checkinId]));
  const manualNoShowKeys = new Set(manualNoShows.map((m) => entryKey(m.classRegistrationId, m.occurrenceEventId)));

  const resolved: ResolvedAttendanceEntry[] = [];
  const remainingEntries: AttendanceEntry[] = [];
  const consumedCheckinIds = new Set<string>();

  for (const entry of entries) {
    const key = entryKey(entry.classRegistrationId, entry.occurrenceEventId);
    const manualCheckinId = manualMatchByEntry.get(key);
    if (manualCheckinId) {
      consumedCheckinIds.add(manualCheckinId);
      resolved.push({ ...entry, status: 'matched', matchedCheckin: checkinById.get(manualCheckinId) ?? null });
      continue;
    }
    if (manualNoShowKeys.has(key)) {
      resolved.push({ ...entry, status: 'no_show', matchedCheckin: null });
      continue;
    }
    remainingEntries.push(entry);
  }

  const remainingCheckins = checkins.filter((c) => !consumedCheckinIds.has(c.id));

  const groupKey = (name: string, classTitle: string) => `${name}::${classTitle}`;
  const checkinsByGroup = new Map<string, AttendanceCheckinRow[]>();
  for (const c of remainingCheckins) {
    const k = groupKey(normalizeName(c.first_name, c.last_name), c.class_title);
    const arr = checkinsByGroup.get(k) ?? [];
    arr.push(c);
    checkinsByGroup.set(k, arr);
  }

  const usedCheckinIds = new Set<string>();

  for (const entry of remainingEntries) {
    const k = groupKey(normalizeName(entry.firstName, entry.lastName), entry.classTitle);
    const sameNameCandidates = (checkinsByGroup.get(k) ?? []).filter((c) => !usedCheckinIds.has(c.id));

    // A Whole-Series entry must match its exact occurrence date; a Drop-In
    // (or unexpandable) entry can match any occurrence of that same class.
    const pool = entry.occurrenceEventId
      ? sameNameCandidates.filter((c) => c.event_id === entry.occurrenceEventId)
      : sameNameCandidates;

    let matched: AttendanceCheckinRow | null = null;
    if (pool.length === 1) {
      matched = pool[0];
    } else if (pool.length > 1) {
      const agreeing = pool.filter((c) => (entry.phone && c.phone === entry.phone) || (entry.email && c.email === entry.email));
      if (agreeing.length === 1) matched = agreeing[0];
      // Otherwise still ambiguous (e.g. two same-named dancers who also
      // share contact info, or neither side has any) — left unmatched
      // below for manual reconciliation rather than guessed.
    }

    if (matched) {
      usedCheckinIds.add(matched.id);
      resolved.push({ ...entry, status: 'matched', matchedCheckin: matched });
      continue;
    }

    const dueDate = entry.occurrenceDate ? new Date(entry.occurrenceDate) : null;
    const isPastOrToday = !dueDate || dueDate <= now;
    resolved.push({ ...entry, status: isPastOrToday ? 'orphaned' : 'upcoming', matchedCheckin: null });
  }

  const orphanedCheckins = remainingCheckins.filter((c) => !usedCheckinIds.has(c.id));
  return { resolved, orphanedCheckins };
}
