// Builds the HTML for the class-registration confirmation email sent to
// dancers. Content mirrors what /register/confirmation shows (and prints):
// who's registered, the class, payment method, subtotal, and the site's FAQ
// reminders (an event's community guidelines instead) shown fully expanded
// (email clients don't support the on-screen <details> accordion interaction).

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

import { siteFormatter } from './siteTime';
import { formatPrice, quantityNote, receiptHeading, type ReceiptLine } from './registrationReceipt';

export interface RegistrationEmailParams {
  registrationTypeLabel: string;
  createdAt: Date;
  summaryRows: [string, string][];
  // Itemized classes (see registrationReceipt.ts); when present they're listed
  // with the subtotal under them instead of a bare Subtotal row.
  receiptLines?: ReceiptLine[];
  subtotal: number | null;
  // An event registration: the receipt is headed "Events", per "attendees".
  isEvent?: boolean;
  // e.g. "You agreed to pay with Venmo.", shown under the classes.
  paymentNote?: string | null;
  // FAQ-style items under faqsHeading (default "A Few Reminders"). Events pass
  // their community guidelines here; an item with no question is just its text.
  faqs: { question: string; answer: string }[];
  faqsHeading?: string;
}

function receiptHtml(lines: ReceiptLine[], subtotal: number | null, isEvent: boolean): string {
  const lineRows = lines
    .map((line) => {
      const note = quantityNote(line, isEvent);
      return `<tr>
        <td style="padding:6px 12px 6px 0;vertical-align:top;color:#111;">
          <div style="font-weight:bold;">${escapeHtml(line.title)}</div>
          ${line.detail ? `<div style="font-size:12px;color:#666;">${escapeHtml(line.detail)}</div>` : ''}
        </td>
        <td style="padding:6px 0;vertical-align:top;text-align:right;color:#333;white-space:nowrap;">
          <div>${line.lineTotal != null ? formatPrice(line.lineTotal) : '—'}</div>
          ${note ? `<div style="font-size:12px;color:#666;">${escapeHtml(note)}</div>` : ''}
        </td>
      </tr>`;
    })
    .join('');
  const subtotalRow =
    subtotal != null
      ? `<tr><td style="padding:8px 12px 0 0;border-top:1px solid #e5d9da;font-weight:bold;color:#111;">Subtotal</td><td style="padding:8px 0 0;border-top:1px solid #e5d9da;text-align:right;font-weight:bold;color:#111;">${formatPrice(subtotal)}</td></tr>`
      : '';
  return `
    <p style="margin:16px 0 6px;font-size:11px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:#666;">${receiptHeading(isEvent)}</p>
    <table cellpadding="0" cellspacing="0" style="font-size:14px;width:100%;">${lineRows}${subtotalRow}</table>`;
}

export function buildRegistrationConfirmationEmailHtml(params: RegistrationEmailParams): string {
  // In the site's time zone (the server's own is UTC).
  const dateLabel = siteFormatter({ month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(params.createdAt);

  const rowsHtml = params.summaryRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-weight:bold;vertical-align:top;color:#111;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#333;">${escapeHtml(value).replace(/\n/g, '<br/>')}</td></tr>`
    )
    .join('');

  const hasReceipt = Boolean(params.receiptLines && params.receiptLines.length > 0);
  const subtotalRowHtml =
    params.subtotal != null && !hasReceipt
      ? `<tr><td style="padding:6px 12px 6px 0;font-weight:bold;vertical-align:top;color:#111;white-space:nowrap;">Subtotal</td><td style="padding:6px 0;color:#333;">${formatPrice(params.subtotal)}</td></tr>`
      : '';

  const faqsHtml = params.faqs.length
    ? `
      <h2 style="margin:28px 0 12px;font-size:12px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:#666;">${escapeHtml(params.faqsHeading ?? 'A Few Reminders')}</h2>
      ${params.faqs
        .map(
          (faq) => `
        <div style="margin-bottom:10px;border:1px solid #e5d9da;border-radius:12px;overflow:hidden;">
          ${faq.question ? `<p style="margin:0;padding:12px 16px;font-size:14px;font-weight:600;color:#111;background:#f7f1f1;border-bottom:1px solid #e5d9da;">${escapeHtml(faq.question)}</p>` : ''}
          <div style="padding:12px 16px;font-size:14px;line-height:1.5;color:#333;">${faq.answer}</div>
        </div>`
        )
        .join('')}
    `
    : '';

  return `
    <div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
      <h1 style="font-size:22px;margin:0 0 4px;color:#111;">Your Registration is Confirmed!</h1>
      <p style="margin:0 0 20px;color:#666;">${params.isEvent ? 'See you there!' : 'See you in class!'}</p>

      <div style="border:1px solid #e5d9da;border-radius:16px;padding:20px;">
        <p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:#c0392b;">${escapeHtml(params.registrationTypeLabel)}</p>
        <p style="margin:4px 0 16px;font-size:12px;color:#666;">Submitted ${escapeHtml(dateLabel)}</p>
        <table cellpadding="0" cellspacing="0" style="font-size:14px;width:100%;">
          ${rowsHtml}
          ${subtotalRowHtml}
        </table>
        ${hasReceipt ? receiptHtml(params.receiptLines!, params.subtotal, Boolean(params.isEvent)) : ''}
        ${params.paymentNote ? `<p style="margin:12px 0 0;font-size:14px;color:#333;">${escapeHtml(params.paymentNote)}</p>` : ''}
      </div>

      ${faqsHtml}
    </div>
  `;
}
