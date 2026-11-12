import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));
vi.mock('../../src/lib/admin', () => ({ requireAdmin: async () => ({ user: { email: 'admin@test' }, error: null }) }));

const google = vi.hoisted(() => ({ connected: false, insertCalendarEvent: vi.fn(), updateCalendarEvent: vi.fn() }));
vi.mock('../../src/lib/googleCalendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/googleCalendar')>();
  return {
    ...actual,
    getGoogleAccessToken: async () => {
      if (!google.connected) throw new actual.GoogleNotConnectedError();
      return 'token';
    },
    insertCalendarEvent: google.insertCalendarEvent,
    updateCalendarEvent: google.updateCalendarEvent,
    deleteCalendarEvent: async () => undefined,
  };
});
vi.mock('../../src/lib/calendarSync', () => ({
  runCalendarSync: async () => ({ public: { errors: [] }, private: { errors: [] } }),
  syncErrorText: () => null,
}));

import { POST as createEvent } from '../../src/pages/api/admin/create-event';
import { POST as updateEvent } from '../../src/pages/api/admin/update-event';

// A class's city and state (migration 0077) through the editor's save routes.
const call = (route: typeof createEvent, body: Record<string, unknown>) =>
  route({ request: new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { Authorization: 'Bearer t' } }) } as never) as Promise<Response>;

const base = { title: 'Desert Bachata', startTime: '2027-06-09T01:00:00.000Z', endTime: '2027-06-09T02:00:00.000Z', eventType: 'class', location: 'Moxie Studio' };

beforeEach(() => {
  db.current = new FakeSupabase();
  google.connected = false;
  google.insertCalendarEvent.mockReset().mockResolvedValue({ id: 'g-master' });
  google.updateCalendarEvent.mockReset().mockResolvedValue({});
});

describe('create-event', () => {
  it('stores the city and state trimmed and capped at 80, empty as null, and leaves them out when not sent', async () => {
    await call(createEvent, { ...base, city: '  Santa Fe ', state: ' NM ' });
    await call(createEvent, { ...base, city: 'x'.repeat(200), state: '' });
    await call(createEvent, { ...base, city: '  ', state: 'NM' });
    await call(createEvent, base);
    const [a, b, c, d] = db.current.callsTo('events', 'insert').map((x) => x.payload as Record<string, unknown>);
    expect(a).toMatchObject({ city: 'Santa Fe', state: 'NM', location: 'Moxie Studio' });
    expect((b.city as string).length).toBe(80);
    expect(b.state).toBeNull();
    expect(c).toMatchObject({ city: null, state: null });
    expect(d).not.toHaveProperty('city');
  });

  it('puts a new series\' city and state on every class, as it does the location', async () => {
    google.connected = true;
    const res = await call(createEvent, { ...base, city: 'Santa Fe', state: 'NM', recurrence: { byDay: ['TU'], interval: 1, endType: 'count', count: 4 } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(google.insertCalendarEvent.mock.calls)).not.toContain('Santa Fe');
    expect(db.current.callsTo('events', 'update')[0].payload).toMatchObject({ city: 'Santa Fe', state: 'NM' });
  });
});

describe('update-event', () => {
  const ID = '00000000-0000-4000-8000-0000000000e1';
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: base.title, visibility: 'public', google_event_id: null, google_recurring_event_id: null, flyer_url: null, time_zone: 'America/Chicago',
    location: 'Moxie Studio', city: 'Santa Fe', state: 'NM', start_time: base.startTime, end_time: base.endTime, ...extra,
  });

  it('keeps the stored city when the request leaves it out, replaces it when sent, clears it with nulls', async () => {
    db.current.seed('events', [row(ID)]);
    expect((await call(updateEvent, { ...base, id: ID })).status).toBe(200);
    expect(db.current.rows('events')[0]).toMatchObject({ city: 'Santa Fe', state: 'NM' });
    await call(updateEvent, { ...base, id: ID, city: ' Taos ', state: 'NM' });
    expect(db.current.rows('events')[0]).toMatchObject({ city: 'Taos', state: 'NM' });
    await call(updateEvent, { ...base, id: ID, location: 'Typed by hand', city: null, state: null });
    expect(db.current.rows('events')[0]).toMatchObject({ location: 'Typed by hand', city: null, state: null });
  });

  it('applies a series-wide edit to every class of the series', async () => {
    db.current.seed('events', [
      row('w1', { google_recurring_event_id: 'R', google_event_id: 'g1' }),
      row('w2', { google_recurring_event_id: 'R', google_event_id: 'g2', start_time: '2027-06-16T01:00:00Z', end_time: '2027-06-16T02:00:00Z' }),
    ]);
    const res = await call(updateEvent, { ...base, id: 'w1', applyToSeries: true, city: 'Taos', state: 'NM' });
    expect(res.status).toBe(200);
    expect(db.current.rows('events').map((r) => r.city)).toEqual(['Taos', 'Taos']);
  });

  it('edits one class of a series alone when the edit is not series-wide', async () => {
    db.current.seed('events', [
      row('w1', { google_recurring_event_id: 'R', google_event_id: 'g1' }),
      row('w2', { google_recurring_event_id: 'R', google_event_id: 'g2' }),
    ]);
    await call(updateEvent, { ...base, id: 'w1', city: 'Taos', state: 'NM' });
    expect(db.current.rows('events').map((r) => r.city)).toEqual(['Taos', 'Santa Fe']);
  });

  it('puts the city on a rebuilt series and tells Google nothing about it', async () => {
    google.connected = true;
    db.current.seed('events', [
      row('w1', { google_recurring_event_id: 'R', google_event_id: 'g1', start_time: '2027-06-09T01:00:00Z', end_time: '2027-06-09T02:00:00Z' }),
      row('w2', { google_recurring_event_id: 'R', google_event_id: 'g2', start_time: '2027-06-16T01:00:00Z', end_time: '2027-06-16T02:00:00Z' }),
    ]);
    const res = await call(updateEvent, { ...base, id: 'w1', applyToSeries: true, rebuildSeries: true, city: 'Taos', state: 'NM', recurrence: { byDay: ['TU'], interval: 1, endType: 'count', count: 2 } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(google.insertCalendarEvent.mock.calls)).not.toContain('Taos');
    expect(db.current.callsTo('events', 'update')[0].payload).toMatchObject({ city: 'Taos', state: 'NM' });
  });
});
