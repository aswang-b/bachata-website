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

  it('names the location: Madison, WI by default, or the one passed in', () => {
    const seattle = { city: 'Seattle', state: 'WA', note: '' };
    const text = (v: unknown) => JSON.stringify(v);

    const mad = text(siteSchema([]));
    expect(mad).toContain('"name":"Madison, WI"');
    expect(mad).toContain('events in Madison, WI, taught');
    const madEvent = eventSchemas([row({ description: '', location: '' })], now, new Set())[0];
    expect(madEvent.description).toBe('Bachata Sensual Focus II with B in Madison, WI.');
    expect(madEvent.location).toEqual({ '@type': 'Place', name: 'Madison, WI', address: { '@type': 'PostalAddress', addressLocality: 'Madison', addressRegion: 'WI', addressCountry: 'US' } });

    const sea = text(siteSchema([], seattle));
    expect(sea).toContain('"name":"Seattle, WA"');
    expect(sea).toContain('events in Seattle, WA, taught');
    expect(sea).not.toContain('Madison');
    const seaEvent = eventSchemas([row({ description: '', location: '' })], now, new Set(), 40, seattle)[0];
    expect(seaEvent.description).toBe('Bachata Sensual Focus II with B in Seattle, WA.');
    expect(seaEvent.location).toEqual({ '@type': 'Place', name: 'Seattle, WA', address: { '@type': 'PostalAddress', addressLocality: 'Seattle', addressRegion: 'WA', addressCountry: 'US' } });
    // A class with its own venue keeps that name.
    expect(eventSchemas([row()], now, new Set(), 40, seattle)[0].location.name).toBe('Dance Life Studio and Fitness');
  });

  it("uses a class's own city and state for its address when set, else the home location", () => {
    const home = { city: 'Madison', state: 'WI', note: '' };
    const away = eventSchemas([row({ location: 'Moxie Studio', city: ' Santa Fe ', state: 'NM' })], now, new Set(), 40, home)[0];
    expect(away.location).toEqual({ '@type': 'Place', name: 'Moxie Studio', address: { '@type': 'PostalAddress', addressLocality: 'Santa Fe', addressRegion: 'NM', addressCountry: 'US' } });
    const bare = eventSchemas([row({ description: '', location: '', city: 'Santa Fe', state: 'NM' })], now, new Set(), 40, home)[0];
    expect(bare.description).toBe('Bachata Sensual Focus II with B in Santa Fe, NM.');
    expect(bare.location.name).toBe('Santa Fe, NM');
    // A city without a state never borrows the home state.
    const noState = eventSchemas([row({ city: 'Taos', state: null })], now, new Set(), 40, home)[0];
    expect(noState.location.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Taos', addressCountry: 'US' });
    // No city: the home location, as before.
    expect(eventSchemas([row({ city: null })], now, new Set(), 40, home)[0].location.address).toMatchObject({ addressLocality: 'Madison', addressRegion: 'WI' });
  });

  it('leaves the region out when there is no state', () => {
    const nowhere = { city: 'Reykjavik', state: '', note: '' };
    expect(JSON.stringify(siteSchema([], nowhere))).toContain('"name":"Reykjavik"');
    const e = eventSchemas([row({ location: '' })], now, new Set(), 40, nowhere)[0];
    expect(e.location.name).toBe('Reykjavik');
    expect(e.location.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Reykjavik', addressCountry: 'US' });
    expect(e.location.address).not.toHaveProperty('addressRegion');
  });
});
