// The editor's date and time fields <-> instants, in the site's time zone.
import { zonedDateKey, zonedTimeOfDay, zonedToInstant } from '../../../lib/siteTime';

// The editor's date and time fields are in the site's time zone (siteTime.ts),
// whatever zone the admin's own device is in.
export function toLocalParts(iso: string) {
  return { date: zonedDateKey(iso), time: zonedTimeOfDay(iso) };
}

export function fromLocalParts(date: string, time: string) {
  return zonedToInstant(date, time).toISOString();
}

// datetime-local inputs want/give "YYYY-MM-DDTHH:mm", in the site's time zone.
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
