import { describe, expect, it, vi } from 'vitest';

// registrationReceipt.ts reaches for the database client; these tests never query it.
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));

import { VENMO_URL, venmoNote, venmoPayUrl } from '../../src/lib/venmoPay';
import { venmoPayLink, type ReceiptLine } from '../../src/lib/registrationReceipt';
import { buildRegistrationConfirmationEmailHtml } from '../../src/lib/registrationEmail';

const BASE = 'https://venmo.com/amumira?txn=pay&amount=';
const params = (url: string) => new URL(url).searchParams;

describe('venmoPayUrl', () => {
  it('formats the amount with two decimals, no sign or thousands separator', () => {
    expect(venmoPayUrl({ amount: 25, note: 'Salsa' })).toBe(`${BASE}25.00&note=Salsa`);
    expect(venmoPayUrl({ amount: 37.5, note: 'Salsa' })).toBe(`${BASE}37.50&note=Salsa`);
    expect(venmoPayUrl({ amount: 1234, note: 'Salsa' })).toBe(`${BASE}1234.00&note=Salsa`);
    expect(venmoPayUrl({ amount: 19.999, note: 'Salsa' })).toBe(`${BASE}20.00&note=Salsa`);
    expect(venmoPayUrl({ amount: 0.1 + 0.2, note: 'Salsa' })).toBe(`${BASE}0.30&note=Salsa`);
  });

  it('URL-encodes the note: ampersand, emoji, quotes, a hash', () => {
    const url = venmoPayUrl({ amount: 10, note: 'Rock & Roll #1 "Fun" 💃 it\'s' });
    expect(url).toBe(`${BASE}10.00&note=${encodeURIComponent('Rock & Roll #1 "Fun" 💃 it\'s')}`);
    expect(url).not.toContain('#');
    expect(url.match(/&/g)).toHaveLength(2);
    expect(params(url).get('note')).toBe('Rock & Roll #1 "Fun" 💃 it\'s');
    expect(params(url).get('amount')).toBe('10.00');
  });

  it('is the plain account link when there is nothing to pay', () => {
    for (const amount of [0, -5, NaN, Infinity, null, undefined, 0.004]) {
      expect(venmoPayUrl({ amount, note: 'Salsa' })).toBe(VENMO_URL);
    }
  });

  it('names the account in one place: the plain link is the code link', () => {
    expect(VENMO_URL).toBe('https://venmo.com/code?user_id=2024335518728192092&created=1788834419');
  });

  it('says Dance with B when no class name is known', () => {
    expect(venmoPayUrl({ amount: 5, note: '' })).toBe(`${BASE}5.00&note=${encodeURIComponent('Dance with B')}`);
    expect(venmoPayUrl({ amount: 5, note: '   ' })).toContain('Dance%20with%20B');
    expect(venmoPayUrl({ amount: 5 })).toContain('Dance%20with%20B');
    expect(venmoPayUrl({ amount: 5, note: [] })).toContain('Dance%20with%20B');
  });
});

describe('venmoNote', () => {
  it('is the class name, tidied; several are joined with ", " and a repeat is said once', () => {
    expect(venmoNote(['  Bachata   1 \n'])).toBe('Bachata 1');
    expect(venmoNote(['Bachata 1', 'Salsa 2'])).toBe('Bachata 1, Salsa 2');
    expect(venmoNote(['Bachata 1', ' Bachata  1', 'Salsa 2'])).toBe('Bachata 1, Salsa 2');
    expect(venmoNote(['', '  '])).toBe('Dance with B');
  });

  it('keeps 120 characters as they are', () => {
    const exact = 'x'.repeat(120);
    expect(venmoNote([exact])).toBe(exact);
  });

  it('cuts a long list after a whole name and ends with …, 120 characters at most', () => {
    const names = Array.from({ length: 12 }, (_, i) => `Class number ${i + 10}`); // 15 chars each
    const note = venmoNote(names);
    expect(note.length).toBeLessThanOrEqual(120);
    expect(note.endsWith('…')).toBe(true);
    const kept = note.slice(0, -1).split(', ');
    expect(kept).toEqual(names.slice(0, kept.length));
    // One more name would not have fit.
    expect(`${kept.join(', ')}, ${names[kept.length]}…`.length).toBeGreaterThan(120);
  });

  it('cuts a single name that is too long at 119 characters plus …', () => {
    const note = venmoNote(['y'.repeat(300), 'Short']);
    expect(note).toBe(`${'y'.repeat(119)}…`);
    expect(note).toHaveLength(120);
  });

  it('cuts the first name, not later ones, when only it is too long', () => {
    expect(venmoNote(['z'.repeat(130), 'A'])).toBe(`${'z'.repeat(119)}…`);
  });
});

const lines: ReceiptLine[] = [
  { title: 'Bachata 1', detail: 'Whole Series', unitPrice: 40, quantity: 2, lineTotal: 80 },
  { title: 'Salsa & Sol', detail: 'Drop In · Oct 25', unitPrice: 20, quantity: 2, lineTotal: 40 },
  { title: 'Bundle', detail: 'Bundle deal', unitPrice: -10, quantity: 2, lineTotal: -20, discount: true },
];

describe('venmoPayLink (confirmation page and email)', () => {
  it('fills in the sign-up\'s subtotal and its class names, not the deal', () => {
    const url = venmoPayLink('venmo', lines, 100)!;
    expect(url.startsWith(`${BASE}100.00&note=`)).toBe(true);
    expect(params(url).get('note')).toBe('Bachata 1, Salsa & Sol');
  });

  it('is nothing for cash or another method', () => {
    expect(venmoPayLink('cash', lines, 100)).toBeNull();
    expect(venmoPayLink(null, lines, 100)).toBeNull();
    expect(venmoPayLink(undefined, lines, 100)).toBeNull();
  });

  it('is the plain account link with no subtotal', () => {
    expect(venmoPayLink('venmo', lines, null)).toBe(VENMO_URL);
    expect(venmoPayLink('venmo', [], null)).toBe(VENMO_URL);
  });
});

describe('confirmation email pay link', () => {
  const base = {
    registrationTypeLabel: 'Group Lesson',
    createdAt: new Date('2026-10-01T12:00:00Z'),
    summaryRows: [['Jo Doe', 'leader'] as [string, string]],
    receiptLines: lines,
    subtotal: 100,
    faqs: [],
    paymentNote: 'You agreed to pay with Venmo.',
  };

  it('puts "Click here to pay @amumira." on the line under the Venmo sentence, linking the pre-filled pay link', () => {
    const url = venmoPayLink('venmo', lines, 100)!;
    const html = buildRegistrationConfirmationEmailHtml({ ...base, payUrl: url });
    expect(html).toContain('You agreed to pay with Venmo.<br /><a href="https://venmo.com/amumira?txn=pay&amp;amount=100.00&amp;note=Bachata%201%2C%20Salsa%20%26%20Sol" style="color:');
    expect(html).toMatch(/>Click here to pay @amumira<\/a>\.<\/p>/);
  });

  it('links the plain account link when the sign-up has no subtotal', () => {
    const html = buildRegistrationConfirmationEmailHtml({ ...base, subtotal: null, payUrl: venmoPayLink('venmo', lines, null) });
    expect(html).toContain(`<a href="${VENMO_URL.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('Click here to pay @amumira</a>.');
  });

  it('has no such sentence for cash', () => {
    const html = buildRegistrationConfirmationEmailHtml({ ...base, paymentNote: 'You agreed to pay with cash.', payUrl: venmoPayLink('cash', lines, 100) });
    expect(html).toContain('You agreed to pay with cash.');
    expect(html).not.toContain('Click here to pay');
    expect(html).not.toContain('venmo.com');
  });
});
