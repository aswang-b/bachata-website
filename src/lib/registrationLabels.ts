// The registration form's class labels (/register, /register/events), in each
// class's own zone (eventClock.ts), with its zone after the time when that
// differs from the site's clock. The label a dancer picks is what a sign-up
// saves as its class_label. Pure.
import { eventDayKey, timeRange, type ZonedEvent } from './eventClock';
import { eventZone, siteFormatter } from './siteTime';

interface Occurrence extends ZonedEvent {
  end_time: string;
}

const shortDate = (iso: string, tz: string) => siteFormatter({ month: 'short', day: 'numeric' }, 'en-US', tz).format(new Date(iso));

// "Tuesdays, 7:00 PM–8:00 PM (Oct 7–Oct 28)", or for a one-off event
// "Saturday, Nov 8, 9:00 PM–1:00 AM". `whole` is the series' first and last
// class, past ones included (flyerBlocks.seriesBounds); the series' zone is its
// first listed class's.
export function seriesSubLabel(
  first: Occurrence,
  last: Occurrence,
  whole: { first: string; last: string } | undefined,
  isSeries: boolean,
  isEvent: boolean
): string {
  const tz = eventZone(first);
  const weekday = siteFormatter({ weekday: 'long' }, 'en-US', tz).format(new Date(first.start_time));
  const times = timeRange(first.start_time, first.end_time, tz);
  const dates = isSeries
    ? `${shortDate(whole?.first ?? first.start_time, tz)}–${shortDate(whole?.last ?? last.start_time, tz)}`
    : shortDate(first.start_time, tz);
  return isEvent && !isSeries ? `${weekday}, ${dates}, ${times}` : `${weekday}s, ${times} (${dates})`;
}

// One class date: its day in its own zone (the linked-class rule "a Drop-In
// only takes in what it includes that day", which the server checks with the
// same eventDayKey) and its label ("Oct 7, 7:00 PM").
export function occurrenceChoice(occ: ZonedEvent): { day: string; label: string } {
  const tz = eventZone(occ);
  return { day: eventDayKey(occ), label: `${shortDate(occ.start_time, tz)}, ${timeRange(occ.start_time, null, tz)}` };
}
