import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));
vi.mock('../../src/lib/admin', () => ({ requireAdmin: async () => ({ user: { email: 'admin@test' }, error: null }) }));

import { setServerTimeZone } from '../../src/lib/siteTime';
import { classStamp } from '../../src/lib/eventClock';
import { buildClassSeriesList } from '../../src/lib/classSeries';
import { expandRegistrationsToEntries, type AttendanceRegistrationRow } from '../../src/lib/attendanceMatching';
import { GET as checkinClasses } from '../../src/pages/api/admin/checkin-classes';
import { GET as analyticsData } from '../../src/pages/api/admin/analytics-data';
import { GET as attendanceData } from '../../src/pages/api/admin/attendance-data';
import { GET as pushGet } from '../../src/pages/api/admin/push';
import { GET as dealsGet } from '../../src/pages/api/admin/deals';
import { GET as recyclingBin } from '../../src/pages/api/admin/recycling-bin';

// Admin screens (batch 2 of per-class time zones, migration 0076): a class's
// own date and time follow its zone, with "MT" after a time only off the
// site's clock. The site is on Central here; the Santa Fe class is Mountain.
const DENVER = 'America/Denver';
// 7:30 PM Mountain on Tuesday, June 8, 2027 (8:30 PM Central, 01:30 UTC on the 9th).
const START = '2027-06-09T01:30:00Z';
const END = '2027-06-09T02:30:00Z';
const MOUNTAIN_ID = '00000000-0000-4000-8000-0000000000a1';
const CENTRAL_ID = '00000000-0000-4000-8000-0000000000a2';

const mountainClass = {
  id: MOUNTAIN_ID,
  title: 'Santa Fe Bachata',
  event_type: 'class',
  visibility: 'public',
  start_time: START,
  end_time: END,
  time_zone: DENVER,
  google_recurring_event_id: null,
  price_whole_series: 50,
  price_drop_in: 15,
  registration_closed: false,
  location: 'Studio, Santa Fe',
};
const centralClass = { ...mountainClass, id: CENTRAL_ID, title: 'Madison Bachata', time_zone: 'America/Chicago', location: 'Studio' };

const get = (route: typeof checkinClasses, url = 'http://x/api') =>
  route({ request: new Request(url, { headers: { Authorization: 'Bearer t' } }), url: new URL(url) } as never) as Promise<Response>;

beforeEach(() => {
  setServerTimeZone('America/Chicago');
  db.current = new FakeSupabase();
  // Only the columns a route asks for come back, so a feed that forgets time_zone shows it.
  db.current.projectColumns = true;
  db.current.seed('events', [mountainClass, centralClass]);
});
afterEach(() => setServerTimeZone('America/Chicago'));

describe('classStamp', () => {
  it("prints a class's start in its own zone, with its zone only off the site's clock", () => {
    expect(classStamp(START, DENVER)).toBe('Jun 8, 2027, 7:30 PM MT');
    expect(classStamp(START, 'America/Chicago')).toBe('Jun 8, 2027, 8:30 PM');
    // No zone stored: the site's.
    expect(classStamp(START, null)).toBe('Jun 8, 2027, 8:30 PM');
    expect(classStamp(null, DENVER)).toBe('—');
  });

  it('prints a date alone on its own day without a zone', () => {
    // 11:30 PM Mountain on Monday is already Tuesday in Central.
    expect(classStamp('2027-06-08T05:30:00Z', DENVER, { weekday: 'short', month: 'short', day: 'numeric' })).toBe('Mon, Jun 7');
    expect(classStamp('2027-06-08T05:30:00Z', 'America/Chicago', { weekday: 'short', month: 'short', day: 'numeric' })).toBe('Tue, Jun 8');
  });

  it('prints no zone for a Mountain class when the site itself is on Mountain time', () => {
    setServerTimeZone(DENVER);
    expect(classStamp(START, DENVER)).toBe('Jun 8, 2027, 7:30 PM');
  });
});

describe('attendance entries', () => {
  it("carry each class's own zone for its date", () => {
    const series = buildClassSeriesList([mountainClass]);
    const reg = (id: string, mode: 'whole' | 'dropin', occurrence: string | null): AttendanceRegistrationRow =>
      ({ id, first_name: 'A', last_name: 'B', email: null, phone: null, class_title: 'Santa Fe Bachata', series_mode: mode, price: 15, occurrence_event_id: occurrence, created_at: '2027-05-01T00:00:00Z' }) as AttendanceRegistrationRow;
    const entries = expandRegistrationsToEntries([reg('r1', 'whole', null), reg('r2', 'dropin', MOUNTAIN_ID), reg('r3', 'dropin', null)], series);
    expect(entries.map((e) => e.occurrenceTimeZone)).toEqual([DENVER, DENVER, DENVER]);
    // A class that can't be found any more has no zone (and no date).
    expect(expandRegistrationsToEntries([{ ...reg('r4', 'whole', null), class_title: 'Gone' }], series)[0].occurrenceTimeZone).toBeNull();
  });
});

describe('admin feeds', () => {
  it('the door sign picker (checkin-classes) labels a Mountain class in Mountain time with MT', async () => {
    const { classSeries } = await (await get(checkinClasses)).json();
    const mountain = classSeries.find((s: { key: string }) => s.key === MOUNTAIN_ID);
    const central = classSeries.find((s: { key: string }) => s.key === CENTRAL_ID);
    expect(mountain.timeZone).toBe(DENVER);
    expect(mountain.subLabel).toBe('Tue, Jun 8, 7:30 PM–8:30 PM MT');
    expect(mountain.occurrences[0].label).toBe('Tue, Jun 8, 7:30 PM MT');
    expect(central.subLabel).toBe('Tue, Jun 8, 8:30 PM–9:30 PM');
  });

  it("the dashboard (analytics-data) labels classes in their zone and sends each check-in's class zone", async () => {
    db.current.seed('class_checkins', [
      { id: 'c1', created_at: '2027-06-09T01:40:00Z', first_name: 'Ana', last_name: 'B', phone: '1', class_title: 'Santa Fe Bachata', event_id: MOUNTAIN_ID, deleted_at: null },
      { id: 'c2', created_at: '2027-06-09T01:40:00Z', first_name: 'Ben', last_name: 'C', phone: '2', class_title: 'Old', event_id: null, deleted_at: null },
    ]);
    const body = await (await get(analyticsData)).json();
    expect(body.classSeries.find((s: { key: string }) => s.key === MOUNTAIN_ID).occurrences[0].label).toBe('Tue, Jun 8, 7:30 PM MT');
    const byId = Object.fromEntries(body.checkins.map((c: { id: string }) => [c.id, c]));
    expect(byId.c1).toMatchObject({ classDate: START, classTimeZone: DENVER });
    expect(classStamp(byId.c1.classDate, byId.c1.classTimeZone)).toBe('Jun 8, 2027, 7:30 PM MT');
    expect(byId.c2).toMatchObject({ classDate: null, classTimeZone: null });
  });

  it('the Attendance tab (attendance-data) dates each entry in its class zone', async () => {
    db.current.seed('class_registrations', [
      { id: 'r1', first_name: 'Ana', last_name: 'B', email: null, phone: '1', class_title: 'Santa Fe Bachata', series_mode: 'dropin', price: 15, occurrence_event_id: MOUNTAIN_ID, created_at: '2027-05-01T00:00:00Z', deleted_at: null },
    ]);
    const { entries } = await (await get(attendanceData)).json();
    expect(entries[0]).toMatchObject({ occurrenceDate: START, occurrenceTimeZone: DENVER });
  });

  it("notifications (push) get a class's zone, for its picker and message", async () => {
    const { event } = await (await get(pushGet, `http://x/api/admin/push?event=${MOUNTAIN_ID}`)).json();
    expect(event).toMatchObject({ id: MOUNTAIN_ID, start_time: START, time_zone: DENVER });
  });

  it("the deals picker (deals) gets each class's zone", async () => {
    // Its upcoming list counts from now; the seeded classes are in 2027.
    const { options } = await (await get(dealsGet)).json();
    expect(options.find((o: { key: string }) => o.key === MOUNTAIN_ID)).toMatchObject({ first: START, timeZone: DENVER });
    expect(options.find((o: { key: string }) => o.key === CENTRAL_ID)).toMatchObject({ timeZone: 'America/Chicago' });
  });

  it("the Recycling Bin (recycling-bin) dates a binned check-in in its class's zone", async () => {
    db.current.seed('class_checkins', [
      { first_name: 'Ana', last_name: 'B', class_title: 'Santa Fe Bachata', event_id: MOUNTAIN_ID, deleted_at: '2027-06-10T00:00:00Z', deleted_by: 'admin@test', deletion_id: 'd1' },
    ]);
    const { items } = await (await get(recyclingBin)).json();
    expect(items[0].classes[0]).toMatchObject({ date: START, timeZone: DENVER });
  });
});
