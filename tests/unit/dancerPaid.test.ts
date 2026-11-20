import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';
import { dancerPaid, markRowPaid, withDancerPaid } from '../../src/lib/dancerPaid';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));
vi.mock('../../src/lib/admin', () => ({ requireAdmin: async () => ({ user: { email: 'admin@test' }, error: null }) }));
vi.mock('../../src/lib/editLock', () => ({ EVENT_REGISTRATIONS_LOCK_RESOURCE: 'events', SIGNUPS_LOCK_RESOURCE: 'signups', requireLock: async () => {} }));

import { POST as updateSignup } from '../../src/pages/api/admin/update-signup';
import { POST as editSignup } from '../../src/pages/api/admin/edit-signup';

// Marking one dancer of a group sign-up paid marked the others too (one flag
// per sign-up). Each dancer has their own now: dancers[i].paid.
const ana = { firstName: 'Ana', lastName: 'Lee' };
const ben = { firstName: 'Ben', lastName: 'Ray' };
const cy = { firstName: 'Cy', lastName: 'Fox' };

describe('reading a dancer’s Paid', () => {
  it('is their own flag when they have one, else the sign-up’s (old data reads as before)', () => {
    expect(dancerPaid({ ...ana, paid: false }, true)).toBe(false);
    expect(dancerPaid({ ...ana, paid: true }, false)).toBe(true);
    expect(dancerPaid(ana, true)).toBe(true);
    expect(dancerPaid(ana, false)).toBe(false);
    expect(dancerPaid({ ...ana, paid: 'yes' }, false)).toBe(false);
    expect(dancerPaid(null, true)).toBe(true);
  });
});

describe('setting one dancer’s Paid', () => {
  it('gives the others the sign-up’s current value first, so they read the same', () => {
    const change = withDancerPaid([ana, ben], true, 1, false);
    expect(change).toEqual({ ok: true, dancers: [{ ...ana, paid: true }, { ...ben, paid: false }], paid: false });
  });

  it('leaves the others’ own flags alone', () => {
    const change = withDancerPaid([{ ...ana, paid: false }, { ...ben, paid: true }, cy], true, 0, true);
    expect(change).toEqual({ ok: true, dancers: [{ ...ana, paid: true }, { ...ben, paid: true }, { ...cy, paid: true }], paid: true });
  });

  it('marks the sign-up paid only when every live dancer is, ignoring the Recycling Bin', () => {
    const binned = { ...cy, deleted: true, paid: false };
    expect(withDancerPaid([{ ...ana, paid: false }, ben, binned], false, 0, true)).toMatchObject({ ok: true, paid: false });
    expect(withDancerPaid([{ ...ana, paid: true }, ben, binned], false, 1, true)).toMatchObject({ ok: true, paid: true });
    // A binned dancer without a flag gets the sign-up's too, so a restore reads as it did.
    const change = withDancerPaid([ana, { ...ben, deleted: true }], true, 0, false);
    expect(change).toMatchObject({ ok: true, dancers: [{ paid: false }, { paid: true, deleted: true }], paid: false });
  });

  it('doesn’t change the list it was given', () => {
    const list = [ana, ben];
    withDancerPaid(list, false, 0, true);
    expect(list).toEqual([ana, ben]);
  });

  it('a one-person sign-up (no dancers list) sets the sign-up’s own Paid', () => {
    expect(withDancerPaid(null, false, null, true)).toEqual({ ok: true, dancers: null, paid: true });
    expect(withDancerPaid([], true, null, false)).toEqual({ ok: true, dancers: null, paid: false });
    expect(withDancerPaid([{ ...ana, deleted: true }], true, null, false)).toEqual({ ok: true, dancers: null, paid: false });
  });

  it('refuses a missing, out-of-range, fractional or binned dancer', () => {
    expect(withDancerPaid([ana, ben], false, null, true)).toEqual({ ok: false, error: 'missing-index' });
    expect(withDancerPaid([ana, ben], false, 2, true)).toEqual({ ok: false, error: 'not-found' });
    expect(withDancerPaid([ana, ben], false, -1, true)).toEqual({ ok: false, error: 'not-found' });
    expect(withDancerPaid([ana, ben], false, 0.5, true)).toEqual({ ok: false, error: 'not-found' });
    expect(withDancerPaid([ana, { ...ben, deleted: true }], false, 1, true)).toEqual({ ok: false, error: 'not-found' });
    expect(withDancerPaid(null, false, 0, true)).toEqual({ ok: false, error: 'not-found' });
  });

  it('the dashboard changes only that dancer’s row', () => {
    const rows = [
      { submissionId: 's', dancerIndex: 0, paid: true },
      { submissionId: 's', dancerIndex: 1, paid: true },
      { submissionId: 't', dancerIndex: null, paid: false },
    ];
    markRowPaid(rows, 's', 1, false);
    markRowPaid(rows, 't', null, true);
    expect(rows.map((r) => r.paid)).toEqual([true, false, true]);
  });
});

const SUB = 'sub-1';
const signup = () => db.current.rows('intake_submissions')[0] as { paid: boolean; dancers: Record<string, unknown>[] | null; payment_method?: string };
const post = (route: typeof updateSignup, body: Record<string, unknown>) =>
  route({ request: new Request('http://x', { method: 'POST', body: JSON.stringify({ holderId: 'h', submissionId: SUB, ...body }) }) } as never);

beforeEach(() => {
  db.current = new FakeSupabase();
  db.current.seed('intake_submissions', [{ id: SUB, registration_type: 'group', paid: true, dancers: [ana, ben], deleted_at: null }]);
  db.current.seed('class_registrations', []);
  // update_signup_dancer (migration 0040): merges p_dancer into the dancer and sets the sign-up's paid.
  db.current.rpcHandlers.update_signup_dancer = (a) => {
    const row = signup();
    if (a.p_dancer_index != null) row.dancers![a.p_dancer_index as number] = { ...row.dancers![a.p_dancer_index as number], ...(a.p_dancer as object) };
    row.paid = a.p_paid as boolean;
    row.payment_method = a.p_payment_method as string;
    return null;
  };
});

describe('update-signup: a dancer’s Paid switch', () => {
  it('unpaying dancer 2 of a sign-up paid as a whole leaves dancer 1 paid; then unpaying dancer 1 too', async () => {
    expect((await post(updateSignup, { dancerIndex: 1, paid: false })).status).toBe(200);
    expect(signup().dancers).toEqual([{ ...ana, paid: true }, { ...ben, paid: false }]);
    expect(signup().paid).toBe(false);
    expect((await post(updateSignup, { dancerIndex: 0, paid: false })).status).toBe(200);
    expect(signup().dancers).toEqual([{ ...ana, paid: false }, { ...ben, paid: false }]);
    expect((await post(updateSignup, { dancerIndex: 0, paid: true })).status).toBe(200);
    expect((await post(updateSignup, { dancerIndex: 1, paid: true })).status).toBe(200);
    expect(signup().paid).toBe(true);
  });

  it('a one-person sign-up sets its own Paid', async () => {
    signup().dancers = null;
    expect((await post(updateSignup, { paid: false })).status).toBe(200);
    expect(signup()).toMatchObject({ paid: false, dancers: null });
  });

  it('refuses a bad, missing, out-of-range or binned dancer', async () => {
    expect((await post(updateSignup, { dancerIndex: '1', paid: false })).status).toBe(400);
    expect((await post(updateSignup, { dancerIndex: 1.5, paid: false })).status).toBe(400);
    expect((await post(updateSignup, { paid: false })).status).toBe(400);
    expect((await post(updateSignup, { dancerIndex: 2, paid: false })).status).toBe(404);
    signup().dancers![1] = { ...ben, deleted: true };
    expect((await post(updateSignup, { dancerIndex: 1, paid: false })).status).toBe(404);
    expect(signup()).toMatchObject({ paid: true, dancers: [ana, { ...ben, deleted: true }] });
  });

  it("doesn't undo a Recycling Bin move that lands between its read and its write", async () => {
    db.current.beforeNext.set('intake_submissions.update', () => {
      signup().dancers = [ana, { ...ben, deleted: true }];
    });
    expect((await post(updateSignup, { dancerIndex: 0, paid: false })).status).toBe(200);
    expect(signup().dancers).toEqual([{ ...ana, paid: false }, { ...ben, deleted: true, paid: true }]);
  });
});

describe('edit-signup: the edit row’s Paid', () => {
  const save = (dancerIndex: number, paid: boolean) =>
    post(editSignup, { action: 'update', dancerIndex, paid, firstName: 'Benny', lastName: 'Ray', keepClasses: true, paymentMethod: 'cash' });

  it("changes only that dancer's Paid, with their new details", async () => {
    expect((await save(1, false)).status).toBe(200);
    expect(signup().dancers).toEqual([{ ...ana, paid: true }, expect.objectContaining({ firstName: 'Benny', paid: false })]);
    expect(signup()).toMatchObject({ paid: false, payment_method: 'cash' });
  });

  it("an unchanged Paid leaves the others' (and the sign-up's) as they were", async () => {
    expect((await save(1, true)).status).toBe(200);
    expect(signup().dancers).toEqual([ana, expect.objectContaining({ firstName: 'Benny' })]);
    expect(signup().dancers![1].paid).toBeUndefined();
    expect(signup().paid).toBe(true);
  });
});
