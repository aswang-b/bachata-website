import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as import('./fakeSupabase').FakeSupabase, sendFails: false, errors: [] as string[] }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return state.db;
  },
}));
vi.mock('../../src/lib/email', () => ({
  sendEmail: async () => {
    if (state.sendFails) throw new Error('Resend is down');
    return 'admin-copy-id';
  },
}));
vi.mock('../../src/lib/notificationSettings', () => ({ getConfirmationBccEmails: async () => ['a@admin.test', 'b@admin.test'] }));
vi.mock('../../src/lib/registrationConfirmation', () => ({ buildRegistrationConfirmation: async () => ({ subject: 'Confirmed', html: '<p>hi</p>' }) }));
vi.mock('../../src/lib/siteErrors', () => ({
  logSiteError: async (_kind: string, message: string) => {
    state.errors.push(message);
  },
}));

import { queueAdminCopy, recordDeliveryOutcome } from '../../src/lib/confirmationAdminCopy';

// The admins' copy of a registration confirmation, when its own send fails.
beforeEach(() => {
  state.db = new FakeSupabase();
  state.sendFails = true;
  state.errors = [];
});

describe("the admins' confirmation copy", () => {
  it('goes back in the queue, and shows on the Errors queue, when its send fails', async () => {
    state.db.seed('confirmation_admin_copies', [{ id: 'copy-1', submission_id: 'sub-1', email_ids: ['e1'], outcomes: {}, sent_at: '2026-10-28T00:00:00Z' }]);
    state.db.rpcHandlers.record_confirmation_outcome = () => [{ id: 'copy-1', submission_id: 'sub-1', email_ids: ['e1'], outcomes: { e1: { status: 'delivered', email: 'd@x.com' } } }];

    await recordDeliveryOutcome('e1', { status: 'delivered', email: 'd@x.com' });

    expect(state.db.rows('confirmation_admin_copies')[0].sent_at).toBeNull();
    expect(state.errors).toEqual([expect.stringContaining("Couldn't send the admins' copy")]);
  });

  it('with no dancer email to wait for, a failed send is queued for the scheduled job', async () => {
    await queueAdminCopy('sub-2', [{ email: 'd@x.com', id: null, error: 'bad address' }]);

    const rows = state.db.rows('confirmation_admin_copies');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ submission_id: 'sub-2', email_ids: [] });
  });

  it('is sent once queued if every report already came in (e.g. a fast bounce)', async () => {
    state.sendFails = false;
    let queued: Record<string, unknown> = {};
    state.db.rpcHandlers.queue_confirmation_copy = (args) => {
      queued = args;
      return [{ id: 'copy-3', submission_id: 'sub-3', email_ids: ['e9'], outcomes: { e9: { status: 'bounced', email: 'd@gmial.com' } } }];
    };

    await queueAdminCopy('sub-3', [{ email: 'd@gmial.com', id: 'e9' }]);

    expect(queued).toMatchObject({ p_submission_id: 'sub-3', p_email_ids: ['e9'] });
    expect(state.errors).toEqual([]);
  });
});
