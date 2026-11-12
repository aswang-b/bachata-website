import { supabase } from './supabase';
import { eventZone, siteFormatter, zoneSuffix } from './siteTime';
import type { ClassRegistrationRow } from './classRegistrations';
import { venmoNote, venmoPayUrl } from './venmoPay';

// The itemized "receipt" a dancer sees after registering, on
// /register/confirmation and in the confirmation email — the same breakdown
// /register shows live above its subtotal. Built from the saved
// class_registrations rows (prices as snapshotted at registration time), with
// identical classes across a group's dancers folded into one "× N" line.
// A bundle deal shows as its own negative line after the classes, which are
// listed at their full price, so the lines still add up to the subtotal.

export interface ReceiptLine {
  title: string;
  // "Whole Series · Sundays, 1:00 PM… (Oct 25–Nov 15)" or "Drop In · Oct 25, 1:00 PM".
  detail: string;
  unitPrice: number | null;
  quantity: number;
  lineTotal: number | null;
  // A bundle deal's discount line (negative amounts).
  discount?: boolean;
}

// "Oct 25, 1:00 PM" in the class's own zone (plus " MT" off the site's clock).
function occurrenceText(e: { start_time: string; time_zone?: string | null }): string {
  const tz = eventZone(e);
  return `${siteFormatter({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, 'en-US', tz).format(new Date(e.start_time))}${zoneSuffix(e.start_time, tz)}`;
}

export function formatPrice(value: number): string {
  const abs = Math.abs(value);
  return `${value < 0 ? '−' : ''}${Number.isInteger(abs) ? `$${abs}` : `$${abs.toFixed(2)}`}`;
}

// class_label is "<title> — <schedule>"; the schedule part alone.
function scheduleOf(row: ClassRegistrationRow): string {
  const prefix = `${row.class_title} — `;
  return row.class_label.startsWith(prefix) ? row.class_label.slice(prefix.length) : row.class_label === row.class_title ? '' : row.class_label;
}

export async function buildReceiptLines(registrations: ClassRegistrationRow[]): Promise<ReceiptLine[]> {
  // Rows a dancer removal moved to the Recycling Bin aren't part of the sign-up anymore.
  const live = registrations.filter((r) => !(r as ClassRegistrationRow & { deleted_at?: string | null }).deleted_at);

  const occurrenceIds = [...new Set(live.map((r) => r.occurrence_event_id).filter((id): id is string => Boolean(id)))];
  const whenById = new Map<string, string>();
  if (occurrenceIds.length > 0) {
    const { data, error } = await supabase.from('events').select('id, start_time, time_zone').in('id', occurrenceIds);
    if (error) console.error('Failed to load drop-in dates for the receipt:', error.message);
    for (const e of data ?? []) whenById.set(e.id, occurrenceText(e));
  }

  const lines = new Map<string, ReceiptLine>();
  for (const r of live) {
    const schedule = scheduleOf(r);
    let detail: string;
    if (r.series_mode === 'dropin') {
      const when = r.occurrence_event_id ? whenById.get(r.occurrence_event_id) : undefined;
      detail = when ? `Drop In · ${when}` : ['Drop In', schedule].filter(Boolean).join(' · ');
    } else if (r.series_mode === 'whole') {
      detail = ['Whole Series', schedule].filter(Boolean).join(' · ');
    } else {
      detail = schedule;
    }

    // The full price; a deal's discount gets its own line below.
    const price = r.price != null ? Math.round((r.price + (r.deal_discount ?? 0)) * 100) / 100 : null;
    const key = [r.class_title, detail, price ?? ''].join('|');
    const existing = lines.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.lineTotal = existing.unitPrice != null ? existing.unitPrice * existing.quantity : null;
    } else {
      lines.set(key, { title: r.class_title, detail, unitPrice: price, quantity: 1, lineTotal: price });
    }
  }
  return [...lines.values(), ...dealLines(live)];
}

// One line per bundle deal: its total discount, "× N dancers" when several got it.
function dealLines(rows: ClassRegistrationRow[]): ReceiptLine[] {
  const byDeal = new Map<string, { total: number; dancers: Set<number | null> }>();
  for (const r of rows) {
    if (!r.deal_name || !r.deal_discount) continue;
    const entry = byDeal.get(r.deal_name) ?? { total: 0, dancers: new Set() };
    entry.total += r.deal_discount;
    entry.dancers.add(r.dancer_index);
    byDeal.set(r.deal_name, entry);
  }
  return [...byDeal.entries()].map(([name, { total, dancers }]) => {
    const lineTotal = -Math.round(total * 100) / 100;
    return { title: name, detail: 'Bundle deal', unitPrice: Math.round((lineTotal / dancers.size) * 100) / 100, quantity: dancers.size, lineTotal, discount: true };
  });
}

export function receiptSubtotal(lines: ReceiptLine[]): number | null {
  return lines.some((l) => l.lineTotal != null) ? lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0) : null;
}

// "$120 × 2 dancers" (or "attendees" for an event) under a multi-person line;
// empty for a single person.
export function quantityNote(line: ReceiptLine, isEvent = false): string {
  return line.quantity > 1 && line.unitPrice != null ? `${formatPrice(line.unitPrice)} × ${line.quantity} ${isEvent ? 'attendees' : 'dancers'}` : '';
}

// The receipt's heading: event tickets aren't classes.
export const receiptHeading = (isEvent: boolean) => (isEvent ? 'Events' : 'Classes');

// The payment line under the receipt, e.g. "You agreed to pay with Venmo."
export function paymentAgreementText(method: string | null | undefined): string | null {
  if (method === 'venmo') return 'You agreed to pay with Venmo.';
  if (method === 'cash') return 'You agreed to pay with cash.';
  return null;
}

// "Click here to pay." after a Venmo agreement: the link opens Venmo's pay screen with
// the sign-up's subtotal and class names filled in (the plain account link when there
// is no subtotal). null for any other payment method.
export function venmoPayLink(method: string | null | undefined, lines: ReceiptLine[], subtotal: number | null): string | null {
  return method === 'venmo' ? venmoPayUrl({ amount: subtotal, note: venmoNote(lines.filter((l) => !l.discount).map((l) => l.title)) }) : null;
}
