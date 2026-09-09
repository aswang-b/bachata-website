import { env } from './env';
import { getNotificationRecipients } from './notificationSettings';

const RESEND_API_KEY = env('RESEND_API_KEY');
const NOTIFICATION_EMAILS_ENV = env('NOTIFICATION_EMAILS');

const FROM_ADDRESS = 'Dance with B <service@dancewithb.fun>';

export async function sendAdminNotification(subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('Skipping admin email: RESEND_API_KEY not set.');
    return;
  }

  // The admin-editable recipient list (Settings -> Notifications) is the
  // source of truth; the env var is only a fallback for before it's been set.
  let recipients = await getNotificationRecipients();
  if (recipients.length === 0 && NOTIFICATION_EMAILS_ENV) {
    recipients = NOTIFICATION_EMAILS_ENV.split(',').map((e) => e.trim()).filter(Boolean);
  }
  if (recipients.length === 0) {
    console.warn('Skipping admin email: no notification recipients configured.');
    return;
  }

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
