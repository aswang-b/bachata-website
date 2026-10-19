import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

import {
  parseClassSelectionString,
  parseClassSelectionsJson,
  resolveClassSelections,
  selectionsHaveCost,
  validateClassSelections,
  type ClassRegistrationRow,
} from '../../src/lib/classRegistrations';
import { buildReceiptLines, paymentAgreementText, quantityNote, receiptSubtotal } from '../../src/lib/registrationReceipt';
import { buildRegistrationConfirmationEmailHtml } from '../../src/lib/registrationEmail';
import { createCheckinRegisterToken, verifyCheckinRegisterToken } from '../../src/lib/checkinToken';

beforeEach(() => {
  db.current = new FakeSupabase();
});

describe('class selections', () => {
  it('stores labels as "<title> — <schedule>" whatever form the form sent', () => {
    const [a, b, c] = parseClassSelectionsJson(
      JSON.stringify([
        { key: 'S1', title: 'Bachata 1', label: 'Tuesdays, 7:00 PM', mode: 'whole' },
        { key: 'S2', title: 'Sensual', label: 'Sensual — Fridays', mode: 'dropin', occurrenceEventId: 'occ-1' },
        { key: 'S3', title: 'Social', label: '', mode: 'bogus' },
      ])
    );
    expect(a).toMatchObject({ label: 'Bachata 1 — Tuesdays, 7:00 PM', mode: 'whole', occurrenceEventId: null });
    expect(b).toMatchObject({ label: 'Sensual — Fridays', mode: 'dropin', occurrenceEventId: 'occ-1' });
    expect(c).toMatchObject({ label: 'Social', mode: null });
  });

  it('falls back to the legacy string only when the structured field is empty or broken', () => {
    expect(parseClassSelectionString('A — Mondays — Drop In; B — Fridays')).toEqual([
      { label: 'A — Mondays', title: 'A', mode: 'dropin' },
      { label: 'B — Fridays', title: 'B', mode: null },
    ]);
    expect(resolveClassSelections('A — Mondays — Whole Series', 'not json')[0].mode).toBe('whole');
  });

  it('rejects a closed class by its key, not a different open class that shares its title', async () => {
    db.current.seed('events', [{ id: 'closed', google_recurring_event_id: 'C', title: 'Bachata 1', registration_closed: true }]);
    expect(await validateClassSelections([{ key: 'OPEN', title: 'Bachata 1', label: 'x', mode: 'whole' }])).toBeNull();
    expect((await validateClassSelections([{ key: 'C', title: 'Anything', label: 'x', mode: 'whole' }]))?.status).toBe(400);
  });

  it('fails closed (503) when it cannot tell which classes are closed', async () => {
    db.current.failNext.set('events.select', { message: 'down' });
    expect((await validateClassSelections([{ title: 'x', label: 'x', mode: null }]))?.status).toBe(503);
  });

  it('knows whether a free event needs a payment method', async () => {
    db.current.seed('events', [
      { id: 'free', google_recurring_event_id: null, title: 'Free Social', price_whole_series: null },
      { id: 'paid', google_recurring_event_id: null, title: 'Gala', price_whole_series: 15 },
    ]);
    expect(await selectionsHaveCost([{ key: 'free', title: 'Free Social', label: 'Free Social', mode: null }])).toBe(false);
    expect(await selectionsHaveCost([{ key: 'paid', title: 'Gala', label: 'Gala', mode: null }])).toBe(true);
  });
});

describe('itemized receipt', () => {
  const reg = (over: Partial<ClassRegistrationRow>): ClassRegistrationRow => ({
    id: 'r',
    submission_id: 's',
    dancer_index: 0,
    first_name: 'A',
    last_name: 'B',
    email: null,
    phone: null,
    class_title: 'Bachata 1',
    class_label: 'Bachata 1 — Tuesdays, 7:00 PM',
    series_mode: 'whole',
    price: 80,
    price_tier: 'regular',
    occurrence_event_id: null,
    is_drop_in: false,
    created_at: '',
    ...over,
  });

  it('folds the same class across a group into one "× N" line and totals it', async () => {
    const lines = await buildReceiptLines([reg({ dancer_index: 0 }), reg({ dancer_index: 1 })]);
    expect(lines).toEqual([{ title: 'Bachata 1', detail: 'Whole Series · Tuesdays, 7:00 PM', unitPrice: 80, quantity: 2, lineTotal: 160 }]);
    expect(quantityNote(lines[0])).toBe('$80 × 2 dancers');
    expect(quantityNote(lines[0], true)).toBe('$80 × 2 attendees');
    expect(receiptSubtotal(lines)).toBe(160);
  });

  it("names a drop-in's date and leaves out classes in the Recycling Bin", async () => {
    db.current.seed('events', [{ id: 'occ', start_time: '2026-10-28T00:00:00Z' }]);
    const lines = await buildReceiptLines([
      reg({ series_mode: 'dropin', occurrence_event_id: 'occ', price: 15 }),
      { ...reg({ class_title: 'Gone' }), deleted_at: '2026-01-01' } as ClassRegistrationRow,
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].detail).toBe('Drop In · Oct 27, 7:00 PM');
  });

  it('has no subtotal when nothing has a price, and words the payment line', () => {
    expect(receiptSubtotal([{ title: 'x', detail: '', unitPrice: null, quantity: 1, lineTotal: null }])).toBeNull();
    expect(paymentAgreementText('venmo')).toBe('You agreed to pay with Venmo.');
    expect(paymentAgreementText('cash')).toBe('You agreed to pay with cash.');
    expect(paymentAgreementText(null)).toBeNull();
  });
});

describe('confirmation email', () => {
  const base = {
    registrationTypeLabel: 'Group Lesson',
    createdAt: new Date('2026-10-01T12:00:00Z'),
    summaryRows: [['<b>Jo</b> Doe', 'leader · 555'] as [string, string]],
    subtotal: 80,
    faqs: [{ question: 'What to wear?', answer: '<p>Comfy shoes</p>' }],
  };

  it('escapes what dancers typed, and lists the FAQ reminders for a class', () => {
    const html = buildRegistrationConfirmationEmailHtml(base);
    expect(html).toContain('&lt;b&gt;Jo&lt;/b&gt; Doe');
    expect(html).toContain('A Few Reminders');
    expect(html).toContain('See you in class!');
  });

  it('lists an event\'s community guidelines under their own heading, an untitled item as plain text', () => {
    const html = buildRegistrationConfirmationEmailHtml({
      ...base,
      isEvent: true,
      faqsHeading: 'Our Community Guidelines',
      faqs: [
        { question: '', answer: '<div>Intro</div>' },
        { question: 'Consent', answer: '<div>Ask first</div>' },
      ],
    });
    expect(html).toContain('Our Community Guidelines');
    expect(html).not.toContain('A Few Reminders');
    expect(html).toContain('See you there!');
    // The untitled block has no empty question bar above it.
    expect(html.match(/font-weight:600;color:#111;background:#f7f1f1/g)).toHaveLength(1);
  });

  it('itemizes the receipt with the subtotal under it', () => {
    const html = buildRegistrationConfirmationEmailHtml({
      ...base,
      receiptLines: [{ title: 'Bachata 1', detail: 'Whole Series', unitPrice: 80, quantity: 2, lineTotal: 160 }],
      subtotal: 160,
      paymentNote: 'You agreed to pay with cash.',
    });
    expect(html).toContain('$80 × 2 dancers');
    expect(html).toContain('$160');
    expect(html).toContain('You agreed to pay with cash.');
  });
});

describe('check-in register tokens', () => {
  it('only accepts the token generated for that exact event', () => {
    const token = createCheckinRegisterToken('event-1')!;
    expect(verifyCheckinRegisterToken('event-1', token)).toBe(true);
    expect(verifyCheckinRegisterToken('event-2', token)).toBe(false);
    expect(verifyCheckinRegisterToken('event-1', token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'))).toBe(false);
    expect(verifyCheckinRegisterToken('event-1', null)).toBe(false);
  });
});
