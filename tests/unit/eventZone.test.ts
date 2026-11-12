import { afterEach, describe, expect, it } from 'vitest';
import { eventZone, setServerTimeZone, showsOwnZone, siteFormatter, zoneLabel, zonedToInstant, zoneSuffix } from '../../src/lib/siteTime';
import { eventDayKey, eventSchedule, eventTimeRange, isEventToday } from '../../src/lib/eventClock';
import { buildClassSeriesList, type ClassOccurrenceRow } from '../../src/lib/classSeries';
import { dateRange } from '../../src/lib/flyerBlocks';
import { occurrenceChoice, seriesSubLabel } from '../../src/lib/registrationLabels';
import { endAfterStart } from '../../src/lib/eventTimes';

// Each class keeps its own time zone (events.time_zone, migration 0076): the
// site is in Central here (the tests' default), and a Santa Fe class in Mountain.
afterEach(() => setServerTimeZone('America/Chicago'));

const DENVER = 'America/Denver';
// 7:00-8:00 PM Mountain on Tuesday, June 8, 2027 (MDT, UTC-6).
const mountain = (start = '2027-06-09T01:00:00Z', end = '2027-06-09T02:00:00Z'): ClassOccurrenceRow => ({
  id: 'm1',
  title: 'Santa Fe Bachata',
  start_time: start,
  end_time: end,
  time_zone: DENVER,
  google_recurring_event_id: null,
});

describe('a zone of its own', () => {
  it('formats in a given zone, the site zone by default', () => {
    const at = new Date('2027-06-09T01:00:00Z');
    expect(siteFormatter({ hour: 'numeric', minute: '2-digit' }).format(at)).toBe('8:00 PM');
    expect(siteFormatter({ hour: 'numeric', minute: '2-digit' }, 'en-US', DENVER).format(at)).toBe('7:00 PM');
    // A bad zone falls back to the site's rather than throwing.
    expect(siteFormatter({ hour: 'numeric', minute: '2-digit' }, 'en-US', 'Not/AZone').format(at)).toBe('8:00 PM');
  });

  it("uses the row's zone when valid, otherwise the site's", () => {
    expect(eventZone({ time_zone: DENVER })).toBe(DENVER);
    expect(eventZone({ time_zone: null })).toBe('America/Chicago');
    expect(eventZone({ time_zone: 'Not/AZone' })).toBe('America/Chicago');
    expect(eventZone({})).toBe('America/Chicago');
    setServerTimeZone('America/Los_Angeles');
    expect(eventZone({ time_zone: null })).toBe('America/Los_Angeles');
  });

  it('names a zone with its short generic name (the specific one where Intl has only a phrase)', () => {
    const winter = '2027-01-15T20:00:00Z';
    const summer = '2027-07-15T20:00:00Z';
    for (const at of [winter, summer]) {
      expect(zoneLabel(at, DENVER)).toBe('MT');
      expect(zoneLabel(at, 'America/Chicago')).toBe('CT');
      expect(zoneLabel(at, 'America/Los_Angeles')).toBe('PT');
      expect(zoneLabel(at, 'America/Phoenix')).toBe('MST');
    }
    // "United Kingdom Time" is a phrase, so the specific name instead.
    expect(zoneLabel(winter, 'Europe/London')).toBe('GMT');
  });

  it('prints a zone only when its clock differs from the site\'s at that instant', () => {
    const summer = '2027-07-15T20:00:00Z';
    const winter = '2027-01-15T20:00:00Z';
    expect(showsOwnZone(summer, DENVER)).toBe(true);
    expect(showsOwnZone(summer, 'America/Chicago')).toBe(false);
    // Another id for Central time prints nothing.
    expect(showsOwnZone(summer, 'America/Indiana/Knox')).toBe(false);
    expect(showsOwnZone(summer, 'Not/AZone')).toBe(false);
    // Phoenix keeps standard time: the same clock as Denver in winter, not in summer.
    setServerTimeZone(DENVER);
    expect(showsOwnZone(winter, 'America/Phoenix')).toBe(false);
    expect(showsOwnZone(summer, 'America/Phoenix')).toBe(true);
    expect(zoneSuffix(summer, 'America/Phoenix')).toBe(' MST');
    expect(zoneSuffix(winter, 'America/Phoenix')).toBe('');
  });
});

describe('class labels in their own zone', () => {
  it('shows a Mountain class at its Mountain time with "MT" under a Central site', () => {
    const [s] = buildClassSeriesList([mountain()]);
    expect(s.timeZone).toBe(DENVER);
    expect(s.subLabel).toBe('Tue, Jun 8, 7:00 PM–8:00 PM MT');
    expect(s.occurrences[0].label).toBe('Tue, Jun 8, 7:00 PM MT');
    expect(dateRange(s)).toBe('Jun 8');
  });

  it('prints no zone under a Mountain site', () => {
    setServerTimeZone(DENVER);
    const [s] = buildClassSeriesList([mountain()]);
    expect(s.subLabel).toBe('Tue, Jun 8, 7:00 PM–8:00 PM');
    expect(s.occurrences[0].label).toBe('Tue, Jun 8, 7:00 PM');
  });

  it('a class in the site zone (or without one) reads exactly as before', () => {
    const [s] = buildClassSeriesList([{ ...mountain(), time_zone: null }]);
    expect(s.subLabel).toBe('Tue, Jun 8, 8:00 PM–9:00 PM');
    expect(s.timeZone).toBe('America/Chicago');
  });

  it('a series is labelled in its first class\'s zone', () => {
    const weeks = [0, 7, 14].map((d, i) => ({
      ...mountain(new Date(Date.parse('2027-06-09T01:00:00Z') + d * 86400000).toISOString(), new Date(Date.parse('2027-06-09T02:00:00Z') + d * 86400000).toISOString()),
      id: `w${i}`,
      google_recurring_event_id: 'R',
    }));
    const [s] = buildClassSeriesList(weeks);
    expect(s.subLabel).toBe('Tuesdays, 7:00 PM–8:00 PM MT');
    expect(dateRange(s)).toBe('Jun 8 – Jun 22');
  });

  it('the calendar, registration and check-in labels', () => {
    const m = mountain();
    expect(eventTimeRange(m)).toBe('7:00 PM–8:00 PM MT');
    expect(eventSchedule(m, { weekday: 'long', month: 'long', day: 'numeric' })).toBe('Tuesday, June 8, 7:00 PM–8:00 PM MT');
    expect(seriesSubLabel(m, m, undefined, false, false)).toBe('Tuesdays, 7:00 PM–8:00 PM MT (Jun 8)');
    expect(seriesSubLabel(m, m, undefined, false, true)).toBe('Tuesday, Jun 8, 7:00 PM–8:00 PM MT');
    expect(occurrenceChoice(m)).toEqual({ day: '2027-06-08', label: 'Jun 8, 7:00 PM MT' });
  });
});

describe('the day a class is on', () => {
  // 11:30 PM Mountain on June 8 is 12:30 AM June 9 in Central.
  const late = mountain('2027-06-09T05:30:00Z', '2027-06-09T06:30:00Z');

  it('is its own zone\'s day, not the site\'s next day (calendar grid, server and browser)', () => {
    expect(eventDayKey(late)).toBe('2027-06-08');
    expect(eventDayKey({ ...late, time_zone: null })).toBe('2027-06-09');
  });

  it('the registration form and the server use the same day key for the linked-class rule', () => {
    expect(occurrenceChoice(late).day).toBe(eventDayKey(late));
    expect(occurrenceChoice(late).day).toBe('2027-06-08');
  });

  it("is today when its own day is today's date where it takes place", () => {
    expect(isEventToday(late, new Date('2027-06-09T04:00:00Z'))).toBe(true); // 10 PM Mountain, June 8
    expect(isEventToday(late, new Date('2027-06-09T07:00:00Z'))).toBe(false); // 1 AM Mountain, June 9
  });
});

describe('typed times in a zone', () => {
  it('reads the editor\'s date and times in the picked zone, rolling an early end to the next day', () => {
    expect(zonedToInstant('2027-06-08', '19:00', DENVER).toISOString()).toBe('2027-06-09T01:00:00.000Z');
    expect(endAfterStart('2027-06-08', '19:00', '20:00', DENVER)).toBe('2027-06-09T02:00:00.000Z');
    expect(endAfterStart('2027-06-08', '23:00', '00:30', DENVER)).toBe('2027-06-09T06:30:00.000Z');
    // Without a zone, the site's.
    expect(endAfterStart('2027-06-08', '19:00', '20:00')).toBe('2027-06-09T01:00:00.000Z');
  });
});
