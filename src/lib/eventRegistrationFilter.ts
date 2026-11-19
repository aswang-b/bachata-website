// The Event Registration tab's "Filter by event". Options and matching go by
// the event's series key (google_recurring_event_id ?? id, which outlasts a
// rename), never by title: two socials with the same name on different dates
// are two options, and a recurring series stays one. Pure, so it's unit-tested.
import type { ClassSeriesEntry } from './classSeries';
import { dateRange } from './flyerBlocks';
import { siteFormatter } from './siteTime';

export type EventFilterSeries = Pick<ClassSeriesEntry, 'key' | 'title' | 'timeZone' | 'isSeries' | 'occurrences' | 'nextStartTime'>;

export interface EventFilterEntry {
  classTitle: string;
  seriesKey?: string | null;
}

export interface EventFilterSignup {
  createdAt: string;
  classRegistrations: EventFilterEntry[];
}

export interface EventFilterOption {
  value: string;
  label: string;
}

// Registrations saved before they kept a series key can only be told apart by title.
const TITLE_VALUE = 'title:';

// What a registration entry is filtered by: its series key, else its title.
export function entryFilterValue(entry: EventFilterEntry): string {
  return entry.seriesKey || `${TITLE_VALUE}${entry.classTitle}`;
}

// A dancer passes when no event is chosen or any of their events is it.
export function matchesEventFilter(entries: EventFilterEntry[], value: string): boolean {
  return !value || entries.some((e) => entryFilterValue(e) === value);
}

// "Fri, Nov 20" for one date, "Nov 20 – Dec 11" for a series: in the event's own zone.
export function eventDateLabel(series: EventFilterSeries): string {
  if (series.isSeries) return dateRange(series);
  const first = series.occurrences[0]?.startTime ?? series.nextStartTime;
  return siteFormatter({ weekday: 'short', month: 'short', day: 'numeric' }, 'en-US', series.timeZone).format(new Date(first));
}

export const eventOptionLabel = (series: EventFilterSeries) => `${series.title} · ${eventDateLabel(series)}`;

// The title a "+ N from …" note names: with its date when another event shares the title.
export function eventNoteLabel(key: string, fallbackTitle: string, allSeries: EventFilterSeries[]): string {
  const series = allSeries.find((s) => s.key === key);
  if (!series) return fallbackTitle;
  return allSeries.some((s) => s.key !== key && s.title === series.title) ? eventOptionLabel(series) : series.title;
}

const firstStart = (s: EventFilterSeries) => Date.parse(s.occurrences[0]?.startTime ?? s.nextStartTime);

// One option per event that has registrations or that others' headcount counts
// toward (`extraKeys`), soonest first with the title as tiebreak; events and
// title-only groups with no date known (deleted events, old rows) come last by title.
export function eventFilterOptions(signups: EventFilterSignup[], series: EventFilterSeries[], extraKeys: string[] = []): EventFilterOption[] {
  const byKey = new Map(series.map((s) => [s.key, s]));
  const wanted = new Set(extraKeys.filter((k) => byKey.has(k)));
  // Registrations whose event isn't listed any more (deleted): one option each, never merged by title.
  const unlisted = new Map<string, { title: string; firstSignup: string }>();
  for (const s of signups) {
    for (const e of s.classRegistrations) {
      if (!e.classTitle && !e.seriesKey) continue;
      const value = entryFilterValue(e);
      if (e.seriesKey && byKey.has(e.seriesKey)) wanted.add(e.seriesKey);
      else {
        const seen = unlisted.get(value);
        if (!seen) unlisted.set(value, { title: e.classTitle || 'Unknown event', firstSignup: s.createdAt });
        else if (Date.parse(s.createdAt) < Date.parse(seen.firstSignup)) seen.firstSignup = s.createdAt;
      }
    }
  }

  const dated = [...wanted]
    .map((key) => byKey.get(key)!)
    .sort((a, b) => firstStart(a) - firstStart(b) || a.title.localeCompare(b.title))
    .map((s) => ({ value: s.key, label: eventOptionLabel(s) }));

  const entries = [...unlisted.entries()].map(([value, u]) => ({ value, title: u.title, old: value.startsWith(TITLE_VALUE), firstSignup: u.firstSignup }));
  const base = (u: (typeof entries)[number]) => (u.old ? u.title : `${u.title} (no longer listed)`);
  const stamp = (iso: string) => siteFormatter({ month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
  const rest = entries
    .sort((a, b) => a.title.localeCompare(b.title) || a.value.localeCompare(b.value))
    .map((u) => ({
      value: u.value,
      // Two with one title: told apart by when the first dancer signed up.
      label: entries.filter((o) => base(o) === base(u)).length > 1 ? `${base(u)} · first sign-up ${stamp(u.firstSignup)}` : base(u),
    }));
  return [...dated, ...rest];
}
