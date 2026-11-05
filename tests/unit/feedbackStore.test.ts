import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

// Feedback emails and WhatsApp messages: who gets marked as asked, and when.
const state = vi.hoisted(() => ({
  db: null as unknown as import('./fakeSupabase').FakeSupabase,
  batches: [] as { to: string }[][],
  failBatch: null as number | null,
}));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return state.db;
  },
}));
vi.mock('../../src/lib/email', () => ({
  EMAIL_BATCH_SIZE: 100,
  sendEmailBatch: async (emails: { to: string }[]) => {
    if (state.failBatch === state.batches.length) throw new Error('Resend said 429');
    state.batches.push(emails);
  },
}));

import { emailInvites, markWhatsappSent, whatsappInvite } from '../../src/lib/feedbackStore';
import { fetchAllRows } from '../../src/lib/fetchAll';

const CAMPAIGN = { id: 'c1', class_title: 'Bachata', items: [{ id: 'f', kind: 'faces', text: 'How was {class}?' }], closed_at: null };
const invites = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `i${String(i).padStart(3, '0')}`, campaign_id: 'c1', first_name: `D${i}`, email: `d${i}@example.com`, emailed_at: null }));
const emailed = () => state.db.rows('feedback_invites').filter((r) => r.emailed_at).length;

beforeEach(() => {
  state.db = new FakeSupabase();
  state.db.seed('feedback_campaigns', [CAMPAIGN]);
  state.batches = [];
  state.failBatch = null;
  // Today's limit, as migration 0067's claim_api_usage grants it.
  let used = 0;
  state.db.rpcHandlers.claim_api_usage = ({ p_cap, p_amount }) => {
    const amount = p_amount as number;
    if (amount < 0) {
      used = Math.max(used + amount, 0);
      return amount;
    }
    const granted = Math.min(amount, Math.max((p_cap as number) - used, 0));
    used += granted;
    return granted;
  };
});

describe('emailing a feedback request', () => {
  it('marks the chunks that went when a later one fails, so a retry only emails the rest', async () => {
    state.db.seed('feedback_invites', invites(150));
    state.failBatch = 1;

    await expect(emailInvites('c1', 'https://dancewithb.fun')).rejects.toThrow('429');
    expect(emailed()).toBe(100);
    // The failed chunk's links are gone: nobody got them.
    expect(state.db.rows('feedback_links')).toHaveLength(100);

    state.failBatch = null;
    expect(await emailInvites('c1', 'https://dancewithb.fun')).toEqual({ sent: 50, held: 0 });
    const everyone = state.batches.flat().map((e) => e.to);
    expect(new Set(everyone).size).toBe(150);
    expect(everyone).toHaveLength(150);
  });

  it('writes each chunk’s links in one call', async () => {
    state.db.seed('feedback_invites', invites(30));
    await emailInvites('c1', 'https://dancewithb.fun');
    expect(state.db.callsTo('feedback_links', 'insert')).toHaveLength(1);
    expect(state.db.rows('feedback_links')).toHaveLength(30);
  });

  it('skips dancers another send claimed a moment ago', async () => {
    state.db.seed('feedback_invites', invites(3));
    state.db.beforeNext.set('feedback_invites.update', () => {
      state.db.rows('feedback_invites')[0].emailed_at = '2026-11-05T10:00:00Z';
    });
    expect(await emailInvites('c1', 'https://dancewithb.fun')).toEqual({ sent: 2, held: 0 });
    expect(state.batches.flat().map((e) => e.to)).toEqual(['d1@example.com', 'd2@example.com']);
  });

  it('stops at the daily feedback email limit and leaves the rest for later', async () => {
    state.db.seed('feedback_invites', invites(400));
    expect(await emailInvites('c1', 'https://dancewithb.fun')).toEqual({ sent: 300, held: 100 });
    expect(emailed()).toBe(300);
    expect(await emailInvites('c1', 'https://dancewithb.fun')).toEqual({ sent: 0, held: 100 });
  });

  it('gives back the limit a failed send didn’t use', async () => {
    state.db.seed('feedback_invites', invites(300));
    state.failBatch = 0;
    await expect(emailInvites('c1', 'https://dancewithb.fun')).rejects.toThrow();
    state.failBatch = null;
    expect(await emailInvites('c1', 'https://dancewithb.fun')).toEqual({ sent: 300, held: 0 });
  });
});

describe('WhatsApp', () => {
  beforeEach(() => {
    state.db.seed('feedback_invites', [{ id: 'w1', campaign_id: 'c1', first_name: 'Ana', phone: '608 555 0111', whatsapp_at: null, feedback_campaigns: CAMPAIGN }]);
  });

  it("isn't marked as sent just for opening the message", async () => {
    expect(await whatsappInvite('w1', 'https://dancewithb.fun')).toMatch(/^https:\/\/wa\.me\/16085550111\?text=/);
    expect(state.db.rows('feedback_invites')[0].whatsapp_at).toBeNull();
    await markWhatsappSent('w1');
    expect(state.db.rows('feedback_invites')[0].whatsapp_at).toEqual(expect.any(String));
  });

  it('says so when the dancer is gone', async () => {
    await expect(markWhatsappSent('nobody')).rejects.toThrow('no longer');
  });
});

describe('reading every row', () => {
  it('pages past the 1000 rows one response holds', async () => {
    state.db.seed('events', Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(4, '0') })));
    const rows = await fetchAllRows<{ id: string }>((from, to) => state.db.from('events').select('id').order('id').range(from, to));
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)!.id).toBe('2499');
  });
});
