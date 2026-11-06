import { EMAIL_COLORS as C, emailLayout } from './emailLayout';
import { escapeHtml, isContactRow, linkContacts } from './registrationEmail';
import { SITE_URL } from './seoSchema';
import { siteFormatter } from './siteTime';

// The admins' alert for a message from the contact form (api/submit-intake.ts),
// in the shared email look: "New contact request" with who and when, the
// details on a card (email, phone and WhatsApp as links), and buttons to reply
// and to open the inbox. Its footer says it's an admin alert instead of the
// social icons, as only admins get it.

export interface ContactAlertParams {
  name: string;
  createdAt: Date;
  // [label, value] as the form sent them; values are escaped here.
  rows: [string, string][];
  // Where Reply by email writes to, when they gave an email.
  replyTo?: string | null;
}

export function buildContactAlertHtml(p: ContactAlertParams): string {
  const when = siteFormatter({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(p.createdAt);
  const rows = p.rows
    .map(([label, value]) => {
      const shown = isContactRow(label) ? linkContacts(escapeHtml(value)) : escapeHtml(value);
      return `<tr><td style="padding:6px 14px 6px 0;vertical-align:top;color:${C.muted};font-size:14px;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;color:${C.ink};font-size:14px;">${shown.replace(/\n/g, '<br/>')}</td></tr>`;
    })
    .join('');
  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 20px;border-radius:999px;font-size:14px;font-weight:bold;text-decoration:none;${
      primary ? `background:${C.red};color:#ffffff;` : `background:#ffffff;color:${C.red};border:1px solid ${C.red};`
    }">${label}</a>`;
  const buttons = [p.replyTo ? button(`mailto:${p.replyTo}`, 'Reply by email', true) : '', button(`${SITE_URL}/admin/inbox`, 'Open the inbox', !p.replyTo)].join('');

  const body = `
      <div style="border:1px solid ${C.border};border-radius:16px;padding:16px 18px;background:#ffffff;">
        <table cellpadding="0" cellspacing="0" style="width:100%;">${rows}</table>
      </div>
      <p style="margin:18px 0 0;">${buttons}</p>`;

  return emailLayout({ heading: 'New contact request', subheading: `From ${p.name} · ${when}`, bodyHtml: body, footerNote: 'Admin alert' });
}
