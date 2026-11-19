import { describe, expect, it } from 'vitest';
import { buildIcs, calendarLinkPath, escapeIcsText, foldIcsLine, icsUid, icsUtcStamp, MAX_ICS_EVENTS } from '../../src/lib/ics';
import { zonedToInstant } from '../../src/lib/siteTime';

const HOME = { city: 'Madison', state: 'WI', note: '' };
const NOW = new Date('2027-01-05T12:30:45.000Z');
const bytes = (s: string) => new TextEncoder().encode(s).length;
// The file with folded lines joined back up, split into logical lines.
const unfolded = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');
const has = (ics: string, line: string) => unfolded(ics).includes(line);

const cls = (o: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Bachata Basics',
  start_time: '2027-06-10T01:00:00.000Z',
  end_time: '2027-06-10T02:00:00.000Z',
  location: 'Studio A',
  ...o,
});

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and line breaks', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng');
  });
  it('drops control characters', () => {
    expect(escapeIcsText('a\u0000b\u0007c')).toBe('abc');
  });
});

describe('foldIcsLine', () => {
  it('leaves a line of 75 octets alone', () => {
    const line = 'X'.repeat(75);
    expect(foldIcsLine(line)).toBe(line);
  });
  it('folds longer lines at 75 octets, continuations start with one space', () => {
    const parts = foldIcsLine('X'.repeat(200)).split('\r\n');
    expect(parts.map(bytes)).toEqual([75, 75, 52]);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe('X'.repeat(200));
  });
  it('counts UTF-8 bytes and never splits a multi-byte character at the fold point', () => {
    // 74 ASCII octets then a 3-byte character: it would straddle octet 75, so it moves to the next line.
    const line = 'a'.repeat(74) + '€' + 'b'.repeat(10);
    const parts = foldIcsLine(line).split('\r\n');
    expect(parts[0]).toBe('a'.repeat(74));
    expect(parts[1]).toBe(' €' + 'b'.repeat(10));
    expect(parts.every((p) => bytes(p) <= 75)).toBe(true);
  });
  it('keeps emoji (surrogate pairs) whole', () => {
    const line = 'S'.repeat(73) + '💃'.repeat(30);
    const folded = foldIcsLine(line);
    expect(folded.split('\r\n').every((p) => bytes(p) <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });
});

describe('buildIcs', () => {
  it('writes the calendar header and CRLF line endings throughout', () => {
    const ics = buildIcs([cls()], HOME, NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Dance with B//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('writes a Denver class (7 PM MDT) and a Chicago class (7 PM CDT) as UTC instants, with no zone names', () => {
    const denverStart = zonedToInstant('2027-06-09', '19:00', 'America/Denver');
    const chicagoStart = zonedToInstant('2027-06-09', '19:00', 'America/Chicago');
    const ics = buildIcs(
      [
        cls({ id: 'd', title: 'Denver', start_time: denverStart.toISOString(), end_time: new Date(denverStart.getTime() + 3600e3).toISOString() }),
        cls({ id: 'c', title: 'Chicago', start_time: chicagoStart.toISOString(), end_time: new Date(chicagoStart.getTime() + 5400e3).toISOString() }),
      ],
      HOME,
      NOW
    );
    expect(has(ics, 'DTSTART:20270610T010000Z')).toBe(true);
    expect(has(ics, 'DTEND:20270610T020000Z')).toBe(true);
    expect(has(ics, 'DTSTART:20270610T000000Z')).toBe(true);
    expect(has(ics, 'DTEND:20270610T013000Z')).toBe(true);
    expect(ics).not.toContain('TZID');
    // In winter the same wall clock is an hour later in UTC (MST is UTC-7).
    expect(icsUtcStamp(zonedToInstant('2027-01-12', '19:00', 'America/Denver'))).toBe('20270113T020000Z');
  });

  it('gives a class with no (or an unusable) end time one hour', () => {
    for (const end of [null, undefined, 'not a date', '2027-06-09T00:00:00.000Z']) {
      const ics = buildIcs([cls({ end_time: end })], HOME, NOW);
      expect(has(ics, 'DTSTART:20270610T010000Z')).toBe(true);
      expect(has(ics, 'DTEND:20270610T020000Z')).toBe(true);
    }
  });

  it('adds the city to the location only when the class is away from home', () => {
    const away = buildIcs([cls({ city: 'Santa Fe', state: 'NM' })], HOME, NOW);
    expect(has(away, 'LOCATION:Studio A\\, Santa Fe')).toBe(true);
    expect(has(buildIcs([cls({ city: 'Santa Fe', location: '' })], HOME, NOW), 'LOCATION:Santa Fe')).toBe(true);
    expect(has(buildIcs([cls({ city: 'Madison', state: 'WI' })], HOME, NOW), 'LOCATION:Studio A')).toBe(true);
    expect(buildIcs([cls({ location: null })], HOME, NOW)).not.toContain('LOCATION');
  });

  it('has a stable UID per class date, a stamp from now, the class name and the class link, and no alarm', () => {
    const a = buildIcs([cls()], HOME, NOW);
    const b = buildIcs([cls()], HOME, new Date('2028-01-01T00:00:00Z'));
    expect(icsUid(cls().id)).toBe('00000000-0000-4000-8000-000000000001@dancewithb.fun');
    expect(has(a, `UID:${icsUid(cls().id)}`)).toBe(true);
    expect(unfolded(a).find((l) => l.startsWith('UID:'))).toBe(unfolded(b).find((l) => l.startsWith('UID:')));
    expect(has(a, 'DTSTAMP:20270105T123045Z')).toBe(true);
    expect(has(a, 'SUMMARY:Bachata Basics')).toBe(true);
    expect(has(a, `URL:https://dancewithb.fun/register?series=${cls().id}`)).toBe(true);
    expect(a).not.toContain('VALARM');
  });

  it('links each entry to its own class: a series by its recurring key, an event on the events page, a lone class by its id', () => {
    const ics = buildIcs(
      [
        cls({ id: 'a', google_recurring_event_id: 'series_key@google', event_type: 'class' }),
        cls({ id: 'b', google_recurring_event_id: 'series_key@google', event_type: 'class' }),
        cls({ id: 'c', google_recurring_event_id: null, event_type: 'event' }),
        cls({ id: 'd', google_recurring_event_id: null, event_type: 'class' }),
      ],
      HOME,
      NOW
    );
    const urls = unfolded(ics).filter((l) => l.startsWith('URL:'));
    expect(urls).toEqual([
      'URL:https://dancewithb.fun/register?series=series_key%40google',
      'URL:https://dancewithb.fun/register?series=series_key%40google',
      'URL:https://dancewithb.fun/register/events?series=c',
      'URL:https://dancewithb.fun/register?series=d',
    ]);
    expect(ics).not.toContain('URL:https://dancewithb.fun/calendar');
    expect(ics.split('\r\n').every((l) => bytes(l) <= 75)).toBe(true);
  });

  it('escapes and folds a long, awkward title; no line is over 75 octets', () => {
    const title = 'Salsa; Bachata, & Más\\Fun — ' + 'ñ'.repeat(60) + '\nline two';
    const ics = buildIcs([cls({ title })], HOME, NOW);
    expect(ics.split('\r\n').every((l) => bytes(l) <= 75)).toBe(true);
    expect(has(ics, `SUMMARY:${escapeIcsText(title)}`)).toBe(true);
  });

  it('skips a class with an unreadable start', () => {
    const ics = buildIcs([cls({ id: 'bad', start_time: 'nope' }), cls()], HOME, NOW);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
});

describe('calendarLinkPath', () => {
  it('lists only ids, once each, capped at the route limit; none gives null', () => {
    expect(calendarLinkPath([])).toBeNull();
    expect(calendarLinkPath(['a', 'b', 'a'])).toBe('/calendar/ics?e=a,b');
    const many = Array.from({ length: 90 }, (_, i) => `id${i}`);
    expect(calendarLinkPath(many)!.split('=')[1].split(',')).toHaveLength(MAX_ICS_EVENTS);
  });
});
