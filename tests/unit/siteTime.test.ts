import { afterEach, describe, expect, it } from 'vitest';
import { addDaysToKey, setServerTimeZone, siteFormatter, siteTimeZone, zonedDateKey, zonedParts, zonedTimeOfDay, zonedToInstant } from '../../src/lib/siteTime';
import { endAfterStart } from '../../src/lib/eventTimes';
import { siteDayBoundsUtcIso } from '../../src/lib/classSeries';

afterEach(() => setServerTimeZone('America/Chicago'));

describe('site time zone', () => {
  // 8 PM Central on Friday Oct 23 is 1 AM UTC on Saturday: the server (UTC on Netlify) used to put it on the 24th.
  const fridayEvening = '2026-10-24T01:00:00Z';

  it("puts an instant on the site zone's day and time, not the server's", () => {
    expect(zonedDateKey(fridayEvening)).toBe('2026-10-23');
    expect(zonedTimeOfDay(fridayEvening)).toBe('20:00');
    expect(zonedParts(fridayEvening).weekday).toBe(5);
    expect(siteFormatter({ month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(fridayEvening))).toBe('October 23 at 8:00 PM');
  });

  it('turns a wall-clock date and time into the right instant, on both sides of a DST change', () => {
    expect(zonedToInstant('2026-10-23', '20:00').toISOString()).toBe('2026-10-24T01:00:00.000Z');
    // Nov 1, 2026 ends daylight time: CDT (UTC-5) before, CST (UTC-6) after.
    expect(zonedToInstant('2026-10-31', '19:00').toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(zonedToInstant('2026-11-02', '19:00').toISOString()).toBe('2026-11-03T01:00:00.000Z');
  });

  it("follows the admin's chosen zone", () => {
    setServerTimeZone('America/New_York');
    expect(siteTimeZone()).toBe('America/New_York');
    expect(zonedTimeOfDay(fridayEvening)).toBe('21:00');
    setServerTimeZone('Not/AZone');
    expect(siteTimeZone()).toBe('America/Chicago');
  });

  it("today's bounds are the site zone's midnights (a DST day is 25 hours)", () => {
    expect(siteDayBoundsUtcIso(new Date('2026-11-01T12:00:00Z'))).toEqual({ startIso: '2026-11-01T05:00:00.000Z', endIso: '2026-11-02T06:00:00.000Z' });
  });

  it('an event ending at midnight ends the next day, in the site zone', () => {
    expect(endAfterStart('2026-10-23', '20:00', '00:00')).toBe('2026-10-24T05:00:00.000Z');
    expect(endAfterStart('2026-10-23', '20:00', '20:00')).toBeNull();
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});
