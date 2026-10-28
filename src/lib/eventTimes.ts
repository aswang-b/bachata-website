// Pure — safe for both the event editor's browser script and server routes.
import { addDaysToKey, zonedToInstant } from './siteTime';
// An end time earlier than the start (e.g. 8:00 PM to 12:00 AM) means the
// next day; Google rejects an event whose end isn't after its start.

// The editor's date + start/end "HH:mm" (in the site's time zone) → the end as
// an ISO instant, rolled to the next day when it's before the start. Null when
// the end equals the start (a zero-length event).
export function endAfterStart(date: string, startTime: string, endTime: string): string | null {
  if (endTime === startTime) return null;
  const endDate = endTime < startTime ? addDaysToKey(date, 1) : date;
  return zonedToInstant(endDate, endTime).toISOString();
}

// A recurring series' first-occurrence end date ("YYYY-MM-DD"): the anchor
// date, or the day after when the end "HH:mm" is at or before the start.
export function seriesAnchorEndDate(anchorDate: string, startTime: string, endTime: string): string {
  return endTime <= startTime ? new Date(Date.parse(`${anchorDate}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : anchorDate;
}

interface OrderedEvent {
  id: string;
  start_time: string;
  end_time?: string | null;
  google_recurring_event_id?: string | null;
}

// Each series' (or lone event's) first start, keyed by its recurring id (or own id).
export function seriesFirstStarts(events: OrderedEvent[]): Map<string, string> {
  const firsts = new Map<string, string>();
  for (const e of events) {
    const key = e.google_recurring_event_id ?? e.id;
    const seen = firsts.get(key);
    if (!seen || Date.parse(e.start_time) < Date.parse(seen)) firsts.set(key, e.start_time);
  }
  return firsts;
}

// The calendar's order: by start, then whichever ends first, then the series
// that began first (events have no creation date; a series' first class stands
// in), then the series id, so two series sharing a time slot keep the same
// order every week. `firsts` comes from seriesFirstStarts over whole series.
export function calendarOrder(firsts: Map<string, string>) {
  const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);
  return (a: OrderedEvent, b: OrderedEvent): number => {
    const keyA = a.google_recurring_event_id ?? a.id;
    const keyB = b.google_recurring_event_id ?? b.id;
    return (
      time(a.start_time) - time(b.start_time) ||
      time(a.end_time ?? a.start_time) - time(b.end_time ?? b.start_time) ||
      time(firsts.get(keyA) ?? a.start_time) - time(firsts.get(keyB) ?? b.start_time) ||
      (keyA < keyB ? -1 : keyA > keyB ? 1 : 0)
    );
  };
}

// Events take registrations until 30 minutes after they end, so people can
// sign up at the door; classes stop when they start.
export const EVENT_LATE_REGISTRATION_MS = 30 * 60 * 1000;

export function registrationOpen(e: { event_type?: string | null; start_time: string; end_time?: string | null }, now = Date.now()): boolean {
  if (e.event_type === 'event') return Date.parse(e.end_time ?? e.start_time) + EVENT_LATE_REGISTRATION_MS > now;
  return Date.parse(e.start_time) >= now;
}

// The earliest end time an event can have and still take registrations (for a
// database filter; registrationOpen then decides per class or event).
export function lateRegistrationCutoffIso(now = Date.now()): string {
  return new Date(now - EVENT_LATE_REGISTRATION_MS).toISOString();
}
