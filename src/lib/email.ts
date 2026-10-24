import { env } from './env';
import { getNotificationRecipients } from './notificationSettings';
import { emailSinkPath, recordSunkEmail } from './testMode';
import { logSiteError } from './siteErrors';

const RESEND_API_KEY = env('RESEND_API_KEY');
const NOTIFICATION_EMAILS_ENV = env('NOTIFICATION_EMAILS');

const FROM_ADDRESS = 'Dance with B <service@dancewithb.fun>';

export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  options: { bcc?: string[] } = {}
): Promise<void> {
  if (emailSinkPath()) {
    recordSunkEmail({ to, ...(options.bcc && options.bcc.length > 0 ? { bcc: options.bcc } : {}), subject, html });
    return;
  }
  if (!RESEND_API_KEY) {
    console.warn('Skipping email: RESEND_API_KEY not set.');
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
      to,
      ...(options.bcc && options.bcc.length > 0 ? { bcc: options.bcc } : {}),
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const reason = `${res.status} ${await res.text()}`;
    // Shown in the dashboard's Errors workqueue, one line per status.
    await logSiteError('email_send', `Couldn't send "${subject}" to ${[to].flat().join(', ')}: ${reason}`.slice(0, 1000), {
      details: { to: [to].flat(), status: res.status },
      dedupeKey: `resend:${res.status}`,
    });
    throw new Error(`Failed to send email via Resend: ${reason}`);
  }
}

export async function sendAdminNotification(subject: string, html: string): Promise<void> {
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

  await sendEmail(recipients, subject, html);
}
