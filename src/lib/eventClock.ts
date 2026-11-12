// A class's own date and time, in its own zone (events.time_zone, migration
// 0076): a Santa Fe class shows Mountain time while the site is on Pacific,
// with its zone after the time ("7:00 PM–8:00 PM MT") only when its clock
// differs from the site's. "Now"-level things (today's window, deal ends)
// stay in the site zone. Pure, so the server and the calendar's browser
// script share it.
import { eventZone, siteFormatter, zonedDateKey, zoneSuffix } from './siteTime';

export interface ZonedEvent {
  start_time: string;
  end_time?: string | null;
  time_zone?: string | null;
}

const timeFormat = (tz: string) => siteFormatter({ hour: 'numeric', minute: '2-digit' }, 'en-US', tz);

// "7:00 PM–8:00 PM" (plus " MT" off the site's clock); just the start without an end.
export function timeRange(start: string, end: string | null | undefined, tz: string): string {
  const f = timeFormat(tz);
  return `${f.format(new Date(start))}${end ? `–${f.format(new Date(end))}` : ''}${zoneSuffix(start, tz)}`;
}

export function eventTimeRange(event: ZonedEvent): string {
  return timeRange(event.start_time, event.end_time, eventZone(event));
}

// The event's start in its own zone with any formatter options ("Tue, Nov 4").
export function eventDate(event: ZonedEvent, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return siteFormatter(options, 'en-US', eventZone(event)).format(new Date(event.start_time));
}

// "Tuesday, November 4, 7:00 PM–8:00 PM" (date options as given; " MT" off the site's clock).
export function eventSchedule(event: ZonedEvent, dateOptions: Intl.DateTimeFormatOptions): string {
  return `${eventDate(event, dateOptions)}, ${eventTimeRange(event)}`;
}

// "YYYY-MM-DD" of the day it falls on in its own zone: its calendar day.
export function eventDayKey(event: ZonedEvent): string {
  return zonedDateKey(event.start_time, eventZone(event));
}

// Whether it's on today's date where it takes place.
export function isEventToday(event: ZonedEvent, now: Date = new Date()): boolean {
  const tz = eventZone(event);
  return zonedDateKey(event.start_time, tz) === zonedDateKey(now, tz);
}

const STAMP: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };

// When a class starts, for admin lists ("Nov 4, 2026, 7:00 PM MT"): in its own
// zone (`tz`; the site's when missing), with its zone off the site's clock;
// "—" without a start. Options without a time print no zone.
export function classStamp(start: string | null | undefined, tz?: string | null, options: Intl.DateTimeFormatOptions = STAMP): string {
  if (!start) return '—';
  const zone = eventZone({ time_zone: tz });
  const timed = options.hour !== undefined || options.timeStyle !== undefined;
  return `${siteFormatter(options, 'en-US', zone).format(new Date(start))}${timed ? zoneSuffix(start, zone) : ''}`;
}
