// The editor's date and time fields <-> instants.
import { zonedDateKey, zonedTimeOfDay, zonedToInstant } from '../../../lib/siteTime';

// The class's date and times are in its own zone (`tz`: the editor's picked
// zone, timeZone.ts), whatever zone the admin's own device is in; without one,
// the site's (siteTime.ts).
export function toLocalParts(iso: string, tz?: string) {
  return { date: zonedDateKey(iso, tz), time: zonedTimeOfDay(iso, tz) };
}

export function fromLocalParts(date: string, time: string, tz?: string) {
  return zonedToInstant(date, time, tz).toISOString();
}

// datetime-local inputs (when a deal ends) want/give "YYYY-MM-DDTHH:mm", in
// the site's time zone: a deal is a "now"-level thing, not a class's time.
export function toLocalDateTimeValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const { date, time } = toLocalParts(iso);
  return `${date}T${time}`;
}

export function fromLocalDateTimeValue(value: string): string | null {
  if (!value) return null;
  const [date, time] = value.split('T');
  return zonedToInstant(date, time?.slice(0, 5) ?? '00:00').toISOString();
}
