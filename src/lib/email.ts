import { env } from './env';

const RESEND_API_KEY = env('RESEND_API_KEY');
const NOTIFICATION_EMAILS = env('NOTIFICATION_EMAILS');

const FROM_ADDRESS = 'Bachata with B <service@dancewithb.fun>';

export async function sendAdminNotification(subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY || !NOTIFICATION_EMAILS) {
    console.warn('Skipping admin email: RESEND_API_KEY or NOTIFICATION_EMAILS not set.');
    return;
  }

  const recipients = NOTIFICATION_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);
  if (recipients.length === 0) return;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: recipients,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to send email via Resend: ${res.status} ${await res.text()}`);
  }
}
