import { supabase } from './supabase';
import { TIME_ZONE } from './classSeries';
import type { ClassRegistrationRow } from './classRegistrations';

// The itemized "receipt" a dancer sees after registering, on
// /register/confirmation and in the confirmation email — the same breakdown
// /register shows live above its subtotal. Built from the saved
// class_registrations rows (prices as snapshotted at registration time), with
// identical classes across a group's dancers folded into one "× N" line.

export interface ReceiptLine {
  title: string;
  // "Whole Series · Sundays, 1:00 PM… (Oct 25–Nov 15)" or "Drop In · Oct 25, 1:00 PM".
  detail: string;
  unitPrice: number | null;
  quantity: number;
  lineTotal: number | null;
}

const occurrenceFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});

export function formatPrice(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
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
  const startById = new Map<string, string>();
  if (occurrenceIds.length > 0) {
    const { data, error } = await supabase.from('events').select('id, start_time').in('id', occurrenceIds);
    if (error) console.error('Failed to load drop-in dates for the receipt:', error.message);
    for (const e of data ?? []) startById.set(e.id, e.start_time);
  }

  const lines = new Map<string, ReceiptLine>();
  for (const r of live) {
    const schedule = scheduleOf(r);
    let detail: string;
    if (r.series_mode === 'dropin') {
      const start = r.occurrence_event_id ? startById.get(r.occurrence_event_id) : undefined;
      detail = start ? `Drop In · ${occurrenceFormatter.format(new Date(start))}` : ['Drop In', schedule].filter(Boolean).join(' · ');
    } else if (r.series_mode === 'whole') {
      detail = ['Whole Series', schedule].filter(Boolean).join(' · ');
    } else {
      detail = schedule;
    }

    const key = [r.class_title, detail, r.price ?? ''].join('|');
    const existing = lines.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.lineTotal = existing.unitPrice != null ? existing.unitPrice * existing.quantity : null;
    } else {
      lines.set(key, { title: r.class_title, detail, unitPrice: r.price, quantity: 1, lineTotal: r.price });
    }
  }
  return [...lines.values()];
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
