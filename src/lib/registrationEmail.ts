// Builds the HTML for the class-registration confirmation email sent to
// dancers. Content mirrors what /register/confirmation shows (and prints):
// who's registered, the class, payment method, subtotal, and the site's FAQ
// reminders (an event's community guidelines instead) shown fully expanded
// (email clients don't support the on-screen <details> accordion interaction).
// It's set in the shared email look (emailLayout.ts).

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

import { siteFormatter } from './siteTime';
import { formatPrice, quantityNote, receiptHeading, type ReceiptLine } from './registrationReceipt';
import { EMAIL_COLORS as C, emailLayout } from './emailLayout';

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
  // The WhatsApp community link (lib/siteConfig.ts): its icon in the footer, beside Instagram and Spotify.
  whatsappUrl?: string | null;
}

// Email addresses and phone numbers as the site's red links, instead of the
// blue an email app adds on its own. `text` is already escaped.
const LINK = `color:${C.red};text-decoration:underline;`;
export function linkContacts(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (email) => `<a href="mailto:${email}" style="${LINK}">${email}</a>`)
    .replace(/(^|[^\w@.])(\+?\(?\d[\d ().-]{8,}\d)(?![\w@])/g, (_, before: string, phone: string) => `${before}<a href="tel:${phone.replace(/[^\d+]/g, '')}" style="${LINK}">${phone}</a>`);
}

function receiptHtml(lines: ReceiptLine[], subtotal: number | null, isEvent: boolean): string {
  const lineRows = lines
    .map((line) => {
      const note = quantityNote(line, isEvent);
      return `<tr>
        <td style="padding:6px 12px 6px 0;vertical-align:top;color:${C.ink};">
          <div style="font-weight:bold;">${escapeHtml(line.title)}</div>
          ${line.detail ? `<div style="font-size:12px;color:${C.muted};">${escapeHtml(line.detail)}</div>` : ''}
        </td>
        <td style="padding:6px 0;vertical-align:top;text-align:right;color:${C.ink};white-space:nowrap;">
          <div>${line.lineTotal != null ? formatPrice(line.lineTotal) : '—'}</div>
          ${note ? `<div style="font-size:12px;color:${C.muted};">${escapeHtml(note)}</div>` : ''}
        </td>
      </tr>`;
    })
    .join('');
  const subtotalRow =
    subtotal != null
      ? `<tr><td style="padding:8px 12px 0 0;border-top:1px solid ${C.border};font-weight:bold;color:${C.ink};">Subtotal</td><td style="padding:8px 0 0;border-top:1px solid ${C.border};text-align:right;font-weight:bold;color:${C.ink};">${formatPrice(subtotal)}</td></tr>`
      : '';
  return `
    <p style="margin:16px 0 6px;font-size:11px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">${receiptHeading(isEvent)}</p>
    <table cellpadding="0" cellspacing="0" style="font-size:14px;width:100%;">${lineRows}${subtotalRow}</table>`;
}

export function buildRegistrationConfirmationEmailHtml(params: RegistrationEmailParams): string {
  // In the site's time zone (the server's own is UTC).
  const dateLabel = siteFormatter({ month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(params.createdAt);

  const rowsHtml = params.summaryRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-weight:bold;vertical-align:top;color:${C.ink};white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;color:${C.ink};">${linkContacts(escapeHtml(value)).replace(/\n/g, '<br/>')}</td></tr>`
    )
    .join('');

  const hasReceipt = Boolean(params.receiptLines && params.receiptLines.length > 0);
  const subtotalRowHtml =
    params.subtotal != null && !hasReceipt
      ? `<tr><td style="padding:6px 12px 6px 0;font-weight:bold;vertical-align:top;color:${C.ink};white-space:nowrap;">Subtotal</td><td style="padding:6px 0;color:${C.ink};">${formatPrice(params.subtotal)}</td></tr>`
      : '';

  const faqsHtml = params.faqs.length
    ? `
      <h2 style="margin:28px 0 12px;font-size:12px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">${escapeHtml(params.faqsHeading ?? 'A Few Reminders')}</h2>
      ${params.faqs
        .map(
          (faq) => `
        <div style="margin-bottom:10px;border:1px solid ${C.border};border-radius:12px;overflow:hidden;">
          ${faq.question ? `<p style="margin:0;padding:12px 16px;font-size:14px;font-weight:600;color:${C.ink};background:${C.tint};border-bottom:1px solid ${C.border};">${escapeHtml(faq.question)}</p>` : ''}
          <div style="padding:12px 16px;font-size:14px;line-height:1.5;color:${C.ink};">${faq.answer}</div>
        </div>`
        )
        .join('')}
    `
    : '';

  const card = `
      <div style="border:1px solid ${C.border};border-radius:16px;padding:20px;background:#ffffff;">
        <p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:${C.red};">${escapeHtml(params.registrationTypeLabel)}</p>
        <p style="margin:4px 0 16px;font-size:12px;color:${C.muted};">Submitted ${escapeHtml(dateLabel)}</p>
        <table cellpadding="0" cellspacing="0" style="font-size:14px;width:100%;">
          ${rowsHtml}
          ${subtotalRowHtml}
        </table>
        ${hasReceipt ? receiptHtml(params.receiptLines!, params.subtotal, Boolean(params.isEvent)) : ''}
        ${params.paymentNote ? `<p style="margin:12px 0 0;font-size:14px;color:${C.ink};">${escapeHtml(params.paymentNote)}</p>` : ''}
      </div>`;

  return emailLayout({
    heading: 'Your Registration is Confirmed!',
    subheading: params.isEvent ? 'See you there!' : 'See you in class!',
    bodyHtml: card + faqsHtml,
    whatsappUrl: params.whatsappUrl,
  });
}
