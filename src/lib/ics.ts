import { awayCity, type SiteLocation } from './siteLocation';
import { SITE_URL } from './seoSchema';

// An iCalendar (.ics) file for class occurrences, served by /calendar/ics for
// the "Add to calendar" link on the confirmation page and in the confirmation
// email. Public class details only (never anyone's name, contact or price).
// Times are written as UTC instants with no zone name, so a phone shows them
// on its own clock and the moment is always right. Pure: no Supabase, no env.

export const MAX_ICS_EVENTS = 60;
const DEFAULT_LENGTH_MS = 60 * 60 * 1000;
const FOLD_OCTETS = 75;

export interface IcsClass {
  id: string;
  title: string;
  start_time: string;
  end_time?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
}

// RFC 5545 TEXT: backslash, semicolon and comma are escaped, line breaks become \n.
export function escapeIcsText(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  );
}

const encoder = new TextEncoder();
const octets = (s: string) => encoder.encode(s).length;

// Lines longer than 75 octets continue on the next line after one space. The
// count is UTF-8 bytes, and a character (or surrogate pair) is never split.
export function foldIcsLine(line: string): string {
  if (octets(line) <= FOLD_OCTETS) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  // The first line may hold 75 octets; each continuation has the space plus up to 74.
  let limit = FOLD_OCTETS;
  for (const ch of line) {
    const n = octets(ch);
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = FOLD_OCTETS - 1;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

// 2027-06-09T01:00:00.000Z -> 20270609T010000Z
export function icsUtcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Stable per class date, so adding the file twice updates the entry instead of doubling it.
export const icsUid = (eventId: string) => `${eventId}@dancewithb.fun`;

// "Venue, Santa Fe" away from home; the venue alone at home; the city alone with no venue.
function locationText(c: IcsClass, home: SiteLocation): string {
  const venue = (c.location ?? '').trim();
  const away = awayCity(c, home);
  return [venue, away].filter(Boolean).join(', ');
}

function eventLines(c: IcsClass, home: SiteLocation, stamp: string): string[] | null {
  const start = new Date(c.start_time);
  if (Number.isNaN(start.getTime())) return null;
  let end = c.end_time ? new Date(c.end_time) : null;
  if (!end || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) end = new Date(start.getTime() + DEFAULT_LENGTH_MS);
  const where = locationText(c, home);
  return [
    'BEGIN:VEVENT',
    `UID:${icsUid(c.id)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsUtcStamp(start)}`,
    `DTEND:${icsUtcStamp(end)}`,
    `SUMMARY:${escapeIcsText(c.title)}`,
    ...(where ? [`LOCATION:${escapeIcsText(where)}`] : []),
    // There is no page per class, so the link is the calendar.
    `URL:${SITE_URL}/calendar`,
    'END:VEVENT',
  ];
}

// The whole file: CRLF after every line (the last too), folded at 75 octets.
export function buildIcs(classes: IcsClass[], home: SiteLocation, now: Date = new Date()): string {
  const stamp = icsUtcStamp(now);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dance with B//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const c of classes) {
    const ev = eventLines(c, home, stamp);
    if (ev) lines.push(...ev);
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

// "/calendar/ics?e=<id>,<id>" for the ids given; null with none.
export function calendarLinkPath(eventIds: string[]): string | null {
  const ids = [...new Set(eventIds)].slice(0, MAX_ICS_EVENTS);
  return ids.length > 0 ? `/calendar/ics?e=${ids.join(',')}` : null;
}
