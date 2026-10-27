import { describe, expect, it } from 'vitest';
import { buildClassSeriesList, type ClassOccurrenceRow } from '../../src/lib/classSeries';
import { blockDeals, dateRange, groupByFlyer, priceOptions, seriesBounds } from '../../src/lib/flyerBlocks';
import type { Deal } from '../../src/lib/deals';

const now = new Date('2026-10-20T12:00:00Z');
const FLYER = 'https://example.com/foundations.jpg';

// Sundays at 1 PM Central, from Oct 25.
const row = (id: string, week: number, extra: Partial<ClassOccurrenceRow> = {}): ClassOccurrenceRow => ({
  id: `${id}-${week}`,
  title: id,
  start_time: new Date(Date.parse('2026-10-25T18:00:00Z') + week * 7 * 86400000).toISOString(),
  end_time: new Date(Date.parse('2026-10-25T19:00:00Z') + week * 7 * 86400000).toISOString(),
  google_recurring_event_id: id,
  event_type: 'class',
  ...extra,
});
const series = (id: string, extra: Partial<ClassOccurrenceRow> = {}) => [0, 1, 2, 3].map((w) => row(id, w, extra));

describe('flyer homepage blocks', () => {
  it('puts classes that share a flyer in one block, in card order, and gives the rest a block each', () => {
    const offerings = buildClassSeriesList([...series('sensual', { flyer_url: FLYER }), ...series('salsa'), ...series('head', { flyer_url: FLYER })]);
    const blocks = groupByFlyer(offerings);
    expect(blocks.map((b) => b.offerings.map((o) => o.key))).toEqual([['sensual', 'head'], ['salsa']]);
    expect(blocks[0].flyerUrl).toBe(FLYER);
    expect(blocks[1].flyerUrl).toBeNull();
  });

  it("lists today's prices, never the flyer's expired early bird", () => {
    const [o] = buildClassSeriesList(
      series('sensual', { price_whole_series: 80, price_drop_in: 25, price_whole_series_early_bird: 65, early_bird_until: '2026-10-18T05:00:00Z' })
    );
    expect(priceOptions(o, now)).toEqual([
      { label: 'Series', price: 80, was: null, tag: '', suffix: '' },
      { label: 'Drop in', price: 25, was: null, tag: '', suffix: '/class' },
    ]);
  });

  it('shows a running early bird crossed out', () => {
    const [o] = buildClassSeriesList(series('sensual', { price_whole_series: 80, price_whole_series_early_bird: 65, early_bird_until: '2026-10-22T05:00:00Z' }));
    expect(priceOptions(o, now)[0]).toEqual({ label: 'Series', price: 65, was: 80, tag: 'Early Bird', suffix: '' });
  });

  it("an event's ticket, and the date range of a series", () => {
    const [event] = buildClassSeriesList([row('social', 0, { event_type: 'event', google_recurring_event_id: null, price_whole_series: 5 })]);
    expect(priceOptions(event, now)).toEqual([{ label: 'Ticket', price: 5, was: null, tag: '', suffix: '' }]);
    const [o] = buildClassSeriesList(series('sensual'));
    expect(dateRange(o)).toBe('Oct 25 – Nov 15');
    // Once the first class has passed, the series still shows its full dates.
    const all = series('sensual');
    const [upcoming] = buildClassSeriesList(all.slice(1), all);
    expect(dateRange(upcoming)).toBe('Nov 1 – Nov 15');
    expect(dateRange(upcoming, seriesBounds(all))).toBe('Oct 25 – Nov 15');
  });

  it("names a deal only when all of its classes (or any N of them) are on the flyer", () => {
    const offerings = buildClassSeriesList([...series('sensual'), ...series('head')]);
    const both: Deal = { id: 'd', name: 'Full pass', kind: 'bundle_price', amount: 140, seriesKeys: ['sensual', 'head'], requiredCount: null };
    const elsewhere: Deal = { ...both, id: 'e', seriesKeys: ['sensual', 'salsa'] };
    expect(blockDeals(offerings, [both, elsewhere])).toEqual([{ name: 'Full pass', text: 'Both for $140, applied automatically when you register.', custom: false }]);
    // An admin's own wording replaces the whole note.
    expect(blockDeals(offerings, [{ ...both, homepageText: 'Take both for $140!' }])).toEqual([{ name: 'Full pass', text: 'Take both for $140!', custom: true }]);
  });
});
