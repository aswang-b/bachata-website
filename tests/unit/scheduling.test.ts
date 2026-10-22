import { describe, expect, it } from 'vitest';
import { endAfterStart, seriesAnchorEndDate } from '../../src/lib/eventTimes';
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
