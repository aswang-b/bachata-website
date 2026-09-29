export const TIME_ZONE = 'America/Chicago';

export interface ClassOccurrenceRow {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  google_recurring_event_id: string | null;
  price_whole_series?: number | null;
  price_drop_in?: number | null;
  price_student?: number | null;
  description?: string | null;
  location?: string | null;
  image_url?: string | null;
  event_type?: string;
  color?: string | null;
  registration_closed?: boolean;
  price_whole_series_early_bird?: number | null;
  price_drop_in_early_bird?: number | null;
  price_student_early_bird?: number | null;
  early_bird_until?: string | null;
  price_whole_series_flash_sale?: number | null;
  price_drop_in_flash_sale?: number | null;
  price_student_flash_sale?: number | null;
  flash_sale_until?: string | null;
}

export interface ClassSeriesOccurrence {
  id: string;
  label: string;
  startTime: string;
}

export interface SeriesKeyRow {
  id: string;
  google_recurring_event_id: string | null;
}

export interface ClassSeriesEntry {
  key: string;
  title: string;
  isSeries: boolean;
  subLabel: string;
  singleEventId: string | null;
  occurrences: ClassSeriesOccurrence[];
  // The series' whole-series occurrence count (e.g. all 4 weeks of a
  // 4-week series), independent of how many of those occurrences are
  // still upcoming in `occurrences` — so a "4-Week Series" label doesn't
  // shrink to "3-Week Series" once the first class has passed.
  totalOccurrences: number;
  priceWholeSeries: number | null;
  priceDropIn: number | null;
  priceStudent: number | null;
  description: string | null;
  location: string | null;
  imageUrl: string | null;
  eventType: string;
  nextStartTime: string;
  color: string;
  registrationClosed: boolean;
  priceWholeSeriesEarlyBird: number | null;
  priceDropInEarlyBird: number | null;
  priceStudentEarlyBird: number | null;
  earlyBirdUntil: string | null;
  priceWholeSeriesFlashSale: number | null;
  priceDropInFlashSale: number | null;
  priceStudentFlashSale: number | null;
  flashSaleUntil: string | null;
}

const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TIME_ZONE });
const dateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TIME_ZONE });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });

// Counts occurrences per recurring series (or per standalone class),
// regardless of date — the basis for a series' true "whole series" size.
export function countOccurrencesByKey(events: SeriesKeyRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = event.google_recurring_event_id ?? event.id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Groups class occurrences into one entry per recurring series (or per
// standalone class), matching the selector on the public check-in form.
// `events` may be date-filtered (e.g. upcoming-only) for what's actually
// offered; pass the unfiltered whole-series rows as `allEventsForTotals`
// so `totalOccurrences`/`isSeries` reflect the full series regardless of
// how many occurrences have already passed.
export function buildClassSeriesList(events: ClassOccurrenceRow[], allEventsForTotals?: SeriesKeyRow[]): ClassSeriesEntry[] {
  const totalCountByKey = allEventsForTotals ? countOccurrencesByKey(allEventsForTotals) : null;

  const seriesMap = new Map<string, ClassOccurrenceRow[]>();
  for (const event of events) {
    const key = event.google_recurring_event_id ?? event.id;
    const existing = seriesMap.get(key) ?? [];
    existing.push(event);
    seriesMap.set(key, existing);
  }

  return Array.from(seriesMap.entries()).map(([key, occurrences]) => {
    const sorted = [...occurrences].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    const first = sorted[0];
    const totalOccurrences = totalCountByKey?.get(key) ?? sorted.length;
    const isSeries = totalOccurrences > 1;
    const timeRange = `${timeFormatter.format(new Date(first.start_time))}–${timeFormatter.format(new Date(first.end_time))}`;

    return {
      key,
      title: first.title,
      isSeries,
      totalOccurrences,
      subLabel: isSeries
        ? `${weekdayFormatter.format(new Date(first.start_time))}s, ${timeRange}`
        : `${dateFormatter.format(new Date(first.start_time))}, ${timeRange}`,
      singleEventId: isSeries ? null : first.id,
      occurrences: sorted.map((occ) => ({
        id: occ.id,
        label: `${dateFormatter.format(new Date(occ.start_time))}, ${timeFormatter.format(new Date(occ.start_time))}`,
        startTime: occ.start_time,
      })),
      priceWholeSeries: first.price_whole_series ?? null,
      priceDropIn: first.price_drop_in ?? null,
      priceStudent: first.price_student ?? null,
      description: first.description ?? null,
      location: first.location ?? null,
      imageUrl: first.image_url ?? null,
      eventType: first.event_type ?? 'class',
      nextStartTime: first.start_time,
      color: first.color ?? 'accent',
      registrationClosed: first.registration_closed ?? false,
      priceWholeSeriesEarlyBird: first.price_whole_series_early_bird ?? null,
      priceDropInEarlyBird: first.price_drop_in_early_bird ?? null,
      priceStudentEarlyBird: first.price_student_early_bird ?? null,
      earlyBirdUntil: first.early_bird_until ?? null,
      priceWholeSeriesFlashSale: first.price_whole_series_flash_sale ?? null,
      priceDropInFlashSale: first.price_drop_in_flash_sale ?? null,
      priceStudentFlashSale: first.price_student_flash_sale ?? null,
      flashSaleUntil: first.flash_sale_until ?? null,
    };
  });
}

// Shared "today" boundary in the studio's timezone, expressed as UTC ISO
// instants — used both to filter "upcoming" occurrences and, for check-in,
// to resolve which of a series' occurrences falls on today's date.
export function chicagoDayBoundsUtcIso(now: Date = new Date()): { startIso: string; endIso: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const startIso = localMidnightIso(get('year'), get('month'), get('day'));
  // Next day's midnight rather than start + 24h, since DST days are 23 or 25 hours long.
  const endIso = localMidnightIso(...nextDay(get('year'), get('month'), get('day')));
  return { startIso: new Date(startIso).toISOString(), endIso: new Date(endIso).toISOString() };
}

function nextDay(year: number, month: number, day: number): [number, number, number] {
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

// Midnight in the studio's timezone, using the UTC offset in effect at midnight
// (not at "now"), which differs on the day DST starts or ends. DST changes at
// 2am local, so the offset at 06:00Z (00:00-01:00 local) is the midnight offset.
function localMidnightIso(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetName =
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(Date.UTC(year, month - 1, day, 6)))
      .find((p) => p.type === 'timeZoneName')?.value ?? ''; // e.g. "GMT-5"
  const offsetHours = parseInt(offsetName.replace('GMT', ''), 10) || 0;
  const offsetStr = `${offsetHours <= 0 ? '-' : '+'}${pad(Math.abs(offsetHours))}:00`;
  return `${year}-${pad(month)}-${pad(day)}T00:00:00${offsetStr}`;
}
