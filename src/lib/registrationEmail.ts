// Builds the HTML for the class-registration confirmation email sent to
// dancers. Content mirrors what /register/confirmation shows (and prints):
// who's registered, the class, payment method, subtotal, and the site's FAQ
// reminders shown fully expanded (email clients don't support the on-screen
// <details> accordion interaction).

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export interface RegistrationEmailParams {
  registrationTypeLabel: string;
  createdAt: Date;
  summaryRows: [string, string][];
  subtotal: number | null;
  faqs: { question: string; answer: string }[];
}

export function buildRegistrationConfirmationEmailHtml(params: RegistrationEmailParams): string {
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(params.createdAt);

  const rowsHtml = params.summaryRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-weight:bold;vertical-align:top;color:#111;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#333;">${escapeHtml(value).replace(/\n/g, '<br/>')}</td></tr>`
    )
    .join('');

  const subtotalRowHtml =
    params.subtotal != null
      ? `<tr><td style="padding:6px 12px 6px 0;font-weight:bold;vertical-align:top;color:#111;white-space:nowrap;">Subtotal</td><td style="padding:6px 0;color:#333;">${formatPrice(params.subtotal)}</td></tr>`
      : '';

  const faqsHtml = params.faqs.length
    ? `
      <h2 style="margin:28px 0 12px;font-size:12px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:#888;">A Few Reminders</h2>
      ${params.faqs
        .map(
          (faq) => `
        <div style="margin-bottom:10px;border:1px solid #e5d9da;border-radius:12px;overflow:hidden;">
          <p style="margin:0;padding:12px 16px;font-size:14px;font-weight:600;color:#111;background:#f7f1f1;">${escapeHtml(faq.question)}</p>
          <div style="padding:12px 16px;font-size:14px;line-height:1.5;color:#333;border-top:1px solid #e5d9da;">${faq.answer}</div>
        </div>`
        )
        .join('')}
    `
    : '';

  return `
    <div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
      <h1 style="font-size:22px;margin:0 0 4px;color:#111;">Your Registration is Confirmed!</h1>
      <p style="margin:0 0 20px;color:#666;">See you in class!</p>

      <div style="border:1px solid #e5d9da;border-radius:16px;padding:20px;">
        <p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:#c0392b;">${escapeHtml(params.registrationTypeLabel)}</p>
        <p style="margin:4px 0 16px;font-size:12px;color:#888;">Submitted ${escapeHtml(dateLabel)}</p>
        <table cellpadding="0" cellspacing="0" style="font-size:14px;width:100%;">
          ${rowsHtml}
          ${subtotalRowHtml}
        </table>
      </div>

      ${faqsHtml}
    </div>
  `;
}
