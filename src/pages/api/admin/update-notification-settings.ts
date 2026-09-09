import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { parseRecipientEmails, setNotificationRecipients } from '../../../lib/notificationSettings';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 20;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { recipientEmails } = body ?? {};

  if (typeof recipientEmails !== 'string') {
    return new Response(JSON.stringify({ error: 'recipientEmails must be a string.' }), { status: 400 });
  }

  const emails = parseRecipientEmails(recipientEmails);
  if (emails.length > MAX_RECIPIENTS) {
    return new Response(JSON.stringify({ error: `No more than ${MAX_RECIPIENTS} recipients.` }), { status: 400 });
  }
  const invalid = emails.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length > 0) {
    return new Response(JSON.stringify({ error: `Invalid email address: ${invalid[0]}` }), { status: 400 });
  }

  try {
    await setNotificationRecipients(emails.join(','));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update notification settings.';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
