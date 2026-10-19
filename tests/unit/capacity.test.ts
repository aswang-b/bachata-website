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
  getSpotsByOccurrence,
  publicSpotsLabel,
  seriesSpots,
  spotsLabel,
  validateCapacity,
  type SpotsInfo,
} from '../../src/lib/capacity';

const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

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

describe('validateCapacity (server-side check on registration)', () => {
  const series = (extra: Record<string, unknown>) => [
    { id: 'w1', google_recurring_event_id: 'S', start_time: future(7), ...extra },
    { id: 'w2', google_recurring_event_id: 'S', start_time: future(14), ...extra },
  ];
  const whole = [{ key: 'S', title: 'Bachata 1', label: 'Bachata 1', mode: 'whole' as const }];

  it('turns away a role that is full and names it', async () => {
    db.current.seed('events', series({ capacity_by_role: true, leader_capacity: 1, follower_capacity: 2 }));
    db.current.seed('event_spot_counts', [
      { event_id: 'w1', taken: 1, leaders_taken: 1, followers_taken: 0 },
      { event_id: 'w2', taken: 1, leaders_taken: 1, followers_taken: 0 },
    ]);
    expect((await validateCapacity(whole, ['leader']))?.message).toBe('Sorry, "Bachata 1" is full for leaders.');
    expect((await validateCapacity(whole, ['follower', 'follower', 'follower']))?.message).toContain('only has 2 follower spots left');
    expect(await validateCapacity(whole, ['follower', 'follower'])).toBeNull();
  });

  it('checks a general cap against the number of people', async () => {
    db.current.seed('events', series({ capacity: 3 }));
    db.current.seed('event_spot_counts', [{ event_id: 'w2', taken: 2, leaders_taken: 0, followers_taken: 0 }]);
    expect((await validateCapacity(whole, ['', '']))?.message).toContain('only has 1 spot remaining');
    expect(await validateCapacity(whole, [''])).toBeNull();
  });

  it('only counts the picked class for a drop-in', async () => {
    db.current.seed('events', series({ capacity: 1 }));
    db.current.seed('event_spot_counts', [{ event_id: 'w1', taken: 1, leaders_taken: 0, followers_taken: 0 }]);
    const dropIn = [{ ...whole[0], mode: 'dropin' as const, occurrenceEventId: 'w2' }];
    expect(await validateCapacity(dropIn, [''])).toBeNull();
    expect((await validateCapacity([{ ...dropIn[0], occurrenceEventId: 'w1' }], ['']))?.message).toBe('Sorry, "Bachata 1" is full.');
  });

  it('fails closed (503) when the counts cannot be loaded', async () => {
    db.current.seed('events', series({ capacity: 3 }));
    db.current.failNext.set('event_spot_counts.select', { message: 'boom' });
    expect((await validateCapacity(whole, ['']))?.status).toBe(503);
  });
});
