import { describe, expect, it } from 'vitest';
import { eventSchemas, jsonLd, plainText, siteSchema, type EventSchemaRow } from '../../src/lib/seoSchema';

const now = new Date('2026-10-28T12:00:00Z');
const row = (o: Partial<EventSchemaRow> = {}): EventSchemaRow => ({
  id: 'occ-1',
  title: 'Bachata Sensual Focus II',
  description: '<p>Learn <strong>body movement</strong> &amp; more.</p>',
  location: 'Dance Life Studio and Fitness',
  start_time: '2026-11-01T19:00:00+00:00',
  end_time: '2026-11-01T20:00:00+00:00',
  event_type: 'class',
  google_recurring_event_id: 'series-1',
  flyer_url: 'https://cdn.example/flyer.jpg',
  price_whole_series: 85,
  price_drop_in: 25,
  ...o,
});

describe('structured data for search engines', () => {
  it('describes B and Dance with B, under both of her names, with no studio address', () => {
    const graph = siteSchema(['https://www.instagram.com/x/'])['@graph'];
    const person = graph.find((n: { '@type': string }) => n['@type'] === 'Person') as Record<string, unknown>;
    expect(person.name).toBe('B Li');
    expect(person.alternateName).toContain('Belinda Li');
    expect(JSON.stringify(graph)).not.toContain('Seybold');
    expect(JSON.stringify(graph)).not.toContain('streetAddress');
    // Google takes the site name it shows in results from the WebSite entry.
    const site = graph.find((n: { '@type': string }) => n['@type'] === 'WebSite') as Record<string, unknown>;
    expect(site.name).toBe('Dance with B');
    expect(site.url).toBe('https://dancewithb.fun/');
  });

  it("gives each upcoming class its own venue, today's prices, flyer and register link", () => {
    const [e] = eventSchemas([row({ price_whole_series_early_bird: 70, early_bird_until: '2026-10-30T00:00:00Z' })], now, new Set());
    expect(e.name).toBe('Bachata Sensual Focus II');
    expect(e.description).toBe('Learn body movement & more.');
    expect(e.location.name).toBe('Dance Life Studio and Fitness');
    expect(e.location.address).not.toHaveProperty('streetAddress');
    expect(e.image).toEqual(['https://cdn.example/flyer.jpg']);
    expect(e.performer.alternateName).toContain('Belinda Li');
    expect(e.offers?.map((o) => [o.name, o.price])).toEqual([
      ['Whole series', 70],
      ['Drop-in', 25],
    ]);
    expect(e.url).toBe('https://dancewithb.fun/register?series=series-1');
  });

  it('marks full or closed ones sold out, skips past ones, and an event is one ticket', () => {
    const rows = [row(), row({ id: 'past', start_time: '2026-10-01T19:00:00+00:00' }), row({ id: 'ev', event_type: 'event', google_recurring_event_id: null, price_drop_in: 10 })];
    const out = eventSchemas(rows, now, new Set(['occ-1']));
    expect(out.map((e) => e.offers?.[0].availability)).toEqual(['https://schema.org/SoldOut', 'https://schema.org/InStock']);
    expect(out[1].offers?.map((o) => o.name)).toEqual(['Ticket']);
    expect(out[1].url).toBe('https://dancewithb.fun/register/events?series=ev');
  });

  it("can't be broken out of its script tag by a description", () => {
    expect(plainText('</script><script>alert(1)</script>')).not.toContain('<');
    expect(jsonLd({ d: '</script>' })).not.toContain('</script>');
  });
});
