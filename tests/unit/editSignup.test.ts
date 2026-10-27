import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));
vi.mock('../../src/lib/admin', () => ({ requireAdmin: async () => ({ user: { email: 'admin@test' }, error: null }) }));
vi.mock('../../src/lib/editLock', () => ({ EVENT_REGISTRATIONS_LOCK_RESOURCE: 'events', SIGNUPS_LOCK_RESOURCE: 'signups', requireLock: async () => {} }));

import { POST } from '../../src/pages/api/admin/edit-signup';

// Admin → Event Registration → add someone (e.g. at the door).
const GALA = '00000000-0000-4000-8000-0000000000a1';

beforeEach(() => {
  db.current = new FakeSupabase();
  db.current.seed('events', [{ id: GALA, event_type: 'event', google_recurring_event_id: null, title: 'Gala', price_whole_series: 15 }]);
});

const addToEvent = () =>
  POST({
    request: new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', registrationType: 'events', holderId: 'h', firstName: 'Ana', lastName: 'Lee', classSelections: [{ key: GALA, title: 'Gala', label: 'Gala', mode: null }] }),
    }),
  } as never);

describe('admin adds an event registration', () => {
  it('saves the sign-up with its event registration', async () => {
    const res = await addToEvent();
    expect(res.status).toBe(200);
    expect(db.current.rows('intake_submissions')).toHaveLength(1);
    expect(db.current.rows('class_registrations')).toEqual([expect.objectContaining({ series_key: GALA, price: 15 })]);
  });

  it("reports a failed event registration instead of success, and doesn't leave the sign-up behind without it", async () => {
    db.current.failNext.set('class_registrations.insert', { message: 'constraint' });
    const res = await addToEvent();
    expect(res.status).toBe(500);
    expect(db.current.rows('intake_submissions')).toHaveLength(0);
  });
});
