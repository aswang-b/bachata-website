import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));
vi.mock('../../src/lib/admin', () => ({ requireAdmin: async () => ({ user: { email: 'admin@test' }, error: null }) }));

import { setServerTimeZone } from '../../src/lib/siteTime';
import { buildClassSeriesList } from '../../src/lib/classSeries';
import { expandRegistrationsToEntries, type AttendanceRegistrationRow } from '../../src/lib/attendanceMatching';
import { GET as analyticsData } from '../../src/pages/api/admin/analytics-data';
import { GET as attendanceData } from '../../src/pages/api/admin/attendance-data';

// What the class filters match by: the series key of each row's class
// (google_recurring_event_id ?? id). Sign-ups already carry it; check-ins and
// attendance rows carry it from these feeds.
const get = (route: typeof analyticsData) => route({ request: new Request('http://x/api', { headers: { Authorization: 'Bearer t' } }) } as never) as Promise<Response>;

const klass = (id: string, title: string, start: string, recurring: string | null = null) => ({
  id,
  title,
  event_type: 'class',
  visibility: 'public',
  start_time: start,
  end_time: new Date(Date.parse(start) + 3600_000).toISOString(),
  time_zone: 'America/Chicago',
  google_recurring_event_id: recurring,
  price_whole_series: 50,
  price_drop_in: 15,
});
// Two same-named classes (one a two-date series) and one whose title contains theirs.
const events = [
  klass('c1', 'Bachata Basics', '2027-06-09T01:00:00Z', 'series-1'),
  klass('c2', 'Bachata Basics', '2027-06-16T01:00:00Z', 'series-1'),
  klass('c3', 'Bachata Basics', '2027-09-09T01:00:00Z'),
  klass('c4', 'Bachata Basics Advanced', '2027-06-10T01:00:00Z'),
];

beforeEach(() => {
  setServerTimeZone('America/Chicago');
  db.current = new FakeSupabase();
  // Only the columns a route asks for come back, so a feed that forgets one shows it.
  db.current.projectColumns = true;
  db.current.seed('events', events);
});

describe('the Check-Ins feed (analytics-data)', () => {
  it("sends each check-in's class series key: a series' recurring id, a single class's own id, none without a class date", async () => {
    const checkin = (id: string, event_id: string | null) => ({ id, created_at: '2027-06-09T01:40:00Z', first_name: 'Ana', last_name: 'B', phone: '1', class_title: 'Bachata Basics', event_id, deleted_at: null });
    db.current.seed('class_checkins', [checkin('k1', 'c2'), checkin('k2', 'c3'), checkin('k3', 'c4'), checkin('k4', null)]);
    const { checkins } = await (await get(analyticsData)).json();
    const keyOf = (id: string) => checkins.find((c: { id: string }) => c.id === id).seriesKey;
    expect(keyOf('k1')).toBe('series-1');
    expect(keyOf('k2')).toBe('c3');
    expect(keyOf('k3')).toBe('c4');
    expect(keyOf('k4')).toBeNull();
  });

  it('no longer sends a bare list of class titles to filter by', async () => {
    expect(await (await get(analyticsData)).json()).not.toHaveProperty('classTitles');
  });
});

describe('the Attendance feed (attendance-data)', () => {
  const reg = (id: string, o: Record<string, unknown> = {}) => ({
    id,
    first_name: 'Ana',
    last_name: 'B',
    email: null,
    phone: '1',
    class_title: 'Bachata Basics',
    series_key: 'c3',
    series_mode: 'dropin',
    price: 15,
    occurrence_event_id: 'c3',
    created_at: '2027-05-01T00:00:00Z',
    deleted_at: null,
    ...o,
  });

  it("carries each entry's series key, from its sign-up, and the orphaned check-in's from its class date", async () => {
    db.current.seed('class_registrations', [reg('r1'), reg('r2', { series_key: 'series-1', series_mode: 'whole', occurrence_event_id: null, first_name: 'Ben' })]);
    db.current.seed('class_checkins', [
      { id: 'k1', first_name: 'Zed', last_name: 'Q', phone: '9', email: null, class_title: 'Bachata Basics', event_id: 'c2', created_at: '2027-06-16T01:40:00Z', deleted_at: null },
      { id: 'k2', first_name: 'Yan', last_name: 'Q', phone: '8', email: null, class_title: 'Bachata Basics', event_id: null, created_at: '2027-06-16T01:40:00Z', deleted_at: null },
    ]);
    const { entries, orphanedCheckins } = await (await get(attendanceData)).json();
    expect(entries.filter((e: { firstName: string }) => e.firstName === 'Ana').map((e: { seriesKey: string }) => e.seriesKey)).toEqual(['c3']);
    // A Whole Series expands to a row per date, all in its series.
    expect(entries.filter((e: { firstName: string }) => e.firstName === 'Ben').map((e: { seriesKey: string }) => e.seriesKey)).toEqual(['series-1', 'series-1']);
    const key = (id: string) => orphanedCheckins.find((c: { id: string }) => c.id === id).seriesKey;
    expect(key('k1')).toBe('series-1');
    expect(key('k2')).toBeNull();
  });
});

describe('attendance entries', () => {
  const series = buildClassSeriesList(events);
  const reg = (o: Partial<AttendanceRegistrationRow>): AttendanceRegistrationRow => ({
    id: 'r',
    first_name: 'A',
    last_name: 'B',
    email: null,
    phone: null,
    class_title: 'Bachata Basics Advanced',
    series_mode: 'dropin',
    price: 15,
    occurrence_event_id: null,
    created_at: '2027-05-01T00:00:00Z',
    ...o,
  });

  it("keep the sign-up's own series key, else the series their dates were found in, else none", () => {
    expect(expandRegistrationsToEntries([reg({ series_key: 'c4', occurrence_event_id: 'c4' })], series)[0].seriesKey).toBe('c4');
    expect(expandRegistrationsToEntries([reg({ occurrence_event_id: 'c4' })], series)[0].seriesKey).toBe('c4');
    expect(expandRegistrationsToEntries([reg({})], series)[0].seriesKey).toBe('c4');
    expect(expandRegistrationsToEntries([reg({ series_mode: 'whole' })], series)[0].seriesKey).toBe('c4');
    expect(expandRegistrationsToEntries([reg({ class_title: 'Gone' })], series)[0].seriesKey).toBeNull();
    expect(expandRegistrationsToEntries([reg({ class_title: 'Gone', series_mode: 'whole', series_key: 'old' })], series)[0].seriesKey).toBe('old');
  });
});
