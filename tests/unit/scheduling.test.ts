import { describe, expect, it } from 'vitest';
import { calendarOrder, endAfterStart, registrationOpen, seriesAnchorEndDate, seriesFirstOccurrences } from '../../src/lib/eventTimes';
import { getActivePrice, priceTierLabel } from '../../src/lib/pricing';
import { buildWeeklyRecurrenceRule, googleColorIdToSiteColor, siteColorToGoogleColorId } from '../../src/lib/googleCalendar';
import { eventTypeLabel } from '../../src/lib/classSeries';

describe('event end times (Google rejects an end at or before the start)', () => {
  it('rolls an end earlier than the start (e.g. ending at midnight) to the next day', () => {
    const end = new Date(endAfterStart('2026-10-31', '20:00', '00:00')!);
    const start = new Date('2026-10-31T20:00:00');
    expect(end.getTime() - start.getTime()).toBe(4 * 60 * 60 * 1000);
  });

  it('keeps a same-day end, and rejects an end equal to the start', () => {
    expect(new Date(endAfterStart('2026-10-31', '19:00', '20:00')!).getTime()).toBe(new Date('2026-10-31T20:00:00').getTime());
    expect(endAfterStart('2026-10-31', '19:00', '19:00')).toBeNull();
  });

  it('rolls a series anchor end date across month and year ends', () => {
    expect(seriesAnchorEndDate('2026-10-31', '21:00', '00:00')).toBe('2026-11-01');
    expect(seriesAnchorEndDate('2026-12-31', '21:00', '00:30')).toBe('2027-01-01');
    expect(seriesAnchorEndDate('2026-10-31', '19:00', '20:00')).toBe('2026-10-31');
    expect(seriesAnchorEndDate('2026-10-31', '19:00', '19:00')).toBe('2026-11-01');
  });
});

describe('tiered pricing', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const base = { base: 80, earlyBird: 65, earlyBirdUntil: '2026-09-08T00:00:00Z', flashSale: null, flashSaleUntil: null };

  it('applies an early bird until it expires', () => {
    expect(getActivePrice(now, base)).toMatchObject({ activePrice: 65, tag: 'early_bird', display: 'discounted' });
    expect(getActivePrice(new Date('2026-09-09T00:00:00Z'), base)).toMatchObject({ activePrice: 80, tag: 'regular' });
  });

  it('picks the cheaper of two active discounts, a tie going to the flash sale', () => {
    const both = { ...base, flashSale: 65, flashSaleUntil: '2026-09-02T00:00:00Z' };
    expect(getActivePrice(now, both).tag).toBe('flash_sale');
    expect(getActivePrice(now, { ...both, flashSale: 70 }).tag).toBe('early_bird');
    expect(priceTierLabel('flash_sale')).toBe('Flash Sale');
  });

  it('ignores a discount with no end date', () => {
    expect(getActivePrice(now, { ...base, earlyBirdUntil: null }).tag).toBe('regular');
  });
});

describe('Google Calendar mapping', () => {
  it('builds weekly rules with interval, count or an inclusive until', () => {
    expect(buildWeeklyRecurrenceRule({ byDay: ['TU'], count: 8 })).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=8']);
    expect(buildWeeklyRecurrenceRule({ byDay: ['MO', 'WE'], interval: 2, until: '2026-12-01' })).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261201T235959Z']);
  });

  it('round-trips every color the editor offers', () => {
    for (const color of ['green', 'blue', 'red', 'orange', 'purple']) {
      expect(googleColorIdToSiteColor(siteColorToGoogleColorId(color))).toBe(color);
    }
    expect(googleColorIdToSiteColor(undefined)).toBe('accent');
  });
});

describe("the calendar's type tag", () => {
  it('shows a class that never repeats (no week number) as a Workshop, a series class as a Class', () => {
    expect(eventTypeLabel('class', null)).toBe('Workshop');
    expect(eventTypeLabel('class', 2)).toBe('Class');
    expect(eventTypeLabel('event', null)).toBe('Event');
  });
});

describe('when registration closes', () => {
  const now = Date.parse('2026-10-24T03:00:00Z');
  const at = (minutesFromNow: number) => new Date(now + minutesFromNow * 60000).toISOString();
  it('a class closes when it starts; an event stays open until 30 minutes after it ends (door sign-ups)', () => {
    expect(registrationOpen({ event_type: 'class', start_time: at(1), end_time: at(60) }, now)).toBe(true);
    expect(registrationOpen({ event_type: 'class', start_time: at(-1), end_time: at(60) }, now)).toBe(false);
    expect(registrationOpen({ event_type: 'event', start_time: at(-120), end_time: at(-29) }, now)).toBe(true);
    expect(registrationOpen({ event_type: 'event', start_time: at(-120), end_time: at(-31) }, now)).toBe(false);
  });
});

describe("the calendar's order for classes at the same time", () => {
  const at = (day: string, hm: string) => `2026-11-${day}T${hm}:00.000Z`;
  const occ = (id: string, series: string, day: string, end: string) => ({ id, google_recurring_event_id: series, start_time: at(day, '18:00'), end_time: at(day, end) });

  it('puts the one that ends first first', () => {
    const events = [occ('a', 'long', '01', '20:00'), occ('b', 'short', '01', '19:00')];
    expect(events.sort(calendarOrder(seriesFirstOccurrences(events))).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('then the series that began first, the same way every week', () => {
    // "older" started a week earlier; the day's rows arrive in a different order each week.
    const all = [occ('o0', 'older', '01', '20:00'), occ('n1', 'newer', '08', '20:00'), occ('o1', 'older', '08', '20:00'), occ('o2', 'older', '15', '20:00'), occ('n2', 'newer', '15', '20:00')];
    const order = calendarOrder(seriesFirstOccurrences(all));
    expect([all[1], all[2]].sort(order).map((e) => e.id)).toEqual(['o1', 'n1']);
    expect([all[4], all[3]].sort(order).map((e) => e.id)).toEqual(['o2', 'n2']);
  });

  it('falls back to the series id when everything else ties', () => {
    const events = [occ('x', 'zeta', '01', '20:00'), occ('y', 'alpha', '01', '20:00')];
    expect(events.sort(calendarOrder(seriesFirstOccurrences(events))).map((e) => e.id)).toEqual(['y', 'x']);
    expect(events.reverse().sort(calendarOrder(seriesFirstOccurrences(events))).map((e) => e.id)).toEqual(['y', 'x']);
  });
});

describe("a class run long one week doesn't change the calendar's order", () => {
  it("ranks by each series' first class's length, not that week's", () => {
    const at = (day: string, hm: string) => `2026-11-${day}T${hm}:00.000Z`;
    const occ = (id: string, series: string, day: string, end: string) => ({ id, google_recurring_event_id: series, start_time: at(day, '18:00'), end_time: at(day, end) });
    // "short" normally ends at 19:00, "long" at 20:30; on the 15th short runs to 21:00.
    const all = [occ('s1', 'short', '01', '19:00'), occ('l1', 'long', '01', '20:30'), occ('s3', 'short', '15', '21:00'), occ('l3', 'long', '15', '20:30')];
    const order = calendarOrder(seriesFirstOccurrences(all));
    expect([all[1], all[0]].sort(order).map((e) => e.id)).toEqual(['s1', 'l1']);
    expect([all[3], all[2]].sort(order).map((e) => e.id)).toEqual(['s3', 'l3']);
  });
});
