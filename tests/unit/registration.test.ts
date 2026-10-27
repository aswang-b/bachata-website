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
  insertClassRegistrations,
  prepareRegistrationRows,
  validateClassSelections,
  applyDealsToRows,
  carryOverPricing,
  type ClassRegistrationRow,
} from '../../src/lib/classRegistrations';
import { buildReceiptLines, paymentAgreementText, quantityNote, receiptSubtotal } from '../../src/lib/registrationReceipt';
import { buildRegistrationConfirmationEmailHtml } from '../../src/lib/registrationEmail';
import { createCheckinRegisterToken, verifyCheckinRegisterToken } from '../../src/lib/checkinToken';

beforeEach(() => {
  db.current = new FakeSupabase();
});

// What the public form offers: a public class or event with a date to come.
const FREE = '00000000-0000-4000-8000-0000000000f1';
const PAID = '00000000-0000-4000-8000-0000000000f2';
const upcoming = { visibility: 'public', start_time: '2099-01-06T19:00:00Z' };

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
      { id: FREE, event_type: 'event', google_recurring_event_id: null, title: 'Free Social', price_whole_series: null, ...upcoming },
      { id: PAID, event_type: 'event', google_recurring_event_id: null, title: 'Gala', price_whole_series: 15, ...upcoming },
    ]);
    const cost = async (key: string, title: string) => {
      const prepared = await prepareRegistrationRows([{ key, title, label: title, mode: null }], 'event', [{ firstName: 'A', lastName: 'B' }]);
      return 'hasCost' in prepared && prepared.hasCost;
    };
    expect(await cost(FREE, 'Free Social')).toBe(false);
    expect(await cost(PAID, 'Gala')).toBe(true);
  });

  it('an event is always one ticket at the price the form shows, never a drop-in, so it counts toward a deal', async () => {
    // Both carry a drop-in price left over from when they were classes. The
    // server used to save a drop-in pick (or an event with no ticket price) as
    // a drop-in, outside the deal the form had applied.
    db.current.seed('events', [
      { id: FREE, event_type: 'event', google_recurring_event_id: null, title: 'Social', price_whole_series: 20, price_drop_in: 10, ...upcoming },
      { id: PAID, event_type: 'event', google_recurring_event_id: null, title: 'Gala', price_whole_series: 30, price_drop_in: 15, ...upcoming },
    ]);
    db.current.seed('deals', [{ id: 'd', name: 'Night Out', kind: 'amount_off', amount: 5, series_keys: [FREE, PAID], required_count: null, starts_at: null, ends_at: null, active: true }]);
    const prepared = await prepareRegistrationRows(
      [
        { key: FREE, title: 'Social', label: 'Social', mode: 'dropin' },
        { key: PAID, title: 'Gala', label: 'Gala', mode: null },
      ],
      'event',
      [{ firstName: 'A', lastName: 'B' }]
    );
    if (!('rows' in prepared)) throw new Error(prepared.error.message);
    expect(prepared.rows.map((r) => [r.class_title, r.is_drop_in, r.series_mode, r.deal_name])).toEqual([
      ['Social', false, null, 'Night Out'],
      ['Gala', false, null, 'Night Out'],
    ]);
    expect(prepared.rows.reduce((s, r) => s + (r.price ?? 0), 0)).toBe(45);

    db.current.rows('events')[1].price_whole_series = null;
    const ticketless = await prepareRegistrationRows([{ key: PAID, title: 'Gala', label: 'Gala', mode: null }], 'event', [{ firstName: 'A', lastName: 'B' }]);
    // Shown as Free on the form, so saved free, not at the old drop-in price.
    expect('rows' in ticketless && ticketless.rows.map((r) => [r.is_drop_in, r.price])).toEqual([[false, null]]);
  });
});

describe('registration rows (what a public sign-up saves, and is capacity-checked on)', () => {
  const dancers = [
    { firstName: 'Ana', lastName: 'Lee' },
    { firstName: 'Bo', lastName: 'Kim' },
  ];
  // Drop-In dates are only kept when they're real (uuid) class ids.
  const W1 = '00000000-0000-4000-8000-000000000001';
  const W2 = '00000000-0000-4000-8000-000000000002';
  const X1 = '00000000-0000-4000-8000-000000000003';
  const PAST = '00000000-0000-4000-8000-000000000004';
  const W0 = '00000000-0000-4000-8000-000000000005';
  const PRIV = '00000000-0000-4000-8000-000000000006';
  const OVER = '00000000-0000-4000-8000-000000000007';
  beforeEach(() => {
    db.current.seed('events', [
      { id: W1, event_type: 'class', google_recurring_event_id: 'S', title: 'Bachata 1', price_whole_series: 80, price_drop_in: 20, ...upcoming },
      { id: W2, event_type: 'class', google_recurring_event_id: 'S', title: 'Bachata 1', price_whole_series: 80, price_drop_in: 20, ...upcoming },
      { id: X1, event_type: 'class', google_recurring_event_id: 'X', title: 'Styling', price_whole_series: 60, price_drop_in: 15, ...upcoming },
      { id: W0, event_type: 'class', google_recurring_event_id: null, title: 'Workshop', price_whole_series: 30, price_drop_in: null, ...upcoming },
      { id: 'gala', event_type: 'event', google_recurring_event_id: null, title: 'Bachata 1', price_whole_series: 15, ...upcoming },
      { id: PAST, event_type: 'class', google_recurring_event_id: 'S', title: 'Bachata 1', price_whole_series: 80, price_drop_in: 20, visibility: 'public', start_time: '2020-01-07T19:00:00Z' },
      { id: PRIV, event_type: 'class', google_recurring_event_id: null, title: 'Private Lesson', price_whole_series: 90, visibility: 'private', start_time: upcoming.start_time },
      { id: OVER, event_type: 'class', google_recurring_event_id: null, title: 'Old Series', price_whole_series: 50, visibility: 'public', start_time: '2020-01-07T19:00:00Z' },
    ]);
  });

  it('refuses a private-calendar class and a class whose dates have all passed (the form never offers them)', async () => {
    for (const [key, title] of [[PRIV, 'Private Lesson'], [OVER, 'Old Series']]) {
      const prepared = await prepareRegistrationRows([{ key, title, label: title, mode: 'whole' }], 'class', [dancers[0]]);
      expect('error' in prepared && prepared.error.message).toContain("isn't open for registration");
    }
  });

  it('refuses a Drop-In for a date that has already passed (capacity never counts it)', async () => {
    const prepared = await prepareRegistrationRows([{ key: 'S', title: 'Bachata 1', label: 'x', mode: 'dropin', occurrenceEventId: PAST }], 'class', [dancers[0]]);
    expect('error' in prepared && prepared.error.message).toContain('already passed');
  });

  it("lets an admin add someone to a class picked by title alone, whatever the class's dates", async () => {
    await insertClassRegistrations({
      submissionId: 'sub',
      classRaw: 'Old Series — Tuesdays — Whole Series',
      dancers: null,
      fallbackFirstName: 'Ana',
      fallbackLastName: 'Lee',
      fallbackEmail: null,
      fallbackPhone: null,
      eventType: 'class',
    });
    expect(db.current.tables.class_registrations).toEqual([expect.objectContaining({ series_key: OVER, price: 50 })]);
  });

  it('makes one row per dancer per class, each with its series so it is counted', async () => {
    const prepared = await prepareRegistrationRows([{ key: 'S', title: 'Bachata 1', label: 'Bachata 1', mode: 'whole' }], 'class', dancers);
    expect('rows' in prepared && prepared.rows).toEqual([
      expect.objectContaining({ dancer_index: 0, first_name: 'Ana', series_key: 'S', series_mode: 'whole', is_drop_in: false, price: 80 }),
      expect.objectContaining({ dancer_index: 1, first_name: 'Bo', series_key: 'S', series_mode: 'whole', is_drop_in: false, price: 80 }),
    ]);
    expect('rows' in prepared && prepared.rows[0]).not.toHaveProperty('submission_id');
  });

  it('resolves a class picked by title alone to that class, never an event sharing its title', async () => {
    const prepared = await prepareRegistrationRows([{ title: 'Bachata 1', label: 'Bachata 1', mode: 'whole' }], 'class', [dancers[0]]);
    expect('rows' in prepared && prepared.rows[0]).toMatchObject({ series_key: 'S', price: 80 });
  });

  it("refuses an event on the class form (it would skip the guidelines) and a class it can't find", async () => {
    const event = await prepareRegistrationRows([{ key: 'gala', title: 'Bachata 1', label: 'x', mode: null }], 'class', [dancers[0]]);
    expect('error' in event && event.error.status).toBe(400);
    const unknown = await prepareRegistrationRows([{ key: 'nope', title: 'Bachata 1', label: 'x', mode: 'whole' }], 'class', [dancers[0]]);
    expect('error' in unknown && unknown.error.message).toContain("couldn't find");
  });

  it("refuses a Drop-In whose date isn't one of its own classes (it would count toward nothing)", async () => {
    const dropIn = (occurrenceEventId: string | null) =>
      prepareRegistrationRows([{ key: 'S', title: 'Bachata 1', label: 'x', mode: 'dropin', occurrenceEventId }], 'class', [dancers[0]]);
    for (const bad of [null, X1, '00000000-0000-4000-8000-00000000ffff']) {
      const prepared = await dropIn(bad);
      expect('error' in prepared && prepared.error.message).toContain('dropping into');
    }
    const ok = await dropIn(W2);
    expect('rows' in ok && ok.rows[0]).toMatchObject({ is_drop_in: true, occurrence_event_id: W2, series_key: 'S', price: 20 });
  });

  it('turns a Drop-In without a drop-in price into the Whole Series, the way it is counted', async () => {
    const prepared = await prepareRegistrationRows([{ key: W0, title: 'Workshop', label: 'x', mode: 'dropin', occurrenceEventId: W0 }], 'class', [dancers[0]]);
    expect('rows' in prepared && prepared.rows[0]).toMatchObject({ series_mode: 'whole', is_drop_in: false, occurrence_event_id: null, series_key: W0 });
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

describe('bundle deals on saved registrations', () => {
  const deal = { id: 'd', name: 'Zouk Bundle', kind: 'bundle_price' as const, amount: 40, seriesKeys: ['a', 'b'], requiredCount: null };
  const row = (dancer: number, key: string, price: number, dropIn = false) => ({
    dancer_index: dancer,
    series_key: key,
    price,
    is_drop_in: dropIn,
    deal_id: null as string | null,
    deal_name: null as string | null,
    deal_discount: null as number | null,
  });

  it('applies per dancer, recording the deal and each row\'s share', () => {
    const rows = applyDealsToRows([row(0, 'a', 25), row(0, 'b', 25), row(1, 'a', 25), row(1, 'b', 25, true)], [deal]);
    expect(rows.map((r) => [r.price, r.deal_name, r.deal_discount])).toEqual([
      [20, 'Zouk Bundle', 5],
      [20, 'Zouk Bundle', 5],
      // The second dancer's "b" is a single Drop-In date, so no deal for them.
      [25, null, null],
      [25, null, null],
    ]);
  });

  it('the receipt lists classes at full price, then the deal, adding up to what is owed', async () => {
    const saved = applyDealsToRows([row(0, 'a', 25), row(0, 'b', 25)], [deal]).map((r, i) => ({
      ...r,
      id: `r${i}`,
      submission_id: 's',
      first_name: 'A',
      last_name: 'B',
      email: null,
      phone: null,
      class_title: r.series_key === 'a' ? 'Intro' : 'Open',
      class_label: r.series_key === 'a' ? 'Intro' : 'Open',
      series_mode: null,
      price_tier: null,
      occurrence_event_id: null,
      created_at: '',
    })) as ClassRegistrationRow[];
    const lines = await buildReceiptLines(saved);
    expect(lines.map((l) => [l.title, l.lineTotal])).toEqual([
      ['Intro', 25],
      ['Open', 25],
      ['Zouk Bundle', -10],
    ]);
    expect(receiptSubtotal(lines)).toBe(40);
  });
});

describe('an admin edit keeps what unchanged classes were saved at', () => {
  // A rebuilt row, at today's price (no early bird, no deal any more).
  const rebuilt = (key: string, price: number) => ({
    submission_id: 's',
    dancer_index: 0,
    first_name: 'A',
    last_name: 'B',
    email: null,
    phone: null,
    class_title: key,
    class_label: key,
    series_key: key,
    series_mode: 'whole' as const,
    price: price as number | null,
    price_tier: null as 'early_bird' | 'flash_sale' | null,
    occurrence_event_id: null,
    is_drop_in: false,
    deal_id: null as string | null,
    deal_name: null as string | null,
    deal_discount: null as number | null,
  });
  const saved = (key: string, price: number, deal?: number) => ({
    series_key: key,
    series_mode: 'whole' as const,
    occurrence_event_id: null,
    price,
    price_tier: null,
    deal_id: deal ? 'd' : null,
    deal_name: deal ? 'Zouk Bundle' : null,
    deal_discount: deal ?? null,
  });

  it('a deal that has since ended stays on the classes it covered; an added class is priced today', () => {
    const rows = carryOverPricing([rebuilt('a', 25), rebuilt('b', 25), rebuilt('c', 30)], [saved('a', 20, 5), saved('b', 20, 5)]);
    expect(rows.map((r) => [r.series_key, r.price, r.deal_name])).toEqual([
      ['a', 20, 'Zouk Bundle'],
      ['b', 20, 'Zouk Bundle'],
      ['c', 30, null],
    ]);
  });

  it('removing one of a deal\'s classes returns the other to its full saved price', () => {
    const rows = carryOverPricing([rebuilt('a', 28)], [saved('a', 20, 5), saved('b', 20, 5)]);
    expect(rows.map((r) => [r.price, r.deal_name])).toEqual([[25, null]]);
  });

  it('removing a class from one of two bundles of an "any 3" deal keeps the other bundle', () => {
    // Six workshops on an "any 3" deal, saved at $25 each after $5 off: two bundles.
    const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
    const savedRows = keys.map((k) => saved(k, 25, 5));
    // The admin removes "f"; the deal has since ended.
    const rows = carryOverPricing(keys.slice(0, 5).map((k) => rebuilt(k, 30)), savedRows, new Map([['d', 3]]));
    expect(rows.map((r) => [r.series_key, r.price, r.deal_name])).toEqual([
      ['a', 25, 'Zouk Bundle'],
      ['b', 25, 'Zouk Bundle'],
      ['c', 25, 'Zouk Bundle'],
      ['d', 30, null],
      ['e', 30, null],
    ]);
  });

  it('keeps an early-bird price that has since ended', () => {
    const rows = carryOverPricing([rebuilt('a', 30)], [{ ...saved('a', 22), price_tier: 'early_bird' as const }]);
    expect(rows[0]).toMatchObject({ price: 22, price_tier: 'early_bird' });
  });

  it('a kept deal is left alone when today\'s deals are applied', () => {
    const today = { id: 'n', name: 'New Deal', kind: 'amount_off' as const, amount: 10, seriesKeys: ['a', 'c'], requiredCount: null };
    const rows = applyDealsToRows(carryOverPricing([rebuilt('a', 25), rebuilt('b', 25), rebuilt('c', 30)], [saved('a', 20, 5), saved('b', 20, 5)]), [today]);
    expect(rows.map((r) => r.deal_name)).toEqual(['Zouk Bundle', 'Zouk Bundle', null]);
  });
});
