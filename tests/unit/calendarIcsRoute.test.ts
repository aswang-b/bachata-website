import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase, testEvents: false }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));
vi.mock('../../src/lib/siteConfig', () => ({ loadSiteLocation: async () => ({ city: 'Madison', state: 'WI', note: '' }) }));
vi.mock('../../src/lib/testMode', () => ({ publicVisibilities: () => (db.testEvents ? ['public', 'test'] : ['public']) }));

import { GET } from '../../src/pages/calendar/ics';
import { upcomingCalendarEventIds } from '../../src/lib/registrationCalendar';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const get = (e: string | null) => GET({ url: new URL(`http://x/calendar/ics${e === null ? '' : `?e=${encodeURIComponent(e)}`}`) } as never) as Promise<Response>;
const event = (n: number, o: Record<string, unknown> = {}) => ({
  id: id(n),
  title: `Class ${n}`,
  visibility: 'public',
  start_time: '2027-06-10T01:00:00.000Z',
  end_time: '2027-06-10T02:00:00.000Z',
  location: 'Studio A',
  city: null,
  state: null,
  ...o,
});

beforeEach(() => {
  db.current = new FakeSupabase();
  db.testEvents = false;
  db.current.seed('events', [event(1), event(2, { visibility: 'private' }), event(3, { visibility: 'test' }), event(4, { visibility: 'draft' })]);
});

describe('GET /calendar/ics', () => {
  it('refuses a missing, malformed or oversized list with 400, before any lookup', async () => {
    for (const e of [null, '', 'abc', `${id(1)},oops`, `${id(1)},`, "1'; drop table events"]) expect((await get(e)).status).toBe(400);
    const sixtyOne = Array.from({ length: 61 }, (_, i) => id(i + 1)).join(',');
    expect((await get(sixtyOne)).status).toBe(400);
    expect(db.current.callsTo('events')).toHaveLength(0);
    const sixty = Array.from({ length: 60 }, (_, i) => id(i + 1)).join(',');
    expect((await get(sixty)).status).toBe(200);
  });

  it('serves a public class as a downloadable calendar file that is never cached', async () => {
    const res = await get(id(1));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="dance-with-b.ics"');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain('SUMMARY:Class 1\r\n');
    expect(body).toContain('DTSTART:20270610T010000Z\r\n');
  });

  it('links each class date to its own class page, which needs the route to select its series key and type', async () => {
    db.current.projectColumns = true; // answer with only the columns the route asked for
    db.current.seed('events', [
      event(11, { google_recurring_event_id: 'ser-key', event_type: 'class' }),
      event(12, { google_recurring_event_id: 'ser-key', event_type: 'class', start_time: '2027-06-17T01:00:00.000Z' }),
      event(13, { google_recurring_event_id: null, event_type: 'event' }),
    ]);
    const body = await (await get(`${id(11)},${id(12)},${id(13)}`)).text();
    const urls = body.replace(/\r\n /g, '').split('\r\n').filter((l) => l.startsWith('URL:'));
    expect([...urls].sort()).toEqual([
      `URL:https://dancewithb.fun/register/events?series=${id(13)}`,
      'URL:https://dancewithb.fun/register?series=ser-key',
      'URL:https://dancewithb.fun/register?series=ser-key',
    ]);
    expect(body).not.toContain('/calendar\r\n');
  });

  it('leaves out private, draft and (off the test server) test classes; 404 when none are left', async () => {
    const mixed = await (await get(`${id(1)},${id(2)},${id(3)},${id(4)}`)).text();
    expect(mixed.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(mixed).not.toContain('Class 2');
    expect(mixed).not.toContain('Class 3');
    for (const hidden of [2, 3, 4, 99]) expect((await get(id(hidden))).status).toBe(404);
  });

  it('shows test classes only where the public pages do', async () => {
    db.testEvents = true;
    expect((await get(id(3))).status).toBe(200);
    expect((await get(id(2))).status).toBe(404);
  });

  it('carries no personal details', async () => {
    db.current.seed('class_registrations', [{ id: 'reg-secret', first_name: 'Dana', email: 'dana@example.com', price: 5555, series_key: id(1) }]);
    const body = await (await get(id(1))).text();
    expect(body).not.toMatch(/Dana|dana@|5555|reg-secret/);
  });
});

describe('the confirmation link covers upcoming dates', () => {
  const reg = (o: Record<string, unknown>) => ({ id: 'r', submission_id: 's', ...o }) as never;
  const NOW = new Date('2027-01-01T00:00:00Z');

  it('maps a whole series to its dates and a drop-in to its one date, upcoming and public only', async () => {
    db.current.seed('events', [
      event(1, { google_recurring_event_id: 'ser', start_time: '2026-12-01T01:00:00Z' }),
      event(2, { google_recurring_event_id: 'ser', start_time: '2027-02-01T01:00:00Z' }),
      event(3, { google_recurring_event_id: 'ser', start_time: '2027-03-01T01:00:00Z' }),
      event(4, { google_recurring_event_id: 'ser', start_time: '2027-04-01T01:00:00Z', visibility: 'test' }),
      event(5, { start_time: '2027-05-01T01:00:00Z' }),
      event(6, { start_time: '2027-05-08T01:00:00Z' }),
    ]);
    const ids = await upcomingCalendarEventIds(
      [reg({ series_mode: 'whole', series_key: 'ser' }), reg({ series_mode: 'dropin', occurrence_event_id: id(5), series_key: 'x' }), reg({ series_mode: 'whole', series_key: id(6) })],
      NOW
    );
    expect(ids).toEqual([id(2), id(3), id(5), id(6)]);
  });

  it('never filters the uuid id column with a recurring (non-uuid) series key', async () => {
    const idFilters: unknown[][] = [];
    const realFrom = db.current.from.bind(db.current);
    db.current.from = (table: string) => {
      const q = realFrom(table);
      const realIn = q.in.bind(q);
      q.in = (col: string, vs: unknown[]) => {
        if (col === 'id') idFilters.push(vs);
        return realIn(col, vs);
      };
      return q;
    };
    db.current.seed('events', [event(1, { google_recurring_event_id: 'ser', start_time: '2027-02-01T01:00:00Z' })]);
    await upcomingCalendarEventIds([reg({ series_mode: 'whole', series_key: 'ser' }), reg({ series_mode: 'whole', series_key: id(1) })], NOW);
    expect(idFilters).toEqual([[id(1)]]);
  });

  it('gives nothing (no link) when every date is past, or the sign-up was removed', async () => {
    db.current.seed('events', [event(1, { google_recurring_event_id: 'ser', start_time: '2026-11-01T01:00:00Z' })]);
    expect(await upcomingCalendarEventIds([reg({ series_mode: 'whole', series_key: 'ser' })], NOW)).toEqual([]);
    db.current.seed('events', [event(1, { start_time: '2027-05-01T01:00:00Z' })]);
    expect(await upcomingCalendarEventIds([reg({ series_mode: 'dropin', occurrence_event_id: id(1), deleted_at: '2027-01-01T00:00:00Z' })], NOW)).toEqual([]);
  });
});
