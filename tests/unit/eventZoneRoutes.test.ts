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

// A class's own time zone (migration 0076) through the editor's save routes.
const call = (route: typeof createEvent, body: Record<string, unknown>) =>
  route({ request: new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { Authorization: 'Bearer t' } }) } as never) as Promise<Response>;

const base = { title: 'Santa Fe Bachata', startTime: '2027-06-09T01:00:00.000Z', endTime: '2027-06-09T02:00:00.000Z', eventType: 'class' };

beforeEach(() => {
  db.current = new FakeSupabase();
  google.connected = false;
  google.insertCalendarEvent.mockReset().mockResolvedValue({ id: 'g-master' });
  google.updateCalendarEvent.mockReset().mockResolvedValue({});
});

describe('create-event', () => {
  it('stores a valid zone, and leaves it to the database default when none is sent', async () => {
    expect((await call(createEvent, { ...base, timeZone: 'America/Denver' })).status).toBe(200);
    expect((await call(createEvent, base)).status).toBe(200);
    const [withZone, without] = db.current.callsTo('events', 'insert').map((c) => c.payload as Record<string, unknown>);
    expect(withZone).toMatchObject({ time_zone: 'America/Denver', start_time: base.startTime });
    expect(without).not.toHaveProperty('time_zone');
  });

  it('refuses an unknown zone (400) without saving', async () => {
    const res = await call(createEvent, { ...base, timeZone: 'Mars/Olympus' });
    expect(res.status).toBe(400);
    expect(db.current.callsTo('events', 'insert')).toHaveLength(0);
  });

  it("sends a new series to Google in its own zone and stores it on every class", async () => {
    google.connected = true;
    const res = await call(createEvent, { ...base, timeZone: 'America/Denver', recurrence: { byDay: ['TU'], interval: 1, endType: 'count', count: 4 } });
    expect(res.status).toBe(200);
    expect(google.insertCalendarEvent.mock.calls[0][2]).toMatchObject({ timeZone: 'America/Denver' });
    expect(db.current.callsTo('events', 'update')[0].payload).toMatchObject({ time_zone: 'America/Denver' });
  });
});

describe('update-event', () => {
  const ID = '00000000-0000-4000-8000-0000000000e1';
  beforeEach(() => {
    db.current.seed('events', [
      { id: ID, title: base.title, visibility: 'public', google_event_id: null, google_recurring_event_id: null, flyer_url: null, time_zone: 'America/Chicago', start_time: base.startTime, end_time: base.endTime },
    ]);
  });

  it('stores a new zone on a single class (an ordinary save) and refuses an unknown one', async () => {
    expect((await call(updateEvent, { ...base, id: ID, timeZone: 'Mars/Olympus' })).status).toBe(400);
    expect(db.current.callsTo('events', 'update')).toHaveLength(0);
    expect((await call(updateEvent, { ...base, id: ID, timeZone: 'America/Denver' })).status).toBe(200);
    expect(db.current.rows('events')[0]).toMatchObject({ time_zone: 'America/Denver', start_time: base.startTime });
  });

  it('keeps the stored zone when none is sent', async () => {
    expect((await call(updateEvent, { ...base, id: ID })).status).toBe(200);
    expect(db.current.rows('events')[0].time_zone).toBe('America/Chicago');
  });

  it("rebuilds a series in its new zone: the first class's typed date, the new wall-clock times", async () => {
    google.connected = true;
    // A Central series whose first class is Tuesday June 8, 2027, 8 PM Central (Wednesday 01:00 UTC).
    db.current.seed('events', [
      { id: 'w1', title: 'Weekly', visibility: 'public', google_event_id: 'g1', google_recurring_event_id: 'R', flyer_url: null, time_zone: 'America/Chicago', start_time: '2027-06-09T01:00:00Z', end_time: '2027-06-09T02:00:00Z' },
      { id: 'w2', title: 'Weekly', visibility: 'public', google_event_id: 'g2', google_recurring_event_id: 'R', flyer_url: null, time_zone: 'America/Chicago', start_time: '2027-06-16T01:00:00Z', end_time: '2027-06-16T02:00:00Z' },
    ]);
    // The editor kept "8:00 PM" typed and picked Mountain: 8 PM Mountain is 02:00 UTC.
    const res = await call(updateEvent, {
      id: 'w1',
      title: 'Weekly',
      startTime: '2027-06-09T02:00:00.000Z',
      endTime: '2027-06-09T03:00:00.000Z',
      timeZone: 'America/Denver',
      applyToSeries: true,
      rebuildSeries: true,
      recurrence: { byDay: ['TU'], interval: 1, endType: 'count', count: 2 },
    });
    expect(res.status).toBe(200);
    expect(google.insertCalendarEvent.mock.calls[0][2]).toMatchObject({ startTime: '2027-06-08T20:00:00', endTime: '2027-06-08T21:00:00', timeZone: 'America/Denver' });
    expect(db.current.callsTo('events', 'update')[0].payload).toMatchObject({ time_zone: 'America/Denver' });
  });
});
