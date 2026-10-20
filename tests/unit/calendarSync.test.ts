import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

const google = vi.hoisted(() => ({
  events: { public: [] as Record<string, unknown>[], private: [] as Record<string, unknown>[] },
  insertCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));
vi.mock('../../src/lib/googleCalendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/googleCalendar')>();
  return {
    ...actual,
    getGoogleAccessToken: async () => 'token',
    listCalendarEvents: async (_t: string, visibility: 'public' | 'private') => google.events[visibility],
    insertCalendarEvent: google.insertCalendarEvent,
    updateCalendarEvent: google.updateCalendarEvent,
  };
});

import { runCalendarSync, syncErrorText } from '../../src/lib/calendarSync';

const day = 86400000;
const at = (days: number, hour = 19) => {
  const d = new Date(Date.now() + days * day);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

// A site row and the identical Google event it mirrors.
function linkedPair(id: string, overrides: Record<string, unknown> = {}) {
  const row = {
    id,
    title: 'Bachata 1',
    description: null,
    location: 'Studio',
    color: 'green',
    event_type: 'class',
    visibility: 'public',
    start_time: at(7),
    end_time: at(7, 20),
    google_event_id: `g-${id}`,
    google_recurring_event_id: null,
    updated_at: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  };
  const gEvent = {
    id: `g-${id}`,
    summary: row.title,
    location: row.location,
    colorId: '10',
    start: { dateTime: row.start_time },
    end: { dateTime: row.end_time },
    updated: new Date(Date.now() - 60000).toISOString(),
  };
  return { row, gEvent };
}

beforeEach(() => {
  db.current = new FakeSupabase();
  google.events = { public: [], private: [] };
  google.insertCalendarEvent.mockReset().mockImplementation(async (_t, _v, e) => ({ id: `g-new-${e.siteEventId}` }));
  google.updateCalendarEvent.mockReset().mockResolvedValue({});
});

describe('pulling from Google', () => {
  it('saves a new Google event with a plain insert (the google_event_id index is partial, so upserts fail)', async () => {
    google.events.public = [{ id: 'g1', summary: 'Social', start: { dateTime: at(3) }, end: { dateTime: at(3, 22) } }];
    const result = await runCalendarSync();
    expect(result.public.pulledCreated).toBe(1);
    expect(db.current.callsTo('events', 'upsert')).toHaveLength(0);
    expect(db.current.rows('events')[0]).toMatchObject({ title: 'Social', google_event_id: 'g1', event_type: 'event' });
  });

  it('updates the existing row instead when the insert hits the unique index (23505)', async () => {
    db.current.seed('events', [{ id: 'old', title: 'Old', google_event_id: 'g1', visibility: 'public', start_time: at(-30) }]);
    db.current.failNext.set('events.insert', { code: '23505', message: 'duplicate key' });
    google.events.public = [{ id: 'g1', summary: 'Renamed', start: { dateTime: at(3) }, end: { dateTime: at(3, 22) } }];
    const result = await runCalendarSync();
    expect(result.public).toMatchObject({ pulledUpdated: 1, errors: [] });
    expect(db.current.rows('events')[0].title).toBe('Renamed');
  });

  it("carries a series' site-only settings (type, prices, caps by role) onto an instance Google regenerated", async () => {
    const { row } = linkedPair('a', {
      google_recurring_event_id: 'R',
      price_whole_series: 80,
      capacity: 20,
      capacity_by_role: true,
      leader_capacity: 8,
      follower_capacity: 9,
      show_capacity: true,
    });
    db.current.seed('events', [row]);
    google.events.public = [
      { id: 'g-a', summary: row.title, location: row.location, colorId: '10', start: { dateTime: row.start_time }, end: { dateTime: row.end_time }, recurringEventId: 'R' },
      { id: 'g-regenerated', summary: row.title, recurringEventId: 'R', start: { dateTime: at(14) }, end: { dateTime: at(14, 20) } },
    ];
    await runCalendarSync();
    const created = db.current.rows('events').find((r) => r.google_event_id === 'g-regenerated')!;
    expect(created).toMatchObject({ event_type: 'class', price_whole_series: 80, capacity_by_role: true, leader_capacity: 8, follower_capacity: 9, show_capacity: true });
  });

  it('pulls an edit made on Google when Google is newer and something mirrored changed', async () => {
    const { row, gEvent } = linkedPair('a');
    db.current.seed('events', [row]);
    google.events.public = [{ ...gEvent, summary: 'Bachata 1 (moved)', updated: new Date(Date.now() + 1000).toISOString() }];
    const result = await runCalendarSync();
    expect(result.public.pulledUpdated).toBe(1);
    expect(google.updateCalendarEvent).not.toHaveBeenCalled();
    expect(db.current.rows('events')[0].title).toBe('Bachata 1 (moved)');
  });
});

describe('pushing to Google', () => {
  it('does not re-push an unchanged event even when the site row is newer (that tripped Google rate limits)', async () => {
    const { row, gEvent } = linkedPair('a', { updated_at: new Date().toISOString(), price_whole_series: 99 });
    db.current.seed('events', [row]);
    google.events.public = [gEvent];
    await runCalendarSync();
    expect(google.updateCalendarEvent).not.toHaveBeenCalled();
    expect(db.current.callsTo('events', 'update')).toHaveLength(0);
  });

  it('pushes a site edit, and keeps going (collecting the error) when one push fails', async () => {
    const a = linkedPair('a', { title: 'Edited A', updated_at: new Date().toISOString() });
    const b = linkedPair('b', { title: 'Edited B', updated_at: new Date().toISOString() });
    db.current.seed('events', [a.row, b.row]);
    google.events.public = [
      { ...a.gEvent, summary: 'A' },
      { ...b.gEvent, summary: 'B' },
    ];
    google.updateCalendarEvent.mockRejectedValueOnce(new Error('403 rateLimitExceeded'));
    const result = await runCalendarSync();
    expect(google.updateCalendarEvent).toHaveBeenCalledTimes(2);
    expect(result.public.errors).toHaveLength(1);
    expect(syncErrorText(result)).toContain('rateLimitExceeded');
  });

  it('pushes a site-created event and links it', async () => {
    db.current.seed('events', [{ id: 'new', title: 'New', visibility: 'public', start_time: at(5), end_time: at(5, 20), google_event_id: null }]);
    const result = await runCalendarSync();
    expect(result.public.pushedCreated).toBe(1);
    expect(db.current.rows('events')[0].google_event_id).toBe('g-new-new');
  });
});

describe('custom (picked) colors', () => {
  // '#00a0ff' is closest to Google's Peacock (colorId 7).
  const picked = '#00a0ff';

  it("isn't re-pushed while Google shows the picked color's closest match", async () => {
    const { row, gEvent } = linkedPair('a', { color: picked, updated_at: new Date().toISOString() });
    db.current.seed('events', [row]);
    google.events.public = [{ ...gEvent, colorId: '7' }];
    await runCalendarSync();
    expect(google.updateCalendarEvent).not.toHaveBeenCalled();
  });

  it('survives pulling an edit made on Google to something else (e.g. the title)', async () => {
    const { row, gEvent } = linkedPair('a', { color: picked });
    db.current.seed('events', [row]);
    google.events.public = [{ ...gEvent, colorId: '7', summary: 'Renamed on Google', updated: new Date(Date.now() + 1000).toISOString() }];
    await runCalendarSync();
    expect(db.current.rows('events')[0]).toMatchObject({ title: 'Renamed on Google', color: picked });
  });

  it('gives way when the color itself was changed on Google', async () => {
    const { row, gEvent } = linkedPair('a', { color: picked });
    db.current.seed('events', [row]);
    google.events.public = [{ ...gEvent, colorId: '11', updated: new Date(Date.now() + 1000).toISOString() }];
    await runCalendarSync();
    expect(db.current.rows('events')[0].color).toBe('red');
  });

  it('carries over onto classes Google re-creates for a series', async () => {
    const { row } = linkedPair('a', { color: picked, google_recurring_event_id: 'R' });
    db.current.seed('events', [row]);
    google.events.public = [
      { id: 'g-a', summary: row.title, location: row.location, colorId: '7', start: { dateTime: row.start_time }, end: { dateTime: row.end_time }, recurringEventId: 'R' },
      { id: 'g-new', summary: row.title, colorId: '7', recurringEventId: 'R', start: { dateTime: at(14) }, end: { dateTime: at(14, 20) } },
    ];
    await runCalendarSync();
    expect(db.current.rows('events').find((r) => r.google_event_id === 'g-new')!.color).toBe(picked);
  });
});

describe('deletions and the sync window', () => {
  it('deletes a linked row whose Google event is gone', async () => {
    const { row } = linkedPair('a');
    db.current.seed('events', [row]);
    const result = await runCalendarSync();
    expect(result.public.pulledDeleted).toBe(1);
    expect(db.current.rows('events')).toHaveLength(0);
  });

  it('leaves events beyond the window alone: not deleted as "gone from Google", not pushed early', async () => {
    db.current.seed('events', [
      { ...linkedPair('far').row, start_time: at(200), end_time: at(200, 20) },
      { id: 'far-unlinked', title: 'Far', visibility: 'public', start_time: at(250), end_time: at(250, 20), google_event_id: null },
    ]);
    const result = await runCalendarSync();
    expect(result.public).toMatchObject({ pulledDeleted: 0, pushedCreated: 0 });
    expect(db.current.rows('events')).toHaveLength(2);
    expect(google.insertCalendarEvent).not.toHaveBeenCalled();
  });

  it('skips cancelled instances and all-day events without times', async () => {
    google.events.public = [
      { id: 'c', status: 'cancelled', start: { dateTime: at(2) }, end: { dateTime: at(2, 20) } },
      { id: 'x', summary: 'No times' },
    ];
    const result = await runCalendarSync();
    expect(result.public.pulledCreated).toBe(0);
  });
});
