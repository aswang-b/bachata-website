import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));
vi.mock('../../src/lib/admin', () => ({ requireAdmin: async () => ({ user: { email: 'admin@test' }, error: null }) }));
vi.mock('../../src/lib/siteErrors', () => ({
  getOpenSiteError: async () => ({ id: 'err-1', kind: 'email_bounce', details: { email: 'ana@gmial.com' } }),
  closeSiteError: async () => {},
  listOpenSiteErrors: async () => [],
}));

import { POST } from '../../src/pages/api/admin/site-errors';

// Admin → Dashboard → Errors → Update email, on a two-dancer sign-up.
const SUB = 'sub-1';
const dancers = () => [
  { firstName: 'Ana', lastName: 'Lee', email: 'ana@gmial.com' },
  { firstName: 'Ben', lastName: 'Ray', email: 'ben@example.com' },
];

beforeEach(() => {
  db.current = new FakeSupabase();
  db.current.seed('intake_submissions', [{ id: SUB, email: 'ana@gmial.com', dancers: dancers(), deleted_at: null }]);
  db.current.seed('class_registrations', [{ id: 'r1', submission_id: SUB, dancer_index: 0, email: 'ana@gmial.com', deleted_at: null }]);
});

const updateEmail = (dancerIndex: number, email: string) =>
  POST({ request: new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'update-email', id: 'err-1', submissionId: SUB, dancerIndex, email }) }) } as never);

const signup = () => db.current.rows('intake_submissions')[0] as { email: string; dancers: Record<string, unknown>[] };

describe('Errors queue: update email', () => {
  it("corrects the dancer's address on the sign-up and their class registrations", async () => {
    const res = await updateEmail(0, 'ana@gmail.com');
    expect(res.status).toBe(200);
    expect(signup().email).toBe('ana@gmail.com');
    expect(signup().dancers[0].email).toBe('ana@gmail.com');
    expect(db.current.rows('class_registrations')[0].email).toBe('ana@gmail.com');
  });

  it("doesn't undo another admin's Recycling Bin move that lands between its read and its write", async () => {
    // Admin B bins dancer 1 just before admin A's write.
    db.current.beforeNext.set('intake_submissions.update', () => {
      signup().dancers = [dancers()[0], { ...dancers()[1], deleted: true }];
    });
    const res = await updateEmail(0, 'ana@gmail.com');
    expect(res.status).toBe(200);
    expect(signup().dancers[0].email).toBe('ana@gmail.com');
    expect(signup().dancers[1].deleted).toBe(true);
  });

  it('refuses a dancer who is in the Recycling Bin', async () => {
    signup().dancers[1] = { ...signup().dancers[1], deleted: true };
    const res = await updateEmail(1, 'ben@gmail.com');
    expect(res.status).toBe(404);
    expect(signup().dancers[1].email).toBe('ben@example.com');
  });
});
