import { addDaysToKey, siteFormatter, zonedDateKey, zonedToInstant } from './siteTime';

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
  flyer_url?: string | null;
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
  lesson_overview_title?: string | null;
  lesson_overview_body?: string | null;
  hide_lesson_overview?: boolean;
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
  // The uncropped flyer (migration 0055); classes on the same flyer share it.
  flyerUrl: string | null;
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
  // Per-class override of the homepage card's "About This Class Format"
  // section: custom header/body (null = use the default), or hide it entirely.
  lessonOverviewTitle: string | null;
  lessonOverviewBody: string | null;
  hideLessonOverview: boolean;
}

// In the site's time zone (siteTime.ts), looked up when used, since an admin can change it.
const weekdayFormatter = () => siteFormatter({ weekday: 'long' });
const dateFormatter = () => siteFormatter({ weekday: 'short', month: 'short', day: 'numeric' });
const timeFormatter = () => siteFormatter({ hour: 'numeric', minute: '2-digit' });

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
    const timeRange = `${timeFormatter().format(new Date(first.start_time))}–${timeFormatter().format(new Date(first.end_time))}`;

    return {
      key,
      title: first.title,
      isSeries,
      totalOccurrences,
      subLabel: isSeries
        ? `${weekdayFormatter().format(new Date(first.start_time))}s, ${timeRange}`
        : `${dateFormatter().format(new Date(first.start_time))}, ${timeRange}`,
      singleEventId: isSeries ? null : first.id,
      occurrences: sorted.map((occ) => ({
        id: occ.id,
        label: `${dateFormatter().format(new Date(occ.start_time))}, ${timeFormatter().format(new Date(occ.start_time))}`,
        startTime: occ.start_time,
      })),
      priceWholeSeries: first.price_whole_series ?? null,
      priceDropIn: first.price_drop_in ?? null,
      priceStudent: first.price_student ?? null,
      description: first.description ?? null,
      location: first.location ?? null,
      imageUrl: first.image_url ?? null,
      flyerUrl: first.flyer_url ?? null,
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
      lessonOverviewTitle: first.lesson_overview_title ?? null,
      lessonOverviewBody: first.lesson_overview_body ?? null,
      hideLessonOverview: first.hide_lesson_overview ?? false,
    };
  });
}

// Today, as the site's time zone sees it, as UTC ISO instants: used both to
// filter "upcoming" occurrences and, for check-in, to resolve which of a
// series' occurrences falls on today's date. The end is the next midnight, not
// start + 24h, since DST days are 23 or 25 hours long.
export function siteDayBoundsUtcIso(now: Date = new Date()): { startIso: string; endIso: string } {
  const today = zonedDateKey(now);
  return { startIso: zonedToInstant(today).toISOString(), endIso: zonedToInstant(addDaysToKey(today, 1)).toISOString() };
}

// The calendar's type tag. A class that doesn't repeat (no week number) is
// shown as a Workshop, like the registration form does; it's still stored as
// a class.
export function eventTypeLabel(eventType: string | null | undefined, weekNumber: number | null | undefined): string {
  if (eventType === 'event') return 'Event';
  return weekNumber ? 'Class' : 'Workshop';
}
