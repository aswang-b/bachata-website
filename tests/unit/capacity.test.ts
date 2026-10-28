import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

import {
  capacityColumns,
  capacityErrorMessage,
  getSpotsByOccurrence,
  publicSpotsLabel,
  seriesSpots,
  spotsLabel,
  type SpotsInfo,
} from '../../src/lib/capacity';

beforeEach(() => {
  db.current = new FakeSupabase();
});

describe('spot counts', () => {
  it('counts a general cap from the cached taken count, treating a missing cache row as empty', async () => {
    db.current.seed('event_spot_counts', [{ event_id: 'a', taken: 3, leaders_taken: 0, followers_taken: 0 }]);
    const spots = await getSpotsByOccurrence([
      { id: 'a', google_recurring_event_id: null, capacity: 5 },
      { id: 'b', google_recurring_event_id: null, capacity: 2 },
      { id: 'c', google_recurring_event_id: null, capacity: null },
    ]);
    expect(spots.get('a')).toMatchObject({ byRole: false, total: { remaining: 2 }, full: false });
    expect(spots.get('b')).toMatchObject({ total: { remaining: 2, taken: 0 } });
    expect(spots.has('c')).toBe(false);
  });

  it('caps leaders and followers separately and ignores the general cap while capped by role', async () => {
    db.current.seed('event_spot_counts', [{ event_id: 'a', taken: 9, leaders_taken: 4, followers_taken: 5 }]);
    const s = (await getSpotsByOccurrence([{ id: 'a', google_recurring_event_id: null, capacity: 9, capacity_by_role: true, leader_capacity: 4, follower_capacity: null }])).get('a')!;
    expect(s.total).toBeNull();
    expect(s.leader).toMatchObject({ remaining: 0 });
    // A blank role is unlimited, so the class is never full.
    expect(s.follower).toBeNull();
    expect(s.full).toBe(false);
  });

  it('is full by role only when both roles are capped and full', async () => {
    db.current.seed('event_spot_counts', [{ event_id: 'a', taken: 4, leaders_taken: 2, followers_taken: 2 }]);
    const s = (await getSpotsByOccurrence([{ id: 'a', google_recurring_event_id: null, capacity_by_role: true, leader_capacity: 2, follower_capacity: 2 }])).get('a')!;
    expect(s.full).toBe(true);
    expect(spotsLabel(s)).toBe('Full');
  });

  it('a series is as open as its tightest class, per role', () => {
    const occ = (leader: number, follower: number): SpotsInfo => ({
      byRole: true,
      total: null,
      leader: { capacity: 10, taken: 10 - leader, remaining: leader },
      follower: { capacity: 10, taken: 10 - follower, remaining: follower },
      full: false,
    });
    const spots = new Map([
      ['w1', occ(5, 1)],
      ['w2', occ(2, 6)],
    ]);
    const s = seriesSpots(spots, ['w1', 'w2'])!;
    expect(s.leader!.remaining).toBe(2);
    expect(s.follower!.remaining).toBe(1);
    expect(seriesSpots(spots, ['nope'])).toBeNull();
  });
});

describe('labels', () => {
  const role = (leader: number | null, follower: number | null): SpotsInfo => {
    const count = (n: number | null) => (n == null ? null : { capacity: 10, taken: 10 - n, remaining: n });
    const s = { byRole: true, total: null, leader: count(leader), follower: count(follower) };
    return { ...s, full: leader === 0 && follower === 0 };
  };

  it('reads naturally for both kinds of cap', () => {
    expect(spotsLabel({ byRole: false, total: { capacity: 5, taken: 4, remaining: 1 }, leader: null, follower: null, full: false })).toBe('1 spot remaining');
    expect(spotsLabel(role(3, 0))).toBe('3 leader spots left · Followers full');
    expect(spotsLabel(role(1, null))).toBe('1 leader spot left');
  });

  it('shows the public only fullness when the count is hidden', () => {
    expect(publicSpotsLabel(role(3, 2), false)).toBeNull();
    expect(publicSpotsLabel(role(0, 2), false)).toBe('Leaders full');
    expect(publicSpotsLabel(role(0, 2), true)).toBe('Leaders full · 2 follower spots left');
    expect(publicSpotsLabel(null, true)).toBeNull();
  });
});

describe('capacityColumns (editor → row)', () => {
  it('keeps both sets of caps but uses the role ones only when toggled on', () => {
    expect(capacityColumns({ capacity: '20', capacityByRole: true, leaderCapacity: '8', followerCapacity: '', showCapacity: true }, 'class')).toEqual({
      capacity: 20,
      capacity_by_role: true,
      leader_capacity: 8,
      follower_capacity: null,
      show_capacity: true,
    });
  });

  it('never caps an event by role (events ask for no role)', () => {
    expect(capacityColumns({ capacity: '30', capacityByRole: true, leaderCapacity: '8' }, 'event')).toMatchObject({ capacity_by_role: false, capacity: 30 });
  });

  it('turns "show spots" off when nothing is capped', () => {
    expect(capacityColumns({ capacity: '', showCapacity: true }, 'class').show_capacity).toBe(false);
    expect(capacityColumns({ capacity: '12', capacityByRole: true, showCapacity: true }, 'class').show_capacity).toBe(false);
    expect(capacityColumns({ capacity: '-3', capacityByRole: false }, 'class').capacity).toBeNull();
  });
});

describe('capacityErrorMessage (register_submission refused a sign-up)', () => {
  const detail = (role: string, remaining: number) => JSON.stringify({ title: 'Bachata 1', role, remaining });

  it('names a full role, or how many of it are left', () => {
    expect(capacityErrorMessage(detail('leader', 0))).toBe('Sorry, "Bachata 1" is full for leaders.');
    expect(capacityErrorMessage(detail('follower', 2))).toBe('Sorry, "Bachata 1" only has 2 follower spots left — please register fewer followers.');
  });

  it('words the general cap by people', () => {
    expect(capacityErrorMessage(detail('', 0))).toBe('Sorry, "Bachata 1" is full.');
    expect(capacityErrorMessage(detail('', 1))).toBe('Sorry, "Bachata 1" only has 1 spot remaining — please register fewer people.');
  });

  it('still says something sensible without a usable detail', () => {
    expect(capacityErrorMessage(null)).toBe('Sorry, "this class" is full.');
    expect(capacityErrorMessage('not json')).toBe('Sorry, "this class" is full.');
  });
});

describe('getSpotsByOccurrence with many classes', () => {
  it('loads every chunk of counts (in parallel) and fails if any chunk fails', async () => {
    const events = Array.from({ length: 320 }, (_, i) => ({ id: `e${i}`, google_recurring_event_id: null, capacity: 5 }));
    db.current.seed('event_spot_counts', [{ event_id: 'e310', taken: 4, leaders_taken: 0, followers_taken: 0 }]);
    const spots = await getSpotsByOccurrence(events);
    expect(spots.size).toBe(320);
    expect(spots.get('e310')!.total!.remaining).toBe(1);
    expect(db.current.callsTo('event_spot_counts', 'select')).toHaveLength(3);

    db.current.failNext.set('event_spot_counts.select', { message: 'boom' });
    await expect(getSpotsByOccurrence(events)).rejects.toThrow('Failed to load spot counts.');
  });
});

describe('admin calendar events', () => {
  it("counts spots only on classes that haven't ended (it used to look up every past class too)", async () => {
    vi.doMock('../../src/lib/admin', () => ({ requireAdmin: async () => ({ user: { email: 'a@x' } }) }));
    const { GET } = await import('../../src/pages/api/admin/all-events');
    const past = Array.from({ length: 400 }, (_, i) => ({ id: `p${i}`, visibility: 'public', google_recurring_event_id: null, capacity: 5, start_time: '2020-01-01T00:00:00Z', end_time: '2020-01-01T01:00:00Z' }));
    db.current.seed('events', [...past, { id: 'u1', visibility: 'public', google_recurring_event_id: null, capacity: 5, start_time: '2999-01-01T00:00:00Z', end_time: '2999-01-01T01:00:00Z' }]);
    db.current.seed('event_spot_counts', [{ event_id: 'u1', taken: 2, leaders_taken: 0, followers_taken: 0 }]);
    const res = await GET({ request: new Request('http://x/api/admin/all-events') } as never);
    const { events } = await res.json();
    expect(events).toHaveLength(401);
    expect(events.find((e: { id: string }) => e.id === 'u1').spots_label).toBeTruthy();
    expect(events.find((e: { id: string }) => e.id === 'p0').spots_label).toBeNull();
    expect(db.current.callsTo('event_spot_counts', 'select')).toHaveLength(1);
  });
});
