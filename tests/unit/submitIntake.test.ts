import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

import { POST } from '../../src/pages/api/submit-intake';

// The public registration endpoint, up to the point where it saves: what it
// refuses, and the rows it hands register_submission (migration 0046), which
// enforces capacity on exactly those rows.
const CLASS = '00000000-0000-4000-8000-0000000000c1';

let saved: { p_submission: Record<string, unknown>; p_rows: Record<string, unknown>[] }[];

beforeEach(() => {
  db.current = new FakeSupabase();
  db.current.seed('events', [
    { id: CLASS, event_type: 'class', google_recurring_event_id: null, title: 'Bachata 1', price_whole_series: 80, registration_closed: false },
    { id: 'gala', event_type: 'event', google_recurring_event_id: null, title: 'Gala', price_whole_series: 15, registration_closed: false },
  ]);
  saved = [];
  // Refuse with a capacity error, so the test stops before any emails.
  db.current.rpcHandlers.register_submission = (args) => {
    saved.push(args as (typeof saved)[number]);
    throw { message: 'capacity_exceeded', details: JSON.stringify({ title: 'Bachata 1', role: 'leader', remaining: 0 }) };
  };
});

const dancer = (role: string) => ({ firstName: 'Ana', lastName: 'Lee', role, phone: '6085550100', email: '' });

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const request = new Request('http://x/api/submit-intake', { method: 'POST', body });
  return POST({ request, redirect: (url: string, status: number) => new Response(null, { status, headers: { Location: url } }), clientAddress: '127.0.0.1' } as never);
}

const group = (overrides: Record<string, string> = {}) =>
  post({
    registration_type: 'group',
    class: 'Bachata 1',
    payment_method: 'cash',
    class_selections: JSON.stringify([{ key: CLASS, title: 'Bachata 1', label: '', mode: null }]),
    dancers: JSON.stringify([dancer('leader')]),
    ...overrides,
  });

describe('submit-intake', () => {
  it('saves through register_submission and reports its capacity refusal as a 400 with a readable message', async () => {
    const res = await group();
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Sorry, "Bachata 1" is full for leaders.');
    expect(saved[0].p_rows).toEqual([expect.objectContaining({ series_key: CLASS, dancer_index: 0, first_name: 'Ana' })]);
    expect(db.current.callsTo('intake_submissions', 'insert')).toHaveLength(0);
    expect(db.current.callsTo('class_registrations', 'insert')).toHaveLength(0);
  });

  it('counts a role however it is capitalized, and refuses any other role', async () => {
    await group({ dancers: JSON.stringify([dancer(' LEADER ')]) });
    expect((saved[0].p_submission.dancers as { role: string }[])[0].role).toBe('leader');

    const res = await group({ dancers: JSON.stringify([dancer('x')]) });
    expect(res.status).toBe(400);
    expect(saved).toHaveLength(1);
  });

  it("checks a class picked by title alone (no key) like any other, since it's saved with its series", async () => {
    await group({ class_selections: '' });
    expect(saved[0].p_rows[0]).toMatchObject({ series_key: CLASS });
  });

  it('refuses an event on the class form, so the guidelines agreement can\'t be skipped', async () => {
    const res = await group({ class: 'Gala', class_selections: JSON.stringify([{ key: 'gala', title: 'Gala', label: '', mode: null }]) });
    expect(res.status).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it('refuses unknown registration types and malformed dancer lists', async () => {
    expect((await group({ registration_type: 'bogus' })).status).toBe(400);
    expect((await group({ dancers: JSON.stringify({ firstName: 'Ana' }) })).status).toBe(400);
    expect((await group({ dancers: JSON.stringify([null]) })).status).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it('answers 500 when the save fails for any other reason', async () => {
    db.current.rpcHandlers.register_submission = () => {
      throw { message: 'deadlock detected', code: '40P01' };
    };
    expect((await group()).status).toBe(500);
  });
});
