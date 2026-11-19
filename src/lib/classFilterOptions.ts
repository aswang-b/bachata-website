// The dashboard's "Filter by class" on the Sign-Ups, Check-Ins and Attendance
// tabs. Like the Event Registration filter (eventRegistrationFilter.ts), it goes
// by the class's series key, never by title or by part of a title: two classes
// with one name on different dates are two entries, and a class whose title
// contains another's is not matched by it. Entries are one per series, labelled
// with the title and its date or date range in the class's own zone. A row that
// carries no key (older rows, a check-in with no class date) is told apart by
// its exact title. Pure, so it's unit-tested.
import {
  entryFilterValue,
  eventFilterOptions,
  matchesEventFilter,
  type EventFilterEntry,
  type EventFilterOption,
  type EventFilterSeries,
} from './eventRegistrationFilter';

// What a row says about its class: its title and, when known, its series key
// (google_recurring_event_id ?? id), which outlasts a rename.
export interface ClassFilterRow extends EventFilterEntry {
  // When the row was made, for telling apart two title-only entries that share a name.
  createdAt?: string | null;
}

export interface ClassFilterSignupEntry extends ClassFilterRow {
  seriesMode: 'whole' | 'dropin' | null;
  occurrenceEventId: string | null;
}

// One filter row: the entry picked ('' = none) and the date picked ('' = every date).
export interface ClassFilterPick {
  value: string;
  occurrenceId: string;
}

// Everything the three tabs' rows say about their classes, for building the entries.
export function classFilterRows(src: {
  signups: { createdAt: string; classRegistrations: EventFilterEntry[] }[];
  checkins: { createdAt: string; classTitle: string; seriesKey?: string | null }[];
  attendance: EventFilterEntry[];
  orphanedCheckins: { created_at: string; class_title: string; seriesKey?: string | null }[];
}): ClassFilterRow[] {
  return [
    ...src.signups.flatMap((s) => s.classRegistrations.map((e) => ({ classTitle: e.classTitle, seriesKey: e.seriesKey, createdAt: s.createdAt }))),
    ...src.checkins.map((c) => ({ classTitle: c.classTitle, seriesKey: c.seriesKey, createdAt: c.createdAt })),
    ...src.attendance.map((e) => ({ classTitle: e.classTitle, seriesKey: e.seriesKey })),
    ...src.orphanedCheckins.map((c) => ({ classTitle: c.class_title, seriesKey: c.seriesKey, createdAt: c.created_at })),
  ];
}

// Rows with no date to show (attendance entries) get a fixed, valid one.
const NO_DATE = '1970-01-01T00:00:00.000Z';

// Every class series (soonest first, so two same-titled classes show their dates),
// then an exact-title entry for rows no listed series claims.
export function classFilterOptions(rows: ClassFilterRow[], series: EventFilterSeries[]): EventFilterOption[] {
  return eventFilterOptions(
    rows.map((r) => ({ createdAt: r.createdAt || NO_DATE, classRegistrations: [r] })),
    series,
    series.map((s) => s.key)
  );
}

// A check-in or attendance row passes a pick when its class is the one picked
// and, with a date picked, it is for that date.
export function rowMatchesClassPick(row: EventFilterEntry, eventId: string | null, pick: ClassFilterPick): boolean {
  return matchesEventFilter([row], pick.value) && (!pick.occurrenceId || eventId === pick.occurrenceId);
}

// A dancer passes a pick when one of their classes is the one picked and, with a
// date picked, they attend it: a Whole-Series sign-up covers every date, a
// Drop-In only the one it was for (one with no recorded date can't be placed).
export function signupMatchesClassPick(entries: ClassFilterSignupEntry[], pick: ClassFilterPick): boolean {
  return entries.some(
    (e) => entryFilterValue(e) === pick.value && (!pick.occurrenceId || e.seriesMode === 'whole' || e.occurrenceEventId === pick.occurrenceId)
  );
}
