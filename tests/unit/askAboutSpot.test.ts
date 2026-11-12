import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

const contact = vi.hoisted(() => ({ saved: [] as { message: string | null }[] }));
vi.mock('../../src/lib/contactMessages', () => ({
  saveContactMessage: async (input: { message: string | null }) => {
    contact.saved.push(input);
    return { id: 'm1', duplicateOf: null };
  },
}));

import { askAboutSpotHref, isAskable, validSpotId } from '../../src/lib/askAboutSpot';
import { findSpotClass, spotLine, spotMessagePrefix, spotPrefill, withSpotPrefix } from '../../src/lib/spotRequest';
import { cacheContactPage, cacheSharedPage, SHARED_PAGE_CACHE } from '../../src/lib/pageCache';
import { POST } from '../../src/pages/api/submit-intake';
import type { SpotsInfo } from '../../src/lib/capacity';

// "Ask about a spot" (roadmap 10): when the link shows, which class the
// Contact page names from a link's id, what the saved message starts with, and
// that a page opened from the link is never cached at the edge.

const NOW = new Date('2099-01-01T12:00:00Z');
const LATER = '2099-01-06T19:00:00Z';
const count = (capacity: number, taken: number) => ({ capacity, taken, remaining: Math.max(0, capacity - taken) });
const spots = (o: Partial<SpotsInfo>): SpotsInfo => ({ byRole: false, total: null, leader: null, follower: null, full: false, ...o });
const askable = (o: { closed?: boolean; spots?: SpotsInfo | null; startTime?: string }) =>
  isAskable({ closed: false, spots: null, startTime: LATER, now: NOW, ...o });

describe('isAskable', () => {
  it('is yes for a closed class, a full class, and one with a role full, while it is still to come', () => {
    expect(askable({ closed: true })).toBe(true);
    expect(askable({ spots: spots({ total: count(10, 10), full: true }) })).toBe(true);
    expect(askable({ spots: spots({ byRole: true, leader: count(5, 5), follower: count(5, 2) }) })).toBe(true);
    expect(askable({ spots: spots({ byRole: true, leader: count(5, 1), follower: count(5, 5) }) })).toBe(true);
    expect(askable({ closed: true, spots: spots({ total: count(10, 3) }) })).toBe(true);
  });

  it('is no with spots left, with no capacity at all, and with a role that has room beside an uncapped one', () => {
    expect(askable({})).toBe(false);
    expect(askable({ spots: spots({ total: count(10, 9) }) })).toBe(false);
    expect(askable({ spots: spots({ byRole: true, leader: count(5, 4), follower: count(5, 2) }) })).toBe(false);
    expect(askable({ spots: spots({ byRole: true, leader: count(5, 4), follower: null }) })).toBe(false);
  });

  it('is no for a class that has started or is past, even when it is closed or full', () => {
    expect(askable({ closed: true, startTime: '2098-12-31T19:00:00Z' })).toBe(false);
    expect(askable({ closed: true, startTime: NOW.toISOString() })).toBe(false);
    expect(askable({ spots: spots({ total: count(10, 10), full: true }), startTime: '2020-01-01T00:00:00Z' })).toBe(false);
  });
});

describe('the link and its id', () => {
  it('carries only the class id, encoded', () => {
    expect(askAboutSpotHref('abc-123')).toBe('/contact?spot=abc-123');
    expect(askAboutSpotHref('a b&c')).toBe('/contact?spot=a%20b%26c');
  });

  it('accepts uuids and Google series ids and nothing else', () => {
    for (const ok of ['00000000-0000-4000-8000-0000000000c1', 'zzz-e2e-series-1b2c', 'abc_def']) expect(validSpotId(ok)).toBe(true);
    for (const bad of ['', ' ', 'a b', "x'; drop table events", 'a,b', '<script>', 'x'.repeat(201), null, undefined, 5]) expect(validSpotId(bad)).toBe(false);
  });
});

const CLASS = '00000000-0000-4000-8000-0000000000c1';
const row = (o: Record<string, unknown>) => ({
  id: CLASS,
  title: 'Bachata 1',
  event_type: 'class',
  visibility: 'public',
  google_recurring_event_id: null,
  start_time: '2099-01-06T19:00:00Z',
  end_time: '2099-01-06T20:00:00Z',
  time_zone: 'America/Chicago',
  ...o,
});

beforeEach(() => {
  db.current = new FakeSupabase();
});

describe('findSpotClass', () => {
  it('finds a public class by its id, named in its own zone', async () => {
    db.current.seed('events', [row({})]);
    const found = await findSpotClass(CLASS, NOW);
    expect(found).toEqual({ title: 'Bachata 1', schedule: 'Tuesday, January 6, 1:00 PM–2:00 PM', date: 'Jan 6' });
    expect(spotLine(found!)).toBe('Asking about a spot in Bachata 1 · Tuesday, January 6, 1:00 PM–2:00 PM');
    expect(spotPrefill(found!)).toBe("I'd like to ask about a spot in Bachata 1 (Jan 6).");
  });

  it('finds a series by its key: the next class still to come', async () => {
    db.current.seed('events', [
      row({ id: 'e1', google_recurring_event_id: 'zzz-series', start_time: '2098-12-30T19:00:00Z', end_time: '2098-12-30T20:00:00Z' }),
      row({ id: 'e3', google_recurring_event_id: 'zzz-series', start_time: '2099-01-13T19:00:00Z', end_time: '2099-01-13T20:00:00Z' }),
      row({ id: 'e2', google_recurring_event_id: 'zzz-series', start_time: '2099-01-06T19:00:00Z', end_time: '2099-01-06T20:00:00Z' }),
    ]);
    expect((await findSpotClass('zzz-series', NOW))?.date).toBe('Jan 6');
  });

  it('gives nothing for a malformed id, without asking the database', async () => {
    db.current.seed('events', [row({})]);
    for (const bad of ['', 'garbage!', "x'; --", 'a,b', null, undefined]) expect(await findSpotClass(bad, NOW)).toBeNull();
    expect(db.current.callsTo('events')).toHaveLength(0);
  });

  it('gives nothing for an unknown id, a private or draft class, a test class off the test server, an unknown type, or a class that has started', async () => {
    db.current.seed('events', [
      row({ id: '00000000-0000-4000-8000-0000000000c2', visibility: 'private' }),
      row({ id: '00000000-0000-4000-8000-0000000000c3', visibility: 'draft' }),
      row({ id: '00000000-0000-4000-8000-0000000000c4', visibility: 'test' }),
      row({ id: '00000000-0000-4000-8000-0000000000c5', event_type: 'private_lesson' }),
      row({ id: '00000000-0000-4000-8000-0000000000c6', start_time: '2098-12-31T19:00:00Z' }),
      row({ id: 'e9', google_recurring_event_id: 'hidden-series', visibility: 'private' }),
    ]);
    for (const id of ['00000000-0000-4000-8000-0000000000ff', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000c6', 'hidden-series', 'no-such-series'])
      expect(await findSpotClass(id, NOW)).toBeNull();
  });

  it('is no class, rather than an error, when the lookup fails', async () => {
    db.current.seed('events', [row({})]);
    db.current.failNext.set('events.select', { message: 'boom' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await findSpotClass(CLASS, NOW)).toBeNull();
  });
});

describe('the saved message', () => {
  const found = { title: 'Bachata 1', schedule: '', date: 'Jan 6' };

  it('starts with the class and date, then the dancer\'s own words', () => {
    expect(spotMessagePrefix(found)).toBe('[Spot request: Bachata 1, Jan 6]');
    expect(withSpotPrefix('Any chance of a spot?', found)).toBe('[Spot request: Bachata 1, Jan 6]\nAny chance of a spot?');
    expect(withSpotPrefix('', found)).toBe('[Spot request: Bachata 1, Jan 6]');
  });

  const send = (fields: Record<string, string>) => {
    const body = new FormData();
    for (const [k, v] of Object.entries({ registration_type: 'private', first_name: 'Ana', last_name: 'Lee', phone: '6085550100', comments: 'Any chance?', ...fields })) body.set(k, v);
    return POST({
      request: new Request('http://x/api/submit-intake', { method: 'POST', body }),
      redirect: (url: string, status: number) => new Response(null, { status, headers: { Location: url } }),
      clientAddress: '127.0.0.1',
    } as never);
  };
  const savedMessage = () => contact.saved[0]?.message;

  beforeEach(() => {
    contact.saved.length = 0;
    db.current.seed('events', [row({ start_time: '2099-01-06T19:00:00Z' })]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('is looked up again on the server from the id, so class text sent by the browser is ignored', async () => {
    const res = await send({ spot: CLASS, spot_title: 'Fake Class', spot_class: 'Fake Class', class: 'Fake Class', subject: 'Fake Class' });
    expect(res.status).toBe(303);
    expect(savedMessage()).toMatch(/^\[Spot request: Bachata 1, [A-Z][a-z]{2} \d+\]\nAny chance\?$/);
    expect(savedMessage()).not.toContain('Fake Class');
  });

  it('is saved as typed when the id is garbage, unknown or not public', async () => {
    db.current.seed('events', [row({ visibility: 'private' })]);
    for (const spot of ['garbage!', '00000000-0000-4000-8000-0000000000ff', CLASS]) {
      contact.saved.length = 0;
      await send({ spot, comments: `Hello ${spot}` });
      expect(savedMessage()).toBe(`Hello ${spot}`);
    }
  });
});

describe('caching the Contact page', () => {
  it('keeps the plain page on the shared edge cache, apart from any copy with a spot', () => {
    const headers = new Headers();
    cacheContactPage(headers, false);
    expect(headers.get('Netlify-CDN-Cache-Control')).toBe(SHARED_PAGE_CACHE);
    expect(headers.get('Netlify-Vary')).toBe('query=spot');
  });

  it('never stores or serves a page opened from an Ask about a spot link at the edge', () => {
    const headers = new Headers();
    cacheContactPage(headers, true);
    expect(headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
    expect(headers.get('Netlify-Vary')).toBeNull();
    expect(headers.get('Cache-Control')).toBeNull();
  });

  it('leaves the other shared pages as they were', () => {
    const headers = new Headers();
    cacheSharedPage(headers);
    expect(headers.get('Netlify-CDN-Cache-Control')).toBe(SHARED_PAGE_CACHE);
    expect(headers.get('Netlify-Vary')).toBeNull();
  });
});
